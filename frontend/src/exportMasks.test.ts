import { describe, it, expect, vi } from "vitest";
import { exportMasksForFrame } from "./exportMasks";
import type { FrameInfo, LineData } from "./types";
import type Konva from "konva";

function createMockStage(overrides: { scaleX: number; scaleY: number; x: number; y: number }) {
  const state = { ...overrides };

  const mockChild = {
    visible: vi.fn((val?: boolean) => (val !== undefined ? (mockChild._visible = val) : mockChild._visible)),
    _visible: true,
  };

  const toDataURLScales: { scaleX: number; scaleY: number; x: number; y: number }[] = [];

  const mockLayer = {
    getChildren: () => [mockChild],
    toDataURL: vi.fn(() => {
      toDataURLScales.push({ scaleX: state.scaleX, scaleY: state.scaleY, x: state.x, y: state.y });
      return "data:image/png;base64,AAAA";
    }),
  };

  const stage = {
    scaleX: vi.fn((val?: number) => { if (val !== undefined) state.scaleX = val; return state.scaleX; }),
    scaleY: vi.fn((val?: number) => { if (val !== undefined) state.scaleY = val; return state.scaleY; }),
    x: vi.fn((val?: number) => { if (val !== undefined) state.x = val; return state.x; }),
    y: vi.fn((val?: number) => { if (val !== undefined) state.y = val; return state.y; }),
    getLayers: () => [null, null, mockLayer],
  } as unknown as Konva.Stage;

  return { stage, state, toDataURLScales };
}

const frame: FrameInfo = {
  frame_index: "00001",
  plane: "sagittal",
  image_file: "00001_Frame.mha",
  target_file: "00001_Frame.mha",
  width: 128,
  height: 96,
};

const lines: LineData[] = [
  { points: [10, 20, 30, 40], stroke: "#FF0000", strokeWidth: 2, objectIndex: 0 },
];

describe("exportMasksForFrame", () => {
  it("resets stage transform to identity before exporting", () => {
    const { stage, toDataURLScales } = createMockStage({ scaleX: 3, scaleY: 3, x: 50, y: -30 });

    exportMasksForFrame(stage, frame, lines);

    for (const snapshot of toDataURLScales) {
      expect(snapshot.scaleX).toBe(1);
      expect(snapshot.scaleY).toBe(1);
      expect(snapshot.x).toBe(0);
      expect(snapshot.y).toBe(0);
    }
  });

  it("restores stage transform after exporting", () => {
    const { stage, state } = createMockStage({ scaleX: 3, scaleY: 2.5, x: 50, y: -30 });

    exportMasksForFrame(stage, frame, lines);

    expect(state.scaleX).toBe(3);
    expect(state.scaleY).toBe(2.5);
    expect(state.x).toBe(50);
    expect(state.y).toBe(-30);
  });

  it("produces identical masks regardless of zoom level", () => {
    const { stage: stage1 } = createMockStage({ scaleX: 1, scaleY: 1, x: 0, y: 0 });
    const { stage: stage2 } = createMockStage({ scaleX: 5, scaleY: 5, x: 100, y: -200 });

    const masks1 = exportMasksForFrame(stage1, frame, lines);
    const masks2 = exportMasksForFrame(stage2, frame, lines);

    expect(masks1).toEqual(masks2);
  });
});
