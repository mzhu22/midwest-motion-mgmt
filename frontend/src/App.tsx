import { useState, useRef, useCallback } from "react";
import type Konva from "konva";
import FolderInput from "./components/FolderInput";
import FrameViewer from "./components/FrameViewer";
import LabelPanel from "./components/LabelPanel";
import type { FrameInfo, LineData } from "./types";
import { isEnclosed } from "./validation";

export default function App() {
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [labels, setLabels] = useState<string[]>(["target", ...Array(7).fill("")]);
  const [activeColorIndex, setActiveColorIndex] = useState(0);
  const brushSize = 1;
  const [erasing, setErasing] = useState(false);
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

  const exportMasksForFrame = useCallback(
    (frameIdx: number): string[] => {
      const frame = frames[frameIdx];
      const stage = stageRefs[frameIdx]?.current;
      if (!frame || !stage) return Array(8).fill("");

      const lines = frameLines[frame.frame_index] ?? [];
      const annotationLayer = stage.getLayers()[2];
      if (!annotationLayer) return Array(8).fill("");

      const masks: string[] = [];
      const scale = 2; // DISPLAY_SCALE from AnnotationCanvas

      for (let objIdx = 0; objIdx < 8; objIdx++) {
        const children = annotationLayer.getChildren();
        const visibility: boolean[] = [];

        children.forEach((child, i) => {
          visibility.push(child.visible());
          const line = lines[i];
          child.visible(line?.objectIndex === objIdx);
        });

        const dataUrl = annotationLayer.toDataURL({
          pixelRatio: 1 / scale,
          width: frame.width * scale,
          height: frame.height * scale,
        });

        children.forEach((child, i) => {
          child.visible(visibility[i] ?? true);
        });

        const hasStrokes = lines.some((l) => l.objectIndex === objIdx);
        masks.push(hasStrokes ? dataUrl.split(",")[1] ?? "" : "");
      }
      return masks;
    },
    [frames, frameLines, stageRefs]
  );

  const handleSave = useCallback(async () => {
    setError("");

    const validationErrors: string[] = [];

    for (const frame of frames) {
      const lines = frameLines[frame.frame_index] ?? [];
      if (lines.length === 0) {
        validationErrors.push(`No contour drawn on ${frame.frame_index} (${frame.plane})`);
      }
    }

    const usedObjectIndices = new Set<number>();
    for (const frame of frames) {
      const lines = frameLines[frame.frame_index] ?? [];
      const drawLines = lines.filter((l) => l.objectIndex !== -1);
      const objIndices = new Set(drawLines.map((l) => l.objectIndex));
      for (const idx of objIndices) {
        usedObjectIndices.add(idx);
        const objStrokes = drawLines.filter((l) => l.objectIndex === idx);
        if (!isEnclosed(objStrokes)) {
          validationErrors.push(
            `Object ${idx + 1} on ${frame.frame_index} (${frame.plane}) does not form an enclosed shape`
          );
        }
      }
    }
    for (const idx of usedObjectIndices) {
      if (!labels[idx]?.trim()) {
        validationErrors.push(`Object ${idx + 1} has no label`);
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
        masks: exportMasksForFrame(i),
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
      }
    } catch (e) {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [frames, labels, exportMasksForFrame]);

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
          Select an object on the left, then draw a contour over the object on each frame. The original target contour is shown in pink for reference.
          Try to follow existing edges and high-contrast lines in the image, which will make it easier for the model to track the object. Use <strong>Eraser</strong> to remove strokes, or <strong>X</strong> to clear all strokes for an object.
          <br /><br />
          Enter a <strong>label</strong> for each object you draw (other than the target). When complete, click <strong>Save Annotations</strong>. Files are saved in the same folder as the images, under the "Annotations" subfolder.
        </div>
      )}

      {frames.length > 0 && (
        <div style={{ display: "flex", gap: 20 }}>
          <LabelPanel
            labels={labels}
            onLabelsChange={setLabels}
            activeColorIndex={activeColorIndex}
            onActiveColorChange={setActiveColorIndex}
            erasing={erasing}
            onErasingChange={setErasing}
            onSave={handleSave}
            saving={saving}
            savedPath={savedPath}
            onClearObject={(objIdx) =>
              setFrameLines((prev) => {
                const next: typeof prev = {};
                for (const [key, lines] of Object.entries(prev)) {
                  next[key] = lines.filter((l) => l.objectIndex !== objIdx);
                }
                return next;
              })
            }
          />
          <div style={{ display: "flex", gap: 20, flex: 1 }}>
            {frames.map((frame, i) => (
              <FrameViewer
                key={frame.frame_index}
                frame={frame}
                activeColorIndex={activeColorIndex}
                brushSize={brushSize}
                erasing={erasing}
                lines={frameLines[frame.frame_index] ?? []}
                onLinesChange={(newLines) =>
                  setFrameLines((prev) => ({
                    ...prev,
                    [frame.frame_index]: newLines,
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
