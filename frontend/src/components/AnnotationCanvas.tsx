import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Stage, Layer, Line, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import type { Contour } from "../types";
import { COLORS } from "../types";
import { commitStroke } from "../contour";
import { idsToCanvas } from "../pixelPreview";
import { btnStyle } from "./buttonStyle";
import LoadingOverlay from "./LoadingOverlay";

interface Props {
  frameIndex: string;
  width: number;
  height: number;
  activeColorIndex: number;
  // What to call the active object in messages ("liver", or "Object 2" if unnamed).
  activeLabel: string;
  contours: Contour[];
  // One object id per pixel for `contours`, exactly as it will be saved.
  ids: Uint8Array;
  onContoursChange: (contours: Contour[]) => void;
  // A stroke that changed nothing explains why; "" clears the previous explanation.
  onNotice: (message: string) => void;
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
  activeLabel,
  contours,
  ids,
  onContoursChange,
  onNotice,
}: Props) {
  const stageRef = useRef<Konva.Stage>(null);
  const isDrawing = useRef(false);
  // The stroke being dragged, in image coordinates. A ref as well as state: mouse
  // events append to the ref (always current), the state only drives the redraw.
  const strokeRef = useRef<number[]>([]);
  const [stroke, setStroke] = useState<number[]>([]);
  const isPanning = useRef(false);
  const lastPanPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const [transform, setTransform] = useState({ zoom: 1, x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const baseImage = useImage(`/api/frame/${frameIndex}/image`);
  const contourImage = useImage(`/api/frame/${frameIndex}/target-contour`);

  const displayW = width * DISPLAY_SCALE;
  const displayH = height * DISPLAY_SCALE;

  // The exact pixels that will be saved for the contours drawn so far -- see
  // pixelPreview.ts. What is on screen is what gets written.
  const pixelPreview = useMemo(
    () => idsToCanvas(ids, width, height),
    [ids, width, height]
  );

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

      const stage = e.target.getStage();
      const pos = stage?.getPointerPosition();
      if (!pos || !stage) return;

      isDrawing.current = true;
      const { x, y } = toImageCoords(pos, stage);
      strokeRef.current = [x, y];
      setStroke(strokeRef.current);
    },
    [panMode]
  );

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
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
    strokeRef.current = [...strokeRef.current, x, y];
    setStroke(strokeRef.current);
  }, []);

  // A finished stroke either creates the active object's outline or reshapes it; see
  // commitStroke. Whatever it decides, the stroke itself is not kept.
  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
    if (!isDrawing.current) return;
    isDrawing.current = false;

    const finished = strokeRef.current;
    strokeRef.current = [];
    setStroke([]);

    const result = commitStroke({
      existing: contours.find((c) => c.objectIndex === activeColorIndex),
      objectIndex: activeColorIndex,
      stroke: finished,
      width,
      height,
      name: activeLabel,
    });
    if (!result.ok) {
      if (result.reason) onNotice(result.reason);
      return;
    }
    onNotice("");
    onContoursChange([
      ...contours.filter((c) => c.objectIndex !== activeColorIndex),
      result.contour,
    ]);
  }, [contours, activeColorIndex, activeLabel, width, height, onContoursChange, onNotice]);

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
      <LoadingOverlay active={!baseImage} wrapperStyle={{ display: "inline-block" }}>
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
          <Layer listening={false}>
            <KonvaImage image={pixelPreview} width={displayW} height={displayH} />
          </Layer>
          <Layer listening={false}>
            {stroke.length >= 4 && (
              <Line
                points={stroke.map((p) => p * DISPLAY_SCALE)}
                stroke={COLORS[activeColorIndex]}
                strokeWidth={DISPLAY_SCALE}
                lineCap="round"
                lineJoin="round"
                opacity={0.8}
              />
            )}
          </Layer>
        </Stage>
      </LoadingOverlay>
    </div>
  );
}
