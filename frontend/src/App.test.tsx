import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

// Konva can't run in jsdom, so stand in for the canvas with a button that appends
// one stroke for the active object — enough to exercise App's per-frame stroke state.
vi.mock("./components/AnnotationCanvas", () => ({
  default: ({ frameIndex, activeColorIndex, lines, onLinesChange }: any) => (
    <div data-testid="annotation-canvas">
      <button
        onClick={() =>
          onLinesChange([
            ...lines,
            {
              points: [0, 0, 5, 5],
              stroke: "#FF0000",
              strokeWidth: 2,
              objectIndex: activeColorIndex,
            },
          ])
        }
      >
        draw-{frameIndex}
      </button>
    </div>
  ),
}));

const mockFrames = [
  {
    frame_index: "00001",
    plane: "sagittal",
    image_file: "00001_Frame.mha",
    target_file: "00001_Frame.mha",
    width: 128,
    height: 96,
  },
  {
    frame_index: "00002",
    plane: "coronal",
    image_file: "00002_Frame.mha",
    target_file: "00002_Frame.mha",
    width: 128,
    height: 96,
  },
];

async function loadFrames(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByPlaceholderText(/folder path/i);
  await user.type(input, "/some/path");
  await user.click(screen.getByRole("button", { name: /^load$/i }));
  await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument());
}

describe("App save validation", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/load-folder") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ frames: mockFrames }),
          });
        }
        if (url === "/api/save") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ saved: true }),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows an error when no object contour was drawn on either frame", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    await user.click(screen.getByRole("button", { name: /save annotations/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/draw at least one object contour/i)
      ).toBeInTheDocument();
    });
  });

  it("does not call /api/save when validation fails", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    await user.click(screen.getByRole("button", { name: /save annotations/i }));

    await waitFor(() =>
      expect(screen.getByText(/draw at least one object contour/i)).toBeInTheDocument()
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith("/api/save", expect.anything());
  });

  it("saves an object drawn on only one frame", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    // One enclosed contour on the sagittal frame only; the coronal frame stays empty.
    await user.click(screen.getByRole("button", { name: "draw-00001" }));
    await user.type(screen.getAllByPlaceholderText(/Object \d/)[0]!, "liver");

    await user.click(screen.getByRole("button", { name: /save annotations/i }));

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/save", expect.anything())
    );
  });
});

describe("App contour clearing", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/load-folder") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ frames: mockFrames }),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers no eraser, only a per-frame clear", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    expect(screen.queryByRole("button", { name: /eras/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /clear/i })).toHaveLength(2);
  });

  it("clearing a contour on one frame leaves the other frame's contour intact", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    await user.click(screen.getByRole("button", { name: "draw-00001" }));
    await user.click(screen.getByRole("button", { name: "draw-00002" }));

    // Frames render in order, so [0] is 00001 and [1] is 00002.
    const clearButtons = () => screen.getAllByRole("button", { name: /clear/i });
    expect(clearButtons()[0]).toBeEnabled();
    expect(clearButtons()[1]).toBeEnabled();

    await user.click(clearButtons()[0]!);

    // 00001 has nothing left to clear; 00002 is untouched.
    expect(clearButtons()[0]).toBeDisabled();
    expect(clearButtons()[1]).toBeEnabled();
  });

  it("clearing only removes the active object, not the others", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    // Draw object 1 (active by default), then switch to object 2 and draw that too.
    const labelInputs = () => screen.getAllByPlaceholderText(/Object \d/);
    await user.click(screen.getByRole("button", { name: "draw-00001" }));
    await user.click(labelInputs()[1]!);
    await user.click(screen.getByRole("button", { name: "draw-00001" }));

    // Object 2 is active and has strokes, so clearing it is offered.
    const sagittalClear = () => screen.getAllByRole("button", { name: /clear/i })[0]!;
    expect(sagittalClear()).toBeEnabled();
    await user.click(sagittalClear());
    expect(sagittalClear()).toBeDisabled();

    // Switching back to object 1 shows its contour survived.
    await user.click(labelInputs()[0]!);
    expect(sagittalClear()).toBeEnabled();
  });

  it("never offers the target as a drawable object", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    // The legend names it, but there is no input and no way to select it.
    expect(screen.getByText(/target — reference only/i)).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText(/Object \d/)).toHaveLength(7);
    expect(screen.queryByPlaceholderText("Object 0")).not.toBeInTheDocument();
  });
});
