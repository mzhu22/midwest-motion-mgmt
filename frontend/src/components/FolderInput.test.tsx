import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FolderInput from "./FolderInput";

describe("FolderInput", () => {
  it("renders the input and Browse button, with no Load button", () => {
    render(<FolderInput onLoad={() => {}} loading={false} />);
    expect(screen.getByPlaceholderText(/folder path/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /browse/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^load$/i })).not.toBeInTheDocument();
  });

  it("calls onLoad with the trimmed path on Enter", async () => {
    const onLoad = vi.fn();
    const user = userEvent.setup();
    render(<FolderInput onLoad={onLoad} loading={false} />);

    await user.type(screen.getByPlaceholderText(/folder path/i), "  /test/path  {Enter}");

    expect(onLoad).toHaveBeenCalledWith("/test/path");
  });

  it("does not call onLoad with empty input", async () => {
    const onLoad = vi.fn();
    const user = userEvent.setup();
    render(<FolderInput onLoad={onLoad} loading={false} />);

    await user.type(screen.getByPlaceholderText(/folder path/i), "   {Enter}");
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("shows a spinner overlay and disables Browse when loading", () => {
    render(<FolderInput onLoad={() => {}} loading={true} />);
    expect(screen.getByRole("button", { name: /browse/i })).toBeDisabled();
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
  });
});
