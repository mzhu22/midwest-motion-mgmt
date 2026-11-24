import { describe, it, expect } from "vitest";
import { decodeIds, encodeIds } from "./idsCodec";

describe("idsCodec", () => {
  it("round-trips a label image", () => {
    const ids = Uint8Array.from([0, 1, 7, 0, 3]);
    expect(Array.from(decodeIds(encodeIds(ids)))).toEqual([0, 1, 7, 0, 3]);
  });

  it("round-trips an image larger than one encoding chunk", () => {
    const ids = new Uint8Array(256 * 256 + 17);
    for (let i = 0; i < ids.length; i++) ids[i] = i % 8;
    expect(decodeIds(encodeIds(ids))).toEqual(ids);
  });

  it("encodes exactly one byte per pixel", () => {
    expect(atob(encodeIds(new Uint8Array(12)))).toHaveLength(12);
  });
});
