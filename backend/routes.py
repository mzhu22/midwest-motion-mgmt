from __future__ import annotations

from pathlib import Path

from flask import Blueprint, jsonify, request, Response

from . import imaging

api = Blueprint("api", __name__, url_prefix="/api")

_state: dict = {}


@api.route("/browse-folder", methods=["GET"])
def browse_folder():
    import subprocess
    import sys
    if sys.platform == "darwin":
        result = subprocess.run(
            ["osascript", "-e", "POSIX path of (choose folder)"],
            capture_output=True,
            text=True,
        )
        path = result.stdout.strip() if result.returncode == 0 else ""
    elif sys.platform == "win32":
        ps = (
            "Add-Type -AssemblyName System.Windows.Forms;"
            "$d = New-Object System.Windows.Forms.FolderBrowserDialog;"
            "$d.RootFolder = 'MyComputer';"
            "if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }"
        )
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True,
            text=True,
        )
        path = result.stdout.strip() if result.returncode == 0 else ""
    else:
        return jsonify({"error": "Browse not supported on this platform"}), 501
    return jsonify({"path": path})


DEFAULT_MILESTONE_COUNT = 10

# How many frames on either side of a milestone's position get their MHA headers
# read while searching for a valid sagittal/coronal pair. Keeping this small is what
# makes loading (and re-loading, when a milestone is moved) cheap on a long series —
# see _select_pairs and the /select-milestones frame_indices path below.
MILESTONE_WINDOW = 5


def _eligible_positions(
    folder_path: str, ordered: list[str], image_map: dict[str, str], target_map: dict[str, str]
) -> list[int]:
    """Positions to space default milestones across: every frame with a target
    file, from the first *verified* valid pair onward.

    Anchoring on the first frame that merely has a target file isn't good enough —
    on the reference phantom that's frame 00285, whose target carries the wrong
    stack's geometry, not 00287 where the first real pair actually starts. Finding
    the true start (imaging.first_pair_position) is still cheap in practice: an
    early-exiting forward scan, not the whole-series scan this endpoint exists to
    avoid. Everything after it that has a target file is fair game — find_pair_near
    already tolerates the occasional bad frame within its window.
    """
    start = imaging.first_pair_position(folder_path, ordered, image_map, target_map)
    if start is None:
        return []
    return [
        i for i, frame_index in enumerate(ordered) if i >= start and frame_index in target_map
    ]


def _add_dimensions(folder_path: str, pair: list[dict]) -> None:
    images_dir = Path(folder_path) / "TwoDImages"
    for frame in pair:
        if "width" in frame:
            continue
        img_path = str(images_dir / frame["image_file"])
        w, h = imaging.get_image_dimensions(img_path)
        frame["width"] = w
        frame["height"] = h


def _select_pairs(
    folder_path: str, ordered, image_map, target_map, positions, strict: bool = True
) -> list[list[dict]]:
    """Resolve each position to its nearest valid pair, windowed, deduplicating by
    sagittal frame_index.

    Without an eager whole-series scan, the true number of distinct candidate pairs
    isn't known up front, so two evenly-spaced positions can resolve to the very same
    nearby pair (most likely when the requested count approaches — or exceeds — how
    many pairs actually exist). Deduplicating here is what makes "clamp to however
    many distinct milestones are actually available" work without ever computing
    that count in advance.

    A series can also have long stretches with no target at all (the reference
    phantom has none for its first 284 frames), so an evenly-spaced default position
    can legitimately land somewhere no pair exists within the window. With
    strict=False (the auto/count-based paths), that position is just skipped rather
    than failing the whole request, as long as at least one other position succeeds
    — the other evenly-spaced positions still deliver useful milestones. With
    strict=True (a milestone the user explicitly asked to move to a specific frame),
    the failure is real feedback and must propagate immediately.

    If every position fails, skipping all of them would just trade a specific,
    actionable error (an oblique image, mismatched target geometry, ...) for a vague
    "nothing found anywhere" one — so the first error hit is re-raised instead.
    """
    seen: set[str] = set()
    selected: list[list[dict]] = []
    first_error: imaging.PlaneDetectionError | None = None
    for pos in positions:
        try:
            pair = imaging.find_pair_near(
                folder_path, ordered, image_map, target_map, pos, MILESTONE_WINDOW
            )
        except imaging.PlaneDetectionError as exc:
            if strict:
                raise
            first_error = first_error or exc
            continue
        key = pair[0]["frame_index"]
        if key not in seen:
            seen.add(key)
            selected.append(pair)
    if not selected and first_error is not None:
        raise first_error
    return selected


@api.route("/load-folder", methods=["POST"])
def load_folder():
    data = request.get_json()
    folder_path = data.get("folder_path", "").strip()

    images_dir = Path(folder_path) / "TwoDImages"
    target_dir = images_dir / "TargetStructure"
    if not images_dir.is_dir() or not target_dir.is_dir():
        return jsonify({"error": "Invalid folder: missing TwoDImages or TargetStructure"}), 400

    # Cheap: a directory listing only, no MHA headers read yet.
    ordered, image_map, target_map = imaging.list_series(folder_path)
    if not ordered:
        return jsonify({
            "error": "Need at least two frames — a sagittal one and a coronal one — "
            "to find a pair. No frames were found."
        }), 400

    try:
        eligible = _eligible_positions(folder_path, ordered, image_map, target_map)
        if not eligible:
            return jsonify(
                {"error": "No valid sagittal/coronal pair exists anywhere in this series."}
            ), 400
        positions = imaging.default_positions(eligible, min(DEFAULT_MILESTONE_COUNT, len(eligible)))
        selected = _select_pairs(
            folder_path, ordered, image_map, target_map, positions, strict=False
        )
    except imaging.PlaneDetectionError as exc:
        return jsonify({"error": str(exc)}), 400

    for pair in selected:
        _add_dimensions(folder_path, pair)

    # eligible is ascending (built by scanning `ordered` forward), and its first entry
    # is exactly first_pair_position's start — i.e. the earliest sagittal frame that
    # can anchor a valid pair. The frontend uses this to tell "typed frame snapped
    # because it wasn't a valid pair" apart from "typed frame was below the series'
    # actual start".
    first_valid_frame = ordered[eligible[0]]

    _state["folder_path"] = folder_path
    _state["ordered"] = ordered
    _state["image_map"] = image_map
    _state["target_map"] = target_map
    _state["frames"] = {f["frame_index"]: f for pair in selected for f in pair}
    _state["first_valid_frame"] = first_valid_frame

    # Reported after resolving and deduplicating, not the raw request: with no
    # up-front pair count, this is the first point where the real number is known.
    return jsonify({
        "default_count": len(selected),
        "selected": selected,
        "first_valid_frame": first_valid_frame,
    })


