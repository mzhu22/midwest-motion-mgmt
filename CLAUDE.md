# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A web-based annotation tool for MR-Linac medical images. Users load a folder of `.mha` image frames, draw an outline around each object on sagittal/coronal frames, assign labels, and save annotations as `.mha` files. The broader project uses SAM2 for object tracking on MR-Linac images (run via Docker), and this web app is for manual annotation/correction of those results.

The target itself is **not** annotated here. It is drawn on screen in pink from the frame's own `TargetStructure` mask, purely as reference, and `mr-linac-iowa` reads that same mask to seed tracking. The tool exists to add the *other* objects the tracker should follow.

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

Backend tests use synthetic MHA images built with SimpleITK in fixtures (`tests/conftest.py`). Frontend tests use vitest + React Testing Library with jsdom; Konva cannot run in jsdom, so `AnnotationCanvas` is mocked in the `App` and `FrameViewer` tests, and tested on its own with `react-konva` swapped for plain elements that forward the same events.

## Architecture

**Backend** (Python/Flask): `backend/app.py` creates the Flask app; `backend/routes.py` defines the `/api` blueprint with module-level `_state` dict holding loaded folder/frame data; `backend/imaging.py` handles MHA reading (via SimpleITK), PNG conversion, contour rendering, and annotation saving.

**Frontend** (React/TypeScript/Vite): Single-page app using Konva (react-konva) for canvas rendering. `App.tsx` is the root — manages frame data, each frame's contours (with per-frame Undo history), and labels. Components: `FolderInput` (path input), `FrameViewer` (image + contour overlay + annotation canvas + Undo/Clear + closure warnings), `AnnotationCanvas` (draws the stroke being dragged and the exact saved pixels), `LabelPanel` (color/label controls + save). The drawing model lives in plain modules: `contour.ts` (rasterizer and stroke commit), `closure.ts` (the closure check), `loadAnnotations.ts`, `idsCodec.ts`.

**Data flow**: User provides a local filesystem path → backend reads `.mha` files from that path → serves images as PNG via `/api/frame/<idx>/image` and contour overlays via `/api/frame/<idx>/target-contour` → frontend renders on a Konva canvas → on save, frontend rasterizes each frame's contours to a label image (one byte per pixel, base64) → backend checks it and writes `.mha` annotation files to `<input_dir>/Annotations/`.

## Key conventions

