"""Unit test for the D4 augmentation in fields.py. Four checks, all exact
(bit for bit, not "close"), over every one of the eight elements and all
16 directions:

  1. the turned ambient keeps |.| = 1 (its length is the original's to the
     last bit, and the original's is 1 to rounding);
  2. a field that is exactly the uniform ambient comes out exactly the
     turned ambient in every cell;
  3. the inverse brings back the original scene bit for bit;
  4. dz/dx, dz/dy recomputed from the turned DEM equal the turned
     (dz/dx, dz/dy) vector field. This is the one that catches a
     row-is-south sign slip: get it wrong and every odd turn fails.

Plus a hand check of one turn (a north wind, turned a quarter
counter-clockwise, is a west wind) and, when torch is installed, that the
tensor path gives the numpy path's numbers.

    py -3.14 pipeline/surrogate/test_fields.py      (or pytest)
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fields import D4_ELEMENTS, ambient, bearing, d4, d4_inverse, gradients, wrap180  # noqa: E402

DIRECTIONS = [k * 22.5 for k in range(16)]


def scene(R: int = 37, C: int = 53, seed: int = 0):
    """A non-square scene, so a transposed axis cannot pass by accident."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:R, 0:C].astype(np.float32)
    dem = (300 + 40 * np.exp(-((xx - 30) ** 2 + (yy - 12) ** 2) / 60) + 7 * xx - 3 * yy
           + rng.normal(0, 2, (R, C))).astype(np.float32)
    u = rng.normal(0, 1, (16, R, C)).astype(np.float32)
    v = rng.normal(0, 1, (16, R, C)).astype(np.float32)
    turb = rng.random((16, R, C)).astype(np.float32)
    return dem, u, v, turb


def test_ambient_unit():
    for d in DIRECTIONS:
        ex, ey = ambient(d)
        n0 = np.hypot(ex, ey)
        assert abs(n0 - 1.0) < 1e-12
        for k, flip in D4_ELEMENTS:
            _, _, ex_t, ey_t = d4(k, flip, np.zeros((2, 3)), [], ex, ey)
            assert np.hypot(ex_t, ey_t) == n0, (d, k, flip)


def test_uniform_stays_uniform():
    R, C = 19, 29
    for d in DIRECTIONS:
        ex, ey = ambient(d)
        ex, ey = np.float32(ex), np.float32(ey)
        U = np.full((R, C), ex, np.float32)
        V = np.full((R, C), ey, np.float32)
        for k, flip in D4_ELEMENTS:
            _, ((U_t, V_t),), ex_t, ey_t = d4(k, flip, np.zeros((R, C)), [(U, V)], ex, ey)
            assert U_t.shape == ((C, R) if k % 2 else (R, C))
            assert np.array_equal(U_t, np.full(U_t.shape, ex_t, np.float32)), (d, k, flip)
            assert np.array_equal(V_t, np.full(V_t.shape, ey_t, np.float32)), (d, k, flip)


def test_inverse_exact():
    dem, u, v, turb = scene()
    scal = np.concatenate([dem[None], turb])
    for d in DIRECTIONS:
        ex, ey = ambient(d)
        for k, flip in D4_ELEMENTS:
            s_t, vecs_t, ex_t, ey_t = d4(k, flip, scal, [(u, v)], ex, ey)
            s_b, ((u_b, v_b),), ex_b, ey_b = d4_inverse(k, flip, s_t, vecs_t, ex_t, ey_t)
            assert np.array_equal(s_b, scal) and np.array_equal(u_b, u) and np.array_equal(v_b, v), (k, flip)
            assert ex_b == ex and ey_b == ey, (d, k, flip)


def test_gradient_commutes():
    dem, _, _, _ = scene()
    gx, gy = gradients(dem)
    for k, flip in D4_ELEMENTS:
        dem_t, ((gx_t, gy_t),), _, _ = d4(k, flip, dem, [(gx, gy)], 0.0, 0.0)
        gx_r, gy_r = gradients(np.ascontiguousarray(dem_t))
        assert np.array_equal(gx_r, gx_t), ("gx", k, flip)
        assert np.array_equal(gy_r, gy_t), ("gy", k, flip)


def test_slope_sign():
    """A plane rising to the east and north: gx, gy both positive."""
    yy, xx = np.mgrid[0:5, 0:6].astype(np.float32)
    dem = 3.0 * xx - 6.0 * yy          # rows run south, so -row is north
    gx, gy = gradients(dem)
    assert np.allclose(gx, 3.0 / 30) and np.allclose(gy, 6.0 / 30)


def test_quarter_turn_by_hand():
    """A wind from the north blows south; the scene turned a quarter
    counter-clockwise has it blowing east, a wind from the west (270)."""
    ex, ey = ambient(0.0)
    _, _, ex_t, ey_t = d4(1, False, np.zeros((2, 2)), [], ex, ey)
    assert abs(wrap180(bearing(ex_t, ey_t) - 90.0)) < 1e-9
    # and the west-east mirror takes a wind from 60 to one from 300
    ex, ey = ambient(60.0)
    _, _, ex_t, ey_t = d4(0, True, np.zeros((2, 2)), [], ex, ey)
    fx, fy = ambient(300.0)
    assert abs(ex_t - fx) < 1e-12 and abs(ey_t - fy) < 1e-12
    # the picture itself: np.rot90 moves the north-east corner to the north-west
    a = np.zeros((3, 4))
    a[0, -1] = 1
    b, _, _, _ = d4(1, False, a, [], 0.0, 0.0)
    assert b[0, 0] == 1


def test_torch_matches_numpy():
    try:
        import torch
    except ImportError:
        print("  (torch not installed, tensor path skipped)")
        return
    dem, u, v, turb = scene()
    for k, flip in D4_ELEMENTS:
        a_n, ((u_n, v_n),), _, _ = d4(k, flip, turb, [(u, v)], 0.3, -0.4)
        a_t, ((u_t, v_t),), _, _ = d4(k, flip, torch.from_numpy(turb), [(torch.from_numpy(u), torch.from_numpy(v))], 0.3, -0.4)
        assert np.array_equal(a_n, a_t.numpy()) and np.array_equal(u_n, u_t.numpy()) and np.array_equal(v_n, v_t.numpy())


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, f in tests:
        f()
        print(f"ok  {name}")
    print(f"{len(tests)} passed")
