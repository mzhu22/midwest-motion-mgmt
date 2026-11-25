import { describe, it, expect } from "vitest";
import {
  analyzeFrame,
  commitStroke,
  densifyClosed,
  rasterizeContours,
  SNAP_DISTANCE,
} from "./contour";
import { filledObject, isClosed } from "./closure";
import type { Contour } from "./types";

const W = 100;
const H = 100;

function at(ids: Uint8Array, x: number, y: number): number {
  return ids[y * W + x]!;
}

// A closed stroke around a 40x40 square, ending near where it began.
const SQUARE_STROKE = [20, 20, 60, 20, 60, 60, 20, 60, 20.5, 21];

function drawSquare(objectIndex = 1): Contour {
  const result = commitStroke({
    existing: undefined,
    objectIndex,
    stroke: SQUARE_STROKE,
    width: W,
    height: H,
    name: "the object",
  });
  if (!result.ok) throw new Error(String(result.reason));
  return result.contour;
}

function reshape(existing: Contour, stroke: number[]) {
  return commitStroke({
    existing,
    objectIndex: existing.objectIndex,
    stroke,
    width: W,
    height: H,
    name: "the object",
  });
}

describe("densifyClosed", () => {
  it("keeps vertices at most a step apart, including across the closing segment", () => {
    const pts = densifyClosed([0, 0, 10, 0, 10, 10]);
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      expect(Math.hypot(pts[2 * j]! - pts[2 * i]!, pts[2 * j + 1]! - pts[2 * i + 1]!)).toBeLessThanOrEqual(
        1.0001
      );
    }
    // The hypotenuse back from (10, 10) to (0, 0) is covered too.
    expect(n).toBeGreaterThan(30);
  });

  it("drops repeated points and a repeated closing point", () => {
    expect(densifyClosed([0, 0, 0, 0, 1, 0, 1, 1, 0, 0], 10)).toEqual([0, 0, 1, 0, 1, 1]);
  });
});

describe("rasterizeContours", () => {
  it("draws a closed 1 px outline through the pixels its vertices fall in", () => {
    const ids = rasterizeContours(W, H, [{ objectIndex: 1, points: [20.5, 20.5, 40.5, 20.5, 40.5, 40.5, 20.5, 40.5] }]);
    expect(at(ids, 20, 20)).toBe(1);
    expect(at(ids, 30, 20)).toBe(1);
    expect(at(ids, 40, 30)).toBe(1);
    expect(at(ids, 30, 30)).toBe(0); // the inside is not drawn
    let drawn = 0;
    ids.forEach((v) => v && drawn++);
    expect(drawn).toBe(80); // 4 sides of 21 px, sharing 4 corners
  });

  it("is deterministic: the same contour is the same pixels", () => {
    const c = drawSquare();
    expect(rasterizeContours(W, H, [c])).toEqual(rasterizeContours(W, H, [c]));
  });

  it("produces an outline the tracker would accept, from a rough diagonal shape", () => {
    const tri: Contour = { objectIndex: 3, points: [5.2, 5.7, 80.1, 30.4, 30.9, 85.3] };
    expect(isClosed(rasterizeContours(W, H, [tri]), W, H, 3)).toBe(true);
  });

  it("lets the higher object id win where outlines cross", () => {
    const a: Contour = { objectIndex: 1, points: [10.5, 10.5, 50.5, 10.5, 50.5, 50.5, 10.5, 50.5] };
    const b: Contour = { objectIndex: 2, points: [30.5, 5.5, 30.5, 55.5] };
    const ids = rasterizeContours(W, H, [b, a]);
    expect(at(ids, 30, 10)).toBe(2);
    expect(at(ids, 20, 10)).toBe(1);
  });

  it("clips anything outside the image instead of wrapping or throwing", () => {
    const ids = rasterizeContours(W, H, [{ objectIndex: 1, points: [-20, 50, 150, 50, 150, 60, -20, 60] }]);
    expect(at(ids, 0, 50)).toBe(1);
    expect(at(ids, 99, 50)).toBe(1);
  });

  it("draws a lone vertex as one pixel", () => {
    const ids = rasterizeContours(W, H, [{ objectIndex: 4, points: [7.9, 3.1] }]);
    expect(at(ids, 7, 3)).toBe(4);
  });
});

