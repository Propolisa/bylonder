import json, numpy as np, sys
d = json.load(open(sys.argv[1]))
inv = np.linalg.inv
def normcols(m): return m / np.linalg.norm(m, axis=0)
def polar(m):
    u, s, vt = np.linalg.svd(m); return u @ vt
def ortho_y(m):  # keep Y column direction, Gram-Schmidt Z then X
    y = m[:, 1] / np.linalg.norm(m[:, 1]); z = m[:, 2] - y * (y @ m[:, 2]); z /= np.linalg.norm(z); x = np.cross(y, z); return np.stack([x, y, z], 1)
def compose(RS3, t, basis, flags, L3):
    loc = basis[:3, 3].copy()
    if flags["use_connect"]: loc[:] = 0
    out = np.eye(4); out[:3, :3] = RS3 @ basis[:3, :3]
    out[:3, 3] = t + (L3 @ loc)
    return out
for i, r in enumerate(d):
    if r.get("object"): continue
    f = r["flags"]
    A, B = r["bones"]["A"], r["bones"]["B"]
    Pa, Ra, Pb, Rb, basis = (np.array(m) for m in (A["pose"], A["rest"], B["pose"], B["rest"], B["basis"]))
    O = inv(Ra) @ Rb; PI = Pa @ O; t = PI[:3, 3]; P3 = Pa[:3, :3]
    res = {}
    for oname, orth in (("normcols", normcols), ("polar", polar), ("ortho_y", ortho_y)):
        mode = f["inherit_scale"]
        if not f["use_inherit_rotation"]:
            base3 = {"FULL": None}.get(mode)
        scale = np.linalg.norm(P3, axis=0)
        cand = {"FULL": P3 @ O[:3, :3], "NONE": orth(P3) @ O[:3, :3], "NONE_LEGACY": normcols(P3) @ O[:3, :3],
                "AVERAGE": orth(P3) * np.cbrt(np.linalg.det(P3)) @ O[:3, :3], "ALIGNED": orth(P3) @ O[:3, :3] @ np.diag(scale),
                "FIX_SHEAR": ortho_y(P3 @ O[:3, :3]) * np.cbrt(np.linalg.det(P3)) @ np.diag(1/np.ones(3))}
        RS3 = cand[mode]
        if not f["use_inherit_rotation"]:
            RS3 = Rb[:3, :3]
        L3 = RS3 if f["use_local_location"] else P3
        res[oname] = round(np.abs(compose(RS3, t, basis, f, L3) - Pb).max(), 5)
    print(i, f["inherit_scale"], "rot" if f["use_inherit_rotation"] else "NOROT", "conn" if f["use_connect"] else "", "LL" if f["use_local_location"] else "PARLOC", res)
