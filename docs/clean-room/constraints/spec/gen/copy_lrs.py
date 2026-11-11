import random, sys
sys.path.insert(0, "gen"); from common import *
random.seed(41)
def flags(rnd):
    f = {}
    for a in "xyz":
        f["use_" + a] = rnd.random() > 0.25; f["invert_" + a] = rnd.random() < 0.3
    return f
def scene(kind):
    if kind == "object": return [obj("T"), obj("O")], {"owner": "O", "target": "@T"}
    if kind == "sheared": return sheared_target() + [obj("O")], {"owner": "O", "target": "@T"}
    sp = random.choice(["LOCAL", "POSE", "WORLD", "LOCAL_WITH_PARENT"])
    return [armature()], {"owner": "Arm", "bone": "B", "target": "@Arm", "subtarget": "C", "owner_space": sp, "target_space": sp}
loc, rot, sca = [], [], []
for i in range(40):
    kind = ["object", "object", "sheared", "bone"][i % 4]
    objs, base = scene(kind)
    infl = 1.0 if i % 5 else round(random.uniform(0.2, 0.8), 3)
    loc.append({"name": f"loc_{kind}_{i}", "objects": objs, "constraints": [dict(base, type="COPY_LOCATION", use_offset=i % 3 == 0, influence=infl, **flags(random))]})
    objs, base = scene(kind)
    mix = ["REPLACE", "ADD", "BEFORE", "AFTER", "OFFSET"][i % 5]
    order = random.choice(["AUTO", "XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"])
    f = flags(random) if i % 2 else {}
    if kind != "bone" and random.random() < 0.5: objs[-1]["rotation_mode"] = random.choice(["ZXY", "YZX", "XYZ"])
    rot.append({"name": f"rot_{kind}_{mix}_{order}_{i}", "objects": objs, "constraints": [dict(base, type="COPY_ROTATION", mix_mode=mix, euler_order=order, influence=infl, **f)]})
    objs, base = scene(kind)
    f = {"use_" + a: random.random() > 0.25 for a in "xyz"}
    s = dict(base, type="COPY_SCALE", power=random.choice([1.0, 1.0, round(random.uniform(-2, 3), 3)]), use_make_uniform=i % 4 == 1,
             use_offset=i % 3 == 0, use_add=i % 6 == 0, influence=infl, **f)
    sca.append({"name": f"scale_{kind}_{i}", "objects": objs, "constraints": [s]})
save(loc, "oracle/copy_location.cases.json"); save(rot, "oracle/copy_rotation.cases.json"); save(sca, "oracle/copy_scale.cases.json")
