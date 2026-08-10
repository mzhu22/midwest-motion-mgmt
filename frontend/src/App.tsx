import { useState, useRef, useCallback } from "react";
import type Konva from "konva";
import FolderInput from "./components/FolderInput";
import FrameViewer from "./components/FrameViewer";
import LabelPanel from "./components/LabelPanel";
import type { FrameInfo, LineData } from "./types";
import { exportMasksForFrame } from "./exportMasks";
import { isEnclosed } from "./validation";

export default function App() {
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [replacedCount, setReplacedCount] = useState(0);
  const [error, setError] = useState("");
  // Index 0 is reserved for the target, which is never drawn here, so it stays empty.
  const [labels, setLabels] = useState<string[]>(Array(8).fill(""));
  const [activeColorIndex, setActiveColorIndex] = useState(1);
  const brushSize = 2;
  const [frameLines, setFrameLines] = useState<Record<string, LineData[]>>({});

  const stageRefs = [
    useRef<Konva.Stage | null>(null),
    useRef<Konva.Stage | null>(null),
  ];

  const handleLoad = useCallback(async (path: string) => {
    setLoading(true);
    setError("");
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
      setFrames(data.frames);
      setFrameLines({});
    } catch (e) {
      setError("Failed to connect to backend");
    } finally {
      setLoading(false);
    }
  }, []);

  const exportMasks = useCallback(
    (frameIdx: number): string[] => {
      const frame = frames[frameIdx];
      const stage = stageRefs[frameIdx]?.current;
      if (!frame || !stage) return Array(8).fill("");
      const lines = frameLines[frame.frame_index] ?? [];
      return exportMasksForFrame(stage, frame, lines);
    },
    [frames, frameLines, stageRefs]
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
      const framesData = frames.map((frame, i) => ({
        frame_index: frame.frame_index,
        masks: exportMasks(i),
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
  }, [frames, labels, exportMasks]);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 20, maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>MR-Linac Annotation Tool</h1>
      <FolderInput onLoad={handleLoad} loading={loading} />

      {error && (
        <div style={{ color: "#dc2626", marginBottom: 12, fontSize: 14 }}>
          {error}
        </div>
      )}

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
            {frames.map((frame, i) => (
              <FrameViewer
                key={frame.frame_index}
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
                stageRef={stageRefs[i]!}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
