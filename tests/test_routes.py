from __future__ import annotations

import base64
import io
from unittest.mock import MagicMock, patch

from PIL import Image


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
        assert "frames" in data
        assert len(data["frames"]) == 2
        for f in data["frames"]:
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
            "labels": {"0": "tumor"},
            "frames": [
                {"frame_index": "00001", "masks": [self._make_mask_b64()]},
            ],
        })
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "ok"
        assert (tmp_input_dir / "Annotations" / "00001_annotation.mha").exists()

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
                {"frame_index": "99999", "masks": []},
            ],
        })
        assert resp.status_code == 200
        assert not (tmp_input_dir / "Annotations").exists()