describe("commitStroke: a first stroke", () => {
  it("becomes a closed outline around what was drawn", () => {
    const contour = drawSquare();
    const ids = rasterizeContours(W, H, [contour]);
    expect(isClosed(ids, W, H, 1)).toBe(true);
    expect(filledObject(ids, W, H, 1)[40 * W + 40]).toBe(1);
  });

  it("closes itself even when the stroke stops well short of where it started", () => {
    const result = commitStroke({
      existing: undefined,
      objectIndex: 1,
      stroke: [20, 20, 60, 20, 60, 60, 20, 60],
      width: W,
      height: H,
      name: "x",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = rasterizeContours(W, H, [result.contour]);
      expect(isClosed(ids, W, H, 1)).toBe(true);
      expect(at(ids, 20, 40)).toBe(1); // the closing edge
    }
  });

  it("ignores a click without comment", () => {
    expect(
      commitStroke({ existing: undefined, objectIndex: 1, stroke: [30, 30], width: W, height: H, name: "x" })
    ).toEqual({ ok: false, reason: null });
    expect(
      commitStroke({ existing: undefined, objectIndex: 1, stroke: [30, 30, 30.5, 30.5], width: W, height: H, name: "x" })
    ).toEqual({ ok: false, reason: null });
  });

  it("refuses a stroke that encloses no area, and says so", () => {
    const result = commitStroke({
      existing: undefined,
      objectIndex: 1,
      stroke: [10, 10, 80, 10],
      width: W,
      height: H,
      name: "the liver",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/enclose any area.*the liver/);
  });

  it("clamps a stroke that leaves the image so the outline stays inside it", () => {
    const result = commitStroke({
      existing: undefined,
      objectIndex: 1,
      stroke: [-30, 10, 130, 10, 130, 60, -30, 60],
      width: W,
      height: H,
      name: "x",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Math.min(...result.contour.points)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...result.contour.points)).toBeLessThan(100);
      expect(isClosed(rasterizeContours(W, H, [result.contour]), W, H, 1)).toBe(true);
    }
  });
});

describe("commitStroke: reshaping an existing outline", () => {
  it("replaces the stretch it runs alongside and stays one closed outline", () => {
    const before = drawSquare();
    // Up and over a bump on the top edge, from x=30 to x=50.
    const result = reshape(before, [30, 20, 33, 12, 47, 12, 50, 20]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ids = rasterizeContours(W, H, [result.contour]);
    expect(isClosed(ids, W, H, 1)).toBe(true);
    expect(at(ids, 40, 12)).toBe(1); // the bump
    expect(at(ids, 40, 20)).toBe(0); // the old edge under it is gone
    expect(filledObject(ids, W, H, 1)[16 * W + 40]).toBe(1); // and the bump is enclosed
    expect(at(ids, 40, 60)).toBe(1); // the rest of the outline is untouched
    expect(at(ids, 20, 40)).toBe(1);
  });

  it("works the same drawn the other way round", () => {
    const before = drawSquare();
    const result = reshape(before, [50, 20, 47, 12, 33, 12, 30, 20]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = rasterizeContours(W, H, [result.contour]);
      expect(isClosed(ids, W, H, 1)).toBe(true);
      expect(at(ids, 40, 12)).toBe(1);
      expect(at(ids, 40, 20)).toBe(0);
    }
  });

  it("can cut a corner inward as well as bulge outward", () => {
    const before = drawSquare();
    const result = reshape(before, [30, 20, 35, 28, 45, 28, 50, 20]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = rasterizeContours(W, H, [result.contour]);
      expect(isClosed(ids, W, H, 1)).toBe(true);
      expect(at(ids, 40, 28)).toBe(1);
      expect(filledObject(ids, W, H, 1)[24 * W + 40]).toBe(0); // the notch is outside now
    }
  });

  it("chooses the stretch alongside the stroke, not the longer way round", () => {
    const before = drawSquare();
    // Along the bottom edge, near x=40..50: the short arc is the one to replace.
    const result = reshape(before, [30, 60, 35, 66, 45, 66, 50, 60]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = rasterizeContours(W, H, [result.contour]);
      expect(at(ids, 40, 66)).toBe(1);
      expect(at(ids, 40, 20)).toBe(1); // the top edge, the far side, is still there
    }
  });

  it("keeps a single contour per object", () => {
    const result = reshape(drawSquare(), [30, 20, 33, 12, 47, 12, 50, 20]);
    expect(result.ok && result.contour.objectIndex).toBe(1);
  });

  it("refuses a stroke that does not start on the outline", () => {
    const result = reshape(drawSquare(), [40, 40, 45, 30, 50, 20]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/one contour per object.*start and end the stroke on its outline.*Clear/);
  });

  it("refuses a stroke that does not end on the outline", () => {
    const result = reshape(drawSquare(), [30, 20, 35, 12, 45, 5]);
    expect(result.ok).toBe(false);
  });

  it("accepts a start within the snap distance", () => {
    const result = reshape(drawSquare(), [30, 20 - (SNAP_DISTANCE - 1), 33, 12, 47, 12, 50, 20]);
    expect(result.ok).toBe(true);
  });

  it("refuses a stroke that starts and ends at the same spot", () => {
    const result = reshape(drawSquare(), [30, 20, 33, 12, 40, 8, 30.4, 20.2]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/same spot/);
  });

  it("ignores a click on an existing outline", () => {
    expect(reshape(drawSquare(), [30, 20])).toEqual({ ok: false, reason: null });
  });

  it("never returns an outline that fails the closure check, however it is drawn", () => {
    // Fuzz: many random strokes between random points of the outline. Whatever is
    // accepted must still enclose an area -- that is the whole point of the design.
    let seed = 12345;
    const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    let contour = drawSquare();
    let accepted = 0;
    for (let i = 0; i < 200; i++) {
      const n = contour.points.length / 2;
      const a = Math.floor(rand() * n);
      const b = Math.floor(rand() * n);
      const mid = Array.from({ length: 3 }, () => [rand() * 100, rand() * 100]).flat();
      const stroke = [contour.points[2 * a]!, contour.points[2 * a + 1]!, ...mid, contour.points[2 * b]!, contour.points[2 * b + 1]!];
      const result = reshape(contour, stroke);
      if (!result.ok) continue;
      accepted++;
      contour = result.contour;
      expect(isClosed(rasterizeContours(W, H, [contour]), W, H, 1)).toBe(true);
    }
    expect(accepted).toBeGreaterThan(10);
  });
});

describe("commitStroke: an outline that was loaded open", () => {
  // What loading hands back for a saved outline with a gap: the line, toured out and back.
  const openLine: Contour = {
    objectIndex: 1,
    points: [...Array.from({ length: 71 }, (_, i) => [10.5 + i, 50.5]).flat(), ...Array.from({ length: 69 }, (_, i) => [79.5 - i, 50.5]).flat()],
  };

  it("is flagged as not closed", () => {
    expect(analyzeFrame(W, H, [openLine]).unclosed).toEqual([1]);
  });

  it("refuses an edit that leaves it enclosing nothing", () => {
    const result = reshape(openLine, [30, 50, 40, 50.2, 50, 50]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/enclosed area/);
  });

  it("can be repaired by reshaping it into a loop", () => {
    const result = reshape(openLine, [30, 50, 33, 40, 47, 40, 50, 50]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(analyzeFrame(W, H, [result.contour]).unclosed).toEqual([]);
    }
  });
});

describe("analyzeFrame", () => {
  it("reports no problem for outlines that do not touch", () => {
    const a = drawSquare(1);
    const b: Contour = { objectIndex: 2, points: [70.5, 70.5, 90.5, 70.5, 90.5, 90.5, 70.5, 90.5] };
    expect(analyzeFrame(W, H, [a, b]).unclosed).toEqual([]);
  });

  it("flags the object another object's outline cuts through", () => {
    const a = drawSquare(1);
    const cutter: Contour = { objectIndex: 2, points: [40.5, 10.5, 40.5, 30.5] };
    expect(analyzeFrame(W, H, [a, cutter]).unclosed).toContain(1);
  });
});
