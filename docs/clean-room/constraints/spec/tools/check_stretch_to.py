import sys; sys.path.insert(0, "tools"); from ref import *
def nz(v): return v / np.linalg.norm(v)
def swing(a, b):
    """Minimal rotation taking unit vector a to unit vector b."""
    v = np.cross(a, b); c = a @ b
    if c < -1 + 1e-9:
        p = np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0]); p = nz(p)
        return 2 * np.outer(p, p) - np.eye(3)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)
def soft_limit(v, c):
    lo = c["bulge_min"] if c.get("use_bulge_min") else None
    hi = c["bulge_max"] if c.get("use_bulge_max") else None
    sm = c.get("bulge_smooth", 0.0)
    if hi is not None and v > 1:
        if sm == 0: v = min(v, hi)
        else: v = SMOOTH_MAX(v, hi, sm)
    if lo is not None and v < 1:
        if sm == 0: v = max(v, lo)
        else: v = SMOOTH_MIN(v, lo, sm)
    return v
def SMOOTH_MAX(v, hi, sm):
    soft = 1 + (hi - 1) * 2 / np.pi * np.arctan((v - 1) / (hi - 1))
    return (1 - sm) * min(v, hi) + sm * soft
def SMOOTH_MIN(v, lo, sm):
    soft = 1 - (1 - lo) * 2 / np.pi * np.arctan((1 - v) / (1 - lo))
    return (1 - sm) * max(v, lo) + sm * soft
def solve(O, T, c):
    if c.get("keep_axis", "SWING_Y") == "SWING_Y":
        O = O.copy(); O[:3, :3] = fix_shear(O[:3, :3])
    t = O[:3, 3]; s0 = np.linalg.norm(O[:3, :3], axis=0); R0 = O[:3, :3] / s0
    vec = T[:3, 3] - t; d = np.linalg.norm(vec)
    rest = c.get("rest_length", 0.0) or d / s0[1]
    sy = d / rest; q = sy / s0[1]
    v = soft_limit(q ** -c.get("bulge", 1.0), c)
    vol = c.get("volume", "VOLUME_XZX")
    sx, sz = s0[0], s0[2]
    if vol == "VOLUME_XZX": sx *= np.sqrt(v); sz *= np.sqrt(v)
    elif vol == "VOLUME_X": sx *= v
    elif vol == "VOLUME_Z": sz *= v
    y = nz(vec); keep = c.get("keep_axis", "SWING_Y")
    if keep == "PLANE_X":
        z = nz(np.cross(R0[:, 0], y)); x = np.cross(y, z)
    elif keep == "PLANE_Z":
        x = nz(np.cross(y, R0[:, 2])); z = np.cross(x, y)
    else:
        R = swing(nz(R0[:, 1]), y) @ R0; x, z = R[:, 0], R[:, 2]
    return compose(t, np.stack([x, y, z], 1), np.array([sx, sy, sz]))
if __name__ == "__main__":
    check(sys.argv[1], solve)
