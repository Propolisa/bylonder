import random, sys
sys.path.insert(0, "gen"); from common import *
random.seed(121)
I = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
cases = []
for i in range(24):
    flags = {}
    if i >= 8:
        for g in ("location", "rotation", "scale"):
            for a in "xyz": flags[f"use_{g}_{a}"] = random.random() > 0.3
    kind = "bone" if i % 4 == 3 else "object"
    if kind == "bone":
        objs = [armature(), obj("T")]; sp = random.choice(["POSE", "WORLD", "LOCAL"])
        base = {"owner": "Arm", "bone": "B", "target": "@T", "owner_space": sp}
    else:
        objs = [obj("T"), obj("O")]; base = {"owner": "O", "target": "@T"}
    pending = i % 3 == 0
    c = dict(base, type="CHILD_OF", set_inverse_pending=pending, **flags)
    if not pending: c["inverse_matrix"] = I
    if i % 5 == 4: c["influence"] = 0.5
    cases.append({"name": f"{kind}_{'pending' if pending else 'identity'}_{'flags' if flags else 'all'}_{i}", "objects": objs, "constraints": [c]})
save(cases, "oracle/child_of.cases.json")
