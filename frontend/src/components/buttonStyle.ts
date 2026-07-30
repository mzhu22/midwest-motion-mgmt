// Shared look for the small toolbar buttons above each frame.
export function btnStyle(active = false): React.CSSProperties {
  return {
    padding: "3px 10px",
    fontSize: 13,
    border: "1px solid #ccc",
    borderRadius: 4,
    cursor: "pointer",
    background: active ? "#334155" : "#f1f5f9",
    color: active ? "#fff" : "#333",
  };
}
