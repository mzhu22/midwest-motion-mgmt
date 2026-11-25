import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LabelPanel from "./LabelPanel";

const defaultProps = {
  // Slot 0 is the target and is never drawn, so it carries no label.
  labels: Array(8).fill("") as string[],
  onLabelsChange: vi.fn(),
  activeColorIndex: 1,
  onActiveColorChange: vi.fn(),
  onSave: vi.fn(),
  saving: false,
};

function renderPanel(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  Object.values(props).forEach((v) => {
    if (typeof v === "function" && "mockClear" in v) {
      (v as ReturnType<typeof vi.fn>).mockClear();
    }
  });
  return render(<LabelPanel {...props} />);
}

describe("LabelPanel", () => {
  it("renders 7 editable label inputs, one per drawable object", () => {
    renderPanel();
    const inputs = screen.getAllByPlaceholderText(/Object \d/);
    expect(inputs).toHaveLength(7);
  });

  it("clicking a color swatch calls onActiveColorChange", async () => {
    const user = userEvent.setup();
    renderPanel();
    // inputs[0] is Object 1 (Object 0 has no input); its parent row is index 1
    const inputs = screen.getAllByPlaceholderText(/Object \d/);
    const secondSwatch = inputs[1]!.parentElement!.querySelector("div")!;
    await user.click(secondSwatch);
    expect(defaultProps.onActiveColorChange).toHaveBeenCalledWith(2);
  });

  it("typing in label input calls onLabelsChange", async () => {
    const user = userEvent.setup();
    renderPanel();
    const inputs = screen.getAllByPlaceholderText(/Object \d/);
    await user.type(inputs[1]!, "tumor");
    expect(defaultProps.onLabelsChange).toHaveBeenCalled();
  });

  it("has no eraser control", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /eras/i })).not.toBeInTheDocument();
  });

  it("has no per-object clear button (clearing is per-frame)", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: "✕" })).not.toBeInTheDocument();
  });

  it("save button calls onSave", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(defaultProps.onSave).toHaveBeenCalled();
  });

  it("shows Saving... when saving", () => {
    renderPanel({ saving: true });
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
  });

  it("clicking the row (outside the swatch) activates that color", async () => {
    const user = userEvent.setup();
    renderPanel();
    const inputs = screen.getAllByPlaceholderText(/Object \d/);
    // inputs[1] is Object 2 (Object 0 has no input, inputs[0] is Object 1)
    const row = inputs[1]!.parentElement!;
    await user.click(row);
    expect(defaultProps.onActiveColorChange).toHaveBeenCalledWith(2);
  });

  it("focusing a label input activates that color", async () => {
    const user = userEvent.setup();
    renderPanel();
    const inputs = screen.getAllByPlaceholderText(/Object \d/);
    // inputs[3] is Object 4
    await user.click(inputs[3]!);
    expect(defaultProps.onActiveColorChange).toHaveBeenCalledWith(4);
  });
});
