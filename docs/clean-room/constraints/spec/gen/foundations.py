import json, random, math
random.seed(11)
def rv(a, b): return [round(random.uniform(a, b), 4) for _ in range(3)]
cases = []
# Influence blending: object Copy Transforms from random (sheared) target, several influences.
for i in range(12):
    infl = [0.0, 0.25, 0.5, 0.75, 1.0, 0.3][i % 6]
    objs = [{"name": "P", "loc": rv(-2, 2), "rot": rv(-180, 180), "scale": rv(0.3, 2.5)},
            {"name": "T", "parent": "P", "loc": rv(-2, 2), "rot": rv(-180, 180), "scale": rv(0.3, 2.5)} if i >= 6 else {"name": "T", "loc": rv(-2, 2), "rot": rv(-180, 180), "scale": rv(0.3, 2.5)},
            {"name": "O", "loc": rv(-2, 2), "rot": rv(-180, 180), "scale": rv(0.3, 2.5)}]
    cases.append({"name": f"influence_{i}", "objects": objs, "constraints": [{"owner": "O", "type": "COPY_TRANSFORMS", "target": "@T", "influence": infl}]})
# Stack order: Copy Location then Limit Distance vs reversed.
for order in (0, 1):
    cons = [{"owner": "O", "type": "COPY_LOCATION", "target": "@T"}, {"owner": "O", "type": "LIMIT_LOCATION", "use_max_x": True, "max_x": 0.5}]
    if order: cons.reverse()
    cases.append({"name": f"stack_order_{order}", "objects": [{"name": "T", "loc": [2, 1, 0]}, {"name": "O", "loc": [-1, 0, 0]}], "constraints": cons})
# Child of a constrained object follows the constrained matrix; constraint acts after parenting.
cases.append({"name": "object_parent_then_constraint", "objects": [
    {"name": "P", "loc": [1, 2, 3], "rot": [0, 0, 90]}, {"name": "T", "loc": [5, 0, 0]},
    {"name": "O", "parent": "P", "loc": [1, 0, 0]}, {"name": "C", "parent": "O", "loc": [0, 1, 0]}],
    "constraints": [{"owner": "O", "type": "COPY_LOCATION", "target": "@T", "use_y": False}]})
# Disabled constraint and missing target.
cases.append({"name": "muted", "objects": [{"name": "T", "loc": [2, 1, 0]}, {"name": "O"}], "constraints": [{"owner": "O", "type": "COPY_LOCATION", "target": "@T", "enabled": False}]})
cases.append({"name": "no_target", "objects": [{"name": "O", "loc": [1, 1, 1]}], "constraints": [{"owner": "O", "type": "COPY_LOCATION"}]})
# Bone owner: chain where the parent bone is constrained; the child follows.
arm = lambda CONNECT=False: {"name": "Arm", "kind": "ARMATURE", "loc": [0.5, 0, 0], "rot": [0, 0, 30], "scale": [1, 1, 1],
    "bones": [{"name": "A", "head": [0, 0, 0], "tail": [0, 0, 1]}, {"name": "B", "head": [0, 0, 1], "tail": [0, 1, 1.5], "parent": "A", "use_connect": CONNECT},
              {"name": "C", "head": [1, 0, 0], "tail": [1, 0, 1], "roll": 30}],
    "pose": {"A": {"rot": [10, 20, 30]}, "B": {"rot": [0, 0, 45], "scale": [1, 2, 1]}, "C": {"loc": [0.1, 0.2, 0.3], "rot": [5, 50, -20]}}}
cases.append({"name": "bone_parent_constrained", "objects": [arm(), {"name": "T", "loc": [2, 2, 2], "rot": [0, 90, 0]}],
              "constraints": [{"owner": "Arm", "bone": "A", "type": "COPY_ROTATION", "target": "@T"}]})
# Every space pair, bone owner and bone target, Copy Transforms (Arm.B copies Arm.C).
spaces = ["WORLD", "POSE", "LOCAL_WITH_PARENT", "LOCAL", "CUSTOM"]
for os_ in spaces:
    for ts in spaces + ["LOCAL_OWNER_ORIENT"]:
        c = {"owner": "Arm", "bone": "B", "type": "COPY_TRANSFORMS", "target": "@Arm", "subtarget": "C", "owner_space": os_, "target_space": ts, "influence": 1.0}
        if "CUSTOM" in (os_, ts): c["space_object"] = "@S"
        cases.append({"name": f"spaces_{os_}_{ts}", "objects": [arm(), {"name": "S", "loc": [0.3, -1, 2], "rot": [40, 10, -70], "scale": [1, 1.5, 0.7]}], "constraints": [c]})
# Object owner, object target, all object spaces; parented owner and target.
for os_ in ["WORLD", "LOCAL", "CUSTOM"]:
    for ts in ["WORLD", "LOCAL", "CUSTOM"]:
        for parented in (0, 1):
            objs = [{"name": "P", "loc": [1, -1, 0.5], "rot": [20, 0, 60], "scale": [1, 2, 1]}, {"name": "S", "loc": [0.3, -1, 2], "rot": [40, 10, -70]},
                    {"name": "T", "loc": [2, 0.5, -1], "rot": [10, 30, 50], "scale": [1.2, 0.8, 1.0]}, {"name": "O", "loc": [-1, 2, 0], "rot": [-30, 15, 5], "scale": [0.7, 0.7, 1.3]}]
            if parented: objs[2]["parent"] = "P"; objs[3]["parent"] = "P"
            c = {"owner": "O", "type": "COPY_TRANSFORMS", "target": "@T", "owner_space": os_, "target_space": ts}
            if "CUSTOM" in (os_, ts): c["space_object"] = "@S"
            cases.append({"name": f"objspaces_{os_}_{ts}_{'par' if parented else 'nopar'}", "objects": objs, "constraints": [c]})
# Bone target: head_tail and B-Bone shape.
for ht in (0.0, 0.5, 1.0):
    cases.append({"name": f"head_tail_{ht}", "objects": [arm(), {"name": "O"}], "constraints": [{"owner": "O", "type": "COPY_TRANSFORMS", "target": "@Arm", "subtarget": "B", "head_tail": ht}]})
# Vertex group target.
cases.append({"name": "vertex_group_target", "objects": [{"name": "M", "kind": "MESH", "loc": [1, 0, 0], "rot": [0, 0, 45], "scale": [2, 1, 1],
    "verts": [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], "faces": [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]], "groups": {"g": [0, 1, 0.5, 0]}}, {"name": "O"}],
    "constraints": [{"owner": "O", "type": "COPY_TRANSFORMS", "target": "@M", "subtarget": "g"}]})
json.dump(cases, open("oracle/foundations.cases.json", "w"), indent=1)
print(len(cases))
cases.append({"name": "connected_bone_keeps_head", "objects": [arm(True), {"name": "T", "loc": [2, 2, 2], "rot": [0, 90, 0]}],
              "constraints": [{"owner": "Arm", "bone": "B", "type": "COPY_TRANSFORMS", "target": "@T"}]})
json.dump(cases, open("oracle/foundations.cases.json", "w"), indent=1)
print(len(cases))
