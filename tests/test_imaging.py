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
from tests.conftest import (
    CORONAL_DIRECTION,
    OBLIQUE_DIRECTION,
    SAGITTAL_DIRECTION,
    _make_frame_dir,
    _write_mha_2d,
    _write_mha_3d,
)


def _write_mha(path: Path, arr: np.ndarray, origin=(0.0, 0.0), spacing=(1.0, 1.0)):
    img = sitk.GetImageFromArray(arr)
    img.SetOrigin(origin)
    img.SetSpacing(spacing)
    sitk.WriteImage(img, str(path))


# --- _read_plane ---

class TestReadPlane:
    def test_sagittal_from_direction(self, tmp_path):
        path = tmp_path / "sag.mha"
        _write_mha_3d(path, np.zeros((8, 8), dtype=np.uint8), direction=SAGITTAL_DIRECTION)
        assert imaging._read_plane(str(path)) == "sagittal"

    def test_coronal_from_direction(self, tmp_path):
        path = tmp_path / "cor.mha"
        _write_mha_3d(path, np.zeros((8, 8), dtype=np.uint8), direction=CORONAL_DIRECTION)
        assert imaging._read_plane(str(path)) == "coronal"

    def test_2d_image_rejected(self, tmp_path):
        path = tmp_path / "flat2d.mha"
        _write_mha_2d(path, np.zeros((8, 8), dtype=np.uint8))
        with pytest.raises(imaging.PlaneDetectionError) as exc:
            imaging._read_plane(str(path))
        assert "flat2d.mha" in str(exc.value)
        assert "2D" in str(exc.value)

    def test_oblique_rejected(self, tmp_path):
        path = tmp_path / "oblique.mha"
        _write_mha_3d(path, np.zeros((8, 8), dtype=np.uint8), direction=OBLIQUE_DIRECTION)
        with pytest.raises(imaging.PlaneDetectionError) as exc:
            imaging._read_plane(str(path))
        assert "oblique.mha" in str(exc.value)
        assert "oblique" in str(exc.value)

    def test_unreadable_file_rejected(self, tmp_path):
        path = tmp_path / "garbage.mha"
        path.write_text("not an mha")
        with pytest.raises(imaging.PlaneDetectionError) as exc:
            imaging._read_plane(str(path))
        assert "garbage.mha" in str(exc.value)


# --- list_series ---

class TestListSeries:
    def test_returns_sorted_frame_indices(self, tmp_path):
        _make_frame_dir(
            tmp_path,
            {"00010": SAGITTAL_DIRECTION, "00003": CORONAL_DIRECTION, "00001": SAGITTAL_DIRECTION},
        )
        ordered, image_map, target_map = imaging.list_series(str(tmp_path))
        assert ordered == ["00001", "00003", "00010"]
        assert set(image_map) == {"00001", "00003", "00010"}
        assert set(target_map) == {"00001", "00003", "00010"}

    def test_does_not_read_any_mha_headers(self, tmp_path, monkeypatch):
        _make_frame_dir(tmp_path, {"00001": SAGITTAL_DIRECTION, "00002": CORONAL_DIRECTION})
        calls = []
        monkeypatch.setattr(imaging, "_read_plane", lambda path: calls.append(path) or "sagittal")
        imaging.list_series(str(tmp_path))
        assert calls == []


# --- first_pair_position ---

