import sys, json; sys.path.insert(0, "tools")
from ref import *; from euler import *
from check_copy_rotation import owner_mode
OPT = {"ortho": "fs"}
def clamp_circle(a, lo, hi):
    mid = (lo + hi) / 2; a = mid + (a - mid + np.pi) % (2 * np.pi) - np.pi
    if lo <= a <= hi: return a
    dlo = (lo - a) % (2 * np.pi); dhi = (a - hi) % (2 * np.pi)
    return lo if dlo < dhi else hi
def limit_rotation(O, c, mode):
    order = c.get("euler_order", "AUTO")
    if order == "AUTO": order = mode if mode in ("XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX") else "XYZ"
    F = fix_shear(O[:3, :3]); s0 = np.linalg.norm(F, axis=0); R0 = F / s0
    e = mat_to_euler(R0, order)
    for i, a in enumerate("xyz"):
        if c.get("use_limit_" + a):
            lo, hi = c.get("min_" + a, 0.0), c.get("max_" + a, 0.0)
            e[i] = np.clip(e[i], lo, hi) if c.get("use_legacy_behavior") else clamp_circle(e[i], lo, hi)
    return compose(O[:3, 3], euler_to_mat(e, order), s0)
if __name__ == "__main__":
    for m in ("fs",):
        bad = []
        for case in json.load(open(sys.argv[1])):
            md = owner_mode(case); w, g = run(case, lambda O, T, c: limit_rotation(O, c, md))
            if np.abs(w - g).max() > 1e-4: bad.append((case["name"], round(float(np.abs(w - g).max()), 3)))
        print(m, len(bad), bad)
