import random, sys, math
sys.path.insert(0, "gen"); from common import *
random.seed(81)
cases = []
for i in range(48):
    lims = {}
    for a in "xyz":
        if random.random() < 0.7:
            lo = random.uniform(-3.0, 2.5); hi = lo + random.uniform(0.05, 3.0)
            lims.update({f"use_limit_{a}": True, f"min_{a}": round(lo, 4), f"max_{a}": round(min(hi, 3.1), 4)})
    kind = ["object", "bone"][i % 2]
    if kind == "object":
        o = obj("O"); objs = [o]; base = {"owner": "O"}
        if i % 3 == 0: o["rotation_mode"] = random.choice(["ZXY", "YZX"])
    else:
        objs = [armature()]; sp = random.choice(["LOCAL", "WORLD", "POSE"]); base = {"owner": "Arm", "bone": "B", "owner_space": sp}
    c = dict(base, type="LIMIT_ROTATION", euler_order=random.choice(["AUTO", "AUTO", "XYZ", "ZYX", "YXZ"]), use_legacy_behavior=i % 4 == 3,
             influence=1.0 if i % 5 else 0.5, **lims)
    cases.append({"name": f"{kind}_{'legacy' if c['use_legacy_behavior'] else 'new'}_{i}", "objects": objs, "constraints": [c]})
cases.append({"name": "manual_340", "objects": [{"name": "O", "rot": [340, 0, 0]}], "constraints": [{"owner": "O", "type": "LIMIT_ROTATION", "use_limit_x": True, "min_x": 0.0, "max_x": round(math.pi / 2, 6)}]})
cases.append({"name": "no_limits_sheared", "objects": [obj("OP", scale=[2, 0.6, 1]), obj("O", parent="OP")], "constraints": [{"owner": "O", "type": "LIMIT_ROTATION"}]})
save(cases, "oracle/limit_rotation.cases.json")