class TestFirstPairPosition:
    def test_finds_the_first_pair(self, tmp_input_dir):
        ordered, image_map, target_map = imaging.list_series(str(tmp_input_dir))
        assert imaging.first_pair_position(str(tmp_input_dir), ordered, image_map, target_map) == 0

    def test_skips_a_geometry_mismatched_frame(self, tmp_path):
        """Reproduces frame 00285 in the reference dataset: its target carries the
        wrong stack's geometry, so the true first pair is 00287/00288, not 00285."""
        _make_frame_dir(
            tmp_path,
            {
                "00285": SAGITTAL_DIRECTION,
                "00286": CORONAL_DIRECTION,
                "00287": SAGITTAL_DIRECTION,
                "00288": CORONAL_DIRECTION,
            },
            target_planes={"00285": CORONAL_DIRECTION},
        )
        ordered, image_map, target_map = imaging.list_series(str(tmp_path))
        position = imaging.first_pair_position(str(tmp_path), ordered, image_map, target_map)
        assert ordered[position] == "00287"

    def test_returns_none_when_no_pair_exists(self, tmp_path):
        _make_frame_dir(
            tmp_path,
            {"00001": SAGITTAL_DIRECTION, "00003": SAGITTAL_DIRECTION},
        )
        ordered, image_map, target_map = imaging.list_series(str(tmp_path))
        assert imaging.first_pair_position(str(tmp_path), ordered, image_map, target_map) is None

    def test_unreadable_single_frame_still_raises(self, tmp_path):
        """With fewer than two frames the forward scan never runs at all, so the
        lone frame's plane must still be read some other way for a bad image to
        surface as its own error instead of silently returning None."""
        images_dir = tmp_path / "TwoDImages"
        target_dir = images_dir / "TargetStructure"
        images_dir.mkdir()
        target_dir.mkdir()
        arr = np.zeros((8, 8), dtype=np.uint8)
        _write_mha_2d(images_dir / "00001_Frame.mha", arr)
        _write_mha_2d(target_dir / "00001_Frame.mha", arr)

        ordered, image_map, target_map = imaging.list_series(str(tmp_path))
        with pytest.raises(imaging.PlaneDetectionError, match="imaging plane"):
            imaging.first_pair_position(str(tmp_path), ordered, image_map, target_map)


# --- default_positions ---

class TestDefaultPositions:
    def test_count_one_returns_first_position(self):
        assert imaging.default_positions(list(range(5)), 1) == [0]

    def test_count_equal_to_n_returns_all_positions(self):
        assert imaging.default_positions(list(range(4)), 4) == [0, 1, 2, 3]

    def test_count_greater_than_n_is_clamped(self):
        assert imaging.default_positions(list(range(3)), 99) == [0, 1, 2]

    def test_includes_first_and_last(self):
        positions = imaging.default_positions(list(range(20)), 5)
        assert positions[0] == 0
        assert positions[-1] == 19

    def test_distinct_positions_across_many_count_to_n_ratios(self):
        for n in range(2, 40):
            for count in range(2, n + 1):
                positions = imaging.default_positions(list(range(n)), count)
                assert len(positions) == count
                assert len(set(positions)) == count

    def test_spaces_over_an_arbitrary_subset_not_just_a_dense_range(self):
        """The pool doesn't have to be range(n) — a caller can restrict it (e.g. to
        positions with a target file) so the spread avoids a region with none."""
        eligible = [62, 100, 200, 400, 800, 1328]
        positions = imaging.default_positions(eligible, 3)
        assert positions[0] == 62
        assert positions[-1] == 1328
        assert all(p in eligible for p in positions)


# --- position_near ---

class TestPositionNear:
    def test_exact_match(self):
        assert imaging.position_near(["00001", "00005", "00009"], "00005") == 1

    def test_value_in_a_gap_snaps_to_nearest(self):
        assert imaging.position_near(["00001", "00005", "00009"], "00008") == 2

    def test_value_past_the_end_snaps_to_last(self):
        assert imaging.position_near(["00001", "00005", "00009"], "00050") == 2

    def test_value_before_the_start_snaps_to_first(self):
        assert imaging.position_near(["00001", "00005", "00009"], "00000") == 0


# --- find_pair_near ---

