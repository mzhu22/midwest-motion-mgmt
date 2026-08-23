import { useState, useRef, useCallback } from "react";
import type Konva from "konva";
import FolderInput from "./components/FolderInput";
import FrameViewer from "./components/FrameViewer";
import LabelPanel from "./components/LabelPanel";
import MilestoneNav from "./components/MilestoneNav";
import type { FrameInfo, LineData } from "./types";
import { exportMasksForFrame } from "./exportMasks";
import { isEnclosed } from "./validation";

// A ref-shaped object with the same {current} contract useRef returns, so each
// frame's Stage can be looked up by frame_index instead of positional array index —
// the frame count is no longer fixed at 2, so a fixed-size ref array cannot key them.
type StageRef = { current: Konva.Stage | null };

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
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  // The earliest frame that can anchor a valid sagittal/coronal pair, from
  // /api/load-folder. Lets the sagittal-frame warning distinguish "typed frame
  // snapped to the nearest valid pair" from "typed frame was below the series' start".
  const [firstValidFrame, setFirstValidFrame] = useState<string | null>(null);
  // Index 0 is reserved for the target, which is never drawn here, so it stays empty.
  const [labels, setLabels] = useState<string[]>(Array(8).fill(""));
  const [activeColorIndex, setActiveColorIndex] = useState(1);
  const brushSize = 2;
  const [frameLines, setFrameLines] = useState<Record<string, LineData[]>>({});

  const milestoneCount = frames.length / 2;
  const currentPair = frames.slice(milestoneIndex * 2, milestoneIndex * 2 + 2);

  const stageRefsMap = useRef(new Map<string, StageRef>());
  const getStageRef = useCallback((frameIndex: string): StageRef => {
    let ref = stageRefsMap.current.get(frameIndex);
    if (!ref) {
      ref = { current: null };
      stageRefsMap.current.set(frameIndex, ref);
    }
    return ref;
  }, []);

  const handleLoad = useCallback(async (path: string) => {
    setLoading(true);
    setError("");
    setWarning("");
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
      setFrameLines({});
      setFirstValidFrame(data.first_valid_frame ?? null);
    } catch (e) {
      setError("Failed to connect to backend");
    } finally {
      setLoading(false);
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

  const exportMasksFor = useCallback(
    (frameIndex: string): string[] => {
      const frame = frames.find((f) => f.frame_index === frameIndex);
      const stage = stageRefsMap.current.get(frameIndex)?.current;
      if (!frame || !stage) return Array(8).fill("");
      const lines = frameLines[frameIndex] ?? [];
      return exportMasksForFrame(stage, frame, lines);
    },
    [frames, frameLines]
  );

  const handleSave = useCallback(async () => {
    setError("");

    const validationErrors: string[] = [];

    // An object drawn on only one plane is fine — it is simply tracked in that plane
    // alone. Drawing nothing at all is not: the target contour is saved from the
    // original image either way, so such a save would add nothing.
    const drewSomething = frames.some(
      (frame) => (frameLines[frame.frame_index] ?? []).length > 0
    );
    if (!drewSomething) {
      setError(
        "Draw at least one object contour before saving. The pink target contour is " +
          "reference only — it is taken from the original image automatically."
      );
      return;
    }

    const usedObjectIndices = new Set<number>();
    for (const frame of frames) {
      const lines = frameLines[frame.frame_index] ?? [];
      const objIndices = new Set(lines.map((l) => l.objectIndex));
      for (const idx of objIndices) {
        usedObjectIndices.add(idx);
        const objStrokes = lines.filter((l) => l.objectIndex === idx);
        if (!isEnclosed(objStrokes)) {
          validationErrors.push(
            `Object ${idx} on ${frame.frame_index} (${frame.plane}) does not form an enclosed shape`
          );
        }
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
      const framesData = frames.map((frame) => ({
        frame_index: frame.frame_index,
        masks: exportMasksFor(frame.frame_index),
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
      }
    } catch (e) {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [frames, labels, exportMasksFor]);

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
          <strong>Instructions: </strong>
          <br />
          The target contour is shown in <strong style={{ color: "#FF1493" }}>pink</strong>. Draw one or more <strong>additional objects</strong>: select an object on the left, then draw a contour over it. Try to follow existing edges and high-contrast lines in the image, which will make it easier for the model to track the object. To fix a mistake, click <strong>✕ Clear</strong> above that frame. An object drawn on only one frame is tracked in that plane only.
          <br /><br />
          Enter a <strong>label</strong> for each object you draw. When complete, click <strong>Save Annotations</strong>. Files are saved in the same folder as the images, under the "Annotations" subfolder.
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, flex: 1, minWidth: 0 }}>
            {frames.map((frame, i) => {
              // Every milestone's frame stays mounted for the whole session — even
              // ones not currently shown — because handleSave exports masks from
              // each frame's Konva stage, which requires the stage to exist.
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
                    brushSize={brushSize}
                    lines={frameLines[frame.frame_index] ?? []}
                    onLinesChange={(newLines) =>
                      setFrameLines((prev) => ({
                        ...prev,
                        [frame.frame_index]: newLines,
                      }))
                    }
                    onClearActiveObject={() =>
                      setFrameLines((prev) => ({
                        ...prev,
                        [frame.frame_index]: (prev[frame.frame_index] ?? []).filter(
                          (l) => l.objectIndex !== activeColorIndex
                        ),
                      }))
                    }
                    stageRef={getStageRef(frame.frame_index)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
