import random, sys
sys.path.insert(0, "gen"); from common import *
random.seed(101)
cases = []
tracks = ["TRACK_X", "TRACK_Y", "TRACK_Z", "TRACK_NEGATIVE_X", "TRACK_NEGATIVE_Y", "TRACK_NEGATIVE_Z"]
for i in range(30):
    tr = tracks[i % 6]; up = ["UP_X", "UP_Y", "UP_Z"][(i // 6) % 3]
    if tr[-1] == up[-1]: up = "UP_Z" if up != "UP_Z" else "UP_Y"
    kind = ["object", "object", "bone"][i % 3]
    if kind == "bone":
        objs = [armature()]; base = {"owner": "Arm", "bone": "B", "target": "@Arm", "subtarget": "C"}
    else:
        objs = [obj("T"), obj("O")]; base = {"owner": "O", "target": "@T"}
    cases.append({"name": f"{kind}_{tr}_{up}_{i}", "objects": objs, "constraints": [dict(base, type="TRACK_TO", track_axis=tr, up_axis=up, use_target_z=i % 4 == 1, influence=1.0 if i % 5 else 0.5)]})
cases.append({"name": "camera_default", "objects": [{"name": "T", "loc": [0, 0, 0]}, {"name": "O", "loc": [7, -6, 5], "scale": [1, 2, 1]}], "constraints": [{"owner": "O", "type": "TRACK_TO", "target": "@T"}]})
cases.append({"name": "up_parallel", "objects": [{"name": "T", "loc": [0, 0, 5]}, {"name": "O"}], "constraints": [{"owner": "O", "type": "TRACK_TO", "target": "@T", "track_axis": "TRACK_NEGATIVE_Z", "up_axis": "UP_Y"}]})
cases.append({"name": "track_parallel_world_z", "objects": [{"name": "T", "loc": [0, 0, 5]}, {"name": "O"}], "constraints": [{"owner": "O", "type": "TRACK_TO", "target": "@T", "track_axis": "TRACK_Y", "up_axis": "UP_Z"}]})
save(cases, "oracle/track_to.cases.json")
