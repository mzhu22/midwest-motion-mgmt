from __future__ import annotations

import numpy as np

from backend import contours


def _line(m, x0, y0, x1, y1):
    """Bresenham, the same drawing the frontend uses to rasterize a contour."""
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        m[y0, x0] = True
        if x0 == x1 and y0 == y1:
            return
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


def _polygon(vertices, shape=(60, 60)):
    m = np.zeros(shape, bool)
    for i, a in enumerate(vertices):
        b = vertices[(i + 1) % len(vertices)]
        _line(m, a[0], a[1], b[0], b[1])
    return m


def _thick_ring(thickness=2):
    """A rectangular ring `thickness` px wide, outer edge rows 10-29, cols 10-39."""
    m = np.zeros((40, 50), bool)
    t = thickness
    m[10 : 10 + t, 10:40] = True
    m[30 - t : 30, 10:40] = True
    m[10:30, 10 : 10 + t] = True
    m[10:30, 40 - t : 40] = True
    return m


def _pixels_of(contour):
    pts = np.array(contour.points).reshape(-1, 2)
    return {(int(y), int(x)) for x, y in pts}


def _mask_pixels(mask):
    return {(int(r), int(c)) for r, c in zip(*np.nonzero(mask))}


SQUARE = [(10, 10), (40, 10), (40, 40), (10, 40)]
TRIANGLE = [(5, 5), (50, 20), (20, 50)]  # sharp tips strand pixels for a greedy walk
STAR = [(30, 5), (35, 25), (55, 30), (35, 35), (30, 55), (25, 35), (5, 30), (25, 25)]


class TestThinOutlines:
    """The tool's own output: 1 px 8-connected loops. These must come back exactly."""

    def test_empty_mask_has_no_contour(self):
        assert contours.mask_to_contour(np.zeros((10, 10), bool)) is None

    def test_outline_reloads_to_exactly_the_same_pixels(self):
        for name, vertices in {"square": SQUARE, "triangle": TRIANGLE, "star": STAR}.items():
            mask = _polygon(vertices)
            loaded = contours.mask_to_contour(mask)
            assert _pixels_of(loaded) == _mask_pixels(mask), name
            assert loaded.notes == [], name

    def test_vertices_sit_on_pixel_centres(self):
        loaded = contours.mask_to_contour(_polygon(SQUARE))
        pts = np.array(loaded.points).reshape(-1, 2)
        assert np.allclose(pts % 1, 0.5)

    def test_random_outlines_reload_exactly(self):
        rng = np.random.default_rng(7)
        for _ in range(60):
            n = int(rng.integers(3, 9))
            angles = np.sort(rng.uniform(0, 2 * np.pi, n))
            radii = rng.uniform(10, 27, n)
            vertices = [
                (int(30 + r * np.cos(a)), int(30 + r * np.sin(a))) for a, r in zip(angles, radii)
            ]
            mask = _polygon(vertices)
            if not contours._is_thin(mask):
                continue
            assert _pixels_of(contours.mask_to_contour(mask)) == _mask_pixels(mask)

    def test_walk_ends_next_to_its_start(self):
        """Closing the polygon must add no pixel the mask did not have."""
        for vertices in (SQUARE, TRIANGLE, STAR):
            pts = np.array(contours.mask_to_contour(_polygon(vertices)).points).reshape(-1, 2)
            assert np.abs(pts[0] - pts[-1]).max() <= 1.0

    def test_a_lone_pixel_is_a_dot(self):
        m = np.zeros((9, 9), bool)
        m[4, 4] = True
        assert _pixels_of(contours.mask_to_contour(m)) == {(4, 4)}


class TestThickOutlines:
    """Masks from older saves, drawn with a 2 px brush: reduced to a centerline."""

    def test_thick_ring_is_one_loop_on_the_strokes_centre(self):
        loaded = contours.mask_to_contour(_thick_ring())
        pts = np.array(loaded.points).reshape(-1, 2)
        # A 2 px ring spanning rows/cols 10-11 .. 28-29 / 38-39 is centred on 11, 29, 39.
        assert abs(pts[:, 0].min() - 11.0) <= 0.5
        assert abs(pts[:, 0].max() - 39.0) <= 0.5
        assert abs(pts[:, 1].min() - 11.0) <= 0.5
        assert abs(pts[:, 1].max() - 29.0) <= 0.5
        assert loaded.notes == []

    def test_thick_ring_walk_closes_on_itself(self):
        pts = np.array(contours.mask_to_contour(_thick_ring()).points).reshape(-1, 2)
        assert np.linalg.norm(pts[0] - pts[-1]) <= 2.0

    def test_thin_and_thick_are_told_apart(self):
        assert contours._is_thin(_polygon(SQUARE))
        assert not contours._is_thin(_thick_ring())


class TestProblemsAreReported:
    def test_a_second_part_is_dropped_and_said_so(self):
        m = _polygon(SQUARE)
        _line(m, 50, 50, 56, 50)
        loaded = contours.mask_to_contour(m)
        assert any("separate part" in n for n in loaded.notes)
        assert _pixels_of(loaded) == _mask_pixels(_polygon(SQUARE))

    def test_an_outline_with_a_gap_is_flagged_not_repaired(self):
        m = _polygon(SQUARE)
        m[10, 20:24] = False  # a gap in the top edge
        loaded = contours.mask_to_contour(m)
        assert any("does not enclose" in n for n in loaded.notes)
        assert _pixels_of(loaded) == _mask_pixels(m)

    def test_a_closed_outline_has_no_notes(self):
        assert contours.mask_to_contour(_polygon(SQUARE)).notes == []


class TestSkeletonize:
    def test_result_is_a_subset_of_the_mask(self):
        m = _thick_ring(thickness=3)
        assert not (contours.skeletonize(m) & ~m).any()

    def test_thick_line_reduces_to_one_pixel_wide(self):
        m = np.zeros((20, 30), bool)
        m[8:12, 3:27] = True
        skeleton = contours.skeletonize(m)
        assert skeleton.any()
        assert skeleton[:, 12].sum() == 1
