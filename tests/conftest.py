from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import SimpleITK as sitk

from backend.app import create_app
from backend import routes


def _write_mha(path: Path, arr: np.ndarray, origin=(0.0, 0.0), spacing=(1.0, 1.0)):
    img = sitk.GetImageFromArray(arr)
    img.SetOrigin(origin)
    img.SetSpacing(spacing)
    sitk.WriteImage(img, str(path))


@pytest.fixture()
def tmp_input_dir(tmp_path):
    """Build a minimal MHA folder structure with two frames (one sagittal, one coronal)."""
    images_dir = tmp_path / "TwoDImages"
    target_dir = images_dir / "TargetStructure"
    reg_dir = images_dir / "RegistrationStructure"
    images_dir.mkdir()
    target_dir.mkdir()
    reg_dir.mkdir()

    rng = np.random.RandomState(42)

    for prefix in ("00001", "00002"):
        image_arr = rng.randint(0, 256, (8, 8), dtype=np.uint8)
        _write_mha(images_dir / f"{prefix}_Frame.mha", image_arr)

        mask_arr = np.full((8, 8), 255, dtype=np.uint8)
        mask_arr[2:6, 2:6] = 0
        _write_mha(target_dir / f"{prefix}_Frame.mha", mask_arr)
        _write_mha(reg_dir / f"{prefix}_Frame.mha", mask_arr)

    return tmp_path


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
