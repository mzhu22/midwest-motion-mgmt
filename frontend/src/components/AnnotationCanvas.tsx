import { useRef, useState, useEffect, useCallback } from "react";
import { Stage, Layer, Line, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import type { LineData } from "../types";
import { COLORS } from "../types";

interface Props {
  frameIndex: string;
  width: number;
  height: number;
  activeColorIndex: number;
  brushSize: number;
  erasing: boolean;
  lines: LineData[];
  onLinesChange: (lines: LineData[]) => void;
  stageRef: React.RefObject<Konva.Stage>;
}

function useImage(src: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImage(img);
    img.src = src;
  }, [src]);
  return image;
}

const DISPLAY_SCALE = 2;

export default function AnnotationCanvas({
  frameIndex,
  width,
  height,
  activeColorIndex,
  brushSize,
  erasing,
  lines,
  onLinesChange,
  stageRef,
}: Props) {
  const isDrawing = useRef(false);
  const baseImage = useImage(`/api/frame/${frameIndex}/image`);
  const contourImage = useImage(`/api/frame/${frameIndex}/target-contour`);

  const displayW = width * DISPLAY_SCALE;
  const displayH = height * DISPLAY_SCALE;

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      isDrawing.current = true;
      const pos = e.target.getStage()?.getPointerPosition();
      if (!pos) return;
      const x = pos.x / DISPLAY_SCALE;
      const y = pos.y / DISPLAY_SCALE;
      const newLine: LineData = {
        points: [x, y],
        stroke: erasing ? "#000000" : COLORS[activeColorIndex]!,
        strokeWidth: brushSize,
        objectIndex: erasing ? -1 : activeColorIndex,
      };
      onLinesChange([...lines, newLine]);
    },
    [lines, onLinesChange, activeColorIndex, brushSize, erasing]
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isDrawing.current) return;
      const pos = e.target.getStage()?.getPointerPosition();
      if (!pos) return;
      const x = pos.x / DISPLAY_SCALE;
      const y = pos.y / DISPLAY_SCALE;
      const updated = [...lines];
      const last = updated[updated.length - 1];
      if (!last) return;
      last.points = [...last.points, x, y];
      onLinesChange(updated);
    },
    [lines, onLinesChange]
  );

  const handleMouseUp = useCallback(() => {
    isDrawing.current = false;
  }, []);

  return (
    <Stage
      ref={stageRef}
      width={displayW}
      height={displayH}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        border: "1px solid #ccc",
        cursor: erasing
          ? "crosshair"
          : "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E%3Cpath d='M14.5 1.5l4 4L6 18H2v-4L14.5 1.5z' fill='%23333' stroke='%23fff' stroke-width='0.5'/%3E%3C/svg%3E\") 0 20, crosshair",
      }}
    >
      <Layer>
        {baseImage && (
          <KonvaImage image={baseImage} width={displayW} height={displayH} />
        )}
      </Layer>
      <Layer>
        {contourImage && (
          <KonvaImage
            image={contourImage}
            width={displayW}
            height={displayH}
            opacity={0.8}
          />
        )}
      </Layer>
      <Layer>
        {lines.map((line, i) => (
          <Line
            key={i}
            points={line.points.map((p) => p * DISPLAY_SCALE)}
            stroke={line.stroke}
            strokeWidth={line.strokeWidth * DISPLAY_SCALE}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
            globalCompositeOperation={
              line.objectIndex === -1 ? "destination-out" : "source-over"
            }
            opacity={line.objectIndex === -1 ? 1 : 0.6}
          />
        ))}
      </Layer>
    </Stage>
  );
}
