import { useState, useCallback } from "react";
import FolderInput from "./components/FolderInput";
import FrameViewer from "./components/FrameViewer";
import LabelPanel from "./components/LabelPanel";
import LoadingOverlay from "./components/LoadingOverlay";
import MilestoneNav from "./components/MilestoneNav";
import type { Contour, FrameInfo } from "./types";
import { TARGET_OBJECT_INDEX } from "./types";
import { analyzeFrame, rasterizeContours } from "./contour";
import { decodeIds, encodeIds } from "./idsCodec";
import {
  compareObjectIds,
  contoursFromLoaded,
  describeMismatch,
} from "./loadAnnotations";
import type { LoadedFrame } from "./loadAnnotations";

// How many changes per frame Undo remembers.
const UNDO_DEPTH = 50;

// Each frame's contours, and for each the earlier versions Undo can step back to. One
// piece of state so an edit and its history always change together.
interface Edits {
  contours: Record<string, Contour[]>;
  history: Record<string, Contour[][]>;
}

export default function App() {
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  // Which milestone (one sagittal+coronal pair) is currently shown. Milestone m is
  // frames[2m] and frames[2m+1], since milestones always keep the sag/cor pairing.
  const [milestoneIndex, setMilestoneIndex] = useState(0);
  const [milestoneBusy, setMilestoneBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [replacedCount, setReplacedCount] = useState(0);
  // Whether the loaded folder already holds a save, from /api/load-folder.
  const [hasAnnotations, setHasAnnotations] = useState(false);
  const [loadingAnnotations, setLoadingAnnotations] = useState(false);
  const [loadNotice, setLoadNotice] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  // The earliest frame that can anchor a valid sagittal/coronal pair, from
  // /api/load-folder. Lets the sagittal-frame warning distinguish "typed frame
  // snapped to the nearest valid pair" from "typed frame was below the series' start".
  const [firstValidFrame, setFirstValidFrame] = useState<string | null>(null);
  // Index 0 is reserved for the target, which is never drawn here, so it stays empty.
  const [labels, setLabels] = useState<string[]>(Array(8).fill(""));
  const [activeColorIndex, setActiveColorIndex] = useState(1);
  const [edits, setEdits] = useState<Edits>({ contours: {}, history: {} });
  const frameContours = edits.contours;

  // Replaces one frame's contours, remembering the version being replaced for Undo.
  const changeContours = useCallback((frameIndex: string, next: Contour[]) => {
    setEdits((prev) => ({
      contours: { ...prev.contours, [frameIndex]: next },
      history: {
        ...prev.history,
        [frameIndex]: [...(prev.history[frameIndex] ?? []), prev.contours[frameIndex] ?? []].slice(
          -UNDO_DEPTH
        ),
      },
    }));
  }, []);

  const undoContours = useCallback((frameIndex: string) => {
    setEdits((prev) => {
      const past = prev.history[frameIndex] ?? [];
      if (past.length === 0) return prev;
      return {
        contours: { ...prev.contours, [frameIndex]: past[past.length - 1]! },
        history: { ...prev.history, [frameIndex]: past.slice(0, -1) },
      };
    });
  }, []);

  const milestoneCount = frames.length / 2;
  const currentPair = frames.slice(milestoneIndex * 2, milestoneIndex * 2 + 2);

  const handleLoad = useCallback(async (path: string) => {
    setLoading(true);
    setError("");
    setWarning("");
    setLoadNotice("");
    try {
      const res = await fetch("/api/load-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: path }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load");
        return;
      }
      setFrames(data.selected.flat());
      setMilestoneIndex(0);
      setEdits({ contours: {}, history: {} });
      setFirstValidFrame(data.first_valid_frame ?? null);
      setHasAnnotations(Boolean(data.has_annotations));
      setSavedPath(null);
      setReplacedCount(0);
    } catch (e) {
      setError("Failed to connect to backend");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLoadAnnotations = useCallback(async () => {
    setLoadingAnnotations(true);
    setError("");
    setWarning("");
    setLoadNotice("");
    try {
      const res = await fetch("/api/load-annotations", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load annotations");
        return;
      }
      const loaded: Record<string, LoadedFrame> = data.frames;
      const selected: FrameInfo[] = data.selected.flat();
      const nextContours: Record<string, Contour[]> = {};
      const problems: string[] = [];
      const total = { total: 0, differing: 0, outlinesIdentical: true };
      for (const frame of selected) {
        const saved = loaded[frame.frame_index];
        if (!saved) continue;
        const contours = contoursFromLoaded(saved.objects);
        nextContours[frame.frame_index] = contours;
        saved.notes.forEach((note) => problems.push(`Frame ${frame.frame_index}, ${note}`));

        // The same rasterization a save would use, against the label image on disk.
        const redrawn = rasterizeContours(frame.width, frame.height, contours);
        const result = compareObjectIds(
          decodeIds(saved.reference),
          redrawn,
          frame.width,
          frame.height
        );
        total.total += result.total;
        total.differing += result.differing;
        total.outlinesIdentical &&= result.outlinesIdentical;
      }
      const nextLabels = Array(8).fill("");
      for (const [id, label] of Object.entries<string>(data.labels ?? {})) {
        const i = Number(id);
        if (Number.isInteger(i) && i > TARGET_OBJECT_INDEX && i < nextLabels.length) {
          nextLabels[i] = label;
        }
      }

      setFrames(selected);
      setMilestoneIndex(0);
      setEdits({ contours: nextContours, history: {} });
      setLabels(nextLabels);
      setSavedPath(null);
      setReplacedCount(0);
      setLoadNotice([describeMismatch(total), ...problems].filter(Boolean).join(" "));
    } catch (e) {
      setError("Failed to connect to backend");
    } finally {
      setLoadingAnnotations(false);
    }
  }, []);

  const handleMilestoneCountChange = useCallback(async (count: number) => {
    setMilestoneBusy(true);
    setError("");
    try {
      const res = await fetch("/api/select-milestones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update milestones");
        return;
      }
      setFrames(data.selected.flat());
      setMilestoneIndex(0);
    } catch (e) {
      setError("Failed to connect to backend");
    } finally {
      setMilestoneBusy(false);
    }
  }, []);

  const handleMilestoneFrameIndexChange = useCallback(
    async (newSagittalIndex: string): Promise<string | undefined> => {
      const frameIndices = frames
        .filter((_, i) => i % 2 === 0)
        .map((f) => f.frame_index);
      frameIndices[milestoneIndex] = newSagittalIndex;

      setMilestoneBusy(true);
      setError("");
      setWarning("");
      try {
        const res = await fetch("/api/select-milestones", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frame_indices: frameIndices }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to update milestone");
          return undefined;
        }
        const selected: FrameInfo[][] = data.selected;
        setFrames(selected.flat());

        const resolvedIndex = selected[milestoneIndex]?.[0]?.frame_index;
        const requested = parseInt(newSagittalIndex, 10);
        const resolved = resolvedIndex !== undefined ? parseInt(resolvedIndex, 10) : NaN;
        if (Number.isFinite(requested) && Number.isFinite(resolved) && requested !== resolved) {
          const first = firstValidFrame !== null ? parseInt(firstValidFrame, 10) : NaN;
          if (Number.isFinite(first) && requested < first) {
            setWarning(
              `Frame ${newSagittalIndex} is before the first valid frame (${firstValidFrame}); using frame ${resolvedIndex} instead.`
            );
          } else {
            setWarning(
              `Frame ${newSagittalIndex} isn't part of a valid sagittal/coronal pair; snapped to the nearest one, frame ${resolvedIndex}.`
            );
          }
        }
        return resolvedIndex;
      } catch (e) {
        setError("Failed to connect to backend");
        return undefined;
      } finally {
        setMilestoneBusy(false);
      }
    },
    [frames, milestoneIndex, firstValidFrame]
  );

  const handleSave = useCallback(async () => {
    setError("");

    const validationErrors: string[] = [];

    // Every milestone must contribute at least one drawn object. Milestones exist to
    // give the tracker several correction points spaced across the series; one left
    // blank would seed nothing there and just fall back to the target contour alone,
    // defeating the reason that milestone was picked. An object drawn on only one
    // plane of a milestone's pair is still fine — it is simply tracked in that plane
    // alone. Milestone m is frames[2m] and frames[2m+1] (see milestoneIndex above).
    const emptyMilestones: string[] = [];
    for (let m = 0; m < frames.length; m += 2) {
      const pair = frames.slice(m, m + 2);
      const pairDrewSomething = pair.some(
        (frame) => (frameContours[frame.frame_index] ?? []).length > 0
      );
      if (!pairDrewSomething) {
        emptyMilestones.push(`Milestone ${m / 2 + 1} (sagittal frame ${frames[m]!.frame_index})`);
      }
    }
    if (emptyMilestones.length === frames.length / 2) {
      setError(
        "Draw at least one object contour before saving. The pink target contour is " +
          "reference only — it is taken from the original image automatically."
      );
      return;
    }
    if (emptyMilestones.length > 0) {
      setError(
        "Every milestone needs at least one drawn object. Empty: " +
          emptyMilestones.join(", ")
      );
      return;
    }

    // Judge the pixels that will be written, not the strokes behind them. Each outline
    // is closed by construction, so what can fail here is one object's outline crossing
    // another's and overwriting part of it.
    const analyzed = frames.map((frame) => ({
      frame,
      ...analyzeFrame(frame.width, frame.height, frameContours[frame.frame_index] ?? []),
    }));
    const usedObjectIndices = new Set<number>();
    for (const { frame, ids, unclosed } of analyzed) {
      ids.forEach((id) => id && usedObjectIndices.add(id));
      for (const idx of unclosed) {
        validationErrors.push(
          `Object ${idx} on ${frame.frame_index} (${frame.plane}) is not a closed outline`
        );
      }
    }
    for (const idx of usedObjectIndices) {
      if (!labels[idx]?.trim()) {
        validationErrors.push(`Object ${idx} has no label`);
      }
    }

    if (validationErrors.length > 0) {
      setError(validationErrors.join(". "));
      return;
    }

    setSaving(true);
    try {
      const framesData = analyzed.map(({ frame, ids }) => ({
        frame_index: frame.frame_index,
        object_ids: encodeIds(ids),
      }));

      const labelMap: Record<string, string> = {};
      labels.forEach((l, i) => {
        if (l) labelMap[String(i)] = l;
      });

      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frames: framesData, labels: labelMap }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Save failed");
      } else {
        setSavedPath(data.path ?? null);
        setReplacedCount(data.replaced?.length ?? 0);
        setHasAnnotations(true);
      }
    } catch (e) {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [frames, labels, frameContours]);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 20, maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>MR-Linac Annotation Tool</h1>
      <FolderInput onLoad={handleLoad} loading={loading} />

      {frames.length > 0 && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "#f0f4ff",
            border: "1px solid #c7d2fe",
            borderRadius: 6,
            fontSize: 15,
            lineHeight: 1.6,
            color: "#374151",
          }}
        >
          <p style={{ margin: "0 0 6px" }}>
            <strong>Instructions:</strong>
          </p>
          <p style={{ margin: "0 0 6px" }}>
            1. You can adjust the number of milestone frames to annotate, and which frame represents each milestone. By default, milestone frames are distributed evenly across the video. Try to capture a range of motion for each object to improve tracking.
          </p>
          <p style={{ margin: "0 0 6px" }}>
            2. The target is shown in <strong style={{ color: "#FF1493" }}>pink</strong>. Draw one or more <strong>additional objects</strong>: select an object on the left, then draw <strong>one stroke</strong> around it. Try to follow existing edges and high-contrast lines in the image, which will make it easier for the model to track the object. To <strong>edit</strong> an outline, select the object and draw a new stroke that <strong>starts and ends on the outline</strong>. Use <strong>↶ Undo</strong> to take back a change, or <strong>✕ Clear</strong> to start over.
          </p>
          <p style={{ margin: "0 0 6px" }}>
            3. Use <strong>↶ Undo</strong> to take back a change, or <strong>✕ Clear</strong> to start over.
          </p>
          <p style={{ margin: 0 }}>
            4. Enter a <strong>label</strong> for each object you draw. When complete, click <strong>Save Annotations</strong>. Files are saved in the same folder as the images, under the "Annotations" subfolder.
          </p>
        </div>
      )}

      {hasAnnotations && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 6,
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ flex: 1, minWidth: 240 }}>
            This folder has saved annotations. You can load them to edit the existing annotations.
          </span>
          <LoadingOverlay active={loadingAnnotations} wrapperStyle={{ display: "inline-block" }}>
            <button
              onClick={handleLoadAnnotations}
              disabled={loadingAnnotations || loading}
              style={{ padding: "6px 16px", fontSize: 14 }}
            >
              Load existing annotations
            </button>
          </LoadingOverlay>
        </div>
      )}

      {frames.length > 0 && (
        <MilestoneNav
          milestoneIndex={milestoneIndex}
          milestoneCount={milestoneCount}
          currentFrameIndex={currentPair[0]?.frame_index ?? ""}
          busy={milestoneBusy}
          onNavigate={(i) => setMilestoneIndex(Math.max(0, Math.min(i, milestoneCount - 1)))}
          onCountChange={handleMilestoneCountChange}
          onFrameIndexChange={handleMilestoneFrameIndexChange}
        />
      )}

      {error && (
        <div style={{ color: "#dc2626", marginBottom: 12, fontSize: 14 }}>
          {error}
        </div>
      )}

      {!error && loadNotice && (
        <div style={{ color: "#374151", marginBottom: 12, fontSize: 14 }}>{loadNotice}</div>
      )}

      {!error && warning && (
        <div style={{ color: "#92400e", marginBottom: 12, fontSize: 14 }}>
          {warning}
        </div>
      )}

      {frames.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
          <LabelPanel
            labels={labels}
            onLabelsChange={setLabels}
            activeColorIndex={activeColorIndex}
            onActiveColorChange={setActiveColorIndex}
            onSave={handleSave}
            saving={saving}
            savedPath={savedPath}
            replacedCount={replacedCount}
          />
          <LoadingOverlay
            active={milestoneBusy}
            wrapperStyle={{ display: "flex", flexWrap: "wrap", gap: 20, flex: 1, minWidth: 0 }}
          >
            {frames.map((frame, i) => {
              // Every milestone's frame stays mounted for the whole session, even ones
              // not currently shown, so each keeps its zoom and pan.
              const isCurrentMilestone = Math.floor(i / 2) === milestoneIndex;
              return (
                <div
                  key={frame.frame_index}
                  style={{ display: isCurrentMilestone ? "block" : "none" }}
                >
                  <FrameViewer
                    frame={frame}
                    activeColorIndex={activeColorIndex}
                    activeLabel={labels[activeColorIndex]?.trim() || `Object ${activeColorIndex}`}
                    labels={labels}
                    contours={frameContours[frame.frame_index] ?? []}
                    onContoursChange={(next) => changeContours(frame.frame_index, next)}
                    onClearActiveObject={() =>
                      changeContours(
                        frame.frame_index,
                        (frameContours[frame.frame_index] ?? []).filter(
                          (c) => c.objectIndex !== activeColorIndex
                        )
                      )
                    }
                    onUndo={() => undoContours(frame.frame_index)}
                    canUndo={(edits.history[frame.frame_index] ?? []).length > 0}
                    onNotice={setWarning}
                  />
                </div>
              );
            })}
          </LoadingOverlay>
        </div>
      )}
    </div>
  );
}
