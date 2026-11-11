import random, sys, math
sys.path.insert(0, "gen"); from common import *
random.seed(61)
def arm2(bend=0.15, roll=0, pose=None, stretch=0.0):
    a = {"name": "Arm", "kind": "ARMATURE", "loc": [0, 0, 0], "rot": [0, 0, 0], "scale": [1, 1, 1],
         "bones": [{"name": "Up", "head": [0, 0, 0], "tail": [0, bend, 1], "roll": roll},
                   {"name": "Lo", "head": [0, bend, 1], "tail": [0, 0, 2.1], "roll": roll, "parent": "Up", "use_connect": True}],
         "pose": pose or {}}
    for b in ("Up", "Lo"):
        a["pose"].setdefault(b, {})["ik_stretch"] = stretch
    return a
cases = []
for i in range(16):
    t = rv(-1.4, 1.4); t[2] = abs(t[2]) + 0.3
    p = rv(-3, 3)
    cases.append({"name": f"pole_{i}", "objects": [arm2(roll=random.choice([0, 30, -60])), {"name": "T", "loc": t}, {"name": "P", "loc": p}],
                  "constraints": [{"owner": "Arm", "bone": "Lo", "type": "IK", "target": "@T", "pole_target": "@P", "chain_count": 2,
                                   "pole_angle": round(math.radians(random.choice([0, 0, 90, -90, 37])), 6)}]})
for i in range(6):
    t = rv(-1.4, 1.4); t[2] = abs(t[2]) + 0.3
    pose = {"Up": {"rot": rv(-30, 30)}, "Lo": {"rot": rv(-30, 30)}}
    cases.append({"name": f"nopole_{i}", "objects": [arm2(pose=pose), {"name": "T", "loc": t}],
                  "constraints": [{"owner": "Arm", "bone": "Lo", "type": "IK", "target": "@T", "chain_count": 2}]})
for i, t in enumerate([[0, 0, 4], [1, 1, 3], [0, 3, 0]]):
    for st in (0.0, 0.5, 1.0):
        cases.append({"name": f"unreachable_{i}_stretch{st}", "objects": [arm2(stretch=st), {"name": "T", "loc": t}, {"name": "P", "loc": [0, 2, 0]}],
                      "constraints": [{"owner": "Arm", "bone": "Lo", "type": "IK", "target": "@T", "pole_target": "@P", "chain_count": 2}]})
for f in (0.25, 0.5, 0.75):
    cases.append({"name": f"influence_{f}", "objects": [arm2(), {"name": "T", "loc": [0.8, 0.2, 1.2]}, {"name": "P", "loc": [0, 2, 0]}],
                  "constraints": [{"owner": "Arm", "bone": "Lo", "type": "IK", "target": "@T", "pole_target": "@P", "chain_count": 2, "influence": f}]})
cases.append({"name": "use_head", "objects": [arm2(), {"name": "T", "loc": [0.5, 0.2, 1.2]}, {"name": "P", "loc": [0, 2, 0]}],
              "constraints": [{"owner": "Arm", "bone": "Lo", "type": "IK", "target": "@T", "pole_target": "@P", "chain_count": 2, "use_tail": False}]})
cases.append({"name": "rotation", "objects": [arm2(), {"name": "T", "loc": [0.8, 0.2, 1.2], "rot": [30, 60, 10]}, {"name": "P", "loc": [0, 2, 0]}],
              "constraints": [{"owner": "Arm", "bone": "Lo", "type": "IK", "target": "@T", "pole_target": "@P", "chain_count": 2, "use_rotation": True}]})
save(cases, "oracle/ik_two_bone.cases.json")
