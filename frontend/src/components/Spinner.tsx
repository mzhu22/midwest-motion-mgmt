interface Props {
  size?: number;
  color?: string;
}

export default function Spinner({ size = 22, color = "#2563eb" }: Props) {
  return (
    <>
      <style>{`
        @keyframes mmm-spin { to { transform: rotate(360deg); } }
      `}</style>
      <div
        role="status"
        aria-label="Loading"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          border: `${Math.max(2, size / 8)}px solid ${color}33`,
          borderTopColor: color,
          animation: "mmm-spin 0.7s linear infinite",
        }}
      />
    </>
  );
}
