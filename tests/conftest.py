from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import SimpleITK as sitk

from backend.app import create_app
from backend import routes


# SimpleITK direction cosines matching the real MR-Linac cine frames. These are the
# transpose of the MHA header's TransformMatrix: GetDirection/SetDirection hold the
# i/j/k axis cosines as columns, so column 2 is the slice normal.
SAGITTAL_DIRECTION = (0.0, 0.0, -1.0, 1.0, 0.0, 0.0, 0.0, -1.0, 0.0)  # normal (-1,0,0) L/R
CORONAL_DIRECTION = (1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, -1.0, 0.0)  # normal (0,1,0) A/P
_R2 = 2**0.5 / 2
# Normal (-0.707, 0, 0.707): 45 degrees between the L/R and S/I axes, so no axis wins.
OBLIQUE_DIRECTION = (0.0, -_R2, -_R2, 1.0, 0.0, 0.0, 0.0, -_R2, _R2)


def _write_mha_3d(
    path: Path,
    arr: np.ndarray,
    direction=SAGITTAL_DIRECTION,
    origin=(0.0, 0.0, 0.0),
    spacing=(1.0, 1.0, 1.0),
):
    """Write a 2D slice as a 3D (1, H, W) MHA, the shape the real cine frames use.

    Plane detection needs a slice normal, which only a 3D image can express.
    """
    img = sitk.GetImageFromArray(arr[None, :, :])
    img.SetOrigin(origin)
    img.SetSpacing(spacing)
    img.SetDirection(direction)
    sitk.WriteImage(img, str(path))


def _write_mha_2d(path: Path, arr: np.ndarray, origin=(0.0, 0.0), spacing=(1.0, 1.0)):
    """Write a plain 2D MHA — has no slice normal, so plane detection must reject it."""
    img = sitk.GetImageFromArray(arr)
    img.SetOrigin(origin)
    img.SetSpacing(spacing)
    sitk.WriteImage(img, str(path))


def _make_frame_dir(tmp_path, planes: dict[str, tuple], target_planes: dict[str, tuple] | None = None):
    """Build a TwoDImages folder with one image+target per given prefix -> direction.

    target_planes overrides the direction written to a prefix's target mask, so a
    frame whose mask carries the wrong stack's geometry can be reproduced. Defaults
    to the image's direction, which is the healthy case.
    """
    images_dir = tmp_path / "TwoDImages"
    target_dir = images_dir / "TargetStructure"
    reg_dir = images_dir / "RegistrationStructure"
    images_dir.mkdir()
    target_dir.mkdir()
    reg_dir.mkdir()

    rng = np.random.RandomState(42)
    target_planes = target_planes or {}

    for prefix, direction in planes.items():
        image_arr = rng.randint(0, 256, (8, 8), dtype=np.uint8)
        _write_mha_3d(images_dir / f"{prefix}_Frame.mha", image_arr, direction=direction)

        mask_arr = np.full((8, 8), 255, dtype=np.uint8)
        mask_arr[2:6, 2:6] = 0
        mask_direction = target_planes.get(prefix, direction)
        _write_mha_3d(target_dir / f"{prefix}_Frame.mha", mask_arr, direction=mask_direction)
        _write_mha_3d(reg_dir / f"{prefix}_Frame.mha", mask_arr, direction=mask_direction)

    return tmp_path


@pytest.fixture()
def tmp_input_dir(tmp_path):
    """Build a minimal MHA folder structure with two frames (one sagittal, one coronal)."""
    return _make_frame_dir(
        tmp_path,
        {"00001": SAGITTAL_DIRECTION, "00002": CORONAL_DIRECTION},
    )


@pytest.fixture()
def client(tmp_path):
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c
    routes._state.clear()


@pytest.fixture()
def loaded_client(client, tmp_input_dir):
    """A test client with a folder already loaded."""
    resp = client.post("/api/load-folder", json={"folder_path": str(tmp_input_dir)})
    assert resp.status_code == 200
    return client
