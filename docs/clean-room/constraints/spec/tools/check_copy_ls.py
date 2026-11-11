import sys; sys.path.insert(0, "tools"); from ref import *
def copy_location(O, T, c):
    out = O.copy()
    for i, a in enumerate("xyz"):
        if c.get("use_" + a, True):
            v = -T[i, 3] if c.get("invert_" + a) else T[i, 3]
            out[i, 3] = O[i, 3] + v if c.get("use_offset") else v
    return out
def copy_scale(O, T, c):
    s0 = np.linalg.norm(O[:3, :3], axis=0); st = np.linalg.norm(T[:3, :3], axis=0) ** c.get("power", 1.0)
    use = [c.get("use_" + a, True) for a in "xyz"]
    if c.get("use_make_uniform"):
        u = np.prod([st[i] for i in range(3) if use[i]]) ** (1 / 3)
        st = np.full(3, u); use = [any(use)] * 3
    s = s0.copy()
    for i in range(3):
        if not use[i]: continue
        if c.get("use_offset"): s[i] = s0[i] + st[i] - 1 if c.get("use_add") else s0[i] * st[i]
        else: s[i] = st[i]
    out = O.copy(); out[:3, :3] = O[:3, :3] / s0 * s; return out
if __name__ == "__main__":
    check("specs/copy_location.fixtures.json", copy_location)
    check("specs/copy_scale.fixtures.json", copy_scale)
