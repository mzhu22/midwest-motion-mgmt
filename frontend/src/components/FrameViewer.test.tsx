import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import type Konva from "konva";
import FrameViewer from "./FrameViewer";
import type { FrameInfo, LineData } from "../types";

vi.mock("./AnnotationCanvas", () => ({
  default: () => <div data-testid="annotation-canvas" />,
}));

const frame: FrameInfo = {
  frame_index: "00001",
  plane: "sagittal",
  image_file: "00001_Frame.mha",
  target_file: "00001_Frame.mha",
  width: 128,
  height: 96,
};

function stroke(objectIndex: number): LineData {
  return { points: [0, 0, 5, 5], stroke: "#FF0000", strokeWidth: 2, objectIndex };
}

const defaultProps = {
  frame,
  activeColorIndex: 0,
  activeLabel: "target",
  brushSize: 2,
  lines: [] as LineData[],
  onLinesChange: vi.fn(),
  onClearActiveObject: vi.fn(),
};

function renderViewer(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  props.onLinesChange.mockClear();
  props.onClearActiveObject.mockClear();
  return render(<FrameViewer {...props} stageRef={createRef<Konva.Stage>()} />);
}

describe("FrameViewer", () => {
  it("renders frame index", () => {
    renderViewer();
    expect(screen.getByText(/Frame 00001/)).toBeInTheDocument();
  });

  it("renders plane type", () => {
    renderViewer();
    expect(screen.getByText(/sagittal/)).toBeInTheDocument();
  });

  it("renders dimensions", () => {
    renderViewer();
    expect(screen.getByText(/128×96/)).toBeInTheDocument();
  });

  it("renders the annotation canvas", () => {
    renderViewer();
    expect(screen.getByTestId("annotation-canvas")).toBeInTheDocument();
  });

  it("labels the clear button with the active object", () => {
    renderViewer({ activeColorIndex: 2, activeLabel: "bladder" });
    // The visible text is just "✕ Clear" — which object it acts on is in the tooltip.
    expect(screen.getByRole("button", { name: /clear/i })).toHaveAttribute(
      "title",
      expect.stringContaining("bladder")
    );
  });

  it("disables the clear button when the active object has no strokes on this frame", () => {
    // Object 1 has strokes, but object 0 is active.
    renderViewer({ activeColorIndex: 0, lines: [stroke(1)] });
    expect(screen.getByRole("button", { name: /clear/i })).toBeDisabled();
  });

  it("enables the clear button once the active object has strokes", () => {
    renderViewer({ activeColorIndex: 1, activeLabel: "spine", lines: [stroke(1)] });
    expect(screen.getByRole("button", { name: /clear/i })).toBeEnabled();
  });

  it("calls onClearActiveObject when the clear button is clicked", async () => {
    const user = userEvent.setup();
    renderViewer({ activeColorIndex: 0, lines: [stroke(0)] });
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(defaultProps.onClearActiveObject).toHaveBeenCalledTimes(1);
  });
});
