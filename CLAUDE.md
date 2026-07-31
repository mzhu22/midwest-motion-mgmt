# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A web-based annotation tool for MR-Linac medical images. Users load a folder of `.mha` image frames, paint object masks on sagittal/coronal frames using a brush tool, assign labels, and save annotations as `.mha` files. The broader project uses SAM2 for object tracking on MR-Linac images (run via Docker), and this web app is for manual annotation/correction of those results.

## Running the app

```bash
# Install backend deps (uses uv, Python >=3.10)
uv sync

# Install frontend deps
cd frontend && npm install && cd ..

# Start both servers (Flask on :5001, Vite on :5173, opens browser)
uv run launch.py
```

The Vite dev server proxies `/api` requests to the Flask backend (configured in `frontend/vite.config.ts`).

## Build

```bash
cd frontend && npx tsc -b && npx vite build
```

No linter or formatter is configured.

## Tests

Run tests when making changes to validate behavior.

```bash
# Run all tests (backend + frontend)
./run_tests.sh

# Backend only (pytest)
uv run pytest
uv run pytest tests/test_imaging.py::TestReadMhaAsPng::test_returns_valid_png  # single test

# Frontend only (vitest)
cd frontend && npx vitest run
cd frontend && npx vitest run src/components/FolderInput.test.tsx  # single file
```

Backend tests use synthetic MHA images built with SimpleITK in fixtures (`tests/conftest.py`). Frontend tests use vitest + React Testing Library with jsdom; Konva's `AnnotationCanvas` is mocked in component tests.

## Architecture

**Backend** (Python/Flask): `backend/app.py` creates the Flask app; `backend/routes.py` defines the `/api` blueprint with module-level `_state` dict holding loaded folder/frame data; `backend/imaging.py` handles MHA reading (via SimpleITK), PNG conversion, contour rendering, and annotation saving.

**Frontend** (React/TypeScript/Vite): Single-page app using Konva (react-konva) for canvas rendering. `App.tsx` is the root — manages frame data, annotation lines, labels, and brush state. Components: `FolderInput` (path input), `FrameViewer` (image + contour overlay + annotation canvas), `AnnotationCanvas` (brush drawing with Konva), `LabelPanel` (color/label/brush controls + save).

**Data flow**: User provides a local filesystem path → backend reads `.mha` files from that path → serves images as PNG via `/api/frame/<idx>/image` and contour overlays via `/api/frame/<idx>/target-contour` → frontend renders on Konva canvas → on save, frontend exports per-object mask PNGs (base64) → backend writes `.mha` annotation files to `<input_dir>/Annotations/`.

## Key conventions

- Images use the MHA format (MetaImage). The project convention: 0 = positive (object), 255 = negative (background) for contours/targets.
- Frame indices are 5-digit zero-padded prefixes (e.g., `00285`).
- Sagittal vs. coronal is read from each image's direction cosines, never from the frame index: `_read_plane` in `backend/imaging.py` takes the slice normal (`GetDirection()` column 2) and maps L/R → sagittal, A/P → coronal. Undeterminable frames raise `PlaneDetectionError`, which `/api/load-folder` returns as a 400. Parity would silently invert if a frame were ever dropped; in the reference dataset it happens to hold (odd → `ASL`/sagittal, even → `RSA`/coronal, across all 1,329 frames — the two index gaps at 60→145 and 146→285 each skip an even count), so the hazard is latent rather than currently triggered. Do not switch to parity on the strength of that.
- Plane comes from the image in `TwoDImages/`, not from its structure mask. The mask is still read, but only as a cross-check: `find_frames_with_targets` rejects any frame whose target geometry disagrees with its image, because at least one mask in the reference dataset carries the wrong stack's geometry (frame `00285`, which holds `00286`'s `TransformMatrix`, `AnatomicalOrientation` and `Offset` — the only such frame out of 1,267 pairs). A mask whose own plane is unreadable counts as a mismatch, not an error.
- `find_frames_with_targets` returns the first **adjacent** sagittal → coronal pair where both targets pass that check — `00287` + `00288` on the reference dataset. Three properties matter and all three are load-bearing: sagittal first keeps the left panel sagittal and the right coronal; sagittal-before-coronal makes plane order and index order agree so the panels can't read backwards; adjacency (no image of any plane between them, counting images that have no target) is what keeps the handoff to `mr-linac-iowa` correct — see below.
- Saving replaces the whole `Annotations/` directory: `clear_annotations` `rmtree`s it — masks, `labels.json`, and anything else — and `/api/save` calls it once up front, not per frame (`save_annotations` runs per frame, so clearing inside it would delete the first frame's output while writing the second). The directory is not recreated by the clear; `save_annotations` mkdirs it before writing, so a save that writes no frames leaves no directory. Downstream, `read_stacks` takes `start_frame = min(annotation index)` but starts each plane's stack at the first **image** of that plane at or after it, then seeds SAM2 from frame 0 of that stack. A leftover annotation from an earlier run — or a non-adjacent pair — therefore seeds a tracker with a mask drawn on the wrong frame, silently and with no error. That is why both the adjacency rule and the clear-on-save exist.
- The frontend uses a fixed display scale of 2x (defined as `DISPLAY_SCALE` in `AnnotationCanvas`).
- Up to 8 annotation objects per frame, each with a distinct color from the `COLORS` array in `types.ts`.
