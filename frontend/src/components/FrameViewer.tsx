import type Konva from "konva";
import AnnotationCanvas from "./AnnotationCanvas";
import type { FrameInfo, LineData } from "../types";
import { COLORS } from "../types";
import { btnStyle } from "./buttonStyle";

interface Props {
  frame: FrameInfo;
  activeColorIndex: number;
  activeLabel: string;
  brushSize: number;
  lines: LineData[];
  onLinesChange: (lines: LineData[]) => void;
  onClearActiveObject: () => void;
  stageRef: React.RefObject<Konva.Stage>;
}

export default function FrameViewer({
  frame,
  activeColorIndex,
  activeLabel,
  brushSize,
  lines,
  onLinesChange,
  onClearActiveObject,
  stageRef,
}: Props) {
  const hasStrokes = lines.some((l) => l.objectIndex === activeColorIndex);

  return (
    <div style={{ flex: "1 1 auto", minWidth: 200, maxWidth: "100%", overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, fontSize: 14 }}>
        <span>
          <strong>Frame {frame.frame_index}</strong> — {frame.plane}
          <span style={{ color: "#888", marginLeft: 8 }}>
            ({frame.width}×{frame.height})
          </span>
        </span>
        <button
          onClick={onClearActiveObject}
          disabled={!hasStrokes}
          title={
            hasStrokes
              ? `Remove the "${activeLabel}" contour on this frame so you can draw it again`
              : `Nothing drawn for "${activeLabel}" on this frame`
          }
          style={{
            ...btnStyle(),
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: hasStrokes ? "pointer" : "not-allowed",
            opacity: hasStrokes ? 1 : 0.5,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: COLORS[activeColorIndex],
              flexShrink: 0,
            }}
          />
          ✕ Clear contour
        </button>
      </div>
      <AnnotationCanvas
        frameIndex={frame.frame_index}
        width={frame.width}
        height={frame.height}
        activeColorIndex={activeColorIndex}
        brushSize={brushSize}
        lines={lines}
        onLinesChange={onLinesChange}
        stageRef={stageRef}
      />
    </div>
  );
}
