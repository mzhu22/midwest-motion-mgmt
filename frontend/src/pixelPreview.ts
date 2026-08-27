import type Konva from "konva";
import type { LineData } from "./types";
import { COLORS } from "./types";

const DISPLAY_SCALE = 2;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Rasterizes every drawn object at the same resolution and alpha>128 threshold
// save_annotations applies (backend/imaging.py), so the returned canvas shows
// exactly which pixels will end up in the saved mask -- not the smoothed,
// anti-aliased stroke shown while actively drawing. Later objects win on overlap,
// matching the backend's write order (masks_b64 written in ascending object index).
// Returns a canvas at width*DISPLAY_SCALE x height*DISPLAY_SCALE, upscaled with no
// smoothing so it reads as the blocky per-pixel footprint it represents.
export function rasterizeExactPixels(
  stage: Konva.Stage,
  width: number,
  height: number,
  lines: LineData[]
): HTMLCanvasElement | null {
  const annotationLayer = stage.getLayers()[2];
  if (!annotationLayer) return null;

  const prevScaleX = stage.scaleX();
  const prevScaleY = stage.scaleY();
  const prevX = stage.x();
  const prevY = stage.y();
  stage.scaleX(1);
  stage.scaleY(1);
  stage.x(0);
  stage.y(0);

  const children = annotationLayer.getChildren();
  const visibility = children.map((c) => c.visible());

  const composite = document.createElement("canvas");
  composite.width = width;
  composite.height = height;
  const compositeCtx = composite.getContext("2d");

  if (compositeCtx) {
    const compositeData = compositeCtx.getImageData(0, 0, width, height);

    for (let objIdx = 1; objIdx < COLORS.length; objIdx++) {
      if (!lines.some((l) => l.objectIndex === objIdx)) continue;

      children.forEach((child, i) => {
        const line = lines[i];
        child.visible(line?.objectIndex === objIdx);
      });

      const objCanvas = annotationLayer.toCanvas({
        pixelRatio: 1 / DISPLAY_SCALE,
        width: width * DISPLAY_SCALE,
        height: height * DISPLAY_SCALE,
      });
      const objCtx = objCanvas.getContext("2d");
      if (!objCtx) continue;
      const objData = objCtx.getImageData(0, 0, width, height);
      const [r, g, b] = hexToRgb(COLORS[objIdx]!);

      for (let p = 0; p < width * height; p++) {
        if (objData.data[p * 4 + 3]! > 128) {
          compositeData.data[p * 4] = r;
          compositeData.data[p * 4 + 1] = g;
          compositeData.data[p * 4 + 2] = b;
          compositeData.data[p * 4 + 3] = 255;
        }
      }
    }
    compositeCtx.putImageData(compositeData, 0, 0);
  }

  children.forEach((child, i) => child.visible(visibility[i] ?? true));
  stage.scaleX(prevScaleX);
  stage.scaleY(prevScaleY);
  stage.x(prevX);
  stage.y(prevY);

  const upscaled = document.createElement("canvas");
  upscaled.width = width * DISPLAY_SCALE;
  upscaled.height = height * DISPLAY_SCALE;
  const upscaledCtx = upscaled.getContext("2d");
  if (upscaledCtx) {
    upscaledCtx.imageSmoothingEnabled = false;
    upscaledCtx.drawImage(composite, 0, 0, upscaled.width, upscaled.height);
  }

  return upscaled;
}
