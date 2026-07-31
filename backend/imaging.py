from __future__ import annotations

import base64
import io
import shutil
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from PIL import Image
from scipy.ndimage import binary_erosion

# Indexed by the anatomical axis the slice normal points along: x = L/R, y = A/P, z = S/I.
_PLANE_BY_NORMAL_AXIS = ("sagittal", "coronal", "axial")

# Minimum |component| for the slice normal to count as aligned with one anatomical axis.
_AXIS_ALIGNMENT_TOLERANCE = 0.8


class PlaneDetectionError(ValueError):
    """Raised when a frame's imaging plane cannot be read from its geometry."""


def _read_plane(filepath: str) -> str:
    """Return the imaging plane from the frame's acquisition geometry.

    Reads the MHA header only (no pixel data). Raises PlaneDetectionError if the
    plane cannot be determined; we never guess it from the frame index, since that
    silently breaks when frames are dropped from a series.
    """
    name = Path(filepath).name
    reader = sitk.ImageFileReader()
    reader.SetFileName(filepath)
    try:
        reader.ReadImageInformation()
    except RuntimeError as exc:
        raise PlaneDetectionError(f"Could not read MHA header from {name}: {exc}") from exc

    if reader.GetDimension() != 3:
        raise PlaneDetectionError(
            f"Cannot determine imaging plane for {name}: expected a 3D image with "
            f"direction cosines, got a {reader.GetDimension()}D image. A 2D MHA "
            f"cannot express a slice normal."
        )

    # SimpleITK direction is row-major with the i/j/k axis cosines as columns,
    # so column 2 is the slice normal.
    normal = np.array(reader.GetDirection()).reshape(3, 3)[:, 2]
    axis = int(np.argmax(np.abs(normal)))
    if abs(normal[axis]) < _AXIS_ALIGNMENT_TOLERANCE:
        raise PlaneDetectionError(
            f"Cannot determine imaging plane for {name}: slice normal "
            f"({normal[0]:.3f}, {normal[1]:.3f}, {normal[2]:.3f}) is oblique — it "
            f"does not align with a single anatomical axis."
        )
    return _PLANE_BY_NORMAL_AXIS[axis]


def _target_plane_matches(target_path: str, plane: str) -> bool:
    """Return whether the target mask's geometry agrees with its image's plane.

    The plane itself always comes from the image; this is only a consistency check.
    A mask whose plane cannot be read at all counts as a mismatch rather than an
    error, so one unusable mask does not sink a series of otherwise good frames.
    """
    try:
        return _read_plane(target_path) == plane
    except PlaneDetectionError:
        return False


def find_frames_with_targets(input_dir: str) -> list[dict]:
    """Find the first adjacent sagittal -> coronal frame pair, both with good targets.

    Planes come from each image's direction cosines rather than its index, so a
    series whose numbering has holes still yields the right plane per frame.

    Three conditions, each load-bearing:

    - Each frame's target mask geometry must agree with its image's. At least one
      mask in the reference dataset carries the wrong stack's geometry, which would
      draw a coronal contour over a sagittal image.
    - Sagittal must come first, so plane order and index order agree and the two
      panels cannot read backwards relative to acquisition.
    - The two must be *adjacent* in the image series, with no frame of any plane
      between them. Downstream (mr-linac-iowa) starts each plane's stack at the
      first image of that plane at or after min(annotation index) and seeds the
      tracker from frame 0 of that stack, so an intervening coronal image would
      leave the coronal tracker seeded with a mask drawn on a later frame. Adjacency
      is checked against every image on disk, not just those carrying targets,
      because that is what the downstream stack walk iterates.
    """
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

    ordered = sorted(image_map, key=int)
    common = image_map.keys() & target_map.keys()

    mismatched: set[str] = set()

    def candidate(prefix: str, want: str) -> dict | None:
        """Return the frame if it is `want` plane with an agreeing target, else None."""
        if prefix not in common:
            return None
        # A plane unreadable from the image is fatal; unreadable from the mask is not.
        plane = _read_plane(str(images_dir / image_map[prefix]))
        if plane != want:
            return None
        if not _target_plane_matches(str(target_dir / target_map[prefix]), plane):
            mismatched.add(prefix)
            return None
        return {
            "frame_index": prefix,
            "plane": plane,
            "image_file": image_map[prefix],
            "target_file": target_map[prefix],
        }

    for first, second in zip(ordered, ordered[1:]):
        sagittal = candidate(first, "sagittal")
        if sagittal is None:
            continue
        coronal = candidate(second, "coronal")
        if coronal is not None:
            return [sagittal, coronal]

    # No pair found. The scan is lazy and stops at the first frame that disqualifies a
    # pair, so it may never have read some images' geometry — including, when there is
    # only one frame, any image at all. Read the rest now so an unreadable image plane
    # surfaces as its own specific error instead of the generic "no pair" one below.
    for prefix in sorted(common, key=int):
        _read_plane(str(images_dir / image_map[prefix]))

    skipped = (
        f" {len(mismatched)} frame(s) were skipped because the target mask's geometry "
        f"did not match its image: {', '.join(sorted(mismatched))}."
        if mismatched
        else ""
    )
    raise PlaneDetectionError(
        f"Need two adjacent frames — a sagittal one immediately followed by a coronal "
        f"one — where both have a target structure whose geometry matches its image. "
        f"No such pair was found in {len(ordered)} frames ({len(common)} with targets). "
        f"The pair must be adjacent so downstream tracking seeds each plane on its own "
        f"first frame.{skipped}"
    )


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
    rgba[boundary, 0] = 255
    rgba[boundary, 1] = 20
    rgba[boundary, 2] = 147
    rgba[boundary, 3] = 200
    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def get_image_dimensions(filepath: str) -> tuple[int, int]:
    img = sitk.ReadImage(filepath)
    arr = sitk.GetArrayFromImage(img).squeeze()
    return int(arr.shape[1]), int(arr.shape[0])


def clear_annotations(input_dir: str) -> list[str]:
    """Delete the whole Annotations directory so a save is a complete replacement.

    Downstream (mr-linac-iowa) takes its start frame from min(annotation index) but
    seeds each plane's tracker from the *last* annotation matching that plane, so a
    leftover file from an earlier run silently seeds the wrong frame. A save writes a
    full pair plus labels.json, so nothing in here is worth keeping.

    The directory is not recreated; save_annotations mkdirs it before writing.

    Returns the names removed, top level only.
    """
    annotations_dir = Path(input_dir) / "Annotations"
    if not annotations_dir.is_dir():
        return []

    removed = sorted(p.name for p in annotations_dir.iterdir())
    shutil.rmtree(annotations_dir)
    return removed


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
        mask_img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        mask_arr = np.array(mask_img.resize((w, h), Image.NEAREST))
        alpha = mask_arr[:, :, 3]
        output[alpha > 128] = i

    # Write 3D to match the source frame's shape, so the direction cosines survive:
    # a 2D MHA cannot express a slice normal, and without one the saved annotation
    # cannot be identified as sagittal or coronal downstream.
    out_sitk = sitk.GetImageFromArray(output[None, :, :])
    out_sitk.SetOrigin(original.GetOrigin())
    out_sitk.SetSpacing(original.GetSpacing())
    out_sitk.SetDirection(original.GetDirection())

    out_path = annotations_dir / f"{frame_index}_annotation.mha"
    sitk.WriteImage(out_sitk, str(out_path))

    import json

    used_labels = {k: v for k, v in labels.items() if v}
    labels_path = annotations_dir / "labels.json"
    with open(labels_path, "w") as f:
        json.dump(used_labels, f, indent=2)
