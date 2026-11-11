# Analytic two-bone IK with a pole, as the spec describes it.
import numpy as np
def nz(v): return v / np.linalg.norm(v)
def rot_about(axis, ang):
    axis = nz(axis); K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + np.sin(ang) * K + (1 - np.cos(ang)) * K @ K

def swing(a, b):
    a, b = nz(a), nz(b); v = np.cross(a, b); c = a @ b
    if np.linalg.norm(v) < 1e-12: return np.eye(3)
    return rot_about(v, np.arctan2(np.linalg.norm(v), c))
POLE_MODE = [1, "u"]
def two_bone(P1, P2, L1, L2, t, pole=None, pole_angle=0.0):
    """P1, P2: start pose matrices (armature space) of root and tip bone; returns solved matrices."""
    H = P1[:3, 3]; d0 = t - H; d = np.linalg.norm(d0); u = d0 / d
    tip0 = P2[:3, 3] + P2[:3, 1] * L2
    # 1. Rigidly rotate the chain so its root-to-tip line points at the target.
    A = swing(tip0 - H, u)
    if pole is not None:
        q = nz((pole - H) - u * ((pole - H) @ u))
        Y1 = A @ P1[:3, 1]
        x = rot_about(Y1, -POLE_MODE[0] * pole_angle) @ (A @ P1[:3, 0]) if POLE_MODE[1] == "bone" else A @ P1[:3, 0]
        x = nz(x - u * (x @ u))
        want = rot_about(u, pole_angle) @ q if POLE_MODE[1] == "u" else q
        A = rot_about(u, np.arctan2(np.cross(x, want) @ u, x @ want)) @ A
    def moved(P):
        M = np.eye(4); M[:3, :3] = A @ P[:3, :3]; M[:3, 3] = H + A @ (P[:3, 3] - H); return M
    S1, S2 = moved(P1), moved(P2)
    # 2. Bend in the plane of the moved chain.
    e0 = S2[:3, 3]; n = np.cross(u, e0 - H)
    n = nz(n) if np.linalg.norm(n) > 1e-9 else nz(S1[:3, 0])
    dc = min(d, L1 + L2 - 1e-9)
    ca = (L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc)
    alpha = np.arccos(np.clip(ca, -1, 1))
    y1 = rot_about(n, alpha) @ u
    B1 = swing(S1[:3, 1], y1)
    R1 = np.eye(4); R1[:3, :3] = B1 @ S1[:3, :3]; R1[:3, 3] = H
    e = H + y1 * L1
    C2 = B1 @ S2[:3, :3]
    tgt = t if d <= L1 + L2 else H + u * (L1 + L2)
    B2 = swing(C2[:, 1], tgt - e)
    R2 = np.eye(4); R2[:3, :3] = B2 @ C2; R2[:3, 3] = e
    return R1, R2
