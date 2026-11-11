import sys, json; sys.path.insert(0, "tools"); from ref import *
from check_damped_track import AXIS
UPI = {"UP_X": 0, "UP_Y": 1, "UP_Z": 2}
def track_to(O, T, c):
    ti, sgn = AXIS[c.get("track_axis", "TRACK_NEGATIVE_Z")]; ui = UPI[c.get("up_axis", "UP_Y")]
    v = T[:3, 3] - O[:3, 3]
    if np.linalg.norm(v) < 1e-9: return O
    v = v / np.linalg.norm(v) * sgn
    up = T[:3, 2] / np.linalg.norm(T[:3, 2]) if c.get("use_target_z") else np.array([0.0, 0, 1])
    u = up - v * (up @ v)
    if np.linalg.norm(u) < 1e-9: u = np.array([0.0, 1, 0]) - v * v[1]
    u /= np.linalg.norm(u)
    cols = [None] * 3; cols[ti] = v; cols[ui] = u; k = 3 - ti - ui
    cols[k] = np.cross(cols[(k + 1) % 3], cols[(k + 2) % 3])
    s = np.linalg.norm(O[:3, :3], axis=0)
    return compose(O[:3, 3], np.stack(cols, 1), s)
if __name__ == "__main__": check(sys.argv[1], track_to)
