import random, sys
sys.path.insert(0, "gen"); from common import *
random.seed(51)
cases = []
axes = ["TRACK_X", "TRACK_Y", "TRACK_Z", "TRACK_NEGATIVE_X", "TRACK_NEGATIVE_Y", "TRACK_NEGATIVE_Z"]
for i, ax in enumerate(axes * 3):
    kind = ["object", "bone", "sheared"][i // 6]
    if kind == "bone":
        objs = [armature()]; base = {"owner": "Arm", "bone": "B", "target": "@Arm", "subtarget": "C", "head_tail": 1.0}
        sp = random.choice(["WORLD", "POSE", "LOCAL"]); base.update(owner_space=sp, target_space=sp)
    elif kind == "sheared":
        objs = [obj("T"), obj("OP", scale=[2.0, 0.6, 1.0]), obj("O", parent="OP")]; base = {"owner": "O", "target": "@T"}
    else:
        objs = [obj("T"), obj("O")]; base = {"owner": "O", "target": "@T"}
    cases.append({"name": f"{kind}_{ax}_{i}", "objects": objs, "constraints": [dict(base, type="DAMPED_TRACK", track_axis=ax, influence=1.0 if i % 4 else 0.6)]})
cases.append({"name": "opposite", "objects": [{"name": "O", "rot": [0, 0, 0]}, {"name": "T", "loc": [0, -3, 0]}], "constraints": [{"owner": "O", "type": "DAMPED_TRACK", "target": "@T", "track_axis": "TRACK_Y"}]})
cases.append({"name": "coincident", "objects": [{"name": "O", "rot": [10, 20, 30]}, {"name": "T"}], "constraints": [{"owner": "O", "type": "DAMPED_TRACK", "target": "@T", "track_axis": "TRACK_Y"}]})
save(cases, "oracle/damped_track.cases.json")