class TestFindPairNear:
    def test_finds_pair_at_its_own_position(self, tmp_input_dir):
        ordered, image_map, target_map = imaging.list_series(str(tmp_input_dir))
        pair = imaging.find_pair_near(str(tmp_input_dir), ordered, image_map, target_map, 0)
        assert [f["frame_index"] for f in pair] == ["00001", "00002"]

    def test_frame_has_required_keys(self, tmp_input_dir):
        ordered, image_map, target_map = imaging.list_series(str(tmp_input_dir))
        pair = imaging.find_pair_near(str(tmp_input_dir), ordered, image_map, target_map, 0)
        for f in pair:
            assert "frame_index" in f
            assert "plane" in f
            assert "image_file" in f
            assert "target_file" in f

    def test_only_reads_headers_within_the_window(self, tmp_path, monkeypatch):
        """A pair far outside the window must not be found, and frames outside the
        window must never have their headers read — this is the actual performance
        contract: loading a milestone must not touch the rest of the series."""
        planes = {
            f"{i:05d}": SAGITTAL_DIRECTION if i % 2 == 1 else CORONAL_DIRECTION
            for i in range(1, 41)
        }
        _make_frame_dir(tmp_path, planes)
        ordered, image_map, target_map = imaging.list_series(str(tmp_path))

        read_paths = []
        original_read_plane = imaging._read_plane

        def tracking_read_plane(path):
            read_paths.append(Path(path).name)
            return original_read_plane(path)

        monkeypatch.setattr(imaging, "_read_plane", tracking_read_plane)

        position = 20  # ordered[20] == "00021"
        pair = imaging.find_pair_near(
            str(tmp_path), ordered, image_map, target_map, position, window=5
        )
        assert [f["frame_index"] for f in pair] == ["00021", "00022"]

        touched = {name[:5] for name in read_paths}
        assert "00001" not in touched
        assert "00040" not in touched
        assert len(touched) <= 2 * 5 + 1

    def test_picks_the_candidate_closest_to_position(self, tmp_path):
        planes = {
            f"{i:05d}": SAGITTAL_DIRECTION if i % 2 == 1 else CORONAL_DIRECTION
            for i in range(1, 12)
        }
        _make_frame_dir(tmp_path, planes)
        ordered, image_map, target_map = imaging.list_series(str(tmp_path))

        # Position 4 (frame 00005) has candidate pairs at (00001,00002), (00003,00004),
        # (00005,00006), (00007,00008), (00009,00010) within the window; the closest
        # to position 4 is (00005, 00006).
        pair = imaging.find_pair_near(str(tmp_path), ordered, image_map, target_map, 4, window=5)
        assert [f["frame_index"] for f in pair] == ["00005", "00006"]

    def test_geometry_mismatch_is_skipped_within_window(self, tmp_path):
        _make_frame_dir(
            tmp_path,
            {
                "00001": SAGITTAL_DIRECTION,
                "00002": CORONAL_DIRECTION,
                "00003": SAGITTAL_DIRECTION,
                "00004": CORONAL_DIRECTION,
            },
            target_planes={"00001": CORONAL_DIRECTION},
        )
        ordered, image_map, target_map = imaging.list_series(str(tmp_path))
        pair = imaging.find_pair_near(str(tmp_path), ordered, image_map, target_map, 0, window=5)
        assert [f["frame_index"] for f in pair] == ["00003", "00004"]

    def test_no_pair_in_window_raises_with_window_size_in_message(self, tmp_path):
        _make_frame_dir(
            tmp_path,
            {"00010": CORONAL_DIRECTION, "00011": SAGITTAL_DIRECTION},
        )
        ordered, image_map, target_map = imaging.list_series(str(tmp_path))
        with pytest.raises(
            imaging.PlaneDetectionError, match="No such pair was found within 5 frames"
        ):
            imaging.find_pair_near(str(tmp_path), ordered, image_map, target_map, 0, window=5)

    def test_unreadable_image_plane_still_raises(self, tmp_path):
        """The skip path must not swallow an image-side plane failure."""
        _make_frame_dir(
            tmp_path,
            {"00001": OBLIQUE_DIRECTION, "00002": CORONAL_DIRECTION},
        )
        ordered, image_map, target_map = imaging.list_series(str(tmp_path))
        with pytest.raises(imaging.PlaneDetectionError, match="oblique"):
            imaging.find_pair_near(str(tmp_path), ordered, image_map, target_map, 0, window=5)

    def test_error_names_the_frames_skipped_for_bad_geometry(self, tmp_path):
        _make_frame_dir(
            tmp_path,
            {"00001": SAGITTAL_DIRECTION, "00002": CORONAL_DIRECTION},
            target_planes={
                "00001": CORONAL_DIRECTION,
                "00002": SAGITTAL_DIRECTION,
            },
        )
        ordered, image_map, target_map = imaging.list_series(str(tmp_path))
        with pytest.raises(imaging.PlaneDetectionError) as exc:
            imaging.find_pair_near(str(tmp_path), ordered, image_map, target_map, 0, window=5)
        assert "1 frame(s) were skipped" in str(exc.value)
        assert "00001" in str(exc.value)

    def test_non_adjacent_pair_is_rejected(self, tmp_path):
        """An intervening coronal image would be the real start of the coronal stack,
        so pairing across a bad frame in between must be rejected."""
        _make_frame_dir(
            tmp_path,
            {
                "00287": SAGITTAL_DIRECTION,
                "00288": CORONAL_DIRECTION,
                "00289": SAGITTAL_DIRECTION,
                "00290": CORONAL_DIRECTION,
            },
            target_planes={"00288": SAGITTAL_DIRECTION},
        )
        ordered, image_map, target_map = imaging.list_series(str(tmp_path))
        pair = imaging.find_pair_near(str(tmp_path), ordered, image_map, target_map, 0, window=5)
        assert [f["frame_index"] for f in pair] == ["00289", "00290"]

    def test_geometry_wins_over_index_parity(self, tmp_path):
        """An even index carrying sagittal cosines must be reported as sagittal."""
        _make_frame_dir(
            tmp_path,
            {"00002": SAGITTAL_DIRECTION, "00003": CORONAL_DIRECTION},
        )
        ordered, image_map, target_map = imaging.list_series(str(tmp_path))
        pair = imaging.find_pair_near(str(tmp_path), ordered, image_map, target_map, 0, window=5)
        by_index = {f["frame_index"]: f["plane"] for f in pair}
        assert by_index == {"00002": "sagittal", "00003": "coronal"}


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

    def test_boundary_is_hot_pink(self, tmp_input_dir):
        target_dir = tmp_input_dir / "TwoDImages" / "TargetStructure"
        mha_file = next(target_dir.glob("*.mha"))
        png_bytes = imaging.read_target_contour_as_png(str(mha_file))
        img = Image.open(io.BytesIO(png_bytes))
        arr = np.array(img)
        boundary_pixels = arr[arr[:, :, 3] > 0]
        assert len(boundary_pixels) > 0
        assert np.all(boundary_pixels[:, 0] == 255)   # red
        assert np.all(boundary_pixels[:, 1] == 20)    # green
        assert np.all(boundary_pixels[:, 2] == 147)   # blue

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

