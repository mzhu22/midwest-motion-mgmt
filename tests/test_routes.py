from __future__ import annotations

import base64
import io
from unittest.mock import MagicMock, patch

import numpy as np
from PIL import Image

from tests.conftest import SAGITTAL_DIRECTION, _make_frame_dir, _write_mha_2d


# --- GET /api/browse-folder ---

def _mock_proc(stdout: str, returncode: int = 0) -> MagicMock:
    m = MagicMock()
    m.stdout = stdout
    m.returncode = returncode
    return m


class TestBrowseFolder:
    def test_macos_returns_selected_path(self, client):
        with patch("sys.platform", "darwin"), \
             patch("subprocess.run", return_value=_mock_proc("/tmp/data\n")) as mock_run:
            resp = client.get("/api/browse-folder")
        assert resp.status_code == 200
        assert resp.get_json() == {"path": "/tmp/data"}
        args = mock_run.call_args[0][0]
        assert args[0] == "osascript"

    def test_macos_cancel_returns_empty(self, client):
        with patch("sys.platform", "darwin"), \
             patch("subprocess.run", return_value=_mock_proc("", returncode=1)):
            resp = client.get("/api/browse-folder")
        assert resp.status_code == 200
        assert resp.get_json() == {"path": ""}

    def test_windows_returns_selected_path(self, client):
        with patch("sys.platform", "win32"), \
             patch("subprocess.run", return_value=_mock_proc("C:\\Users\\data\n")) as mock_run:
            resp = client.get("/api/browse-folder")
        assert resp.status_code == 200
        assert resp.get_json() == {"path": "C:\\Users\\data"}
        args = mock_run.call_args[0][0]
        assert args[0] == "powershell"

    def test_windows_cancel_returns_empty(self, client):
        with patch("sys.platform", "win32"), \
             patch("subprocess.run", return_value=_mock_proc("", returncode=1)):
            resp = client.get("/api/browse-folder")
        assert resp.status_code == 200
        assert resp.get_json() == {"path": ""}

    def test_unsupported_platform_returns_501(self, client):
        with patch("sys.platform", "linux"):
            resp = client.get("/api/browse-folder")
        assert resp.status_code == 501


# --- POST /api/load-folder ---

class TestLoadFolder:
    def test_success(self, client, tmp_input_dir):
        resp = client.post("/api/load-folder", json={"folder_path": str(tmp_input_dir)})
        assert resp.status_code == 200
        data = resp.get_json()
        assert "selected" in data
        assert data["default_count"] == 1
        assert len(data["selected"]) == 1
        pair = data["selected"][0]
        assert len(pair) == 2
        for f in pair:
            assert "frame_index" in f
            assert "plane" in f
            assert "width" in f
            assert "height" in f

    def test_missing_directory(self, client):
        resp = client.post("/api/load-folder", json={"folder_path": "/nonexistent/path"})
        assert resp.status_code == 400
        assert "error" in resp.get_json()

    def test_directory_without_target_structure(self, client, tmp_path):
        (tmp_path / "TwoDImages").mkdir()
        resp = client.post("/api/load-folder", json={"folder_path": str(tmp_path)})
        assert resp.status_code == 400

    def test_not_enough_frames(self, client, tmp_path):
        images_dir = tmp_path / "TwoDImages"
        target_dir = images_dir / "TargetStructure"
        images_dir.mkdir()
        target_dir.mkdir()
        resp = client.post("/api/load-folder", json={"folder_path": str(tmp_path)})
        assert resp.status_code == 400

    def test_undeterminable_plane_returns_400_with_message(self, client, tmp_path):
        images_dir = tmp_path / "TwoDImages"
        target_dir = images_dir / "TargetStructure"
        images_dir.mkdir()
        target_dir.mkdir()
        arr = np.zeros((8, 8), dtype=np.uint8)
        _write_mha_2d(images_dir / "00001_Frame.mha", arr)
        _write_mha_2d(target_dir / "00001_Frame.mha", arr)

        resp = client.post("/api/load-folder", json={"folder_path": str(tmp_path)})
        assert resp.status_code == 400
        error = resp.get_json()["error"]
        assert "00001_Frame.mha" in error
        assert "imaging plane" in error

    def test_single_plane_series_returns_400(self, client, tmp_path):
        _make_frame_dir(
            tmp_path,
            {"00001": SAGITTAL_DIRECTION, "00003": SAGITTAL_DIRECTION},
        )
        resp = client.post("/api/load-folder", json={"folder_path": str(tmp_path)})
        assert resp.status_code == 400
        assert "coronal" in resp.get_json()["error"]


