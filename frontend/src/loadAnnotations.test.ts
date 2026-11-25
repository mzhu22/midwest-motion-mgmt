import { describe, it, expect } from "vitest";
import { compareObjectIds, contoursFromLoaded, describeMismatch } from "./loadAnnotations";
import { rasterizeContours } from "./contour";

describe("contoursFromLoaded", () => {
  it("makes one contour per object, keeping its points", () => {
    const contours = contoursFromLoaded({ "2": [0, 0, 5, 0, 5, 5], "5": [1, 1, 9, 1, 9, 9] });
    expect(contours).toEqual([
      { objectIndex: 2, points: [0, 0, 5, 0, 5, 5] },
      { objectIndex: 5, points: [1, 1, 9, 1, 9, 9] },
    ]);
  });

  it("never produces the target object or an unknown one", () => {
    expect(
      contoursFromLoaded({ "0": [0, 0, 1, 1], "8": [0, 0, 1, 1], x: [0, 0, 1, 1] })
    ).toEqual([]);
  });

  it("drops an object with no points", () => {
    expect(contoursFromLoaded({ "1": [] })).toEqual([]);
  });
});

describe("compareObjectIds", () => {
  const W = 40;
  const H = 40;
  const square = (lo: number, hi: number) => [lo + 0.5, lo + 0.5, hi + 0.5, lo + 0.5, hi + 0.5, hi + 0.5, lo + 0.5, hi + 0.5];

  it("calls identical outlines identical", () => {
    const ids = rasterizeContours(W, H, [{ objectIndex: 1, points: square(5, 25) }]);
    expect(compareObjectIds(ids, ids.slice(), W, H)).toMatchObject({
      differing: 0,
      outlinesIdentical: true,
    });
  });

  it("judges by the region enclosed: a thicker saved outline is not a different shape", () => {
    const thin = rasterizeContours(W, H, [{ objectIndex: 1, points: square(5, 25) }]);
    const thick = thin.slice();
    for (let p = 0; p < thick.length; p++) {
      if (thin[p] === 1) thick[p + 1] = 1; // a second pixel along every outline pixel
    }
    const result = compareObjectIds(thick, thin, W, H);
    expect(result.outlinesIdentical).toBe(false);
    expect(result.differing).toBeGreaterThan(0);
    expect(result.differing).toBeLessThan(result.total * 0.2);
  });

  it("counts a shifted shape as a real difference", () => {
    const a = rasterizeContours(W, H, [{ objectIndex: 1, points: square(5, 25) }]);
    const b = rasterizeContours(W, H, [{ objectIndex: 1, points: square(10, 30) }]);
    const result = compareObjectIds(a, b, W, H);
    expect(result.differing).toBeGreaterThan(result.total * 0.3);
  });

  it("has nothing to compare for an empty frame", () => {
    expect(compareObjectIds(new Uint8Array(W * H), new Uint8Array(W * H), W, H).total).toBe(0);
  });
});

describe("describeMismatch", () => {
  it("says nothing when there was nothing to compare", () => {
    expect(describeMismatch({ total: 0, differing: 0, outlinesIdentical: true })).toBe("");
  });

  it("says nothing on an exact match", () => {
    expect(describeMismatch({ total: 40, differing: 0, outlinesIdentical: true })).toBe("");
  });

  it("reports same regions with slightly different outlines", () => {
    expect(describeMismatch({ total: 40, differing: 0, outlinesIdentical: false })).toMatch(
      /same regions/
    );
  });

  it("reports the count and percentage otherwise", () => {
    expect(describeMismatch({ total: 200, differing: 7, outlinesIdentical: false })).toContain(
      "7 of 200 pixels (3.5%)"
    );
  });
});
