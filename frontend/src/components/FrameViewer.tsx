import type Konva from "konva";
import AnnotationCanvas from "./AnnotationCanvas";
import type { FrameInfo, LineData } from "../types";

interface Props {
  frame: FrameInfo;
  activeColorIndex: number;
  brushSize: number;
  erasing: boolean;
  lines: LineData[];
  onLinesChange: (lines: LineData[]) => void;
  stageRef: React.RefObject<Konva.Stage>;
}

export default function FrameViewer({
  frame,
  activeColorIndex,
  brushSize,
  erasing,
  lines,
  onLinesChange,
  stageRef,
}: Props) {
  return (
    <div style={{ flex: "1 1 auto", minWidth: 200, maxWidth: "100%", overflow: "auto" }}>
      <div style={{ marginBottom: 8, fontSize: 14 }}>
        <strong>Frame {frame.frame_index}</strong> — {frame.plane}
        <span style={{ color: "#888", marginLeft: 8 }}>
          ({frame.width}×{frame.height})
        </span>
      </div>
      <AnnotationCanvas
        frameIndex={frame.frame_index}
        width={frame.width}
        height={frame.height}
        activeColorIndex={activeColorIndex}
        brushSize={brushSize}
        erasing={erasing}
        lines={lines}
        onLinesChange={onLinesChange}
        stageRef={stageRef}
      />
    </div>
  );
}
