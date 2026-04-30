from __future__ import annotations

import base64
import io
import json
from pathlib import Path

import numpy as np
import pytest
import SimpleITK as sitk
from PIL import Image

from backend import imaging


def _write_mha(path: Path, arr: np.ndarray, origin=(0.0, 0.0), spacing=(1.0, 1.0)):
    img = sitk.GetImageFromArray(arr)
    img.SetOrigin(origin)
    img.SetSpacing(spacing)
    sitk.WriteImage(img, str(path))


# --- find_frames_with_targets ---

class TestFindFramesWithTargets:
    def test_returns_matching_frames(self, tmp_input_dir):
        frames = imaging.find_frames_with_targets(str(tmp_input_dir))
        assert len(frames) == 2
        indices = [f["frame_index"] for f in frames]
        assert indices == ["00001", "00002"]

    def test_plane_assignment(self, tmp_input_dir):
        frames = imaging.find_frames_with_targets(str(tmp_input_dir))
        assert frames[0]["plane"] == "sagittal"  # odd
        assert frames[1]["plane"] == "coronal"  # even

    def test_frame_has_required_keys(self, tmp_input_dir):
        frames = imaging.find_frames_with_targets(str(tmp_input_dir))
        for f in frames:
            assert "frame_index" in f
            assert "plane" in f
            assert "image_file" in f
            assert "target_file" in f

    def test_returns_max_two_frames(self, tmp_input_dir):
        images_dir = tmp_input_dir / "TwoDImages"
        target_dir = images_dir / "TargetStructure"
        arr = np.zeros((8, 8), dtype=np.uint8)
        for prefix in ("00003", "00004", "00005"):
            _write_mha(images_dir / f"{prefix}_Frame.mha", arr)
            _write_mha(target_dir / f"{prefix}_Frame.mha", arr)

        frames = imaging.find_frames_with_targets(str(tmp_input_dir))
        assert len(frames) == 2

    def test_empty_directory(self, tmp_path):
        images_dir = tmp_path / "TwoDImages"
        target_dir = images_dir / "TargetStructure"
        images_dir.mkdir()
        target_dir.mkdir()

        frames = imaging.find_frames_with_targets(str(tmp_path))
        assert frames == []

    def test_no_overlap(self, tmp_path):
        images_dir = tmp_path / "TwoDImages"
        target_dir = images_dir / "TargetStructure"
        images_dir.mkdir()
        target_dir.mkdir()
        arr = np.zeros((8, 8), dtype=np.uint8)
        _write_mha(images_dir / "00001_Frame.mha", arr)
        _write_mha(target_dir / "00002_Frame.mha", arr)

        frames = imaging.find_frames_with_targets(str(tmp_path))
        assert frames == []


# --- read_mha_as_png ---

class TestReadMhaAsPng:
    def test_returns_valid_png(self, tmp_input_dir):
        images_dir = tmp_input_dir / "TwoDImages"
        mha_file = next(images_dir.glob("*.mha"))
        png_bytes = imaging.read_mha_as_png(str(mha_file))
        img = Image.open(io.BytesIO(png_bytes))
        assert img.format == "PNG"
        assert img.mode == "L"

    def test_output_dimensions_match(self, tmp_input_dir):
        images_dir = tmp_input_dir / "TwoDImages"
        mha_file = next(images_dir.glob("*.mha"))
        png_bytes = imaging.read_mha_as_png(str(mha_file))
        img = Image.open(io.BytesIO(png_bytes))
        assert img.size == (8, 8)

    def test_flat_image_returns_black(self, tmp_path):
        arr = np.full((4, 4), 100, dtype=np.uint8)
        path = tmp_path / "flat.mha"
        _write_mha(path, arr)
        png_bytes = imaging.read_mha_as_png(str(path))
        img = Image.open(io.BytesIO(png_bytes))
        assert np.array(img).max() == 0

    def test_contrast_normalization(self, tmp_path):
        arr = np.zeros((10, 10), dtype=np.float64)
        arr[0, 0] = 0
        arr[9, 9] = 1000
        arr[5, 5] = 500
        path = tmp_path / "gradient.mha"
        _write_mha(path, arr)
        png_bytes = imaging.read_mha_as_png(str(path))
        img = Image.open(io.BytesIO(png_bytes))
        px = np.array(img)
        assert px.min() == 0
        assert px.max() == 255


# --- read_target_contour_as_png ---

