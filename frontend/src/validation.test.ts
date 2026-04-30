import { describe, it, expect } from "vitest";
import { isEnclosed } from "./validation";
import type { LineData } from "./types";

function stroke(points: number[], objectIndex = 0): LineData {
  return { points, stroke: "#FF0000", strokeWidth: 2, objectIndex };
}

describe("isEnclosed", () => {
  it("returns false for empty strokes array", () => {
    expect(isEnclosed([])).toBe(false);
  });

  it("returns false for a stroke with only one point", () => {
    expect(isEnclosed([stroke([10, 10])])).toBe(false);
  });

  it("returns true for a single stroke whose endpoints are within tolerance", () => {
    // start (10,10), end (12,11) — distance ~2.2, within default 15
    expect(isEnclosed([stroke([10, 10, 50, 0, 90, 10, 70, 60, 12, 11])])).toBe(true);
  });

  it("returns false for a single stroke whose endpoints are far apart", () => {
    // start (0,0), end (100,100) — distance ~141
    expect(isEnclosed([stroke([0, 0, 50, 50, 100, 100])])).toBe(false);
  });

  it("returns true when two strokes connect end-to-end forming a closed loop", () => {
    // stroke1: (0,0) → (100,0); stroke2: (100,0) → (0,0)
    const s1 = stroke([0, 0, 100, 0]);
    const s2 = stroke([100, 0, 0, 0]);
    expect(isEnclosed([s1, s2])).toBe(true);
  });

  it("returns false when two strokes do not connect", () => {
    // Two parallel horizontal lines — no endpoints match
    const s1 = stroke([0, 0, 100, 0]);
    const s2 = stroke([0, 50, 100, 50]);
    expect(isEnclosed([s1, s2])).toBe(false);
  });

  it("returns true for three strokes forming a closed triangle", () => {
    // (0,0)→(100,0), (100,0)→(50,100), (50,100)→(0,0)
    const s1 = stroke([0, 0, 100, 0]);
    const s2 = stroke([100, 0, 50, 100]);
    const s3 = stroke([50, 100, 0, 0]);
    expect(isEnclosed([s1, s2, s3])).toBe(true);
  });

  it("returns false when one stroke in a chain is disconnected", () => {
    const s1 = stroke([0, 0, 100, 0]);
    const s2 = stroke([100, 0, 50, 100]);
    const s3 = stroke([200, 200, 300, 300]); // not connected
    expect(isEnclosed([s1, s2, s3])).toBe(false);
  });

  it("respects custom tolerance — passes with larger tolerance", () => {
    // endpoints 20 apart: fails at tolerance=15, passes at tolerance=25
    const s1 = stroke([0, 0, 100, 0]);
    const s2 = stroke([100, 0, 20, 0]); // end is (20,0), start of s1 is (0,0) — distance 20
    expect(isEnclosed([s1, s2], 15)).toBe(false);
    expect(isEnclosed([s1, s2], 25)).toBe(true);
  });

});
