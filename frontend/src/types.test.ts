import { describe, it, expect } from "vitest";
import { COLORS } from "./types";

describe("COLORS", () => {
  it("has exactly 8 entries", () => {
    expect(COLORS).toHaveLength(8);
  });

  it("contains valid hex color strings", () => {
    for (const c of COLORS) {
      expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("has no duplicates", () => {
    expect(new Set(COLORS).size).toBe(COLORS.length);
  });
});
