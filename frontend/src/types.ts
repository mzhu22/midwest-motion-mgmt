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
  // Which annotation object this stroke belongs to: always 1..7 (an index into COLORS).
  // Never 0 — see TARGET_OBJECT_INDEX.
  objectIndex: number;
}

// Object 0 is the target. It is never drawn here: it is rendered from the dataset's
// TargetStructure mask as reference only, and mr-linac-iowa reads that same mask
// straight from the .mha to seed tracking. Slot 0 of COLORS is therefore unused for
// drawing, leaving objects 1..7 for the user.
export const TARGET_OBJECT_INDEX = 0;

// Must match the RGB in read_target_contour_as_png (backend/imaging.py).
export const TARGET_CONTOUR_COLOR = "#FF1493";

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
