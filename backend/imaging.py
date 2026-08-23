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

# Object id reserved for the target across this tool and mr-linac-iowa. The target is
# never drawn by hand: it is shown as reference here and read from the TargetStructure
# mask downstream, so nothing in Annotations/ ever carries this id. User objects are 1-7.
TARGET_OBJECT_ID = 0


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


def list_series(input_dir: str) -> tuple[list[str], dict[str, str], dict[str, str]]:
    """List every image/target file present, sorted numerically by frame index.

    Only lists filenames (a directory listing), reading no MHA headers — cheap even
    on a series with thousands of frames, so it's safe to call just to learn the
    series' length before deciding what to actually scan.
    """
    images_dir = Path(input_dir) / "TwoDImages"
    target_dir = images_dir / "TargetStructure"

    image_map: dict[str, str] = {
        f.name[:5]: f.name for f in images_dir.iterdir() if f.is_file() and f.suffix == ".mha"
    }
    target_map: dict[str, str] = {
        f.name[:5]: f.name for f in target_dir.iterdir() if f.is_file() and f.suffix == ".mha"
    }
    return sorted(image_map, key=int), image_map, target_map


def first_pair_position(
    input_dir: str,
    ordered: list[str],
    image_map: dict[str, str],
    target_map: dict[str, str],
) -> int | None:
    """Position of the first verified adjacent sagittal -> coronal pair in the
    series, scanning forward from the start and stopping at the first match.

    Cheap in practice, the same way find_frames_with_targets used to be: it reads
    only as many headers as it takes to find one pair, not the whole series. This is
    what a default-milestone pool should anchor its start on — merely the first
    frame with a target file can be geometry-mismatched (the reference phantom's
    frame 00285 carries the wrong stack's geometry; its first real pair is
    00287/00288), so anchoring there instead of the true first pair would waste a
    milestone on a position no better than one with no target at all. Returns None
    if no pair exists anywhere in the series.
    """
    images_dir = Path(input_dir) / "TwoDImages"
    target_dir = images_dir / "TargetStructure"
    common = image_map.keys() & target_map.keys()

    def candidate(prefix: str, want: str) -> bool:
        if prefix not in common:
            return False
        plane = _read_plane(str(images_dir / image_map[prefix]))
        if plane != want:
            return False
        return _target_plane_matches(str(target_dir / target_map[prefix]), plane)

    for i in range(len(ordered) - 1):
        if candidate(ordered[i], "sagittal") and candidate(ordered[i + 1], "coronal"):
            return i

    # No pair exists. With fewer than two frames the loop above never ran at all, so
    # a bad lone frame's plane was never read; read it now so it surfaces as its own
    # specific error rather than silently returning None.
    if len(ordered) < 2:
        for prefix in sorted(common, key=int):
            _read_plane(str(images_dir / image_map[prefix]))
    return None


def default_positions(positions: list[int], count: int) -> list[int]:
    """`count` evenly spaced entries from `positions` (sorted ascending), including
    both endpoints.

    `positions` is the pool to space milestones across — usually every position in
    the series, but callers with a cheap way to narrow it (e.g. to positions whose
    frame has a target file at all) should, so a default milestone doesn't land
    somewhere with no chance of finding anything nearby. A series can have a long
    dead stretch with no targets — the reference phantom has none for its first 284
    frames — and evenly spacing over the *raw* frame count wastes a pick there.

    `count` is clamped to [1, len(positions)]. For 1 < count < n, round(i * (n-1) /
    (count-1)) forms a strictly increasing sequence (the step (n-1)/(count-1) is
    always > 1 in that range, and rounding a sequence with step > 1 can never
    collapse two distinct terms to the same integer), so this never needs to resolve
    a collision between two milestones landing on the same entry.
    """
    n = len(positions)
    count = max(1, min(count, n))
    if count == 1:
        return [positions[0]]
    if count == n:
        return list(positions)
    return [positions[round(i * (n - 1) / (count - 1))] for i in range(count)]


def position_near(ordered: list[str], frame_index: str) -> int:
    """The position in `ordered` closest to `frame_index`, which need not itself be
    present in the series (a typed value can land on a gap, or off either end)."""
    if frame_index in ordered:
        return ordered.index(frame_index)
    target = int(frame_index)
    return min(range(len(ordered)), key=lambda i: abs(int(ordered[i]) - target))


def find_pair_near(
    input_dir: str,
    ordered: list[str],
    image_map: dict[str, str],
    target_map: dict[str, str],
    position: int,
    window: int = 5,
) -> list[dict]:
    """Find the adjacent sagittal -> coronal pair (matching target geometry)
    closest to `ordered[position]`, reading MHA headers for at most
    `2 * window + 1` frames around it rather than scanning the whole series.

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
      is checked against every image in the window, not just those carrying
      targets, because that is what the downstream stack walk iterates.
    """
    images_dir = Path(input_dir) / "TwoDImages"
    target_dir = images_dir / "TargetStructure"
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

    n = len(ordered)
    lo = max(0, position - window)
    hi = min(n, position + window + 1)

    best: list[dict] | None = None
    best_dist: int | None = None
    i = lo
    while i < hi - 1:
        sagittal = candidate(ordered[i], "sagittal")
        if sagittal is None:
            i += 1
            continue
        coronal = candidate(ordered[i + 1], "coronal")
        if coronal is None:
            i += 1
            continue
        dist = abs(i - position)
        if best is None or dist < best_dist:
            best, best_dist = [sagittal, coronal], dist
        i += 2

    if best is not None:
        return best

    # No pair in the window. The scan above is lazy and stops checking a prefix as
    # soon as it disqualifies a pair, so it may not have read every frame's geometry
    # in the window. Read the rest now, so an unreadable image plane surfaces as its
    # own specific error instead of the generic "no pair" one below.
    windowed = set(ordered[lo:hi])
    for prefix in sorted(windowed & common, key=int):
        _read_plane(str(images_dir / image_map[prefix]))

    skipped = (
        f" {len(mismatched)} frame(s) were skipped because the target mask's geometry "
        f"did not match its image: {', '.join(sorted(mismatched))}."
        if mismatched
        else ""
    )
    near = ordered[position] if ordered else "the requested position"
    raise PlaneDetectionError(
        f"Need two adjacent frames — a sagittal one immediately followed by a coronal "
        f"one — where both have a target structure whose geometry matches its image. "
        f"No such pair was found within {window} frames of {near} "
        f"({hi - lo} frames scanned, {len(windowed & common)} with targets).{skipped}"
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
        # Object 0 is the target and is never hand-drawn. mr-linac-iowa reads it from
        # TwoDImages/TargetStructure/ for the frame it seeds on, so writing a traced
        # copy here would only give the tracker a worse version of the same contour.
        if i == TARGET_OBJECT_ID or not b64:
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
