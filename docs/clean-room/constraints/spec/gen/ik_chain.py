import random, sys, math
sys.path.insert(0, "gen"); from common import *
random.seed(71)
def chain(n, bend=0.12):
    bones = []; z = 0.0
    for k in range(n):
        h = [0, bend * (k % 2), z]; z += 0.8; t = [0, bend * ((k + 1) % 2), z]
        b = {"name": f"B{k}", "head": h, "tail": t, "roll": 0}
        if k: b.update(parent=f"B{k-1}", use_connect=True)
        bones.append(b)
    return {"name": "Arm", "kind": "ARMATURE", "loc": [0, 0, 0], "rot": [0, 0, 0], "scale": [1, 1, 1], "bones": bones, "pose": {}}
cases = []
for n in (3, 4, 6):
    for i in range(4):
        t = rv(-1.5, 1.5); t[2] = abs(t[2]) + 0.5
        objs = [chain(n), {"name": "T", "loc": t}]
        c = {"owner": "Arm", "bone": f"B{n-1}", "type": "IK", "target": "@T", "chain_count": 0 if i == 3 else n}
        if i % 2: objs.append({"name": "P", "loc": rv(-3, 3)}); c["pole_target"] = "@P"
        cases.append({"name": f"chain{n}_{i}{'_pole' if i % 2 else ''}", "objects": objs, "constraints": [c]})
# Per-bone IK settings on a 3-bone chain.
for name, pose in [("lock_x_B1", {"B1": {"lock_ik_x": True}}), ("stiff_B0", {"B0": {"ik_stiffness_x": 0.9, "ik_stiffness_y": 0.9, "ik_stiffness_z": 0.9}}),
                   ("limit_B1", {"B1": {"use_ik_limit_x": True, "ik_min_x": -0.2, "ik_max_x": 0.2}})]:
    a = chain(3); a["pose"] = pose
    cases.append({"name": name, "objects": [a, {"name": "T", "loc": [0.9, 0.5, 1.2]}], "constraints": [{"owner": "Arm", "bone": "B2", "type": "IK", "target": "@T", "chain_count": 3}]})
save(cases, "oracle/ik_chain.cases.json")
