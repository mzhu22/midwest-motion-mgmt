import type { LineData } from "./types";

// Checks that all draw strokes for one object collectively form a closed loop:
// every stroke endpoint must connect (within tolerance) to another endpoint.
export function isEnclosed(strokes: LineData[], tolerance = 15): boolean {
  const endpoints: [number, number][] = [];
  for (const stroke of strokes) {
    if (stroke.points.length < 4) continue;
    const n = stroke.points.length;
    endpoints.push([stroke.points[0]!, stroke.points[1]!]);
    endpoints.push([stroke.points[n - 2]!, stroke.points[n - 1]!]);
  }
  if (endpoints.length === 0) return false;
  const matched = new Array(endpoints.length).fill(false);
  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      const dx = endpoints[i]![0]! - endpoints[j]![0]!;
      const dy = endpoints[i]![1]! - endpoints[j]![1]!;
      if (Math.sqrt(dx * dx + dy * dy) <= tolerance) {
        matched[i] = true;
        matched[j] = true;
      }
    }
  }
  return matched.every(Boolean);
}
