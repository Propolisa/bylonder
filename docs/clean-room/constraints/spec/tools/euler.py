# Euler helpers: order "ABC" means R = R_C @ R_B @ R_A (A applied first), angles in radians.
import numpy as np
AX = {"X": 0, "Y": 1, "Z": 2}
def axis_rot(i, a):
    c, s = np.cos(a), np.sin(a); R = np.eye(3); j, k = (i + 1) % 3, (i + 2) % 3
    R[j, j] = c; R[j, k] = -s; R[k, j] = s; R[k, k] = c; return R
def euler_to_mat(e, order="XYZ"):
    """e is indexed by axis (e[0] = X angle), whatever the order."""
    R = np.eye(3)
    for ch in order: R = axis_rot(AX[ch], e[AX[ch]]) @ R
    return R
def mat_to_euler_pair(M, order="XYZ"):
    """The two Euler solutions of a rotation matrix, as axis-indexed triples."""
    i, j, k = (AX[ch] for ch in order)
    if (j - i) % 3 != 1:  # odd order: M^T has the reversed (even) order with negated angles
        return [-e for e in mat_to_euler_pair(M.T, order[::-1])]
    P = np.zeros((3, 3)); P[0, i] = P[1, j] = P[2, k] = 1
    N = P @ M @ P.T
    cy = np.hypot(N[0, 0], N[1, 0])
    if cy > 1e-6:
        sols = [[np.arctan2(N[2, 1], N[2, 2]), np.arctan2(-N[2, 0], cy), np.arctan2(N[1, 0], N[0, 0])],
                [np.arctan2(-N[2, 1], -N[2, 2]), np.arctan2(-N[2, 0], -cy), np.arctan2(-N[1, 0], -N[0, 0])]]
    else:
        a = [np.arctan2(-N[1, 2], N[1, 1]), np.arctan2(-N[2, 0], cy), 0.0]; sols = [a, a]
    out = []
    for sol in sols:
        e = np.zeros(3); e[i], e[j], e[k] = sol; out.append(e)
    return out
def mat_to_euler(M, order="XYZ"):
    a, b = mat_to_euler_pair(M, order)
    return a if np.abs(a).sum() <= np.abs(b).sum() else b
if __name__ == "__main__":
    rng = np.random.default_rng(1)
    for order in ["XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"]:
        for _ in range(200):
            e = rng.uniform(-3, 3, 3); M = euler_to_mat(e, order)
            for s in mat_to_euler_pair(M, order):
                assert np.abs(euler_to_mat(s, order) - M).max() < 1e-9, (order, e, s)
    print("euler ok")

def compatible(e, ref):
    """e with each angle moved by whole turns to lie within pi of ref."""
    return ref + (e - ref + np.pi) % (2 * np.pi) - np.pi
def mat_to_compatible_euler(M, order, ref):
    """The Euler solution closest to ref (sum of absolute differences), each angle wrapped toward ref."""
    sols = [compatible(e, ref) for e in mat_to_euler_pair(M, order)]
    return min(sols, key=lambda e: np.abs(e - ref).sum())
