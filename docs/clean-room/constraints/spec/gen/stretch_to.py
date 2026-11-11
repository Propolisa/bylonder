import random, sys
sys.path.insert(0, "gen"); from common import *
random.seed(31)
cases = []
i = 0
for keep in ["PLANE_X", "PLANE_Z", "SWING_Y"]:
    for vol in ["VOLUME_XZX", "VOLUME_X", "VOLUME_Z", "NO_VOLUME"]:
        for rl in (0.0, 1.7):
            i += 1
            cases.append({"name": f"object_{keep}_{vol}_rest{rl}", "objects": [obj("T"), obj("O")],
                          "constraints": [{"owner": "O", "type": "STRETCH_TO", "target": "@T", "keep_axis": keep, "volume": vol, "rest_length": rl,
                                           "bulge": round(random.choice([1.0, random.uniform(0.2, 3)]), 3)}]})
for j in range(12):
    lim = {"use_bulge_min": j % 2 == 0, "use_bulge_max": j % 3 != 2, "bulge_min": round(random.uniform(0.2, 1), 3), "bulge_max": round(random.uniform(1, 3), 3),
           "bulge_smooth": round(random.choice([0, 0, random.uniform(0, 1)]), 3)}
    T = obj("T"); 
    cases.append({"name": f"limits_{j}", "objects": [T, obj("O")],
                  "constraints": [dict({"owner": "O", "type": "STRETCH_TO", "target": "@T", "volume": ["VOLUME_XZX", "VOLUME_X", "VOLUME_Z"][j % 3],
                                        "rest_length": round(random.uniform(0.3, 6), 3), "bulge": round(random.uniform(0.5, 2), 3)}, **lim)]})
for keep in ["PLANE_X", "PLANE_Z", "SWING_Y"]:
    for sp in ["WORLD", "POSE", "LOCAL"]:
        for rl in (0.0, 1.3):
            cases.append({"name": f"bone_{keep}_{sp}_rest{rl}", "objects": [armature(), obj("T")],
                          "constraints": [{"owner": "Arm", "bone": "B", "type": "STRETCH_TO", "target": "@Arm", "subtarget": "C", "head_tail": 1.0,
                                           "keep_axis": keep, "owner_space": sp, "target_space": sp, "rest_length": rl}]})
cases.append({"name": "influence_half", "objects": [obj("T"), obj("O")], "constraints": [{"owner": "O", "type": "STRETCH_TO", "target": "@T", "rest_length": 2.0, "influence": 0.5}]})
cases.append({"name": "target_at_owner", "objects": [obj("O", loc=[1, 1, 1]), obj("T", loc=[1, 1, 1])], "constraints": [{"owner": "O", "type": "STRETCH_TO", "target": "@T", "rest_length": 1.0}]})
save(cases, "oracle/stretch_to.cases.json")