# --- POST /api/select-milestones ---

class TestSelectMilestones:
    def test_no_folder_loaded_returns_400(self, client):
        resp = client.post("/api/select-milestones", json={"count": 2})
        assert resp.status_code == 400

    def test_count_recomputes_selection(self, client, tmp_multi_pair_dir):
        client.post("/api/load-folder", json={"folder_path": str(tmp_multi_pair_dir)})
        resp = client.post("/api/select-milestones", json={"count": 2})
        assert resp.status_code == 200
        selected = resp.get_json()["selected"]
        assert len(selected) == 2
        # Evenly spaced over 3 candidates with count=2 keeps the first and last.
        assert selected[0][0]["frame_index"] == "00001"
        assert selected[1][0]["frame_index"] == "00005"

    def test_count_clamped_to_available_pairs(self, client, tmp_multi_pair_dir):
        client.post("/api/load-folder", json={"folder_path": str(tmp_multi_pair_dir)})
        resp = client.post("/api/select-milestones", json={"count": 99})
        assert resp.status_code == 200
        assert len(resp.get_json()["selected"]) == 3

    def test_explicit_frame_indices_selects_those_pairs(self, client, tmp_multi_pair_dir):
        client.post("/api/load-folder", json={"folder_path": str(tmp_multi_pair_dir)})
        resp = client.post(
            "/api/select-milestones", json={"frame_indices": ["00003", "00005"]}
        )
        assert resp.status_code == 200
        selected = resp.get_json()["selected"]
        assert [pair[0]["frame_index"] for pair in selected] == ["00003", "00005"]

    def test_explicit_frame_index_snaps_to_nearest_candidate(self, client, tmp_multi_pair_dir):
        client.post("/api/load-folder", json={"folder_path": str(tmp_multi_pair_dir)})
        # "00004" is a coronal frame, not a candidate's sagittal start; nearest is "00003".
        resp = client.post("/api/select-milestones", json={"frame_indices": ["00004"]})
        assert resp.status_code == 200
        selected = resp.get_json()["selected"]
        assert selected[0][0]["frame_index"] == "00003"

    def test_selection_updates_frame_lookup_for_image_route(self, client, tmp_multi_pair_dir):
        client.post("/api/load-folder", json={"folder_path": str(tmp_multi_pair_dir)})
        client.post("/api/select-milestones", json={"frame_indices": ["00005"]})
        resp = client.get("/api/frame/00005/image")
        assert resp.status_code == 200
        # A frame that was in the original default selection but got dropped by the
        # narrower explicit selection is no longer considered loaded.
        resp = client.get("/api/frame/00001/image")
        assert resp.status_code == 404


# --- GET /api/frame/<idx>/image ---

class TestFrameImage:
    def test_returns_png_after_load(self, loaded_client):
        resp = loaded_client.get("/api/frame/00001/image")
        assert resp.status_code == 200
        assert resp.content_type == "image/png"
        img = Image.open(io.BytesIO(resp.data))
        assert img.format == "PNG"

    def test_404_before_load(self, client):
        resp = client.get("/api/frame/00001/image")
        assert resp.status_code == 404

    def test_404_unknown_frame(self, loaded_client):
        resp = loaded_client.get("/api/frame/99999/image")
        assert resp.status_code == 404


# --- GET /api/frame/<idx>/target-contour ---

class TestFrameTargetContour:
    def test_returns_png_after_load(self, loaded_client):
        resp = loaded_client.get("/api/frame/00001/target-contour")
        assert resp.status_code == 200
        assert resp.content_type == "image/png"
        img = Image.open(io.BytesIO(resp.data))
        assert img.mode == "RGBA"

    def test_404_before_load(self, client):
        resp = client.get("/api/frame/00001/target-contour")
        assert resp.status_code == 404

    def test_404_unknown_frame(self, loaded_client):
        resp = loaded_client.get("/api/frame/99999/target-contour")
        assert resp.status_code == 404


# --- POST /api/save ---

def _ids_b64(ids: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(ids, dtype=np.uint8).tobytes()).decode()


def _outline(obj=1, size=8, lo=1, hi=6) -> np.ndarray:
    """A closed 1 px square outline, the way the frontend rasterizes a contour."""
    ids = np.zeros((size, size), dtype=np.uint8)
    ids[lo, lo : hi + 1] = obj
    ids[hi, lo : hi + 1] = obj
    ids[lo : hi + 1, lo] = obj
    ids[lo : hi + 1, hi] = obj
    return ids


