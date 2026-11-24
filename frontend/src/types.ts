export interface FrameInfo {
  frame_index: string;
  plane: "sagittal" | "coronal";
  image_file: string;
  target_file: string;
  width: number;
  height: number;
}

// One object's outline on one frame: a single closed polygon. Never more than one per
// object per frame -- editing replaces a section of it rather than adding strokes, so an
// outline cannot be left with a gap.
export interface Contour {
  // Which annotation object this is: always 1..7 (an index into COLORS).
  // Never 0 -- see TARGET_OBJECT_INDEX.
  objectIndex: number;
  // Flat [x0, y0, x1, y1, ...] in image pixel coordinates, in order around the outline.
  // The segment from the last point back to the first is implied, not stored.
  points: number[];
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
