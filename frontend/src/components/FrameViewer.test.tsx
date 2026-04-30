import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import type Konva from "konva";
import FrameViewer from "./FrameViewer";
import type { FrameInfo } from "../types";

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

describe("FrameViewer", () => {
  it("renders frame index", () => {
    render(
      <FrameViewer
        frame={frame}
        activeColorIndex={0}
        brushSize={2}
        erasing={false}
        lines={[]}
        onLinesChange={() => {}}
        stageRef={createRef<Konva.Stage>()}
      />
    );
    expect(screen.getByText(/Frame 00001/)).toBeInTheDocument();
  });

  it("renders plane type", () => {
    render(
      <FrameViewer
        frame={frame}
        activeColorIndex={0}
        brushSize={2}
        erasing={false}
        lines={[]}
        onLinesChange={() => {}}
        stageRef={createRef<Konva.Stage>()}
      />
    );
    expect(screen.getByText(/sagittal/)).toBeInTheDocument();
  });

  it("renders dimensions", () => {
    render(
      <FrameViewer
        frame={frame}
        activeColorIndex={0}
        brushSize={2}
        erasing={false}
        lines={[]}
        onLinesChange={() => {}}
        stageRef={createRef<Konva.Stage>()}
      />
    );
    expect(screen.getByText(/128×96/)).toBeInTheDocument();
  });

  it("renders the annotation canvas", () => {
    render(
      <FrameViewer
        frame={frame}
        activeColorIndex={0}
        brushSize={2}
        erasing={false}
        lines={[]}
        onLinesChange={() => {}}
        stageRef={createRef<Konva.Stage>()}
      />
    );
    expect(screen.getByTestId("annotation-canvas")).toBeInTheDocument();
  });
});