def _frame(idx: str, ids: np.ndarray | None = None) -> dict:
    ids = np.zeros((8, 8), np.uint8) if ids is None else ids
    return {"frame_index": idx, "object_ids": _ids_b64(ids)}


class TestSave:
    def test_save_success(self, loaded_client, tmp_input_dir):
        resp = loaded_client.post("/api/save", json={
            "labels": {"1": "tumor"},
            "frames": [_frame("00001", _outline()), _frame("00002")],
        })
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "ok"
        assert (tmp_input_dir / "Annotations" / "00001_annotation.mha").exists()

    def test_the_written_mask_is_the_label_image(self, loaded_client, tmp_input_dir):
        import SimpleITK as sitk

        ids = _outline(obj=3)
        loaded_client.post("/api/save", json={
            "labels": {"3": "x"}, "frames": [_frame("00001", ids), _frame("00002")],
        })
        arr = sitk.GetArrayFromImage(
            sitk.ReadImage(str(tmp_input_dir / "Annotations" / "00001_annotation.mha"))
        ).squeeze()
        assert (arr[ids == 3] == 3).all()
        assert (arr[ids == 0] == 255).all()

    def test_save_with_no_object_contours_is_rejected(self, loaded_client, tmp_input_dir):
        """A save that draws nothing adds nothing: the target already comes from the image."""
        resp = loaded_client.post("/api/save", json={
            "labels": {},
            "frames": [_frame("00001"), _frame("00002")],
        })
        assert resp.status_code == 400
        assert "object contours" in resp.get_json()["error"]
        assert not (tmp_input_dir / "Annotations").exists()

    def test_a_rejected_save_leaves_an_earlier_save_intact(
        self, loaded_client, tmp_input_dir
    ):
        """The guard runs before clear_annotations, so a bad save cannot destroy a good one."""
        annotations_dir = tmp_input_dir / "Annotations"
        annotations_dir.mkdir()
        (annotations_dir / "00001_annotation.mha").write_bytes(b"earlier")

        resp = loaded_client.post("/api/save", json={
            "labels": {},
            "frames": [_frame("00001"), _frame("00002")],
        })

        assert resp.status_code == 400
        assert (annotations_dir / "00001_annotation.mha").read_bytes() == b"earlier"

    def test_save_no_folder_loaded(self, client):
        resp = client.post("/api/save", json={"labels": {}, "frames": []})
        assert resp.status_code == 400

    def test_an_unknown_frame_is_rejected(self, loaded_client, tmp_input_dir):
        resp = loaded_client.post("/api/save", json={
            "labels": {},
            "frames": [_frame("99999", _outline())],
        })
        assert resp.status_code == 400
        assert "99999" in resp.get_json()["error"]
        assert not (tmp_input_dir / "Annotations").exists()

    def test_a_label_image_of_the_wrong_size_is_rejected(self, loaded_client):
        resp = loaded_client.post("/api/save", json={
            "labels": {},
            "frames": [_frame("00001", np.ones((4, 4), np.uint8)), _frame("00002")],
        })
        assert resp.status_code == 400
        assert "00001" in resp.get_json()["error"]

    def test_save_replaces_stale_annotations_from_a_previous_run(
        self, loaded_client, tmp_input_dir
    ):
        """A save is a full replacement: masks from an earlier run must not survive.

        Downstream takes its start frame from min(annotation index), so a leftover
        with a lower index drags both stacks back and mis-seeds tracking.
        """
        annotations_dir = tmp_input_dir / "Annotations"
        annotations_dir.mkdir()
        (annotations_dir / "00285_annotation.mha").write_bytes(b"stale")

        resp = loaded_client.post("/api/save", json={
            "labels": {"1": "tumor"},
            "frames": [_frame("00001", _outline()), _frame("00002")],
        })

        assert resp.status_code == 200
        assert resp.get_json()["replaced"] == ["00285_annotation.mha"]
        assert sorted(p.name for p in annotations_dir.glob("*.mha")) == [
            "00001_annotation.mha",
            "00002_annotation.mha",
        ]

    def test_save_with_one_empty_milestone_is_rejected(self, client, tmp_multi_pair_dir):
        """Drawing on some milestones but not others still fails: each milestone is
        a separate correction point for the tracker, so an empty one seeds nothing
        there even though the save as a whole isn't empty."""
        resp = client.post("/api/load-folder", json={"folder_path": str(tmp_multi_pair_dir)})
        assert resp.status_code == 200
        assert resp.get_json()["default_count"] == 3

        resp = client.post("/api/save", json={
            "labels": {"1": "tumor"},
            "frames": [
                _frame("00001", _outline()),
                _frame("00002", _outline()),
                _frame("00003"),
                _frame("00004"),
                _frame("00005", _outline()),
                _frame("00006", _outline()),
            ],
        })
        assert resp.status_code == 400
        error = resp.get_json()["error"]
        assert "Every milestone" in error
        assert "00003" in error
        assert "00001" not in error
        assert "00005" not in error

    def test_a_two_frame_save_keeps_both_frames(self, loaded_client, tmp_input_dir):
        """Clearing runs once per save, not once per frame.

        save_annotations is called in a loop, so a clear living inside it would
        delete the first frame's output while writing the second.
        """
        resp = loaded_client.post("/api/save", json={
            "labels": {"1": "tumor"},
            "frames": [_frame("00001", _outline()), _frame("00002", _outline())],
        })

        assert resp.status_code == 200
        assert resp.get_json()["replaced"] == []
        assert sorted(
            p.name for p in (tmp_input_dir / "Annotations").glob("*.mha")
        ) == ["00001_annotation.mha", "00002_annotation.mha"]


