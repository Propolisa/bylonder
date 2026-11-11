import sys; sys.path.insert(0, "gen"); from common import *
def chain(lengths):
    bones = []; z = 0.0
    for k, L in enumerate(lengths):
        b = {"name": f"B{k}", "head": [0, 0, z], "tail": [0, 0, z + L], "roll": 0}; z += L
        if k: b.update(parent=f"B{k-1}", use_connect=True)
        bones.append(b)
    return {"name": "Arm", "kind": "ARMATURE", "loc": [0, 0, 0], "rot": [0, 0, 0], "scale": [1, 1, 1], "bones": bones, "pose": {}}
poly = {"name": "C", "kind": "CURVE", "curve": {"splines": [{"type": "POLY", "points": [{"co": [0, 0, 0]}, {"co": [1, 0, 1]}, {"co": [1, 1, 2]}, {"co": [0, 2, 2.5]}]}]}}
bez = {"name": "C", "kind": "CURVE", "curve": {"splines": [{"type": "BEZIER", "points": [
    {"co": [0, 0, 0], "left": [0, 0, -1], "right": [0, 0, 1]}, {"co": [1, 1, 2], "left": [0.5, 1, 1.5], "right": [1.5, 1, 2.5], "radius": 2.0, "tilt": 0.5}]}]}}
cases = []
for cname, curve in (("poly", poly), ("bezier", bez)):
    for lens, lname in (([1, 1, 1, 1], "even"), ([0.5, 1, 1.5, 1], "uneven")):
        for opts in ({}, {"use_even_divisions": True}, {"y_scale_mode": "NONE"}, {"y_scale_mode": "BONE_ORIGINAL"}, {"use_chain_offset": True},
                     {"xz_scale_mode": "INVERSE_PRESERVE"}, {"xz_scale_mode": "VOLUME_PRESERVE"}, {"use_curve_radius": False}):
            cases.append({"name": f"{cname}_{lname}_{'_'.join(f'{k}={v}' for k, v in opts.items()) or 'default'}",
                          "objects": [chain(lens), curve], "constraints": [dict({"owner": "Arm", "bone": "B3", "type": "SPLINE_IK", "target": "@C", "chain_count": 4}, **opts)]})
save(cases, "oracle/spline_ik.cases.json")
