import { useState } from "react";

interface Props {
  onLoad: (path: string) => void;
  loading: boolean;
}

export default function FolderInput({ onLoad, loading }: Props) {
  const [path, setPath] = useState("");
  const [browsing, setBrowsing] = useState(false);

  const handleBrowse = async () => {
    setBrowsing(true);
    try {
      const res = await fetch("/api/browse-folder");
      const data = await res.json();
      if (data.path) {
        setPath(data.path);
        onLoad(data.path);
      }
    } finally {
      setBrowsing(false);
    }
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{ margin: "0 0 8px", fontSize: 14, color: "#555" }}>
        Select a scan folder (should contain subfolders such as{" "}
        <strong>TwoDImages</strong> and <strong>ExamCards</strong>).
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
        onClick={handleBrowse}
        disabled={loading || browsing}
        style={{ padding: "6px 16px", fontSize: 14, whiteSpace: "nowrap" }}
      >
        Browse...
      </button>
      <input
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="Select or type a folder path..."
        style={{ flex: 1, padding: "6px 10px", fontSize: 14 }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && path.trim()) onLoad(path.trim());
        }}
      />
      <button
        onClick={() => path.trim() && onLoad(path.trim())}
        disabled={loading || !path.trim()}
        style={{ padding: "6px 16px", fontSize: 14 }}
      >
        {loading ? "Loading..." : "Load"}
      </button>
      </div>
    </div>
  );
}
