export interface FrameInfo {
  frame_index: string;
  plane: "sagittal" | "coronal";
  image_file: string;
  target_file: string;
  width: number;
  height: number;
}

export interface LineData {
  points: number[];
  stroke: string;
  strokeWidth: number;
  // Which annotation object this stroke belongs to: always 0..7 (an index into COLORS).
  objectIndex: number;
}

export const COLORS = [
  "#FF0000",
  "#00FF00",
  "#0000FF",
  "#FFFF00",
  "#FF00FF",
  "#00FFFF",
  "#FF8000",
  "#8000FF",
];
