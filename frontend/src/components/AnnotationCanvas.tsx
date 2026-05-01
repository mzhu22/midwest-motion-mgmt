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
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 10;

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
  const isPanning = useRef(false);
  const lastPanPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const [transform, setTransform] = useState({ zoom: 1, x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);

  const baseImage = useImage(`/api/frame/${frameIndex}/image`);
  const contourImage = useImage(`/api/frame/${frameIndex}/target-contour`);

  const displayW = width * DISPLAY_SCALE;
  const displayH = height * DISPLAY_SCALE;

  // Prevent native scroll when wheeling over the canvas
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;

    setTransform((prev) => {
      const factor = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.min(Math.max(prev.zoom * factor, MIN_ZOOM), MAX_ZOOM);
      return {
        zoom: newZoom,
        x: pointer.x - (pointer.x - prev.x) * (newZoom / prev.zoom),
        y: pointer.y - (pointer.y - prev.y) * (newZoom / prev.zoom),
      };
    });
  }, [stageRef]);

  // Convert stage-space pointer to original image coordinates
  const toImageCoords = (screenPos: { x: number; y: number }, stage: Konva.Stage) => ({
    x: (screenPos.x - stage.x()) / (stage.scaleX() * DISPLAY_SCALE),
    y: (screenPos.y - stage.y()) / (stage.scaleY() * DISPLAY_SCALE),
  });

  const zoomBy = useCallback((factor: number) => {
    setTransform((prev) => {
      const newZoom = Math.min(Math.max(prev.zoom * factor, MIN_ZOOM), MAX_ZOOM);
      const cx = displayW / 2;
      const cy = displayH / 2;
      return {
        zoom: newZoom,
        x: cx - (cx - prev.x) * (newZoom / prev.zoom),
        y: cy - (cy - prev.y) * (newZoom / prev.zoom),
      };
    });
  }, [displayW, displayH]);

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 1 || panMode) {
        e.evt.preventDefault();
        isPanning.current = true;
        lastPanPos.current = { x: e.evt.clientX, y: e.evt.clientY };
        return;
      }
      if (e.evt.button !== 0) return;

      isDrawing.current = true;
      const stage = e.target.getStage();
      const pos = stage?.getPointerPosition();
      if (!pos || !stage) return;

      const { x, y } = toImageCoords(pos, stage);
      const newLine: LineData = {
        points: [x, y],
        stroke: erasing ? "#000000" : COLORS[activeColorIndex]!,
        strokeWidth: brushSize,
        objectIndex: erasing ? -1 : activeColorIndex,
      };
      onLinesChange([...lines, newLine]);
    },
    [lines, onLinesChange, activeColorIndex, brushSize, erasing, panMode]
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (isPanning.current) {
        const dx = e.evt.clientX - lastPanPos.current.x;
        const dy = e.evt.clientY - lastPanPos.current.y;
        lastPanPos.current = { x: e.evt.clientX, y: e.evt.clientY };
        setTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
        return;
      }

      if (!isDrawing.current) return;
      const stage = e.target.getStage();
      const pos = stage?.getPointerPosition();
      if (!pos || !stage) return;

      const { x, y } = toImageCoords(pos, stage);
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
    isPanning.current = false;
  }, []);

  const btnStyle = (active = false): React.CSSProperties => ({
    padding: "3px 10px",
    fontSize: 13,
    border: "1px solid #ccc",
    borderRadius: 4,
    cursor: "pointer",
    background: active ? "#334155" : "#f1f5f9",
    color: active ? "#fff" : "#333",
  });

  return (
    <div ref={containerRef} style={{ display: "inline-block" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <button
          style={btnStyle(panMode)}
          title="Pan mode — drag to move the view (or use middle-mouse)"
          onClick={() => setPanMode((p) => !p)}
        >
          ✋ Pan
        </button>
        <button style={btnStyle()} title="Zoom in" onClick={() => zoomBy(1.25)}>
          + Zoom in
        </button>
        <button style={btnStyle()} title="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
          − Zoom out
        </button>
        <button
          style={btnStyle()}
          title="Reset view"
          onClick={() => setTransform({ zoom: 1, x: 0, y: 0 })}
        >
          ↺ Reset
        </button>
      </div>
      <Stage
        ref={stageRef}
        width={displayW}
        height={displayH}
        scaleX={transform.zoom}
        scaleY={transform.zoom}
        x={transform.x}
        y={transform.y}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.evt.preventDefault()}
        style={{
          border: "1px solid #ccc",
          cursor: panMode
            ? "grab"
            : "crosshair"
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
    </div>
  );
}
