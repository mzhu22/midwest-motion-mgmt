# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

import SimpleITK
import scipy

block_cipher = None

sitk_dir = Path(SimpleITK.__file__).parent
sitk_binaries = []
for f in sitk_dir.glob("_SimpleITK*"):
    sitk_binaries.append((str(f), "SimpleITK"))
for f in sitk_dir.glob("*.dll"):
    sitk_binaries.append((str(f), "SimpleITK"))

a = Analysis(
    ["run_app.py"],
    pathex=[],
    binaries=sitk_binaries,
    datas=[
        ("frontend/dist", "frontend/dist"),
    ],
    hiddenimports=[
        "SimpleITK",
        "scipy.ndimage",
        "scipy.ndimage._morphology",
        "PIL",
        "numpy",
        "flask",
        "flask_cors",
        "backend",
        "backend.app",
        "backend.routes",
        "backend.imaging",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="MidwestMotionMgmt",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="MidwestMotionMgmt",
)
