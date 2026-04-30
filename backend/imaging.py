from __future__ import annotations

import base64
import io
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from PIL import Image
from scipy.ndimage import binary_erosion


def find_frames_with_targets(input_dir: str) -> list[dict]:
    images_dir = Path(input_dir) / "TwoDImages"
    target_dir = images_dir / "TargetStructure"

    image_map: dict[str, str] = {}
    for f in images_dir.iterdir():
        if f.is_file() and f.suffix == ".mha":
            image_map[f.name[:5]] = f.name

    target_map: dict[str, str] = {}
    for f in target_dir.iterdir():
        if f.is_file() and f.suffix == ".mha":
            target_map[f.name[:5]] = f.name

    common = sorted(image_map.keys() & target_map.keys(), key=int)

    result = []
    for prefix in common[:2]:
        frame_num = int(prefix)
        result.append(
            {
                "frame_index": prefix,
                "plane": "sagittal" if frame_num % 2 == 1 else "coronal",
                "image_file": image_map[prefix],
                "target_file": target_map[prefix],
            }
        )
    return result


def read_mha_as_png(filepath: str) -> bytes:
    img = sitk.ReadImage(filepath)
    arr = sitk.GetArrayFromImage(img).squeeze().astype(np.float64)
    p2, p98 = np.percentile(arr, [2, 98])
    if p98 - p2 < 1e-6:
        arr_uint8 = np.zeros_like(arr, dtype=np.uint8)
    else:
        arr_uint8 = np.clip((arr - p2) / (p98 - p2) * 255, 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr_uint8, mode="L").save(buf, format="PNG")
    return buf.getvalue()


def read_target_contour_as_png(filepath: str) -> bytes:
    img = sitk.ReadImage(filepath)
    arr = sitk.GetArrayFromImage(img).squeeze()
    mask = arr == 0
    if not mask.any():
        h, w = arr.shape
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        buf = io.BytesIO()
        Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG")
        return buf.getvalue()

    boundary = mask & ~binary_erosion(mask)
    h, w = arr.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[boundary, 0] = 0
    rgba[boundary, 1] = 255
    rgba[boundary, 2] = 0
    rgba[boundary, 3] = 200
    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def get_image_dimensions(filepath: str) -> tuple[int, int]:
    img = sitk.ReadImage(filepath)
    arr = sitk.GetArrayFromImage(img).squeeze()
    return int(arr.shape[1]), int(arr.shape[0])


def save_annotations(
    input_dir: str,
    frame_index: str,
    masks_b64: list[str],
    labels: dict[str, str],
    image_file: str,
) -> None:
    images_dir = Path(input_dir) / "TwoDImages"
    annotations_dir = Path(input_dir) / "Annotations"
    annotations_dir.mkdir(exist_ok=True)

    original = sitk.ReadImage(str(images_dir / image_file))
    orig_arr = sitk.GetArrayFromImage(original).squeeze()
    h, w = orig_arr.shape

    output = np.full((h, w), 255, dtype=np.uint8)

    for i, b64 in enumerate(masks_b64):
        if not b64:
            continue
        png_bytes = base64.b64decode(b64)
        mask_img = Image.open(io.BytesIO(png_bytes)).convert("L")
        mask_arr = np.array(mask_img.resize((w, h), Image.NEAREST))
        output[mask_arr > 128] = i

    out_sitk = sitk.GetImageFromArray(output)
    out_sitk.SetOrigin(original.GetOrigin()[:2])
    out_sitk.SetSpacing(original.GetSpacing()[:2])

    out_path = annotations_dir / f"{frame_index}_annotation.mha"
    sitk.WriteImage(out_sitk, str(out_path))

    import json

    used_labels = {k: v for k, v in labels.items() if v}
    labels_path = annotations_dir / "labels.json"
    with open(labels_path, "w") as f:
        json.dump(used_labels, f, indent=2)
