import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FrameViewer from "./FrameViewer";
import type { Contour, FrameInfo } from "../types";

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

function square(objectIndex: number, lo = 10, hi = 40): Contour {
  return {
    objectIndex,
    points: [lo + 0.5, lo + 0.5, hi + 0.5, lo + 0.5, hi + 0.5, hi + 0.5, lo + 0.5, hi + 0.5],
  };
}

const defaultProps = {
  frame,
  activeColorIndex: 0,
  activeLabel: "target",
  labels: Array(8).fill("") as string[],
  contours: [] as Contour[],
  onContoursChange: vi.fn(),
  onClearActiveObject: vi.fn(),
  onUndo: vi.fn(),
  canUndo: false,
  onNotice: vi.fn(),
};

function renderViewer(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  props.onClearActiveObject.mockClear();
  props.onUndo.mockClear();
  return render(<FrameViewer {...props} />);
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

  it("disables the clear button when the active object has no contour on this frame", () => {
    renderViewer({ activeColorIndex: 2, contours: [square(1)] });
    expect(screen.getByRole("button", { name: /clear/i })).toBeDisabled();
  });

  it("enables the clear button once the active object has a contour", () => {
    renderViewer({ activeColorIndex: 1, activeLabel: "spine", contours: [square(1)] });
    expect(screen.getByRole("button", { name: /clear/i })).toBeEnabled();
  });

  it("calls onClearActiveObject when the clear button is clicked", async () => {
    const user = userEvent.setup();
    renderViewer({ activeColorIndex: 1, contours: [square(1)] });
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(defaultProps.onClearActiveObject).toHaveBeenCalledTimes(1);
  });

  it("only offers Undo once there is something to undo", async () => {
    const user = userEvent.setup();
    const { unmount } = renderViewer({ canUndo: false });
    expect(screen.getByRole("button", { name: /undo/i })).toBeDisabled();
    unmount();

    renderViewer({ canUndo: true });
    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(defaultProps.onUndo).toHaveBeenCalledTimes(1);
  });

  it("raises no alarm for outlines that are all closed", () => {
    renderViewer({ contours: [square(1), square(2, 60, 90)] });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names an object whose outline another object cuts through", () => {
    // Object 2's thin loop overwrites a pixel of object 1's top edge.
    const cutter: Contour = { objectIndex: 2, points: [25.5, 5.5, 25.5, 15.5] };
    const labels = Array(8).fill("");
    labels[1] = "liver";
    renderViewer({ contours: [square(1), cutter], labels });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/liver/);
    expect(alert).toHaveTextContent(/not a closed outline/);
  });
});
