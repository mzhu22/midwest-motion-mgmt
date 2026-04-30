import { COLORS } from "../types";

interface Props {
  labels: string[];
  onLabelsChange: (labels: string[]) => void;
  activeColorIndex: number;
  onActiveColorChange: (index: number) => void;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  erasing: boolean;
  onErasingChange: (erasing: boolean) => void;
  onSave: () => void;
  saving: boolean;
  savedPath: string | null;
  onClearObject: (index: number) => void;
}

export default function LabelPanel({
  labels,
  onLabelsChange,
  activeColorIndex,
  onActiveColorChange,
  brushSize,
  onBrushSizeChange,
  erasing,
  onErasingChange,
  onSave,
  saving,
  savedPath,
  onClearObject,
}: Props) {
  return (
    <div style={{ padding: 12, minWidth: 240 }}>
      <h3 style={{ margin: "0 0 12px" }}>Annotations</h3>

      {COLORS.map((color, i) => (
        <div
          key={i}
          onClick={() => {
            onActiveColorChange(i);
            onErasingChange(false);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
            padding: "4px 6px",
            borderRadius: 4,
            cursor: "pointer",
            width: "100%",
            boxSizing: "border-box",
            background:
              !erasing && activeColorIndex === i
                ? "#e8e8e8"
                : "transparent",
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              background: color,
              border:
                !erasing && activeColorIndex === i
                  ? "2px solid #333"
                  : "2px solid transparent",
              flexShrink: 0,
            }}
          />
          <input
            type="text"
            value={labels[i] ?? ""}
            onChange={(e) => {
              const next = [...labels];
              next[i] = e.target.value;
              onLabelsChange(next);
            }}
            onFocus={() => {
              onActiveColorChange(i);
              onErasingChange(false);
            }}
            placeholder={`Object ${i}`}
            style={{ flex: 1, padding: "3px 6px", fontSize: 13 }}
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClearObject(i);
            }}
            title="Clear drawn strokes for this object"
            style={{
              padding: "3px 7px",
              fontSize: 12,
              background: "#eee",
              border: "1px solid #ccc",
              borderRadius: 4,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
      ))}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 13 }}>Brush size:</label>
          <input
            type="number"
            min={1}
            max={20}
            value={brushSize}
            onChange={(e) => onBrushSizeChange(Number(e.target.value))}
            style={{ width: 50, padding: "3px 6px", fontSize: 13 }}
          />
        </div>

        <button
          onClick={() => onErasingChange(!erasing)}
          style={{
            padding: "6px 12px",
            fontSize: 13,
            background: erasing ? "#ff4444" : "#eee",
            color: erasing ? "#fff" : "#333",
            border: "1px solid #ccc",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          {erasing ? "Eraser ON" : "Eraser"}
        </button>

        <button
          onClick={onSave}
          disabled={saving}
          style={{
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: "bold",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: saving ? "not-allowed" : "pointer",
            marginTop: 8,
          }}
        >
          {saving ? "Saving..." : "Save Annotations"}
        </button>

        {savedPath && (
          <div style={{ fontSize: 13, color: "#16a34a", marginTop: 4 }}>
            Saved to: {savedPath}
          </div>
        )}
      </div>
    </div>
  );
}
