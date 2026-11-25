import type { Contour } from "./types";
import { isClosed, unclosedObjects } from "./closure";

// How the frontend turns what the user draws into what gets saved.
//
// Each object on a frame is ONE closed polygon. A first stroke becomes that polygon
// (closed automatically); a later stroke that starts and ends on it replaces the section
// of the outline it runs alongside. Nothing is ever erased, so an outline cannot be left
// with a gap by editing it -- the failure mode of free brush strokes plus an eraser.
//
// The polygon is rasterized with plain integer line drawing (no canvas anti-aliasing, no
// opacity, no alpha cutoff), so the saved pixels are exactly the pixels previewed on
// screen, a 1 px outline is reliable, and a saved outline reloads to the same pixels.

// A stroke must start and end within this many image pixels of the outline to reshape it.
export const SNAP_DISTANCE = 6;

// A stroke shorter than this (in image pixels) is a click, not a drawing.
const MIN_STROKE_LENGTH = 3;

// Vertices are kept at most this far apart, so snapping to the nearest vertex is
// accurate to a fraction of a pixel.
const DENSE_STEP = 1;

const EPSILON = 0.01;

type Point = [number, number];

function toPoints(flat: number[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
}

function toFlat(points: Point[]): number[] {
  const out: number[] = [];
  for (const [x, y] of points) out.push(x, y);
  return out;
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > EPSILON) out.push(p);
  }
  return out;
}

// Adds points along any segment longer than `step`, including the closing segment from
// the last point back to the first. Consecutive duplicates are dropped.
export function densifyClosed(flat: number[], step = DENSE_STEP): number[] {
  let points = dedupe(toPoints(flat));
  if (points.length > 1) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= EPSILON) points = points.slice(0, -1);
  }
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    out.push(a);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const pieces = Math.ceil(length / step);
    for (let k = 1; k < pieces; k++) {
      out.push([a[0] + ((b[0] - a[0]) * k) / pieces, a[1] + ((b[1] - a[1]) * k) / pieces]);
    }
  }
  return toFlat(out);
}

// Integer line drawing between two pixels. Every step moves to an 8-neighbour, so the
// result is an 8-connected path -- which the tracker's 4-connected background fill
// cannot leak through.
function drawLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: (x: number, y: number) => void
): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// One object id per pixel (0 = none), row-major, width*height long. Each contour is
// drawn as a 1 px closed outline through the pixels its vertices fall in; where outlines
// cross, the higher object id wins, matching what the backend has always done.
export function rasterizeContours(width: number, height: number, contours: Contour[]): Uint8Array {
  const ids = new Uint8Array(width * height);
  const ordered = [...contours].sort((a, b) => a.objectIndex - b.objectIndex);
  for (const contour of ordered) {
    const pts = toPoints(contour.points).map(
      ([x, y]) => [Math.floor(x), Math.floor(y)] as Point
    );
    const plot = (x: number, y: number) => {
      if (x >= 0 && x < width && y >= 0 && y < height) ids[y * width + x] = contour.objectIndex;
    };
    if (pts.length === 1) plot(pts[0]![0], pts[0]![1]);
    for (let i = 0; i < pts.length && pts.length > 1; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      drawLine(a[0], a[1], b[0], b[1], plot);
    }
  }
  return ids;
}

export interface FrameAnalysis {
  ids: Uint8Array;
  // Objects whose outline, as it will be saved, does not enclose any area.
  unclosed: number[];
}

export function analyzeFrame(width: number, height: number, contours: Contour[]): FrameAnalysis {
  const ids = rasterizeContours(width, height, contours);
  return { ids, unclosed: unclosedObjects(ids, width, height) };
}

export type CommitResult =
  | { ok: true; contour: Contour }
  // `reason` is null for a stroke that is simply ignored (a stray click).
  | { ok: false; reason: string | null };

