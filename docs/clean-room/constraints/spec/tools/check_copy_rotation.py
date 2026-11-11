# Copy Rotation as the spec describes it, checked against the fixtures.
import sys, json; sys.path.insert(0, "tools")
from ref import *; from euler import *
def axes(c): return [c.get("use_" + a, True) for a in "xyz"], [-1.0 if c.get("invert_" + a) else 1.0 for a in "xyz"]
def copy_rotation(O, T, c, owner_mode="XYZ"):
    order = c.get("euler_order", "AUTO")
    if order == "AUTO": order = owner_mode if owner_mode in ("XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX") else "XYZ"
    s0 = np.linalg.norm(O[:3, :3], axis=0); R0 = O[:3, :3] / s0
    F = fix_shear(T[:3, :3]); Rt = F / np.linalg.norm(F, axis=0)
    eo = mat_to_euler(R0, order); et = mat_to_compatible_euler(Rt, order, eo)
    use, sign = axes(c); mix = c.get("mix_mode", "REPLACE")
    picked = np.array([et[i] * sign[i] if use[i] else 0.0 for i in range(3)])
    if mix == "REPLACE": R = euler_to_mat(np.where(use, picked, eo), order)
    elif mix == "ADD": R = euler_to_mat(eo + picked, order)
    elif mix == "BEFORE": R = euler_to_mat(picked, order) @ R0
    elif mix == "AFTER": R = R0 @ euler_to_mat(picked, order)
    elif mix == "OFFSET": R = euler_to_mat(np.where(use, picked, eo), order) @ euler_to_mat(np.where(use, eo, 0.0), "ZYX")
    return compose(O[:3, 3], R, s0)
def owner_mode(case):
    c = case["input"]["constraints"][0]; o = next(x for x in case["input"]["objects"] if x["name"] == c["owner"])
    if "bone" in c: return o.get("pose", {}).get(c["bone"], {}).get("rotation_mode", "XYZ")
    return o.get("rotation_mode", "XYZ")
if __name__ == "__main__":
    for path in sys.argv[1:]:
        bad = []
        for case in json.load(open(path)):
            m = owner_mode(case); w, g = run(case, lambda O, T, c: copy_rotation(O, T, c, m))
            if np.abs(w - g).max() > 1e-4: bad.append(case["name"])
        print(path, "failures:", len(bad), bad)