- Images use the MHA format (MetaImage). The project convention: 0 = positive (object), 255 = negative (background) for contours/targets.
- Frame indices are 5-digit zero-padded prefixes (e.g., `00285`).
- Sagittal vs. coronal is read from each image's direction cosines, never from the frame index: `_read_plane` in `backend/imaging.py` takes the slice normal (`GetDirection()` column 2) and maps L/R → sagittal, A/P → coronal. Undeterminable frames raise `PlaneDetectionError`, which `/api/load-folder` returns as a 400. Parity would silently invert if a frame were ever dropped; in the reference dataset it happens to hold (odd → `ASL`/sagittal, even → `RSA`/coronal, across all 1,329 frames — the two index gaps at 60→145 and 146→285 each skip an even count), so the hazard is latent rather than currently triggered. Do not switch to parity on the strength of that.
- Plane comes from the image in `TwoDImages/`, not from its structure mask. The mask is still read, but only as a cross-check: `find_frames_with_targets` rejects any frame whose target geometry disagrees with its image, because at least one mask in the reference dataset carries the wrong stack's geometry (frame `00285`, which holds `00286`'s `TransformMatrix`, `AnatomicalOrientation` and `Offset` — the only such frame out of 1,267 pairs). A mask whose own plane is unreadable counts as a mismatch, not an error.
- `find_frames_with_targets` returns the first **adjacent** sagittal → coronal pair where both targets pass that check — `00287` + `00288` on the reference dataset. Three properties matter and all three are load-bearing: sagittal first keeps the left panel sagittal and the right coronal; sagittal-before-coronal makes plane order and index order agree so the panels can't read backwards; adjacency (no image of any plane between them, counting images that have no target) is what keeps the handoff to `mr-linac-iowa` correct — see below.
- Saving replaces the whole `Annotations/` directory: `clear_annotations` `rmtree`s it — masks, `labels.json`, and anything else — and `/api/save` calls it once up front, not per frame (`save_annotations` runs per frame, so clearing inside it would delete the first frame's output while writing the second). The directory is not recreated by the clear; `save_annotations` mkdirs it before writing, so a save that writes no frames leaves no directory. Downstream, `read_stacks` takes `start_frame = min(annotation index)` but starts each plane's stack at the first **image** of that plane at or after it, then seeds SAM2 from frame 0 of that stack. A leftover annotation from an earlier run — or a non-adjacent pair — therefore lands on a frame the tracker is not seeding, which is why both the adjacency rule and the clear-on-save exist. `read_stacks` now raises rather than mis-seeding when that happens, but the error still tells you the pair was wrong, not that anything recovered from it.
- `Annotations/` is optional to `mr-linac-iowa`. With no annotations it applies the same first-adjacent-sagittal→coronal rule (`find_seed_frames` in `src/file_input.py`, a port of `find_frames_with_targets`) and tracks the target alone. Keep the two implementations in step; a divergence would put the two repos on different seed frames.
- The frontend uses a fixed display scale of 2x (defined as `DISPLAY_SCALE` in `AnnotationCanvas`).
- Object id 0 is reserved for the target in both this repo and `mr-linac-iowa` (`TARGET_OBJECT_ID` in `backend/imaging.py`, `TARGET_OBJECT_INDEX` in `types.ts`). It is never drawable and never written: `LabelPanel` shows it as a legend row rather than a selectable object, and in a label image id 0 means "no object", so `save_annotations` can never write it. That leaves up to 7 drawn objects per frame, ids 1-7, each with a distinct color from the `COLORS` array in `types.ts`.
- A save must carry at least one drawn object. The check is enforced twice — in `App.handleSave` and again in `/api/save`, which runs it *before* `clear_annotations` so a save with nothing in it cannot destroy an earlier good one. An object drawn on only one of the two frames is allowed; it is simply tracked in that plane alone.
- Both frames' annotation files are written even when one has no drawn objects, because the pair is what tells `read_stacks` which frames to seed on. `labels.json` no longer carries a `"0"` entry; `mr-linac-iowa` supplies the target's label itself.
- **One closed polygon per object per frame (`Contour` in `types.ts`).** The first stroke for an object becomes its outline, closed automatically back to its start. A later stroke for that object must start and end within `SNAP_DISTANCE` of the outline, and replaces the stretch of outline it runs alongside (the arc closer to the stroke, not merely the shorter one); anything else is refused with a message. There is deliberately no eraser and no way to add a second stroke: the old model (many brush strokes, then an erase) could leave a gap that nothing noticed, and "closed by construction" is what replaces it. `commitStroke` (`contour.ts`) also refuses any result that would not enclose an area once rasterized. Undo is per frame (`App`, `UNDO_DEPTH`); `✕ Clear` removes the active object from a frame and is itself undoable.
- **The rasterizer is ours, not the canvas's.** `rasterizeContours` draws each polygon with integer Bresenham lines through the pixel each vertex falls in: 1 px, 8-connected, no anti-aliasing, no opacity, no alpha cutoff. The on-screen preview, the closure check and the bytes sent on save are all that one label image, so what you see is what is written. The earlier canvas path (strokes at `opacity={0.6}`, thresholded at alpha > 128, i.e. about 84% pixel coverage) could not support a 1 px line at all: measured with real Konva, a 1 px brush kept 0/60 closed outlines closed, against 60/60 for 2 px. Do not go back to rasterizing through Konva.
- **"Closed" is judged on the written pixels, by the test the tracker applies.** `mr-linac-iowa` reads each object as `binary_fill_holes(arr == obj_id)` (background flooded 4-connected from the border), so an outline with a gap yields a thin line instead of a region, with no error. `closure.ts` (frontend, live warning plus save gate) and `imaging.find_unclosed_objects` (backend, `/api/save`, before `clear_annotations`) both require an outline to enclose an area *and* be one 8-connected piece; the second rule catches an outline cut into fragments by another object's outline, where one fragment can still enclose a pocket and pass the fill. The two implementations must agree; they matched on 150/150 randomized frames. Where two objects' outlines cross, the higher id overwrites the other's pixels (one id per pixel in the file), so crossing outlines are flagged rather than saved; touching organs need at least a pixel between them.
- **Save payload:** `/api/save` takes per frame `{frame_index, object_ids}` (base64, one byte per pixel, 0 = none, 1-7 = object) and rejects anything of the wrong length, ids above 7, unknown frames, or an unclosed outline, all before clearing. The old per-object PNG `masks` field is gone.
- **Saved annotations can be loaded back for editing** (`/api/load-annotations`, `backend/contours.py`). `/api/load-folder` reports `has_annotations`; the UI then loads them automatically right after the folder loads (so the next save, which replaces `Annotations/`, never silently discards them) and shows a banner saying so; if loading fails it shows the error, keeps the folder's default frames and the banner warns that saving will replace the annotations. Loading switches the milestones to the saved frames, and refuses (400) any `Annotations/` whose frames are not exactly a set of valid adjacent sagittal/coronal pairs. Each object comes back as one closed polygon by walking its pixels (`_tour`, depth first, exploring the smaller dead-end side of a fork first) and putting a vertex at every pixel centre, so a mask this tool wrote reloads to exactly the same pixels, as do old-format masks (alpha > 128 left them mostly 1 px wide too). Only a genuinely thick mask (2x2 blocks over `_THIN_BLOCK_FRACTION` of its pixels) is skeletonized instead, which is approximate. A second separate part is dropped, and an outline with a gap is left as saved and flagged, never silently repaired; both come back as `notes` and are shown to the user. After loading, `App` re-rasterizes the contours and reports how far the enclosed regions are from the label image the backend returns as `reference`.