@api.route("/select-milestones", methods=["POST"])
def select_milestones_route():
    data = request.get_json()
    folder_path = _state.get("folder_path")
    ordered = _state.get("ordered")
    if not folder_path or ordered is None:
        return jsonify({"error": "No folder loaded"}), 400
    image_map, target_map = _state["image_map"], _state["target_map"]

    try:
        if "frame_indices" in data:
            # Each entry loads only a fresh MILESTONE_WINDOW around the requested
            # frame — moving one milestone never re-scans the frames around any
            # other, loaded or not. strict=True (the default): the user asked for a
            # pair near this exact frame, so a failure here is real feedback.
            positions = [
                imaging.position_near(ordered, wanted) for wanted in data["frame_indices"]
            ]
            selected = _select_pairs(folder_path, ordered, image_map, target_map, positions)
        else:
            count = int(data.get("count", DEFAULT_MILESTONE_COUNT))
            eligible = _eligible_positions(folder_path, ordered, image_map, target_map)
            if not eligible:
                return jsonify({
                    "error": "No valid sagittal/coronal pair exists anywhere in this series."
                }), 400
            positions = imaging.default_positions(eligible, count)
            selected = _select_pairs(
                folder_path, ordered, image_map, target_map, positions, strict=False
            )
    except imaging.PlaneDetectionError as exc:
        return jsonify({"error": str(exc)}), 400

    for pair in selected:
        _add_dimensions(folder_path, pair)

    _state["frames"] = {f["frame_index"]: f for pair in selected for f in pair}
    return jsonify({"selected": selected})


@api.route("/frame/<frame_index>/image")
def frame_image(frame_index: str):
    frame = _state.get("frames", {}).get(frame_index)
    if not frame:
        return jsonify({"error": "Frame not loaded"}), 404

    folder = _state["folder_path"]
    path = str(Path(folder) / "TwoDImages" / frame["image_file"])
    png = imaging.read_mha_as_png(path)
    return Response(png, mimetype="image/png")


@api.route("/frame/<frame_index>/target-contour")
def frame_target_contour(frame_index: str):
    frame = _state.get("frames", {}).get(frame_index)
    if not frame:
        return jsonify({"error": "Frame not loaded"}), 404

    folder = _state["folder_path"]
    path = str(Path(folder) / "TwoDImages" / "TargetStructure" / frame["target_file"])
    png = imaging.read_target_contour_as_png(path)
    return Response(png, mimetype="image/png")


@api.route("/save", methods=["POST"])
def save():
    data = request.get_json()
    folder = _state.get("folder_path")
    if not folder:
        return jsonify({"error": "No folder loaded"}), 400

    labels = data.get("labels", {})
    frames_data = data.get("frames", [])

    # Refuse a save where any milestone has nothing drawn, and refuse it *before*
    # clearing: milestones exist to give the tracker several correction points spaced
    # across the series, so one left blank would seed nothing there and just fall back
    # to the target contour alone — the same as if the whole save were empty, just
    # localized to that milestone. Letting it through would also destroy a good earlier
    # save. Object 0 is the target and is dropped on write, so it does not count.
    # frames_data arrives in milestone pairs (the frontend's frames[2m], frames[2m+1]
    # convention — see App.tsx's milestoneIndex comment).
    def _pair_has_objects(pair: list[dict]) -> bool:
        return any(
            mask
            for frame_data in pair
            for mask in frame_data.get("masks", [])[imaging.TARGET_OBJECT_ID + 1 :]
        )

    milestones = [frames_data[i : i + 2] for i in range(0, len(frames_data), 2)]
    empty_milestones = [pair for pair in milestones if not _pair_has_objects(pair)]

    if len(empty_milestones) == len(milestones):
        return jsonify(
            {
                "error": "No object contours were drawn. The target contour is saved "
                "from the original image automatically; draw at least one other object."
            }
        ), 400
    if empty_milestones:
        frame_list = ", ".join(
            pair[0].get("frame_index", "?") for pair in empty_milestones
        )
        return jsonify(
            {
                "error": "Every milestone needs at least one drawn object. Empty "
                f"milestones (sagittal frame): {frame_list}"
            }
        ), 400

    # Clear once up front, not per frame: a save writes a full sagittal/coronal pair
    # and stale masks from an earlier run would mis-seed tracking downstream.
    removed = imaging.clear_annotations(folder)

    for frame_data in frames_data:
        idx = frame_data["frame_index"]
        masks = frame_data.get("masks", [])
        frame = _state["frames"].get(idx)
        if not frame:
            continue
        imaging.save_annotations(folder, idx, masks, labels, frame["image_file"])

    annotations_dir = str(Path(folder) / "Annotations")
    return jsonify({"status": "ok", "path": annotations_dir, "replaced": removed})
