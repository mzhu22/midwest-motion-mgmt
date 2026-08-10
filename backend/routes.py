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


@api.route("/load-folder", methods=["POST"])
def load_folder():
    data = request.get_json()
    folder_path = data.get("folder_path", "").strip()

    images_dir = Path(folder_path) / "TwoDImages"
    target_dir = images_dir / "TargetStructure"
    if not images_dir.is_dir() or not target_dir.is_dir():
        return jsonify({"error": "Invalid folder: missing TwoDImages or TargetStructure"}), 400

    try:
        frames = imaging.find_frames_with_targets(folder_path)
    except imaging.PlaneDetectionError as exc:
        return jsonify({"error": str(exc)}), 400

    for frame in frames:
        img_path = str(images_dir / frame["image_file"])
        w, h = imaging.get_image_dimensions(img_path)
        frame["width"] = w
        frame["height"] = h

    _state["folder_path"] = folder_path
    _state["frames"] = {f["frame_index"]: f for f in frames}

    return jsonify({"frames": frames})


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

    # Refuse a save with nothing drawn, and refuse it *before* clearing: a save that
    # would write no objects has nothing to offer over the target contour the tracker
    # already reads from the image, so letting it through would only destroy a good
    # earlier save. Object 0 is the target and is dropped on write, so it does not count.
    has_objects = any(
        mask
        for frame_data in frames_data
        for mask in frame_data.get("masks", [])[imaging.TARGET_OBJECT_ID + 1 :]
    )
    if not has_objects:
        return jsonify(
            {
                "error": "No object contours were drawn. The target contour is saved "
                "from the original image automatically; draw at least one other object."
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
