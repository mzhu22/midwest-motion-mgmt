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

class TestSave:
    def _make_mask_b64(self, w=8, h=8):
        img = Image.new("L", (w, h), 255)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()

    def test_save_success(self, loaded_client, tmp_input_dir):
        resp = loaded_client.post("/api/save", json={
            "labels": {"1": "tumor"},
            "frames": [
                {"frame_index": "00001", "masks": ["", self._make_mask_b64()]},
            ],
        })
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "ok"
        assert (tmp_input_dir / "Annotations" / "00001_annotation.mha").exists()

    def test_save_with_no_object_contours_is_rejected(self, loaded_client, tmp_input_dir):
        """A save that draws nothing adds nothing: the target already comes from the image."""
        resp = loaded_client.post("/api/save", json={
            "labels": {},
            "frames": [
                {"frame_index": "00001", "masks": ["", "", ""]},
                {"frame_index": "00002", "masks": []},
            ],
        })
        assert resp.status_code == 400
        assert "object contours" in resp.get_json()["error"]
        assert not (tmp_input_dir / "Annotations").exists()

    def test_a_target_only_save_is_rejected(self, loaded_client):
        """Object 0 is dropped on write, so a mask there does not make the save non-empty."""
        resp = loaded_client.post("/api/save", json={
            "labels": {},
            "frames": [
                {"frame_index": "00001", "masks": [self._make_mask_b64()]},
            ],
        })
        assert resp.status_code == 400

    def test_a_rejected_save_leaves_an_earlier_save_intact(
        self, loaded_client, tmp_input_dir
    ):
        """The guard runs before clear_annotations, so a bad save cannot destroy a good one."""
        annotations_dir = tmp_input_dir / "Annotations"
        annotations_dir.mkdir()
        (annotations_dir / "00001_annotation.mha").write_bytes(b"earlier")

        resp = loaded_client.post("/api/save", json={
            "labels": {},
            "frames": [{"frame_index": "00001", "masks": ["", ""]}],
        })

        assert resp.status_code == 400
        assert (annotations_dir / "00001_annotation.mha").read_bytes() == b"earlier"

    def test_save_no_folder_loaded(self, client):
        resp = client.post("/api/save", json={
            "labels": {},
            "frames": [],
        })
        assert resp.status_code == 400

    def test_save_skips_unknown_frame(self, loaded_client, tmp_input_dir):
        resp = loaded_client.post("/api/save", json={
            "labels": {},
            "frames": [
                {"frame_index": "99999", "masks": ["", self._make_mask_b64()]},
            ],
        })
        assert resp.status_code == 200
        assert not (tmp_input_dir / "Annotations").exists()

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
            "frames": [
                {"frame_index": "00001", "masks": ["", self._make_mask_b64()]},
            ],
        })

        assert resp.status_code == 200
        assert resp.get_json()["replaced"] == ["00285_annotation.mha"]
        assert sorted(p.name for p in annotations_dir.glob("*.mha")) == [
            "00001_annotation.mha",
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
                {"frame_index": "00001", "masks": ["", self._make_mask_b64()]},
                {"frame_index": "00002", "masks": ["", self._make_mask_b64()]},
                {"frame_index": "00003", "masks": ["", ""]},
                {"frame_index": "00004", "masks": []},
                {"frame_index": "00005", "masks": ["", self._make_mask_b64()]},
                {"frame_index": "00006", "masks": ["", self._make_mask_b64()]},
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
            "frames": [
                {"frame_index": "00001", "masks": ["", self._make_mask_b64()]},
                {"frame_index": "00002", "masks": ["", self._make_mask_b64()]},
            ],
        })

        assert resp.status_code == 200
        assert resp.get_json()["replaced"] == []
        assert sorted(
            p.name for p in (tmp_input_dir / "Annotations").glob("*.mha")
        ) == ["00001_annotation.mha", "00002_annotation.mha"]