class TestReadTargetContourAsPng:
    def test_returns_rgba_png(self, tmp_input_dir):
        target_dir = tmp_input_dir / "TwoDImages" / "TargetStructure"
        mha_file = next(target_dir.glob("*.mha"))
        png_bytes = imaging.read_target_contour_as_png(str(mha_file))
        img = Image.open(io.BytesIO(png_bytes))
        assert img.mode == "RGBA"

    def test_boundary_is_green(self, tmp_input_dir):
        target_dir = tmp_input_dir / "TwoDImages" / "TargetStructure"
        mha_file = next(target_dir.glob("*.mha"))
        png_bytes = imaging.read_target_contour_as_png(str(mha_file))
        img = Image.open(io.BytesIO(png_bytes))
        arr = np.array(img)
        green_pixels = arr[arr[:, :, 3] > 0]
        assert len(green_pixels) > 0
        assert np.all(green_pixels[:, 1] == 255)  # green channel
        assert np.all(green_pixels[:, 0] == 0)  # red channel

    def test_empty_mask_returns_transparent(self, tmp_path):
        arr = np.full((8, 8), 255, dtype=np.uint8)
        path = tmp_path / "empty.mha"
        _write_mha(path, arr)
        png_bytes = imaging.read_target_contour_as_png(str(path))
        img = Image.open(io.BytesIO(png_bytes))
        assert np.array(img)[:, :, 3].max() == 0


# --- get_image_dimensions ---

class TestGetImageDimensions:
    def test_returns_width_height(self, tmp_path):
        arr = np.zeros((12, 16), dtype=np.uint8)
        path = tmp_path / "test.mha"
        _write_mha(path, arr)
        w, h = imaging.get_image_dimensions(str(path))
        assert w == 16
        assert h == 12

    def test_square_image(self, tmp_path):
        arr = np.zeros((5, 5), dtype=np.uint8)
        path = tmp_path / "square.mha"
        _write_mha(path, arr)
        w, h = imaging.get_image_dimensions(str(path))
        assert w == 5
        assert h == 5


# --- save_annotations ---

class TestSaveAnnotations:
    def _make_mask_b64(self, w, h, value=255):
        img = Image.new("L", (w, h), value)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()

    def test_creates_annotation_file(self, tmp_input_dir):
        imaging.save_annotations(
            str(tmp_input_dir), "00001", [self._make_mask_b64(8, 8)],
            {"0": "tumor"}, "00001_Frame.mha",
        )
        out = tmp_input_dir / "Annotations" / "00001_annotation.mha"
        assert out.exists()

    def test_creates_labels_json(self, tmp_input_dir):
        imaging.save_annotations(
            str(tmp_input_dir), "00001", [],
            {"0": "tumor", "1": "organ"}, "00001_Frame.mha",
        )
        labels_path = tmp_input_dir / "Annotations" / "labels.json"
        assert labels_path.exists()
        data = json.loads(labels_path.read_text())
        assert data == {"0": "tumor", "1": "organ"}

    def test_empty_labels_excluded(self, tmp_input_dir):
        imaging.save_annotations(
            str(tmp_input_dir), "00001", [],
            {"0": "tumor", "1": ""}, "00001_Frame.mha",
        )
        labels_path = tmp_input_dir / "Annotations" / "labels.json"
        data = json.loads(labels_path.read_text())
        assert "1" not in data

    def test_preserves_origin_and_spacing(self, tmp_input_dir):
        images_dir = tmp_input_dir / "TwoDImages"
        arr = np.zeros((8, 8), dtype=np.uint8)
        origin = (10.0, 20.0)
        spacing = (0.5, 0.75)
        _write_mha(images_dir / "00099_Frame.mha", arr, origin=origin, spacing=spacing)

        imaging.save_annotations(
            str(tmp_input_dir), "00099", [],
            {}, "00099_Frame.mha",
        )
        out = tmp_input_dir / "Annotations" / "00099_annotation.mha"
        result = sitk.ReadImage(str(out))
        assert tuple(result.GetOrigin()) == origin
        assert tuple(result.GetSpacing()) == spacing

    def test_mask_pixel_values(self, tmp_input_dir):
        mask_b64 = self._make_mask_b64(8, 8, value=255)
        imaging.save_annotations(
            str(tmp_input_dir), "00001", [mask_b64],
            {}, "00001_Frame.mha",
        )
        out = tmp_input_dir / "Annotations" / "00001_annotation.mha"
        result = sitk.ReadImage(str(out))
        arr = sitk.GetArrayFromImage(result)
        assert 0 in arr  # object index 0 written where mask was white