_NO_OBJECTS = np.zeros((8, 8), dtype=np.uint8)


class TestClearAnnotations:
    def test_removes_the_directory_and_reports_what_was_in_it(self, tmp_input_dir):
        imaging.save_annotations(
            str(tmp_input_dir), "00001", _NO_OBJECTS, {"0": "tumor"}, "00001_Frame.mha",
        )
        imaging.save_annotations(
            str(tmp_input_dir), "00002", _NO_OBJECTS, {"0": "tumor"}, "00002_Frame.mha",
        )

        removed = imaging.clear_annotations(str(tmp_input_dir))

        assert removed == [
            "00001_annotation.mha",
            "00002_annotation.mha",
            "labels.json",
        ]
        assert not (tmp_input_dir / "Annotations").exists()

    def test_removes_unrelated_files_too(self, tmp_input_dir):
        """The clear is wholesale, so anything an earlier run or the OS left goes."""
        annotations_dir = tmp_input_dir / "Annotations"
        annotations_dir.mkdir()
        (annotations_dir / ".DS_Store").write_bytes(b"junk")
        (annotations_dir / "notes.txt").write_text("scratch")

        removed = imaging.clear_annotations(str(tmp_input_dir))

        assert removed == [".DS_Store", "notes.txt"]
        assert not annotations_dir.exists()

    def test_missing_directory_is_not_an_error(self, tmp_input_dir):
        assert imaging.clear_annotations(str(tmp_input_dir)) == []

    def test_a_save_after_clearing_leaves_only_the_new_pair(self, tmp_input_dir):
        """The reference case: a stale 00285/00286 pair must not survive into a
        00287/00288 save, or downstream seeds each stack from the wrong frame."""
        for idx in ("00285", "00286"):
            imaging.save_annotations(
                str(tmp_input_dir), idx, _NO_OBJECTS, {"0": "tumor"}, "00001_Frame.mha",
            )

        imaging.clear_annotations(str(tmp_input_dir))
        for idx in ("00287", "00288"):
            imaging.save_annotations(
                str(tmp_input_dir), idx, _NO_OBJECTS, {"0": "tumor"}, "00001_Frame.mha",
            )

        annotations_dir = tmp_input_dir / "Annotations"
        names = sorted(p.name for p in annotations_dir.glob("*_annotation.mha"))
        assert names == ["00287_annotation.mha", "00288_annotation.mha"]