function clampStroke(flat: number[], width: number, height: number): Point[] {
  const maxX = width - 0.001;
  const maxY = height - 0.001;
  return dedupe(
    toPoints(flat).map(
      ([x, y]) => [Math.min(Math.max(x, 0), maxX), Math.min(Math.max(y, 0), maxY)] as Point
    )
  );
}

function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return total;
}

function nearestVertex(ring: Point[], p: Point): { index: number; distance: number } {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i]![0] - p[0], ring[i]![1] - p[1]);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return { index: best, distance: bestDistance };
}

// The ring's vertices from index i forward to index j, both included.
function arc(ring: Point[], i: number, j: number): Point[] {
  const out: Point[] = [];
  let k = i;
  for (;;) {
    out.push(ring[k]!);
    if (k === j) return out;
    k = (k + 1) % ring.length;
  }
}

// How far a stroke strays from an arc: the mean distance from each stroke point to the
// nearest arc vertex. The arc the user is correcting is the one their stroke runs along.
function strayDistance(stroke: Point[], arcPoints: Point[]): number {
  let total = 0;
  for (const s of stroke) {
    let best = Infinity;
    for (const a of arcPoints) best = Math.min(best, Math.hypot(a[0] - s[0], a[1] - s[1]));
    total += best;
  }
  return total / stroke.length;
}

function closesAlone(
  objectIndex: number,
  points: number[],
  width: number,
  height: number
): boolean {
  const ids = rasterizeContours(width, height, [{ objectIndex, points }]);
  return isClosed(ids, width, height, objectIndex);
}

// Decides what a finished stroke does to one object's outline.
//
// With no outline yet, the stroke becomes it, closed back to its start. With one, the
// stroke must start and end on it; the section of the outline it runs alongside is then
// replaced by the stroke. Either way the result is a single closed polygon, and it is
// refused (with a reason) if it would not enclose any area once rasterized.
export function commitStroke(args: {
  existing: Contour | undefined;
  objectIndex: number;
  stroke: number[];
  width: number;
  height: number;
  name: string;
}): CommitResult {
  const { existing, objectIndex, width, height, name } = args;
  const stroke = clampStroke(args.stroke, width, height);
  if (stroke.length < 2 || pathLength(stroke) < MIN_STROKE_LENGTH) {
    return { ok: false, reason: null };
  }

  if (!existing) {
    const points = densifyClosed(toFlat(stroke));
    if (!closesAlone(objectIndex, points, width, height)) {
      return {
        ok: false,
        reason: `That stroke does not enclose any area. Draw a loop around ${name}.`,
      };
    }
    return { ok: true, contour: { objectIndex, points } };
  }

  const ring = toPoints(existing.points);
  const start = nearestVertex(ring, stroke[0]!);
  const end = nearestVertex(ring, stroke[stroke.length - 1]!);
  if (start.distance > SNAP_DISTANCE || end.distance > SNAP_DISTANCE) {
    return {
      ok: false,
      reason:
        "You can only draw one contour per object. To edit the contour, start and end the " +
        "stroke on its outline. Or use ✕ Clear to start over.",
    };
  }
  if (start.index === end.index) {
    return {
      ok: false,
      reason: `The stroke starts and ends at the same spot on ${name}; it needs to cross a stretch of the outline.`,
    };
  }

  // Land the stroke's ends exactly on the outline so the join leaves no stub.
  const a = start.index;
  const b = end.index;
  const interior = stroke.slice(1, -1);
  const forward = arc(ring, a, b); // a -> b
  const backward = arc(ring, b, a); // b -> a
  const replaceForward = strayDistance(stroke, forward) <= strayDistance(stroke, backward);

  // Keep the other arc, then run the stroke back to where the kept arc began.
  const merged: Point[] = replaceForward
    ? [...backward, ...interior]
    : [...forward, ...interior.slice().reverse()];

  const points = densifyClosed(toFlat(merged));
  if (!closesAlone(objectIndex, points, width, height)) {
    return {
      ok: false,
      reason: `That edit would leave ${name} without an enclosed area, so it was not applied.`,
    };
  }
  return { ok: true, contour: { objectIndex, points } };
}
