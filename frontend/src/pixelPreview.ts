import { COLORS } from "./types";

const DISPLAY_SCALE = 2;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Draws a label image (one object id per pixel, 0 = none) as a canvas, each pixel in its
// object's colour, upscaled with no smoothing so it reads as the blocky per-pixel
// footprint it is. These are the very pixels that get saved: the preview is not an
// approximation of the save.
export function idsToCanvas(ids: Uint8Array, width: number, height: number): HTMLCanvasElement {
  const small = document.createElement("canvas");
  small.width = width;
  small.height = height;
  const smallCtx = small.getContext("2d");
  if (smallCtx) {
    const data = smallCtx.getImageData(0, 0, width, height);
    for (let p = 0; p < width * height; p++) {
      const objIdx = ids[p]!;
      if (objIdx === 0) continue;
      const [r, g, b] = hexToRgb(COLORS[objIdx]!);
      data.data[p * 4] = r;
      data.data[p * 4 + 1] = g;
      data.data[p * 4 + 2] = b;
      data.data[p * 4 + 3] = 255;
    }
    smallCtx.putImageData(data, 0, 0);
  }

  const upscaled = document.createElement("canvas");
  upscaled.width = width * DISPLAY_SCALE;
  upscaled.height = height * DISPLAY_SCALE;
  const upscaledCtx = upscaled.getContext("2d");
  if (upscaledCtx) {
    upscaledCtx.imageSmoothingEnabled = false;
    upscaledCtx.drawImage(small, 0, 0, upscaled.width, upscaled.height);
  }
  return upscaled;
}