class TestSaveAnnotations:
    def test_creates_annotation_file(self, tmp_input_dir):
        imaging.save_annotations(
            str(tmp_input_dir), "00001", _square_outline(),
            {"0": "tumor"}, "00001_Frame.mha",
        )
        out = tmp_input_dir / "Annotations" / "00001_annotation.mha"
        assert out.exists()

    def test_creates_labels_json(self, tmp_input_dir):
        imaging.save_annotations(
            str(tmp_input_dir), "00001", _NO_OBJECTS,
            {"0": "tumor", "1": "organ"}, "00001_Frame.mha",
        )
        labels_path = tmp_input_dir / "Annotations" / "labels.json"
        assert labels_path.exists()
        data = json.loads(labels_path.read_text())
        assert data == {"0": "tumor", "1": "organ"}

    def test_empty_labels_excluded(self, tmp_input_dir):
        imaging.save_annotations(
            str(tmp_input_dir), "00001", _NO_OBJECTS,
            {"0": "tumor", "1": ""}, "00001_Frame.mha",
        )
        labels_path = tmp_input_dir / "Annotations" / "labels.json"
        data = json.loads(labels_path.read_text())
        assert "1" not in data

    def test_preserves_origin_and_spacing(self, tmp_input_dir):
        images_dir = tmp_input_dir / "TwoDImages"
        arr = np.zeros((8, 8), dtype=np.uint8)
        origin = (10.0, 20.0, 30.0)
        spacing = (0.5, 0.75, 5.0)
        _write_mha_3d(
            images_dir / "00099_Frame.mha", arr,
            direction=SAGITTAL_DIRECTION, origin=origin, spacing=spacing,
        )

        imaging.save_annotations(
            str(tmp_input_dir), "00099", _NO_OBJECTS,
            {}, "00099_Frame.mha",
        )
        out = tmp_input_dir / "Annotations" / "00099_annotation.mha"
        result = sitk.ReadImage(str(out))
        assert tuple(result.GetOrigin()) == origin
        assert tuple(result.GetSpacing()) == spacing

    def test_preserves_direction_cosines(self, tmp_input_dir):
        """Without the slice normal the saved annotation's plane is unrecoverable."""
        imaging.save_annotations(
            str(tmp_input_dir), "00002", _NO_OBJECTS,
            {}, "00002_Frame.mha",
        )
        out = tmp_input_dir / "Annotations" / "00002_annotation.mha"
        result = sitk.ReadImage(str(out))
        assert result.GetDimension() == 3
        assert tuple(result.GetDirection()) == CORONAL_DIRECTION
        # The saved file must round-trip back to the plane it was annotated on.
        assert imaging._read_plane(str(out)) == "coronal"

    def test_object_pixels_are_written_with_their_id_and_the_rest_is_background(
        self, tmp_input_dir
    ):
        ids = np.zeros((8, 8), dtype=np.uint8)
        ids[2, 3] = 1
        ids[5, 5] = 4
        imaging.save_annotations(str(tmp_input_dir), "00001", ids, {}, "00001_Frame.mha")
        arr = sitk.GetArrayFromImage(
            sitk.ReadImage(str(tmp_input_dir / "Annotations" / "00001_annotation.mha"))
        ).squeeze()
        assert arr[2, 3] == 1 and arr[5, 5] == 4
        assert (arr == 255).sum() == 62

    def test_nothing_is_written_at_the_target_index(self, tmp_input_dir):
        """Id 0 means "no object" and is the target's id: mr-linac-iowa reads the target
        from TargetStructure/, so a copy here would only shadow the real contour."""
        imaging.save_annotations(
            str(tmp_input_dir), "00001", _NO_OBJECTS, {}, "00001_Frame.mha"
        )
        arr = sitk.GetArrayFromImage(
            sitk.ReadImage(str(tmp_input_dir / "Annotations" / "00001_annotation.mha"))
        )
        assert 0 not in arr

    def test_rejects_a_label_image_of_the_wrong_size(self, tmp_input_dir):
        with pytest.raises(ValueError, match="4x4"):
            imaging.save_annotations(
                str(tmp_input_dir), "00001", np.zeros((4, 4), np.uint8), {}, "00001_Frame.mha"
            )


