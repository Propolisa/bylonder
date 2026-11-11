# Own reference evaluator of single constraints, built from the spec, checked against the oracle fixtures.
import json, sys, numpy as np
sys.path.insert(0, "tools")
from bonemath import *
A = np.array
def mrot(M):
    u, s, vt = np.linalg.svd(M[:3, :3]); R = u @ vt
    return R
def loc_rot_scale(M):
    """Split a 4x4 into translation, pure rotation (columns normalized) and per-column scale, sign on X if mirrored."""
    s = np.linalg.norm(M[:3, :3], axis=0); R = M[:3, :3] / s
    if np.linalg.det(R) < 0: s[0] = -s[0]; R[:, 0] = -R[:, 0]
    return M[:3, 3].copy(), R, s
def compose(t, R, s):
    M = np.eye(4); M[:3, :3] = R @ np.diag(s); M[:3, 3] = t; return M

class Ctx:
    """Everything about one fixture case that the space conversions need."""
    def __init__(self, case, c):
        self.case, self.c, self.out, self.pre = case, c, case["output"], case["unconstrained"]
        self.objs = {o["name"]: o for o in case["input"]["objects"]}
    def world(self, name, bone=None, state="output", head_tail=0.0):
        o = self.case[state][name]; W = A(o["matrix_world"])
        if bone is None: return W
        b = o["bones"][bone]; M = W @ A(b["pose"])
        if head_tail:
            spec = next(x for x in self.objs[name]["bones"] if x["name"] == bone)
            length = np.linalg.norm(A(spec["tail"]) - A(spec["head"]))
            M = M.copy(); M[:3, 3] = (M @ np.array([0, head_tail * length, 0, 1]))[:3]
        return M
    def bone_info(self, name, bone, state="output"):
        o = self.case[state][name]; spec = next(x for x in self.objs[name]["bones"] if x["name"] == bone)
        info = {k: A(v) for k, v in o["bones"][bone].items()}
        parent = None
        if "parent" in spec:
            parent = {k: A(v) for k, v in o["bones"][spec["parent"]].items()}
        flags = dict(FLAGS); flags.update({k: spec[k] for k in FLAGS if k in spec})
        return A(o["matrix_world"]), info, parent, flags
    def custom(self):
        return self.world(self.c["space_object"][1:]) if "space_object" in self.c else None
    def to_space(self, space, W, name, bone, state):
        if bone is None:
            if space == "WORLD": return W
            if space == "CUSTOM": return inv(self.custom()) @ W
            spec = self.objs[name]
            if "parent" in spec:
                return inv(self.world(spec["parent"], state="output")) @ W
            R = np.eye(4); R[:3, :3] = mrot(self.world(name, state=state)); return inv(R) @ W
        aw, info, parent, flags = self.bone_info(name, bone)
        return bone_world_to_space(space, W, aw, info, parent, flags, self.custom())
    def from_space(self, space, X, name, bone, state):
        if bone is None:
            if space == "WORLD": return X
            if space == "CUSTOM": return self.custom() @ X
            spec = self.objs[name]
            if "parent" in spec: return self.world(spec["parent"]) @ X
            R = np.eye(4); R[:3, :3] = mrot(self.world(name, state=state)); return R @ X
        aw, info, parent, flags = self.bone_info(name, bone)
        return bone_space_to_world(space, X, aw, info, parent, flags, self.custom())

def run(case, solve, blend=True):
    """Evaluates the single constraint of a case with solve(owner, target, c) in owner/target space; returns (want, got)."""
    c = case["input"]["constraints"][0]; ctx = Ctx(case, c)
    on, ob = c["owner"], c.get("bone")
    O0 = ctx.world(on, ob, "unconstrained")
    os_, ts = c.get("owner_space", "WORLD"), c.get("target_space", "WORLD")
    T = None
    if c.get("target"):
        tn = c["target"][1:]; tb = c.get("subtarget") or None
        if tb and "bones" not in ctx.out[tn]: tb = None
        T = ctx.world(tn, tb, head_tail=c.get("head_tail", 0.0))
        T = ctx.to_space(ts, T, tn, tb, "output")
    own = ctx.to_space(os_, O0, on, ob, "unconstrained")
    new = solve(own, T, c)
    W = ctx.from_space(os_, new, on, ob, "unconstrained")
    f = c.get("influence", 1.0)
    if blend and f < 1: W = blend_polar(O0, W, f)
    if ob:
        spec = next(x for x in ctx.objs[on]["bones"] if x["name"] == ob)
        if spec.get("use_connect"): W[:3, 3] = O0[:3, 3]
    return W, ctx.world(on, ob, "output")

def check(path, solve, only=None, blend=True):
    bad = 0
    for case in json.load(open(path)):
        if only and not only(case): continue
        if "error" in case: print(case["name"], "ERROR", case["error"]); continue
        want, got = run(case, solve, blend)
        e = np.abs(want - got).max()
        if e > 1e-4: bad += 1
        print(f"{case['name']:50s} {e:.2e}{'  <<<' if e > 1e-4 else ''}")
    print("failures:", bad)
