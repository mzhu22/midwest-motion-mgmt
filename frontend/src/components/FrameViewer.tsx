import { useMemo } from "react";
import AnnotationCanvas from "./AnnotationCanvas";
import type { Contour, FrameInfo } from "../types";
import { COLORS } from "../types";
import { analyzeFrame } from "../contour";
import { btnStyle } from "./buttonStyle";

interface Props {
  frame: FrameInfo;
  activeColorIndex: number;
  activeLabel: string;
  // Every object's name, indexed by object id, for naming the ones with a problem.
  labels: string[];
  contours: Contour[];
  onContoursChange: (contours: Contour[]) => void;
  onClearActiveObject: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onNotice: (message: string) => void;
}

export default function FrameViewer({
  frame,
  activeColorIndex,
  activeLabel,
  labels,
  contours,
  onContoursChange,
  onClearActiveObject,
  onUndo,
  canUndo,
  onNotice,
}: Props) {
  const hasContour = contours.some((c) => c.objectIndex === activeColorIndex);

  // The pixels exactly as they will be saved, and which objects would be refused. Every
  // frame is mounted for the whole session, so this runs once per change, not per paint.
  const { ids, unclosed } = useMemo(
    () => analyzeFrame(frame.width, frame.height, contours),
    [frame.width, frame.height, contours]
  );

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
          onClick={onUndo}
          disabled={!canUndo}
          title={canUndo ? "Undo the last change on this frame" : "Nothing to undo on this frame"}
          style={{
            ...btnStyle(),
            cursor: canUndo ? "pointer" : "not-allowed",
            opacity: canUndo ? 1 : 0.5,
          }}
        >
          ↶ Undo
        </button>
        <button
          onClick={onClearActiveObject}
          disabled={!hasContour}
          title={
            hasContour
              ? `Remove the "${activeLabel}" contour on this frame so you can draw it again`
              : `Nothing drawn for "${activeLabel}" on this frame`
          }
          style={{
            ...btnStyle(),
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: hasContour ? "pointer" : "not-allowed",
            opacity: hasContour ? 1 : 0.5,
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
          ✕ Clear
        </button>
      </div>
      {unclosed.length > 0 && (
        <div role="alert" style={{ color: "#dc2626", fontSize: 13, marginBottom: 6 }}>
          {unclosed
            .map((i) => labels[i]?.trim() || `Object ${i}`)
            .join(", ")}{" "}
          {unclosed.length === 1 ? "is" : "are"} not a closed outline on this frame — another
          object's outline probably crosses it. Reshape one of them, or Undo.
        </div>
      )}
      <AnnotationCanvas
        frameIndex={frame.frame_index}
        width={frame.width}
        height={frame.height}
        activeColorIndex={activeColorIndex}
        activeLabel={activeLabel}
        contours={contours}
        ids={ids}
        onContoursChange={onContoursChange}
        onNotice={onNotice}
      />
    </div>
  );
}