class TestSaveClosureCheck:
    """An outline with a gap seeds the tracker with a thin line, silently, so the save
    refuses it -- and refuses it before clearing, so an earlier good save survives."""

    def _gappy(self):
        ids = _outline()
        ids[1, 3] = 0
        return ids

    def test_an_outline_with_a_gap_is_rejected_naming_object_and_frame(self, loaded_client):
        resp = loaded_client.post("/api/save", json={
            "labels": {"1": "tumor"},
            "frames": [_frame("00001", self._gappy()), _frame("00002", _outline())],
        })
        assert resp.status_code == 400
        error = resp.get_json()["error"]
        assert "Object 1" in error and "00001" in error and "not a closed" in error

    def test_the_other_frames_closed_outline_is_not_blamed(self, loaded_client):
        resp = loaded_client.post("/api/save", json={
            "labels": {"1": "tumor"},
            "frames": [_frame("00001", self._gappy()), _frame("00002", _outline())],
        })
        assert "00002" not in resp.get_json()["error"]

    def test_a_rejected_outline_leaves_an_earlier_save_intact(self, loaded_client, tmp_input_dir):
        annotations_dir = tmp_input_dir / "Annotations"
        annotations_dir.mkdir()
        (annotations_dir / "00001_annotation.mha").write_bytes(b"earlier")

        resp = loaded_client.post("/api/save", json={
            "labels": {"1": "tumor"},
            "frames": [_frame("00001", self._gappy()), _frame("00002", _outline())],
        })

        assert resp.status_code == 400
        assert (annotations_dir / "00001_annotation.mha").read_bytes() == b"earlier"

    def test_one_object_crossing_another_is_caught(self, loaded_client):
        """Later objects win where outlines cross, which can open the earlier one."""
        ids = _outline(obj=1)
        ids[1, 3] = 2
        ids[2, 3] = 2
        resp = loaded_client.post("/api/save", json={
            "labels": {"1": "a", "2": "b"},
            "frames": [_frame("00001", ids), _frame("00002", _outline())],
        })
        assert resp.status_code == 400
        assert "Object 1" in resp.get_json()["error"]


# --- POST /api/load-annotations ---

def _save(client, frame_indices, labels=None, ids=None):
    ids = _outline() if ids is None else ids
    frames = [_frame(idx, ids) for idx in frame_indices]
    resp = client.post(
        "/api/save", json={"frames": frames, "labels": labels or {"1": "kidney"}}
    )
    assert resp.status_code == 200, resp.get_json()


