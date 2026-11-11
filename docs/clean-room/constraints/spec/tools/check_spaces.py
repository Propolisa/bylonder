import json, numpy as np, sys
d = json.load(open(sys.argv[1]))
inv = np.linalg.inv
def err(a, b): return np.abs(np.array(a) - np.array(b)).max()
for i, r in enumerate(d):
    if r.get("object"): continue
    A, B = r["bones"]["A"], r["bones"]["B"]
    Pa, Ra, Pb, Rb = (np.array(m) for m in (A["pose"], A["rest"], B["pose"], B["rest"]))
    x = np.array(r["x"]); W = np.array(r["arm_world"])
    O = inv(Ra) @ Rb
    hyp = {"WORLD": W @ x, "POSE": x, "LOCAL_WITH_PARENT": inv(Rb) @ x, "LOCAL": inv(Pa @ O) @ x}
    print(i, r["flags"], {k: round(err(r["from_pose"][k], v), 5) for k, v in hyp.items()}, "basis-check", round(err(Pb, Pa @ O @ np.array(B["basis"])), 5))
