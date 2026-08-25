import { useState, useEffect } from "react";
import { btnStyle } from "./buttonStyle";

interface Props {
  milestoneIndex: number;
  milestoneCount: number;
  currentFrameIndex: string;
  busy: boolean;
  onNavigate: (index: number) => void;
  onCountChange: (count: number) => void;
  onFrameIndexChange: (frameIndex: string) => Promise<string | undefined>;
}

export default function MilestoneNav({
  milestoneIndex,
  milestoneCount,
  currentFrameIndex,
  busy,
  onNavigate,
  onCountChange,
  onFrameIndexChange,
}: Props) {
  const [countInput, setCountInput] = useState(String(milestoneCount));
  const [frameInput, setFrameInput] = useState(currentFrameIndex);

  // Keep the fields in sync when the parent's selection changes for a reason other
  // than typing here (e.g. after the initial load, or a milestone-index change).
  useEffect(() => setCountInput(String(milestoneCount)), [milestoneCount]);
  useEffect(() => setFrameInput(currentFrameIndex), [currentFrameIndex]);

  // Sagittal frames all share one parity within a loaded series (see CLAUDE.md's
  // note on plane detection); the currently-shown sagittal frame tells us which one,
  // so we can reject typos of the wrong parity before ever asking the backend.
  const parsedCurrent = parseInt(currentFrameIndex, 10);
  const expectedParity = Number.isFinite(parsedCurrent) ? ((parsedCurrent % 2) + 2) % 2 : null;

  const submitCount = () => {
    const parsed = parseInt(countInput, 10);
    if (Number.isFinite(parsed) && parsed > 0 && parsed !== milestoneCount) {
      onCountChange(parsed);
    } else {
      setCountInput(String(milestoneCount));
    }
  };

  const submitFrameIndex = async () => {
    const trimmed = frameInput.trim();
    const parsed = parseInt(trimmed, 10);
    const wrongParity =
      expectedParity !== null && Number.isFinite(parsed) && parsed % 2 !== expectedParity;
    if (trimmed && trimmed !== currentFrameIndex && !wrongParity) {
      // The resolved frame can land back on currentFrameIndex (e.g. an invalid
      // number snaps right back to the frame already shown), in which case the prop
      // never changes and the sync effect below won't fire — so set it directly
      // from what the request actually resolved to, rather than relying on that.
      const resolved = await onFrameIndexChange(trimmed);
      setFrameInput(resolved ?? currentFrameIndex);
    } else {
      setFrameInput(currentFrameIndex);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        marginBottom: 16,
        flexWrap: "wrap",
        padding: "8px 12px",
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label htmlFor="milestone-count" style={{ fontSize: 13, color: "#555" }}>
          Milestones:
        </label>
        <input
          id="milestone-count"
          type="number"
          min={1}
          value={countInput}
          disabled={busy}
          onChange={(e) => setCountInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitCount()}
          style={{ width: 56, padding: "3px 6px", fontSize: 13 }}
        />
        <button style={btnStyle()} disabled={busy} onClick={submitCount}>
          Change milestones
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          style={btnStyle()}
          disabled={busy || milestoneIndex === 0}
          onClick={() => onNavigate(milestoneIndex - 1)}
        >
          ‹ Prev
        </button>
        <span style={{ fontSize: 14, minWidth: 120, textAlign: "center" }}>
          Milestone {milestoneIndex + 1} of {milestoneCount}
        </span>
        <button
          style={btnStyle()}
          disabled={busy || milestoneIndex >= milestoneCount - 1}
          onClick={() => onNavigate(milestoneIndex + 1)}
        >
          Next ›
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label
          htmlFor="milestone-sagittal-frame"
          style={{ fontSize: 13, color: "#555" }}
          title="Type a sagittal frame number; it snaps to the nearest valid sagittal/coronal pair"
        >
          Sagittal frame:
        </label>
        <input
          id="milestone-sagittal-frame"
          type="number"
          step={2}
          min={expectedParity ?? undefined}
          value={frameInput}
          disabled={busy}
          onChange={(e) => setFrameInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitFrameIndex()}
          style={{ width: 80, padding: "3px 6px", fontSize: 13 }}
        />
        <button style={btnStyle()} disabled={busy} onClick={submitFrameIndex}>
          Change frame
        </button>
      </div>
    </div>
  );
}
