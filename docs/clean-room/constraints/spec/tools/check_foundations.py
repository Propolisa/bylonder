import json, numpy as np, sys
sys.path.insert(0, "tools"); from bonemath import *
d = {r["name"]: r for r in json.load(open("specs/00-foundations.fixtures.json"))}
A = lambda m: np.array(m)
def loo(L, Rt, Ro):
    M = np.eye(4); C = inv(Ro) @ Rt
    M[:3, :3] = C @ L[:3, :3] @ inv(C); M[:3, 3] = C @ L[:3, 3]; return M
for n, r in d.items():
    if not n.startswith("spaces_"): continue
    c = r["input"]["constraints"][0]; out = r["output"]
    aw = A(out["Arm"]["matrix_world"]); bones = {k: {kk: A(vv) for kk, vv in v.items()} for k, v in out["Arm"]["bones"].items()}
    S = A(out["S"]["matrix_world"]); T = aw @ bones["C"]["pose"]
    ts, os_ = c["target_space"], c["owner_space"]
    if ts == "LOCAL_OWNER_ORIENT":
        tm = loo(bone_world_to_space("LOCAL", T, aw, bones["C"], None), bones["C"]["rest"][:3, :3], bones["B"]["rest"][:3, :3])
    else:
        tm = bone_world_to_space(ts, T, aw, bones["C"], None, custom=S)
    want = bone_space_to_world(os_, tm, aw, bones["B"], bones["A"], custom=S)
    print(n, round(np.abs(want - aw @ bones["B"]["pose"]).max(), 6))
