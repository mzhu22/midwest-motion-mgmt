import type Konva from "konva";
import type { FrameInfo, LineData } from "./types";

const DISPLAY_SCALE = 2;

export function exportMasksForFrame(
  stage: Konva.Stage,
  frame: FrameInfo,
  lines: LineData[]
): string[] {
  const annotationLayer = stage.getLayers()[2];
  if (!annotationLayer) return Array(8).fill("");

  const masks: string[] = [];

  const prevScaleX = stage.scaleX();
  const prevScaleY = stage.scaleY();
  const prevX = stage.x();
  const prevY = stage.y();
  stage.scaleX(1);
  stage.scaleY(1);
  stage.x(0);
  stage.y(0);

  for (let objIdx = 0; objIdx < 8; objIdx++) {
    const children = annotationLayer.getChildren();
    const visibility: boolean[] = [];

    children.forEach((child, i) => {
      visibility.push(child.visible());
      const line = lines[i];
      child.visible(line?.objectIndex === objIdx);
    });

    const dataUrl = annotationLayer.toDataURL({
      pixelRatio: 1 / DISPLAY_SCALE,
      width: frame.width * DISPLAY_SCALE,
      height: frame.height * DISPLAY_SCALE,
    });

    children.forEach((child, i) => {
      child.visible(visibility[i] ?? true);
    });

    const hasStrokes = lines.some((l) => l.objectIndex === objIdx);
    masks.push(hasStrokes ? dataUrl.split(",")[1] ?? "" : "");
  }

  stage.scaleX(prevScaleX);
  stage.scaleY(prevScaleY);
  stage.x(prevX);
  stage.y(prevY);

  return masks;
}
