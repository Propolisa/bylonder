import sys; sys.path.insert(0, "tools"); from ref import *
from check_stretch_to import swing, nz
AXIS = {"TRACK_X": (0, 1), "TRACK_Y": (1, 1), "TRACK_Z": (2, 1), "TRACK_NEGATIVE_X": (0, -1), "TRACK_NEGATIVE_Y": (1, -1), "TRACK_NEGATIVE_Z": (2, -1)}
PRE = {"mode": "none"}
def damped_track(O, T, c):
    i, sgn = AXIS[c.get("track_axis", "TRACK_Y")]
    M3 = O[:3, :3]
    if PRE["mode"] == "fix_shear": M3 = fix_shear(M3)
    s = np.linalg.norm(M3, axis=0); R0 = M3 / s
    v = T[:3, 3] - O[:3, 3]
    if np.linalg.norm(v) < 1e-9: return O
    R = swing(nz(R0[:, i] * sgn), nz(v)) @ R0
    return compose(O[:3, 3], R, s)
if __name__ == "__main__":
    for m in ("none", "fix_shear"):
        PRE["mode"] = m; print(m); check(sys.argv[1], damped_track)
