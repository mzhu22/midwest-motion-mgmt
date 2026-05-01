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
- Frame indices are 5-digit zero-padded prefixes (e.g., `00285`). Odd = sagittal, even = coronal.
- The frontend uses a fixed display scale of 2x (defined as `DISPLAY_SCALE` in `AnnotationCanvas`).
- Up to 8 annotation objects per frame, each with a distinct color from the `COLORS` array in `types.ts`.
