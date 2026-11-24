import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AnnotationCanvas from "./AnnotationCanvas";
import { commitStroke } from "../contour";
import type { Contour } from "../types";

// Konva cannot run in jsdom. Stand in for react-konva with plain elements that hand the
// real component the same events and stage queries it gets from Konva, so the logic
// under test -- turning a drag into a stroke and a stroke into an edit -- is the real one.
let pointer = { x: 0, y: 0 };
const fakeStage = {
  getPointerPosition: () => pointer,
  x: () => 0,
  y: () => 0,
  scaleX: () => 1,
  scaleY: () => 1,
};

vi.mock("react-konva", async () => {
  const React = await import("react");
  return {
    Stage: React.forwardRef(({ children, onMouseDown, onMouseMove, onMouseUp, onMouseLeave }: any, ref: any) => {
      React.useImperativeHandle(ref, () => fakeStage as any);
      const event = () => ({ evt: { button: 0, clientX: 0, clientY: 0, preventDefault() {} }, target: { getStage: () => fakeStage } });
      return (
        <div
          data-testid="stage"
          onMouseDown={() => onMouseDown(event())}
          onMouseMove={() => onMouseMove(event())}
          onMouseUp={() => onMouseUp(event())}
          onMouseLeave={() => onMouseLeave(event())}
        >
          {children}
        </div>
      );
    }),
    Layer: ({ children }: any) => <div>{children}</div>,
    Line: ({ points }: any) => <div data-testid="draft-line" data-points={points.join(",")} />,
    Image: () => null,
  };
});

vi.mock("../pixelPreview", () => ({ idsToCanvas: () => document.createElement("canvas") }));

const W = 100;
const H = 100;

// Image coordinates -> the display coordinates the stage reports (2x, no zoom).
const at = (x: number, y: number) => ({ x: x * 2, y: y * 2 });

function drag(points: [number, number][]) {
  const stage = screen.getByTestId("stage");
  pointer = at(...points[0]!);
  fireEvent.mouseDown(stage);
  for (const p of points.slice(1)) {
    pointer = at(...p);
    fireEvent.mouseMove(stage);
  }
  fireEvent.mouseUp(stage);
}

function squareContour(objectIndex: number): Contour {
  const r = commitStroke({
    existing: undefined,
    objectIndex,
    stroke: [20, 20, 60, 20, 60, 60, 20, 60, 20.5, 21],
    width: W,
    height: H,
    name: "x",
  });
  if (!r.ok) throw new Error("fixture");
  return r.contour;
}

const onContoursChange = vi.fn();
const onNotice = vi.fn();

function renderCanvas(contours: Contour[] = [], activeColorIndex = 1) {
  return render(
    <AnnotationCanvas
      frameIndex="00001"
      width={W}
      height={H}
      activeColorIndex={activeColorIndex}
      activeLabel="the liver"
      contours={contours}
      ids={new Uint8Array(W * H)}
      onContoursChange={onContoursChange}
      onNotice={onNotice}
    />
  );
}

beforeEach(() => {
  onContoursChange.mockClear();
  onNotice.mockClear();
});

describe("AnnotationCanvas drawing", () => {
  it("turns one stroke around an object into a closed contour for the active object", () => {
    renderCanvas();
    drag([[20, 20], [60, 20], [60, 60], [20, 60]]);

    expect(onContoursChange).toHaveBeenCalledTimes(1);
    const [next] = onContoursChange.mock.calls[0]!;
    expect(next).toHaveLength(1);
    expect(next[0].objectIndex).toBe(1);
    expect(next[0].points.length).toBeGreaterThan(8);
    expect(onNotice).toHaveBeenCalledWith("");
  });

  it("converts display coordinates back to image coordinates", () => {
    renderCanvas();
    drag([[20, 20], [60, 20], [60, 60], [20, 60]]);
    const pts: number[] = onContoursChange.mock.calls[0]![0][0].points;
    const xs = pts.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(20, 0);
    expect(Math.max(...xs)).toBeCloseTo(60, 0);
  });

  it("shows the stroke as a draft line while dragging, and not after", () => {
    renderCanvas();
    const stage = screen.getByTestId("stage");
    pointer = at(20, 20);
    fireEvent.mouseDown(stage);
    pointer = at(40, 25);
    fireEvent.mouseMove(stage);
    expect(screen.getByTestId("draft-line")).toBeInTheDocument();

    fireEvent.mouseUp(stage);
    expect(screen.queryByTestId("draft-line")).not.toBeInTheDocument();
  });

  it("ignores a plain click without comment", () => {
    renderCanvas();
    drag([[30, 30]]);
    expect(onContoursChange).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
  });

  it("explains a stroke that cannot be an outline", () => {
    renderCanvas();
    drag([[10, 10], [40, 10], [80, 10]]);
    expect(onContoursChange).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/enclose any area.*the liver/));
  });

  it("finishes the stroke when the pointer leaves the canvas", () => {
    renderCanvas();
    const stage = screen.getByTestId("stage");
    pointer = at(20, 20);
    fireEvent.mouseDown(stage);
    for (const p of [[60, 20], [60, 60], [20, 60]] as [number, number][]) {
      pointer = at(...p);
      fireEvent.mouseMove(stage);
    }
    fireEvent.mouseLeave(stage);
    expect(onContoursChange).toHaveBeenCalledTimes(1);
  });

  it("does not treat a mouse-up with no stroke as a drawing", () => {
    renderCanvas();
    fireEvent.mouseUp(screen.getByTestId("stage"));
    expect(onContoursChange).not.toHaveBeenCalled();
  });

  it("keeps the other objects' contours when drawing the active one", () => {
    renderCanvas([squareContour(3)], 1);
    drag([[70, 70], [90, 70], [90, 90], [70, 90]]);
    const next: Contour[] = onContoursChange.mock.calls[0]![0];
    expect(next.map((c) => c.objectIndex).sort()).toEqual([1, 3]);
  });
});

describe("AnnotationCanvas reshaping", () => {
  it("replaces the contour with the reshaped one rather than adding a second", () => {
    renderCanvas([squareContour(1)], 1);
    drag([[30, 20], [33, 12], [47, 12], [50, 20]]);

    const next: Contour[] = onContoursChange.mock.calls[0]![0];
    expect(next).toHaveLength(1);
    expect(next[0]!.objectIndex).toBe(1);
    const ys = next[0]!.points.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeLessThan(15); // the bump is in
  });

  it("explains a stroke that does not start on the outline and changes nothing", () => {
    renderCanvas([squareContour(1)], 1);
    drag([[40, 40], [45, 30], [50, 20]]);
    expect(onContoursChange).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/start and end the stroke on its outline/));
  });

  it("treats another object's outline as nothing to snap to", () => {
    // Object 2 owns the square; object 1 is active, so a stroke on that square starts a
    // new outline for object 1 instead of reshaping object 2's.
    renderCanvas([squareContour(2)], 1);
    drag([[20, 20], [60, 20], [60, 60], [20, 60]]);
    const next: Contour[] = onContoursChange.mock.calls[0]![0];
    expect(next.map((c) => c.objectIndex).sort()).toEqual([1, 2]);
  });
});
