import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LabelPanel from "./LabelPanel";

const defaultProps = {
  labels: Array(8).fill(""),
  onLabelsChange: vi.fn(),
  activeColorIndex: 0,
  onActiveColorChange: vi.fn(),
  brushSize: 2,
  onBrushSizeChange: vi.fn(),
  erasing: false,
  onErasingChange: vi.fn(),
  onSave: vi.fn(),
  saving: false,
  savedPath: null as string | null,
  onClearObject: vi.fn(),
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
  it("renders 8 label inputs", () => {
    renderPanel();
    const inputs = screen.getAllByPlaceholderText(/Object \d/);
    expect(inputs).toHaveLength(8);
  });

  it("clicking a color swatch calls onActiveColorChange and disables erasing", async () => {
    const user = userEvent.setup();
    renderPanel();
    const swatches = screen.getAllByPlaceholderText(/Object \d/);
    const thirdSwatch = swatches[2]!.parentElement!.querySelector("div")!;
    await user.click(thirdSwatch);
    expect(defaultProps.onActiveColorChange).toHaveBeenCalledWith(2);
    expect(defaultProps.onErasingChange).toHaveBeenCalledWith(false);
  });

  it("typing in label input calls onLabelsChange", async () => {
    const user = userEvent.setup();
    renderPanel();
    const inputs = screen.getAllByPlaceholderText(/Object \d/);
    await user.type(inputs[0]!, "tumor");
    expect(defaultProps.onLabelsChange).toHaveBeenCalled();
  });

  it("eraser button toggles erasing", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /eraser/i }));
    expect(defaultProps.onErasingChange).toHaveBeenCalledWith(true);
  });

  it("shows Eraser ON when erasing is true", () => {
    renderPanel({ erasing: true });
    expect(screen.getByRole("button", { name: /eraser on/i })).toBeInTheDocument();
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

  it("brush size input shows current value", () => {
    renderPanel({ brushSize: 5 });
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveValue(5);
  });

  it("clicking the row (outside the swatch) activates that color and disables erasing", async () => {
    const user = userEvent.setup();
    renderPanel();
    const inputs = screen.getAllByPlaceholderText(/Object \d/);
    // Click the row div (parent of the input) rather than the swatch or input
    const row = inputs[2]!.parentElement!;
    await user.click(row);
    expect(defaultProps.onActiveColorChange).toHaveBeenCalledWith(2);
    expect(defaultProps.onErasingChange).toHaveBeenCalledWith(false);
  });

  it("focusing a label input activates that color and disables erasing", async () => {
    const user = userEvent.setup();
    renderPanel({ erasing: true });
    const inputs = screen.getAllByPlaceholderText(/Object \d/);
    await user.click(inputs[4]!);
    expect(defaultProps.onActiveColorChange).toHaveBeenCalledWith(4);
    expect(defaultProps.onErasingChange).toHaveBeenCalledWith(false);
  });

  it("shows save path when savedPath is set", () => {
    renderPanel({ savedPath: "/some/folder/Annotations" });
    expect(screen.getByText(/Saved to:.*Annotations/)).toBeInTheDocument();
  });

  it("does not show save message when savedPath is null", () => {
    renderPanel({ savedPath: null });
    expect(screen.queryByText(/Saved to:/)).not.toBeInTheDocument();
  });
});