class TestLoadAnnotations:
    def test_no_folder_loaded_returns_400(self, client):
        assert client.post("/api/load-annotations").status_code == 400

    def test_folder_without_annotations_returns_400(self, loaded_client):
        resp = loaded_client.post("/api/load-annotations")
        assert resp.status_code == 400
        assert "no saved annotations" in resp.get_json()["error"]

    def test_load_folder_reports_whether_annotations_exist(self, client, tmp_input_dir):
        first = client.post("/api/load-folder", json={"folder_path": str(tmp_input_dir)})
        assert first.get_json()["has_annotations"] is False
        _save(client, ["00001", "00002"])
        again = client.post("/api/load-folder", json={"folder_path": str(tmp_input_dir)})
        assert again.get_json()["has_annotations"] is True

    def test_returns_contours_labels_and_the_saved_frames(self, loaded_client):
        _save(loaded_client, ["00001", "00002"], {"1": "kidney"})
        resp = loaded_client.post("/api/load-annotations")
        assert resp.status_code == 200
        data = resp.get_json()
        assert [f["frame_index"] for f in data["selected"][0]] == ["00001", "00002"]
        assert data["labels"] == {"1": "kidney"}
        for idx in ("00001", "00002"):
            objects = data["frames"][idx]["objects"]
            assert list(objects) == ["1"]
            assert len(objects["1"]) >= 6  # one flat [x, y, ...] list: a single loop
            assert data["frames"][idx]["notes"] == []

    def test_reference_is_the_label_image_with_background_as_zero(self, loaded_client):
        _save(loaded_client, ["00001", "00002"])
        data = loaded_client.post("/api/load-annotations").get_json()
        ref = np.frombuffer(
            base64.b64decode(data["frames"]["00001"]["reference"]), dtype=np.uint8
        ).reshape(8, 8)
        assert set(np.unique(ref)) == {0, 1}
        assert ref[1, 1] == 1 and ref[3, 3] == 0

    def test_a_saved_outline_reloads_to_exactly_the_same_pixels(self, loaded_client):
        _save(loaded_client, ["00001", "00002"])
        contour = loaded_client.post("/api/load-annotations").get_json()["frames"]["00001"][
            "objects"
        ]["1"]
        pts = np.array(contour).reshape(-1, 2)
        assert {(int(y), int(x)) for x, y in pts} == {
            (int(r), int(c)) for r, c in zip(*np.nonzero(_outline()))
        }

    def test_each_object_comes_back_as_one_contour(self, loaded_client):
        ids = _outline(obj=1)
        ids[3:5, 3:5] = 0
        two = _outline(obj=2, lo=2, hi=5)
        ids[two > 0] = 2  # a smaller object nested inside the first
        _save(loaded_client, ["00001", "00002"], {"1": "a", "2": "b"}, ids)
        objects = loaded_client.post("/api/load-annotations").get_json()["frames"]["00001"][
            "objects"
        ]
        assert sorted(objects) == ["1", "2"]
        assert all(isinstance(v, list) and isinstance(v[0], float) for v in objects.values())

    def test_switches_milestones_to_the_saved_frames(self, client, tmp_multi_pair_dir):
        client.post("/api/load-folder", json={"folder_path": str(tmp_multi_pair_dir)})
        client.post("/api/select-milestones", json={"frame_indices": ["00003"]})
        _save(client, ["00003", "00004"])
        # Move away from the saved milestone, then load it back.
        client.post("/api/select-milestones", json={"frame_indices": ["00001"]})
        data = client.post("/api/load-annotations").get_json()
        assert [[f["frame_index"] for f in pair] for pair in data["selected"]] == [
            ["00003", "00004"]
        ]
        assert client.get("/api/frame/00003/image").status_code == 200

    def test_loads_several_milestones(self, client, tmp_multi_pair_dir):
        client.post("/api/load-folder", json={"folder_path": str(tmp_multi_pair_dir)})
        client.post("/api/select-milestones", json={"frame_indices": ["00001", "00005"]})
        _save(client, ["00001", "00002", "00005", "00006"])
        data = client.post("/api/load-annotations").get_json()
        assert [pair[0]["frame_index"] for pair in data["selected"]] == ["00001", "00005"]

    def test_a_lone_annotation_that_is_not_a_pair_is_refused(self, client, tmp_multi_pair_dir):
        client.post("/api/load-folder", json={"folder_path": str(tmp_multi_pair_dir)})
        client.post("/api/select-milestones", json={"frame_indices": ["00001"]})
        _save(client, ["00001", "00002"])
        # A leftover file for a frame that is not part of any saved pair.
        stray = tmp_multi_pair_dir / "Annotations" / "00004_annotation.mha"
        (tmp_multi_pair_dir / "Annotations" / "00001_annotation.mha").replace(stray)
        resp = client.post("/api/load-annotations")
        assert resp.status_code == 400
        assert "adjacent" in resp.get_json()["error"] or "pairs" in resp.get_json()["error"]

    def test_wrong_sized_annotation_is_refused(self, loaded_client, tmp_input_dir):
        import SimpleITK as sitk

        _save(loaded_client, ["00001", "00002"])
        path = tmp_input_dir / "Annotations" / "00001_annotation.mha"
        small = sitk.GetImageFromArray(np.full((1, 4, 4), 255, dtype=np.uint8))
        sitk.WriteImage(small, str(path))
        resp = loaded_client.post("/api/load-annotations")
        assert resp.status_code == 400
        assert "00001" in resp.get_json()["error"]
