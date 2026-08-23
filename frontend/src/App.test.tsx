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

function mkFrame(frameIndex: string, plane: "sagittal" | "coronal") {
  return {
    frame_index: frameIndex,
    plane,
    image_file: `${frameIndex}_Frame.mha`,
    target_file: `${frameIndex}_Frame.mha`,
    width: 128,
    height: 96,
  };
}

const mockFramesMulti = [
  mkFrame("00001", "sagittal"),
  mkFrame("00002", "coronal"),
  mkFrame("00003", "sagittal"),
  mkFrame("00004", "coronal"),
  mkFrame("00005", "sagittal"),
  mkFrame("00006", "coronal"),
];
const mockPairsMulti = [
  [mockFramesMulti[0], mockFramesMulti[1]],
  [mockFramesMulti[2], mockFramesMulti[3]],
  [mockFramesMulti[4], mockFramesMulti[5]],
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
            json: () =>
              Promise.resolve({
                pairs: [mockFrames],
                default_count: 1,
                selected: [mockFrames],
              }),
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
            json: () =>
              Promise.resolve({
                pairs: [mockFrames],
                default_count: 1,
                selected: [mockFrames],
              }),
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

describe("App multi-milestone navigation", () => {
  function stubFetch(extra: (url: string, opts: any) => Response | undefined = () => undefined) {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, opts: any) => {
        if (url === "/api/load-folder") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                pairs: mockPairsMulti,
                default_count: 3,
                selected: mockPairsMulti,
              }),
          });
        }
        if (url === "/api/save") {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "ok" }) });
        }
        const custom = extra(url, opts);
        if (custom) return Promise.resolve(custom);
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      })
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows only the current milestone's pair, navigable with prev/next", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    expect(screen.getByText("Milestone 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "draw-00001" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "draw-00003" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /clear/i })).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByText("Milestone 2 of 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "draw-00001" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "draw-00003" })).toBeInTheDocument();
  });

  it("keeps every milestone's frame in the save payload regardless of which is shown", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    // Draw on milestone 1, then navigate away to the last milestone before saving.
    await user.click(screen.getByRole("button", { name: "draw-00001" }));
    await user.type(screen.getAllByPlaceholderText(/Object \d/)[0]!, "liver");
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Milestone 3 of 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save annotations/i }));

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/save", expect.anything())
    );
    const [, opts] = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/save")!;
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.frames.map((f: any) => f.frame_index)).toEqual([
      "00001",
      "00002",
      "00003",
      "00004",
      "00005",
      "00006",
    ]);
  });

  it("changing the milestone count re-fetches and updates the selection", async () => {
    stubFetch((url, opts) => {
      if (url === "/api/select-milestones") {
        const body = JSON.parse(opts.body);
        expect(body).toEqual({ count: 1 });
        return {
          ok: true,
          json: () => Promise.resolve({ selected: [mockPairsMulti[0]] }),
        } as unknown as Response;
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    const countInput = screen.getByLabelText(/milestones/i);
    await user.clear(countInput);
    await user.type(countInput, "1");
    await user.click(screen.getByRole("button", { name: /change/i }));

    await waitFor(() => expect(screen.getByText("Milestone 1 of 1")).toBeInTheDocument());
  });
});
