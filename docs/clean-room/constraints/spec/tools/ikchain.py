# Own iterative chain IK (Jacobian pseudo-inverse integrated in small steps) to compare with the oracle.
import numpy as np
from ik2 import rot_about, nz
def solve_chain(poses, lengths, target, steps=400, step=0.05, damping=1e-3):
    """poses: start pose matrices root first; returns solved matrices. Joints rotate freely (3 DOF)."""
    P = [p.copy() for p in poses]; n = len(P)
    def tip(): return P[-1][:3, 3] + P[-1][:3, 1] * lengths[-1]
    for _ in range(steps):
        e = target - tip()
        if np.linalg.norm(e) < 1e-7: break
        J = np.zeros((3, 3 * n)); t = tip()
        for k in range(n):
            for a in range(3):
                ax = np.zeros(3); ax[a] = 1; J[:, 3 * k + a] = np.cross(ax, t - P[k][:3, 3])
        dth = J.T @ np.linalg.solve(J @ J.T + damping * np.eye(3), e * min(1.0, step / max(np.linalg.norm(e), 1e-12)))
        for k in range(n):
            w = dth[3 * k:3 * k + 3]; ang = np.linalg.norm(w)
            if ang < 1e-15: continue
            R = rot_about(w, ang); o = P[k][:3, 3].copy()
            for j in range(k, n):
                P[j][:3, :3] = R @ P[j][:3, :3]; P[j][:3, 3] = o + R @ (P[j][:3, 3] - o)
    return P
