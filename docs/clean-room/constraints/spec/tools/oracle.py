# Black-box oracle: builds each case of a fixture file in Blender, evaluates it and records the matrices.
# blender -b --factory-startup --python oracle.py -- cases.json results.json
import bpy, sys, json, math
from mathutils import Matrix, Euler, Quaternion, Vector

args = sys.argv[sys.argv.index("--") + 1:]
cases = json.load(open(args[0]))

def mat(m):
    return [[round(v, 6) + 0.0 for v in row] for row in m]

def set_transform(t, spec):
    mode = spec.get("rotation_mode", "XYZ")
    t.rotation_mode = mode
    if "loc" in spec: t.location = spec["loc"]
    if "scale" in spec: t.scale = spec["scale"]
    if "rot" in spec:
        if mode == "QUATERNION": t.rotation_quaternion = spec["rot"]
        elif mode == "AXIS_ANGLE": t.rotation_axis_angle = spec["rot"]
        else: t.rotation_euler = [math.radians(a) for a in spec["rot"]]

def resolve(value):
    if isinstance(value, str) and value.startswith("@"):
        return bpy.data.objects[value[1:]]
    return value

def add_constraint(owner, c):
    con = owner.constraints.new(c["type"])
    for key, value in c.items():
        if key in ("type", "targets"): continue
        setattr(con, key, resolve(value))
    for t in c.get("targets", []):
        tgt = con.targets.new()
        tgt.target = resolve(t["target"])
        if "subtarget" in t: tgt.subtarget = t["subtarget"]
        if "weight" in t: tgt.weight = t["weight"]

def build(case):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    for spec in case.get("objects", []):
        kind = spec.get("kind", "EMPTY")
        data = None
        if kind == "ARMATURE":
            data = bpy.data.armatures.new(spec["name"])
        elif kind == "CURVE":
            data = bpy.data.curves.new(spec["name"], "CURVE")
            data.dimensions = "3D"
            data.use_path = True
            for k, v in spec.get("curve", {}).items():
                if k != "splines": setattr(data, k, v)
            for s in spec["curve"]["splines"]:
                sp = data.splines.new(s.get("type", "POLY"))
                if s.get("type") == "BEZIER":
                    sp.bezier_points.add(len(s["points"]) - 1)
                    for bp, p in zip(sp.bezier_points, s["points"]):
                        bp.co = p["co"]; bp.handle_left = p["left"]; bp.handle_right = p["right"]
                        bp.radius = p.get("radius", 1.0); bp.tilt = p.get("tilt", 0.0)
                else:
                    sp.points.add(len(s["points"]) - 1)
                    for pt, p in zip(sp.points, s["points"]):
                        pt.co = list(p["co"]) + [1.0]; pt.radius = p.get("radius", 1.0); pt.tilt = p.get("tilt", 0.0)
                    if s.get("type") == "NURBS":
                        sp.order_u = s.get("order", 4); sp.use_endpoint_u = s.get("endpoint", True)
                sp.use_cyclic_u = s.get("cyclic", False)
        elif kind == "MESH":
            data = bpy.data.meshes.new(spec["name"])
            data.from_pydata(spec["verts"], [], spec.get("faces", []))
        ob = bpy.data.objects.new(spec["name"], data)
        scene.collection.objects.link(ob)
        if kind == "MESH":
            for g, weights in spec.get("groups", {}).items():
                vg = ob.vertex_groups.new(name=g)
                for i, w in enumerate(weights):
                    if w: vg.add([i], w, "REPLACE")
        set_transform(ob, spec)
        if kind == "ARMATURE":
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.mode_set(mode="EDIT")
            for b in spec["bones"]:
                eb = data.edit_bones.new(b["name"])
                eb.head, eb.tail, eb.roll = b["head"], b["tail"], math.radians(b.get("roll", 0))
                if "parent" in b: eb.parent = data.edit_bones[b["parent"]]
                for k in ("use_connect", "use_inherit_rotation", "inherit_scale", "use_local_location", "bbone_segments"):
                    if k in b: setattr(eb, k, b[k])
            bpy.ops.object.mode_set(mode="OBJECT")
            for name, p in spec.get("pose", {}).items():
                pb = ob.pose.bones[name]
                set_transform(pb, p)
                for k in ("ik_stretch", "lock_ik_x", "lock_ik_y", "lock_ik_z", "ik_stiffness_x", "ik_stiffness_y", "ik_stiffness_z",
                          "use_ik_limit_x", "use_ik_limit_y", "use_ik_limit_z", "ik_min_x", "ik_max_x", "ik_min_y", "ik_max_y", "ik_min_z", "ik_max_z"):
                    if k in p: setattr(pb, k, p[k])
    for spec in case.get("objects", []):
        ob = bpy.data.objects[spec["name"]]
        if "parent" in spec:
            ob.parent = bpy.data.objects[spec["parent"]]
            if "parent_bone" in spec:
                ob.parent_type = "BONE"; ob.parent_bone = spec["parent_bone"]
            if "parent_inverse" in spec: ob.matrix_parent_inverse = Matrix(spec["parent_inverse"])
    for c in case.get("constraints", []):
        ob = bpy.data.objects[c["owner"]]
        owner = ob.pose.bones[c["bone"]] if "bone" in c else ob
        add_constraint(owner, {k: v for k, v in c.items() if k not in ("owner", "bone")})
    if "armature_ik_solver" in case:
        for ob in bpy.data.objects:
            if ob.pose: ob.pose.ik_solver = case["armature_ik_solver"]
    scene.frame_set(case.get("frame", 1))

def record():
    bpy.context.view_layer.update()
    out = {}
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in bpy.data.objects:
        e = ob.evaluated_get(dg)
        r = {"matrix_world": mat(e.matrix_world)}
        if e.pose:
            r["bones"] = {pb.name: {"pose": mat(pb.matrix), "rest": mat(pb.bone.matrix_local)} for pb in e.pose.bones}
        out[ob.name] = r
    return out

def constraint_state():
    out = {}
    for ob in bpy.data.objects:
        owners = [(ob.name, ob)] + ([(ob.name + ":" + pb.name, pb) for pb in ob.pose.bones] if ob.pose else [])
        for key, owner in owners:
            for con in owner.constraints:
                vals = {}
                for p in con.bl_rna.properties:
                    if p.type == "FLOAT":
                        v = getattr(con, p.identifier)
                        vals[p.identifier] = [round(x, 6) for x in (v if not hasattr(v, "col") else [x for r in v for x in r])] if hasattr(v, "__len__") else round(v, 6)
                out.setdefault(key, {})[con.name] = vals
    return out

def all_constraints():
    for ob in bpy.data.objects:
        yield from ob.constraints
        if ob.pose:
            for pb in ob.pose.bones: yield from pb.constraints

results = []
for case in cases:
    build(case)
    try:
        output = record()
        state = constraint_state()
        for con in all_constraints(): con.enabled = False
        results.append({"name": case["name"], "input": case, "output": output, "constraints_after": state, "unconstrained": record()})
    except Exception as e:
        results.append({"name": case["name"], "input": case, "error": str(e)})
json.dump(results, open(args[1], "w"), indent=1)
print("ORACLE", len(results), "cases")
