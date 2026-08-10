import { COLORS, TARGET_CONTOUR_COLOR, TARGET_OBJECT_INDEX } from "../types";

interface Props {
  labels: string[];
  onLabelsChange: (labels: string[]) => void;
  activeColorIndex: number;
  onActiveColorChange: (index: number) => void;
  onSave: () => void;
  saving: boolean;
  savedPath: string | null;
  replacedCount: number;
}

export default function LabelPanel({
  labels,
  onLabelsChange,
  activeColorIndex,
  onActiveColorChange,
  onSave,
  saving,
  savedPath,
  replacedCount,
}: Props) {
  return (
    <div style={{ padding: 12, minWidth: 240, flex: "0 0 auto" }}>
      <h3 style={{ margin: "0 0 12px" }}>Annotations</h3>

      {/* The target is not one of the drawable objects — it comes from the image's own
          TargetStructure mask. Shown here only so the pink overlay has a key. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          padding: "4px 6px",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            background: TARGET_CONTOUR_COLOR,
            border: "2px solid transparent",
            flexShrink: 0,
          }}
        />
        <span style={{ flex: 1, fontSize: 13, color: "#6b7280" }}>
          target
        </span>
      </div>

      {COLORS.map((color, i) => {
        if (i === TARGET_OBJECT_INDEX) return null;
        return (
          <div
            key={i}
            onClick={() => onActiveColorChange(i)}
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
              background: activeColorIndex === i ? "#e8e8e8" : "transparent",
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                background: color,
                border:
                  activeColorIndex === i
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
              onFocus={() => onActiveColorChange(i)}
              placeholder={`Object ${i}`}
              style={{ flex: 1, padding: "3px 6px", fontSize: 13 }}
            />
          </div>
        );
      })}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
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
          <div
            title={savedPath}
            style={{
              fontSize: 13,
              color: "#16a34a",
              marginTop: 4,
              maxWidth: 220,
              wordBreak: "break-all",
            }}
          >
            Saved to: {savedPath}
            {replacedCount > 0 && (
              <div style={{ color: "#a16207", marginTop: 4 }}>
                Cleared {replacedCount} file{replacedCount === 1 ? "" : "s"} from
                a previous save.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
