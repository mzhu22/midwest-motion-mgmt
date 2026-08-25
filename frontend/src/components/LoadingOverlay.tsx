import type { CSSProperties, ReactNode } from "react";
import Spinner from "./Spinner";

interface Props {
  active: boolean;
  children: ReactNode;
  wrapperStyle?: CSSProperties;
  spinnerSize?: number;
}

// Covers `children` with a translucent, centered spinner while `active`, rather
// than swapping in "Loading..." text. Meant to wrap whichever parent element
// actually holds the image(s) being (re)loaded, so the wait is visible right
// where the stale/blank content is.
export default function LoadingOverlay({ active, children, wrapperStyle, spinnerSize }: Props) {
  return (
    <div style={{ position: "relative", ...wrapperStyle }}>
      {children}
      {active && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255, 255, 255, 0.65)",
            borderRadius: 6,
            zIndex: 10,
          }}
        >
          <Spinner size={spinnerSize} />
        </div>
      )}
    </div>
  );
}