def _encode(ids: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(ids, dtype=np.uint8).tobytes()).decode()


def _square_outline(size=8, lo=1, hi=6, obj=1):
    ids = np.zeros((size, size), dtype=np.uint8)
    ids[lo, lo : hi + 1] = obj
    ids[hi, lo : hi + 1] = obj
    ids[lo : hi + 1, lo] = obj
    ids[lo : hi + 1, hi] = obj
    return ids


class TestDecodeObjectIds:
    def test_round_trips_a_label_image(self):
        ids = _square_outline()
        assert (imaging.decode_object_ids(_encode(ids), 8, 8) == ids).all()

    def test_wrong_length_is_rejected(self):
        with pytest.raises(ValueError, match="64"):
            imaging.decode_object_ids(_encode(np.zeros((4, 4))), 8, 8)

    def test_not_base64_is_rejected(self):
        with pytest.raises(ValueError, match="base64"):
            imaging.decode_object_ids("!!not base64!!", 8, 8)

    def test_an_id_above_the_drawable_range_is_rejected(self):
        ids = np.zeros((8, 8), np.uint8)
        ids[0, 0] = 8
        with pytest.raises(ValueError, match="above 7"):
            imaging.decode_object_ids(_encode(ids), 8, 8)


class TestFindUnclosedObjects:
    """The check mr-linac-iowa's `binary_fill_holes(arr == obj_id)` makes implicit."""

    def test_a_closed_outline_is_closed(self):
        assert imaging.find_unclosed_objects(_square_outline()) == []

    def test_an_outline_with_a_gap_is_unclosed(self):
        ids = _square_outline()
        ids[1, 3] = 0
        assert imaging.find_unclosed_objects(ids) == [1]

    def test_a_diagonal_join_still_closes(self):
        """8-connected outlines are fine: the fill floods the background 4-connected."""
        ids = np.zeros((7, 7), np.uint8)
        for r, c in [(1, 2), (2, 1), (3, 2), (2, 3)]:
            ids[r, c] = 2
        assert imaging.find_unclosed_objects(ids) == []

    def test_a_line_encloses_nothing(self):
        ids = np.zeros((8, 8), np.uint8)
        ids[4, 1:7] = 1
        assert imaging.find_unclosed_objects(ids) == [1]

    def test_another_objects_outline_cutting_through_opens_it(self):
        ids = _square_outline(obj=1)
        ids[1, 3] = 2  # object 2 overwrote a pixel of object 1's outline
        assert 1 in imaging.find_unclosed_objects(ids)

    def test_a_cut_up_outline_is_unclosed_even_if_one_piece_still_encloses_a_pocket(self):
        """The fill alone would accept this: the small loop encloses area. But the object
        is a loop plus a detached fragment, i.e. an outline something has cut through."""
        ids = np.zeros((12, 12), np.uint8)
        ids[1, 1:4] = 1
        ids[3, 1:4] = 1
        ids[2, 1] = 1
        ids[2, 3] = 1  # a closed 3x3 loop
        ids[8, 2:9] = 1  # a separate fragment of the same object
        assert imaging.find_unclosed_objects(ids) == [1]

    def test_each_object_is_judged_separately(self):
        ids = _square_outline(obj=1)
        ids[3, 3] = 2  # a lone pixel of another object inside
        assert imaging.find_unclosed_objects(ids) == [2]
