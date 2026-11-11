import random, sys
sys.path.insert(0, "gen"); from common import *
random.seed(111)
cases = []
for i in range(24):
    mode = ["LIMITDIST_INSIDE", "LIMITDIST_OUTSIDE", "LIMITDIST_ONSURFACE"][i % 3]
    dist = [0.0, round(random.uniform(0.5, 4), 3)][i % 4 != 0]
    objs = [obj("T"), obj("O"), obj("S")]; c = {"owner": "O", "type": "LIMIT_DISTANCE", "target": "@T", "limit_mode": mode, "distance": dist}
    if i % 6 == 5: c.update(owner_space="CUSTOM", target_space="CUSTOM", space_object="@S")
    if i % 7 == 6: c["influence"] = 0.5
    cases.append({"name": f"{mode}_{dist}_{i}", "objects": objs, "constraints": [c]})
for i in range(4):
    cases.append({"name": f"bone_custom_{i}", "objects": [armature(), obj("S", scale=[1.5, 1.5, 1.5])],
                  "constraints": [{"owner": "Arm", "bone": "B", "type": "LIMIT_DISTANCE", "target": "@Arm", "subtarget": "C", "owner_space": "CUSTOM", "target_space": "CUSTOM",
                                   "space_object": "@S", "distance": 0.5 + i * 0.3, "limit_mode": ["LIMITDIST_INSIDE", "LIMITDIST_OUTSIDE"][i % 2]}]})
save(cases, "oracle/limit_distance.cases.json")
