import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FolderInput from "./FolderInput";

describe("FolderInput", () => {
  it("renders input and load button", () => {
    render(<FolderInput onLoad={() => {}} loading={false} />);
    expect(screen.getByPlaceholderText(/folder path/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /load/i })).toBeInTheDocument();
  });

  it("calls onLoad with trimmed path on button click", async () => {
    const onLoad = vi.fn();
    const user = userEvent.setup();
    render(<FolderInput onLoad={onLoad} loading={false} />);

    await user.type(screen.getByPlaceholderText(/folder path/i), "  /some/path  ");
    await user.click(screen.getByRole("button", { name: /load/i }));

    expect(onLoad).toHaveBeenCalledWith("/some/path");
  });

  it("calls onLoad on Enter key", async () => {
    const onLoad = vi.fn();
    const user = userEvent.setup();
    render(<FolderInput onLoad={onLoad} loading={false} />);

    const input = screen.getByPlaceholderText(/folder path/i);
    await user.type(input, "/test/path{Enter}");

    expect(onLoad).toHaveBeenCalledWith("/test/path");
  });

  it("does not call onLoad with empty input", async () => {
    const onLoad = vi.fn();
    const user = userEvent.setup();
    render(<FolderInput onLoad={onLoad} loading={false} />);

    await user.click(screen.getByRole("button", { name: /load/i }));
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("shows Loading text when loading", () => {
    render(<FolderInput onLoad={() => {}} loading={true} />);
    const loadBtn = screen.getByRole("button", { name: /loading/i });
    expect(loadBtn).toHaveTextContent("Loading...");
    expect(loadBtn).toBeDisabled();
  });
});
