"""Turn a saved annotation mask back into one editable closed contour per object.

The frontend edits each object as a single closed polygon and rasterizes it with its
own 1 px line drawing (frontend/src/contour.ts), so a mask saved by this tool is a thin
8-connected loop whose pixels are exactly the polygon's vertices. Those load back
exactly: the loop is toured pixel by pixel and every pixel centre becomes a vertex.

Masks from older saves (thick strokes, 2 px wide) are not thin. Those are reduced to a
centerline instead: a Zhang-Suen skeleton at UPSAMPLE x resolution, each point then
moved to the centroid of the mask pixels around it. That is close, not exact; the
frontend measures and reports what is left.

Either way an object comes back as one loop. A second, separate part is dropped, and
an outline that does not enclose anything is flagged (not repaired), so the caller can
tell the user instead of changing their data silently.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.ndimage import binary_fill_holes, label

# Trace on a grid this many times finer than the image. A thick stroke whose centre
# lies on a pixel boundary has two centre rows; at 1x the skeleton must pick one and is
# half a pixel off. At 2x it is a quarter pixel off.
UPSAMPLE = 2

# Pixels within this distance of a skeleton point vote on where the stroke really is.
_REFINE_RADIUS = 1.5

# Thinning leaves whiskers a few pixels long where a thick stroke ends or bends, and the
# tour walks out and back along them. Detours up to this deep are collapsed (thick masks
# only).
_DETOUR_DEPTH = 3

# A mask counts as thin if 2x2 blocks are at most this fraction of its pixels.
_THIN_BLOCK_FRACTION = 0.3

_NEIGHBOURS_4 = ((-1, 0), (0, -1), (0, 1), (1, 0))
_NEIGHBOURS_DIAG = ((-1, -1), (-1, 1), (1, -1), (1, 1))
_NEIGHBOURS_8 = _NEIGHBOURS_4 + _NEIGHBOURS_DIAG

Pixel = tuple[int, int]


def skeletonize(mask: np.ndarray) -> np.ndarray:
    """Zhang-Suen thinning: reduce a boolean mask to a 1 px wide, 8-connected skeleton."""
    img = np.pad(mask.astype(np.int16), 1)
    centre = img[1:-1, 1:-1]  # a view: writes below change img
    while True:
        changed = False
        for step in (0, 1):
            n = img[:-2, 1:-1]
            ne = img[:-2, 2:]
            e = img[1:-1, 2:]
            se = img[2:, 2:]
            s = img[2:, 1:-1]
            sw = img[2:, :-2]
            w = img[1:-1, :-2]
            nw = img[:-2, :-2]

            neighbour_count = n + ne + e + se + s + sw + w + nw
            ring = (n, ne, e, se, s, sw, w, nw, n)
            transitions = sum(
                ((ring[i] == 0) & (ring[i + 1] == 1)).astype(np.int16) for i in range(8)
            )
            if step == 0:
                directional = ((n * e * s) == 0) & ((e * s * w) == 0)
            else:
                directional = ((n * e * w) == 0) & ((n * s * w) == 0)

            removable = (
                (centre == 1)
                & (neighbour_count >= 2)
                & (neighbour_count <= 6)
                & (transitions == 1)
                & directional
            )
            if removable.any():
                centre[removable] = 0
                changed = True
        if not changed:
            break
    return centre.astype(bool)


def _keep_every_component(mask: np.ndarray, skeleton: np.ndarray) -> np.ndarray:
    """Thinning can erase a small blob outright (a 2x2 square, say). Give any component
    that lost every pixel back the one nearest its centre, so a dot stays a dot."""
    skeleton = skeleton.copy()
    components, count = label(mask, structure=np.ones((3, 3)))
    for k in range(1, count + 1):
        member = components == k
        if skeleton[member].any():
            continue
        rows, cols = np.nonzero(member)
        nearest = np.argmin((rows - rows.mean()) ** 2 + (cols - cols.mean()) ** 2)
        skeleton[rows[nearest], cols[nearest]] = True
    return skeleton


def _neighbours(p: Pixel, pixels: set[Pixel]) -> list[Pixel]:
    return [
        (p[0] + dr, p[1] + dc) for dr, dc in _NEIGHBOURS_8 if (p[0] + dr, p[1] + dc) in pixels
    ]


def _tour(pixels: set[Pixel]) -> list[Pixel]:
    """A walk that visits every pixel of a connected, thin pixel set and ends next to its
    start, so closing it with one more step adds no pixel the set did not have.

    Depth first, backing up along the walk when it hits a dead end. A greedy walk without
    backing up strands pixels at sharp corners (a lone pixel at the tip of a triangle,
    say) and has to give up a whole edge; backing up costs at most a one-pixel detour.
    Prefers 4-connected steps and keeping its heading, which keeps the walk clean on
    ordinary outlines.
    """
    start = min(pixels)
    walk = [start]
    trail = [start]
    visited = {start}

    def step_cost(current: Pixel, previous: Pixel | None):
        def cost(q: Pixel):
            diagonal = q[0] != current[0] and q[1] != current[1]
            turn = 0
            if previous is not None:
                turn = abs((q[0] - current[0]) - (current[0] - previous[0])) + abs(
                    (q[1] - current[1]) - (current[1] - previous[1])
                )
            return (diagonal, turn, q)

        return cost

    def adjacent_to_start(p: Pixel) -> bool:
        return max(abs(p[0] - start[0]), abs(p[1] - start[1])) <= 1

    def finished() -> bool:
        if len(visited) < len(pixels):
            return False
        return len(pixels) < 3 or (len(walk) > 2 and adjacent_to_start(walk[-1]))

    def component_sizes(options: list[Pixel]) -> dict[Pixel, int]:
        """For each option, the size of the unvisited region it leads into. Options that
        reach each other share a region (and so a size)."""
        sizes: dict[Pixel, int] = {}
        for option in options:
            if option in sizes:
                continue
            region = {option}
            frontier = [option]
            while frontier:
                for q in _neighbours(frontier.pop(), pixels):
                    if q not in visited and q not in region:
                        region.add(q)
                        frontier.append(q)
            for member in region:
                if member in options:
                    sizes[member] = len(region)
        return sizes

    while not finished():
        current = trail[-1]
        options = [q for q in _neighbours(current, pixels) if q not in visited]
        if options:
            if len(options) > 1:
                # A fork. Explore the smaller dead-end side first: the walk then comes
                # straight back to this pixel and carries on round the loop, instead of
                # going all the way round first and retracing the whole loop to reach it.
                sizes = component_sizes(options)
                smallest = min(sizes.values())
                options = [q for q in options if sizes[q] == smallest]
            previous = trail[-2] if len(trail) > 1 else None
            nxt = min(options, key=step_cost(current, previous))
            visited.add(nxt)
            trail.append(nxt)
            walk.append(nxt)
        elif len(trail) > 1:
            trail.pop()
            walk.append(trail[-1])
        else:
            break  # nothing left to visit and nowhere to back up to
    return walk


def _collapse_detours(walk: list[Pixel]) -> list[Pixel]:
    """Remove short out-and-back detours (a, b, a -> a), a few passes deep.

    Only for masks that had to be thinned: there, a whisker is thinning noise. A thin
    mask is the tool's own output and is kept pixel for pixel.
    """
    for _ in range(_DETOUR_DEPTH):
        out: list[Pixel] = []
        i = 0
        while i < len(walk):
            if i + 2 < len(walk) and walk[i] == walk[i + 2]:
                out.append(walk[i])
                i += 3
                continue
            out.append(walk[i])
            i += 1
        if len(out) == len(walk):
            break
        walk = out
    return walk


def _refine(x: float, y: float, mask: np.ndarray) -> tuple[float, float]:
    """Move a skeleton point to the centroid of the mask pixels around it.

    A thick stroke covers 1 or 2 pixels across depending on where its centre falls, and
    the skeleton cannot tell which (it is a quarter pixel off either way). The centroid
    is exact for both: the pixel centre for the 1 px case, the boundary between the two
    rows for the 2 px case.
    """
    h, w = mask.shape
    reach = int(np.ceil(_REFINE_RADIUS)) + 1
    r0, c0 = int(y), int(x)
    rows = np.arange(max(0, r0 - reach), min(h, r0 + reach + 1))
    cols = np.arange(max(0, c0 - reach), min(w, c0 + reach + 1))
    if rows.size == 0 or cols.size == 0:
        return x, y
    rr, cc = np.meshgrid(rows, cols, indexing="ij")
    near = mask[rr, cc] & ((cc + 0.5 - x) ** 2 + (rr + 0.5 - y) ** 2 <= _REFINE_RADIUS**2)
    if not near.any():
        return x, y
    return float((cc[near] + 0.5).mean()), float((rr[near] + 0.5).mean())


@dataclass
class LoadedContour:
    """One object's closed contour as flat [x0, y0, x1, y1, ...] image coordinates (the
    segment from the last point back to the first is implied), plus anything the user
    should be told about how it was recovered."""

    points: list[float]
    notes: list[str] = field(default_factory=list)


def _is_thin(mask: np.ndarray) -> bool:
    """True if the mask is a line about 1 px wide, with at most a few 2x2 clusters.

    The tool's own outlines qualify: where two edges meet at a sharp angle the drawing
    can fill a 2x2 block, but nowhere else. A thick stroke (2 px or more across) is made
    almost entirely of such blocks.
    """
    blocks = mask[:-1, :-1] & mask[1:, :-1] & mask[:-1, 1:] & mask[1:, 1:]
    return blocks.sum() <= _THIN_BLOCK_FRACTION * mask.sum()


def _largest_component(skeleton: np.ndarray) -> tuple[set[Pixel], int]:
    """Pixels of the biggest 8-connected component, and how many pixels the rest held."""
    components, _ = label(skeleton, structure=np.ones((3, 3)))
    sizes = np.bincount(components.ravel())[1:]
    keep = int(np.argmax(sizes)) + 1
    rows, cols = np.nonzero(components == keep)
    return {(int(r), int(c)) for r, c in zip(rows, cols)}, int(sizes.sum() - sizes[keep - 1])


def mask_to_contour(mask: np.ndarray) -> LoadedContour | None:
    """One closed contour for a boolean (H, W) object mask, or None if it is empty.

    Coordinates follow the canvas convention that pixel (row, col) spans
    [col, col+1] x [row, row+1], so a vertex at a pixel's middle is (col + 0.5, row + 0.5).
    """
    if not mask.any():
        return None

    if _is_thin(mask):
        skeleton, scale = mask, 1
    else:
        fine = np.kron(mask.astype(np.uint8), np.ones((UPSAMPLE, UPSAMPLE), dtype=np.uint8))
        skeleton = _keep_every_component(fine.astype(bool), skeletonize(fine.astype(bool)))
        scale = UPSAMPLE

    pixels, dropped = _largest_component(skeleton)
    notes: list[str] = []
    if dropped:
        notes.append(f"a second, separate part of the outline was dropped ({dropped} px)")

    walk = _tour(pixels)
    if scale != 1:
        walk = _collapse_detours(walk)

    points: list[float] = []
    for row, col in walk:
        x, y = (col + 0.5) / scale, (row + 0.5) / scale
        if scale != 1:
            x, y = _refine(x, y, mask)
        points += [x, y]

    if binary_fill_holes(mask).sum() <= mask.sum():
        # Left as saved, not patched up: the UI flags it as not closed, which is the
        # truth, and the user decides how to fix it.
        notes.append("the saved outline has a gap and does not enclose any area")
    return LoadedContour(points, notes)
