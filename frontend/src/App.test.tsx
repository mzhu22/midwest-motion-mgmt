import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

vi.mock("./components/AnnotationCanvas", () => ({
  default: () => <div data-testid="annotation-canvas" />,
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

  it("shows an error for each frame with no contours drawn", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    await user.click(screen.getByRole("button", { name: /save annotations/i }));

    await waitFor(() => {
      expect(screen.getByText(/no contour drawn on 00001/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/no contour drawn on 00002/i)).toBeInTheDocument();
  });

  it("does not call /api/save when validation fails", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadFrames(user);

    await user.click(screen.getByRole("button", { name: /save annotations/i }));

    await waitFor(() =>
      expect(screen.getByText(/no contour drawn/i)).toBeInTheDocument()
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith("/api/save", expect.anything());
  });
});
