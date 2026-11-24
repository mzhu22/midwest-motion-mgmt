import { describe, it, expect } from "vitest";
import { filledObject, isClosed, isOnePiece, unclosedObjects } from "./closure";

// Mirrors tests/test_imaging.py::TestFindUnclosedObjects: the frontend and the backend
// must call the same outlines closed, or a save would pass here and be refused there
// (or, worse, the other way round).

const W = 8;
const H = 8;

function image(rows: string[]): Uint8Array {
  const ids = new Uint8Array(W * H);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== ".") ids[y * W + x] = Number(ch);
    })
  );
  return ids;
}

const SQUARE = [
  "........",
  ".111111.",
  ".1....1.",
  ".1....1.",
  ".1....1.",
  ".1....1.",
  ".111111.",
  "........",
];

describe("isClosed", () => {
  it("accepts an outline that encloses an area", () => {
    expect(isClosed(image(SQUARE), W, H, 1)).toBe(true);
  });

  it("rejects an outline with a gap", () => {
    const gappy = [...SQUARE];
    gappy[1] = ".11.111.";
    expect(isClosed(image(gappy), W, H, 1)).toBe(false);
  });

  it("accepts an 8-connected outline: the fill floods the background 4-connected", () => {
    const diamond = [
      "........",
      "...1....",
      "..1.1...",
      "...1....",
      "........",
      "........",
      "........",
      "........",
    ];
    expect(isClosed(image(diamond), W, H, 1)).toBe(true);
  });

  it("rejects a bare line", () => {
    const line = ["........", "........", "........", "........", ".111111.", "........", "........", "........"];
    expect(isClosed(image(line), W, H, 1)).toBe(false);
  });

  it("treats another object's pixels as background, not as part of the outline", () => {
    const crossed = [...SQUARE];
    crossed[1] = ".112111.";
    expect(isClosed(image(crossed), W, H, 1)).toBe(false);
  });

  it("an object that is not drawn is not open", () => {
    expect(isClosed(image(SQUARE), W, H, 5)).toBe(true);
  });
});

describe("isOnePiece", () => {
  it("is true for a single outline and for nothing drawn", () => {
    expect(isOnePiece(image(SQUARE), W, H, 1)).toBe(true);
    expect(isOnePiece(image(SQUARE), W, H, 5)).toBe(true);
  });

  it("counts a diagonal join as connected", () => {
    const diag = ["1.......", ".1......", "..1.....", "........", "........", "........", "........", "........"];
    expect(isOnePiece(image(diag), W, H, 1)).toBe(true);
  });

  it("is false once the outline is cut into pieces", () => {
    const cut = [...SQUARE];
    cut[1] = ".11..11.";
    cut[6] = ".11..11.";
    expect(isOnePiece(image(cut), W, H, 1)).toBe(false);
  });
});

describe("a cut-up outline that still encloses a pocket", () => {
  // The fill alone accepts this (the small loop encloses area), but the object is a loop
  // plus a detached fragment -- an outline something has cut through.
  const ids = image([
    ".111....",
    ".1.1....",
    ".111....",
    "........",
    "........",
    "..11111.",
    "........",
    "........",
  ]);

  it("passes the fill test on its own", () => {
    expect(isClosed(ids, W, H, 1)).toBe(true);
  });

  it("is still reported as unclosed", () => {
    expect(unclosedObjects(ids, W, H)).toEqual([1]);
  });
});

describe("filledObject", () => {
  it("includes the interior of a closed outline", () => {
    const filled = filledObject(image(SQUARE), W, H, 1);
    expect(filled[3 * W + 3]).toBe(1);
    expect(filled[0]).toBe(0);
  });

  it("leaves a gappy outline's interior unfilled", () => {
    const gappy = [...SQUARE];
    gappy[1] = ".11.111.";
    expect(filledObject(image(gappy), W, H, 1)[3 * W + 3]).toBe(0);
  });
});

describe("unclosedObjects", () => {
  it("lists only the objects that are open, in order", () => {
    const ids = image(SQUARE);
    ids[3 * W + 3] = 2; // a lone pixel of another object inside
    ids[3 * W + 4] = 4;
    expect(unclosedObjects(ids, W, H)).toEqual([2, 4]);
  });

  it("is empty for a clean frame", () => {
    expect(unclosedObjects(image(SQUARE), W, H)).toEqual([]);
    expect(unclosedObjects(new Uint8Array(W * H), W, H)).toEqual([]);
  });
});
