# Child Of as the spec describes it. The inverse is read from the constraint after evaluation (constraints_after).
import sys, json; sys.path.insert(0, "tools"); from ref import *; from euler import *
def parent_matrix(T, c):
    t, R, s = loc_rot_scale(T); e = mat_to_euler(R, "XYZ")
    for i, a in enumerate("xyz"):
        if not c.get(f"use_rotation_{a}", True): e[i] = 0
        if not c.get(f"use_scale_{a}", True): s[i] = 1
    return compose(t, euler_to_mat(e, "XYZ"), s)
def evaluate(case):
    c = case["input"]["constraints"][0]; ctx = Ctx(case, c)
    on, ob = c["owner"], c.get("bone"); os_ = c.get("owner_space", "WORLD")
    O0 = ctx.world(on, ob, "unconstrained"); Ow = ctx.to_space(os_, O0, on, ob, "unconstrained")
    T = ctx.to_space(os_, ctx.world(c["target"][1:]), on, ob, "unconstrained") if ob else ctx.world(c["target"][1:])
    key = on + (":" + ob if ob else "")
    Inv = A(list(case["constraints_after"][key].values())[0]["inverse_matrix"]).reshape(4, 4)
    R = parent_matrix(T, c) @ Inv @ Ow
    for i, a in enumerate("xyz"):
        if not c.get(f"use_location_{a}", True): R[i, 3] = Ow[i, 3]
    W = ctx.from_space(os_, R, on, ob, "unconstrained")
    if c.get("influence", 1) < 1: W = blend_polar(O0, W, c["influence"])
    return W, ctx.world(on, ob)
if __name__ == "__main__":
    bad = []
    for case in json.load(open(sys.argv[1])):
        w, g = evaluate(case); e = float(np.abs(w - g).max())
        if e > 1e-4: bad.append((case["name"], round(e, 4)))
    print("failures:", len(bad), bad)
