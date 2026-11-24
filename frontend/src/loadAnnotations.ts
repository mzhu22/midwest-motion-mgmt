import type { Contour } from "./types";
import { COLORS } from "./types";
import { filledObject } from "./closure";

// What /api/load-annotations returns for one frame: each object's single closed contour
// as flat [x0, y0, x1, y1, ...] image coordinates, anything worth telling the user about
// how it was recovered, and the saved label image (one byte per pixel, 0 = no object,
// base64) so the redrawn contours can be checked against it.
export interface LoadedFrame {
  objects: Record<string, number[]>;
  notes: string[];
  reference: string;
}

export function contoursFromLoaded(objects: Record<string, number[]>): Contour[] {
  const contours: Contour[] = [];
  for (const [id, points] of Object.entries(objects)) {
    const objectIndex = Number(id);
    if (!Number.isInteger(objectIndex) || objectIndex < 1 || COLORS[objectIndex] === undefined) {
      continue;
    }
    if (points.length < 2) continue;
    contours.push({ objectIndex, points });
  }
  return contours;
}

export interface Mismatch {
  // Pixels that belong to an object's filled region in either image.
  total: number;
  // Of those, pixels where the two images disagree.
  differing: number;
  // Whether the outlines themselves are pixel-for-pixel identical.
  outlinesIdentical: boolean;
}

// Compares what was saved with what the redrawn contours would save. Judged on the
// filled regions, because that is what the tracker is seeded with: a saved outline that
// was a pixel thicker than the redrawn one differs on the outline but encloses nearly
// the same region.
export function compareObjectIds(
  saved: Uint8Array,
  redrawn: Uint8Array,
  width: number,
  height: number
): Mismatch {
  const ids = new Set<number>();
  for (const image of [saved, redrawn]) {
    for (let p = 0; p < image.length; p++) if (image[p]) ids.add(image[p]!);
  }
  let total = 0;
  let differing = 0;
  for (const id of ids) {
    const a = filledObject(saved, width, height, id);
    const b = filledObject(redrawn, width, height, id);
    for (let p = 0; p < a.length; p++) {
      if (!a[p] && !b[p]) continue;
      total++;
      if (a[p] !== b[p]) differing++;
    }
  }
  let outlinesIdentical = saved.length === redrawn.length;
  for (let p = 0; outlinesIdentical && p < saved.length; p++) {
    if (saved[p] !== redrawn[p]) outlinesIdentical = false;
  }
  return { total, differing, outlinesIdentical };
}

export function describeMismatch({ total, differing, outlinesIdentical }: Mismatch): string {
  if (total === 0) return "";
  if (outlinesIdentical) return "The loaded contours match the saved masks exactly.";
  if (differing === 0) {
    return "The loaded contours enclose the same regions as the saved masks (the outlines differ by a pixel or so).";
  }
  const pct = ((100 * differing) / total).toFixed(1);
  return (
    `The loaded contours differ from the saved masks by ${differing} of ${total} ` +
    `pixels (${pct}%) of the regions they enclose. Masks saved by an older version ` +
    `were thicker, so they are reduced to a centerline; where objects overlapped only ` +
    `the later one was saved.`
  );
}
