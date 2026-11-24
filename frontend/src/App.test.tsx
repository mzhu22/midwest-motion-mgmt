import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { rasterizeContours } from "./contour";
import { decodeIds, encodeIds } from "./idsCodec";

// Konva can't run in jsdom, so stand in for the canvas with buttons that put a contour
// on the active object -- enough to exercise App's per-frame contour state. "draw" makes
// a closed square; "cut" makes a thin loop that crosses the square's top edge.
vi.mock("./components/AnnotationCanvas", () => ({
  default: ({ frameIndex, activeColorIndex, contours, onContoursChange }: any) => {
    const put = (points: number[]) =>
      onContoursChange([
        ...contours.filter((c: any) => c.objectIndex !== activeColorIndex),
        { objectIndex: activeColorIndex, points },
      ]);
    return (
      <div data-testid="annotation-canvas">
        <span data-testid={`contours-${frameIndex}`}>
          {contours.map((c: any) => c.objectIndex).join(",")}
        </span>
        <button onClick={() => put([10.5, 10.5, 40.5, 10.5, 40.5, 40.5, 10.5, 40.5])}>
          draw-{frameIndex}
        </button>
        <button onClick={() => put([25.5, 5.5, 25.5, 15.5])}>cut-{frameIndex}</button>
      </div>
    );
  },
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

    // Every milestone needs its own drawn object, so draw on all three before saving,
    // navigating away from the first two to confirm their frames stay in the payload.
    await user.click(screen.getByRole("button", { name: "draw-00001" }));
    await user.type(screen.getAllByPlaceholderText(/Object \d/)[0]!, "liver");
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: "draw-00003" }));
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: "draw-00005" }));
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

  it("rejects a save when a milestone has no drawn object", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    // Draw only on milestone 1; milestones 2 and 3 stay empty.
    await user.click(screen.getByRole("button", { name: "draw-00001" }));
    await user.type(screen.getAllByPlaceholderText(/Object \d/)[0]!, "liver");

    await user.click(screen.getByRole("button", { name: /save annotations/i }));

    await waitFor(() =>
      expect(screen.getByText(/every milestone needs at least one drawn object/i)).toBeInTheDocument()
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith("/api/save", expect.anything());
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
    await user.click(screen.getByRole("button", { name: /change milestones/i }));

    await waitFor(() => expect(screen.getByText("Milestone 1 of 1")).toBeInTheDocument());
  });
});


describe("App loading saved annotations", () => {
  const SQUARE = [10.5, 10.5, 40.5, 10.5, 40.5, 40.5, 10.5, 40.5];

  const loadFolderResponse = (hasAnnotations: boolean) => ({
    ok: true,
    json: () =>
      Promise.resolve({
        default_count: 1,
        selected: [mockFrames],
        has_annotations: hasAnnotations,
      }),
  });

  // The saved label image for a frame holding `contours`, as the backend sends it.
  function reference(contours: { objectIndex: number; points: number[] }[]) {
    return encodeIds(rasterizeContours(128, 96, contours));
  }

  function annotationsResponse(notes: string[] = []) {
    const sag = [
      { objectIndex: 1, points: SQUARE },
      { objectIndex: 3, points: [60.5, 60.5, 80.5, 60.5, 80.5, 80.5, 60.5, 80.5] },
    ];
    const cor = [{ objectIndex: 1, points: SQUARE }];
    return {
      ok: true,
      json: () =>
        Promise.resolve({
          selected: [mockFrames],
          labels: { "1": "liver", "3": "spleen" },
          frames: {
            "00001": {
              objects: { "1": sag[0]!.points, "3": sag[1]!.points },
              notes,
              reference: reference(sag),
            },
            "00002": { objects: { "1": cor[0]!.points }, notes: [], reference: reference(cor) },
          },
        }),
    };
  }

  function stubFetch(hasAnnotations: boolean, annotations: object = annotationsResponse()) {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/load-folder") return Promise.resolve(loadFolderResponse(hasAnnotations));
        if (url === "/api/load-annotations") return Promise.resolve(annotations);
        if (url === "/api/save") {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "ok" }) });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      })
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers nothing to load when the folder has no saved annotations", async () => {
    stubFetch(false);
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    expect(
      screen.queryByRole("button", { name: /load existing annotations/i })
    ).not.toBeInTheDocument();
  });

  it("offers to load when the folder has saved annotations, without loading them unasked", async () => {
    stubFetch(true);
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    expect(screen.getByRole("button", { name: /load existing annotations/i })).toBeInTheDocument();
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith("/api/load-annotations", expect.anything());
    expect(screen.getByTestId("contours-00001")).toBeEmptyDOMElement();
  });

  it("restores every saved object as one contour and the labels", async () => {
    stubFetch(true);
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    await user.click(screen.getByRole("button", { name: /load existing annotations/i }));

    await waitFor(() => expect(screen.getByTestId("contours-00001")).toHaveTextContent("1,3"));
    expect(screen.getByTestId("contours-00002")).toHaveTextContent("1");
    const labelInputs = screen.getAllByPlaceholderText(/Object \d/) as HTMLInputElement[];
    expect(labelInputs[0]!.value).toBe("liver");
    expect(labelInputs[1]!.value).toBe("");
    expect(labelInputs[2]!.value).toBe("spleen");
  });

  it("says the loaded contours match when they reproduce the saved pixels", async () => {
    stubFetch(true);
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);
    await user.click(screen.getByRole("button", { name: /load existing annotations/i }));

    await waitFor(() => expect(screen.getByText(/match the saved masks exactly/i)).toBeInTheDocument());
  });

  it("reports how far the loaded contours are from the saved masks when they are not", async () => {
    const response = annotationsResponse();
    const body = await response.json();
    // The saved image holds a different shape than the contour that came back.
    body.frames["00001"].reference = encodeIds(
      rasterizeContours(128, 96, [
        { objectIndex: 1, points: [30.5, 30.5, 70.5, 30.5, 70.5, 70.5, 30.5, 70.5] },
      ])
    );
    stubFetch(true, { ok: true, json: () => Promise.resolve(body) });
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);
    await user.click(screen.getByRole("button", { name: /load existing annotations/i }));

    await waitFor(() => expect(screen.getByText(/differ from the saved masks by/i)).toBeInTheDocument());
  });

  it("passes on what the backend had to do to recover an outline", async () => {
    stubFetch(true, annotationsResponse(["object 3: a second, separate part of the outline was dropped (12 px)"]));
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);
    await user.click(screen.getByRole("button", { name: /load existing annotations/i }));

    await waitFor(() => expect(screen.getByText(/separate part of the outline was dropped/i)).toBeInTheDocument());
    expect(screen.getByText(/Frame 00001, object 3/)).toBeInTheDocument();
  });

  it("saves what was loaded without needing a redraw", async () => {
    stubFetch(true);
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);
    await user.click(screen.getByRole("button", { name: /load existing annotations/i }));
    await waitFor(() => expect(screen.getByTestId("contours-00001")).toHaveTextContent("1,3"));

    await user.click(screen.getByRole("button", { name: /save annotations/i }));

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/save", expect.anything())
    );
    const [, opts] = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/save")!;
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(decodeIds(body.frames[0].object_ids)).toEqual(
      rasterizeContours(128, 96, [
        { objectIndex: 1, points: SQUARE },
        { objectIndex: 3, points: [60.5, 60.5, 80.5, 60.5, 80.5, 80.5, 60.5, 80.5] },
      ])
    );
    expect(body.labels).toEqual({ "1": "liver", "3": "spleen" });
  });

  it("shows the server's message and keeps the current work when loading fails", async () => {
    stubFetch(true, {
      ok: false,
      json: () => Promise.resolve({ error: "Saved annotations are not a set of pairs." }),
    });
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);
    await user.click(screen.getByRole("button", { name: "draw-00001" }));

    await user.click(screen.getByRole("button", { name: /load existing annotations/i }));

    await waitFor(() =>
      expect(screen.getByText(/not a set of pairs/i)).toBeInTheDocument()
    );
    expect(screen.getByTestId("contours-00001")).toHaveTextContent("1");
  });
});

describe("App editing", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/load-folder") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ default_count: 1, selected: [mockFrames] }),
          });
        }
        if (url === "/api/save") {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "ok" }) });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("undo takes back the last change on that frame only", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);
    const undo = () => screen.getAllByRole("button", { name: /undo/i });
    expect(undo()[0]).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "draw-00001" }));
    await user.click(screen.getByRole("button", { name: "draw-00002" }));
    expect(undo()[0]).toBeEnabled();
    expect(undo()[1]).toBeEnabled();

    await user.click(undo()[0]!);

    expect(screen.getByTestId("contours-00001")).toBeEmptyDOMElement();
    expect(screen.getByTestId("contours-00002")).toHaveTextContent("1");
    expect(undo()[0]).toBeDisabled();
  });

  it("undo also takes back a clear", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);
    await user.click(screen.getByRole("button", { name: "draw-00001" }));
    await user.click(screen.getAllByRole("button", { name: /clear/i })[0]!);
    expect(screen.getByTestId("contours-00001")).toBeEmptyDOMElement();

    await user.click(screen.getAllByRole("button", { name: /undo/i })[0]!);

    expect(screen.getByTestId("contours-00001")).toHaveTextContent("1");
  });

  it("sends the saved pixels, one byte each, rather than strokes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);
    await user.click(screen.getByRole("button", { name: "draw-00001" }));
    await user.type(screen.getAllByPlaceholderText(/Object \d/)[0]!, "liver");

    await user.click(screen.getByRole("button", { name: /save annotations/i }));

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/save", expect.anything())
    );
    const [, opts] = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/save")!;
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.frames).toHaveLength(2);
    for (const f of body.frames) expect(atob(f.object_ids)).toHaveLength(128 * 96);
    const ids = decodeIds(body.frames[0].object_ids);
    expect(new Set(ids)).toEqual(new Set([0, 1]));
    expect(decodeIds(body.frames[1].object_ids).some((v) => v !== 0)).toBe(false);
  });

  it("refuses to save when one object's outline cuts through another's, and says which", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);
    const labelInputs = () => screen.getAllByPlaceholderText(/Object \d/);
    await user.click(screen.getByRole("button", { name: "draw-00001" }));
    await user.type(labelInputs()[0]!, "liver");
    await user.click(labelInputs()[1]!);
    await user.type(labelInputs()[1]!, "spleen");
    await user.click(screen.getByRole("button", { name: "cut-00001" }));

    await user.click(screen.getByRole("button", { name: /save annotations/i }));

    await waitFor(() => expect(screen.getAllByText(/not a closed outline/i).length).toBeGreaterThan(0));
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith("/api/save", expect.anything());
  });

  it("lets the same frame save again once the crossing is undone", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);
    const labelInputs = () => screen.getAllByPlaceholderText(/Object \d/);
    await user.click(screen.getByRole("button", { name: "draw-00001" }));
    await user.type(labelInputs()[0]!, "liver");
    await user.click(labelInputs()[1]!);
    await user.type(labelInputs()[1]!, "spleen");
    await user.click(screen.getByRole("button", { name: "cut-00001" }));
    await user.click(screen.getAllByRole("button", { name: /undo/i })[0]!);

    await user.click(screen.getByRole("button", { name: /^save annotations$/i }));

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/save", expect.anything())
    );
  });
});
