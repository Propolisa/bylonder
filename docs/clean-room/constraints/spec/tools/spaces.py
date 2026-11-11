# Oracle: records Object.convert_space for random armatures and objects.
import bpy, sys, json, math, random
from mathutils import Matrix, Euler, Vector
out = sys.argv[sys.argv.index("--") + 1]
random.seed(7)
M = lambda m: [list(r) for r in m]
def rnd_mat():
    return Matrix.LocRotScale(Vector([random.uniform(-2, 2) for _ in range(3)]),
                              Euler([random.uniform(-3, 3) for _ in range(3)]),
                              Vector([random.uniform(0.5, 2) for _ in range(3)]))
results = []
modes = ["FULL", "FIX_SHEAR", "ALIGNED", "AVERAGE", "NONE", "NONE_LEGACY"]
for i in range(24):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    arm = bpy.data.objects.new("Arm", bpy.data.armatures.new("Arm"))
    bpy.context.scene.collection.objects.link(arm)
    arm.matrix_world = rnd_mat()
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    a = eb.new("A"); a.head = (0, 0, 0); a.tail = (0, 0.3, 1.2); a.roll = 0.4
    b = eb.new("B"); b.head = (0.2, 0.5, 1.5); b.tail = (1.1, 0.4, 2.0); b.roll = -0.7; b.parent = a
    b.use_connect = (i % 4 == 1)
    b.use_inherit_rotation = (i % 5 != 3)
    b.inherit_scale = modes[i % 6]
    b.use_local_location = (i % 7 != 2)
    flags = dict(use_connect=b.use_connect, use_inherit_rotation=b.use_inherit_rotation, inherit_scale=b.inherit_scale, use_local_location=b.use_local_location)
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.location = [random.uniform(-1, 1) for _ in range(3)]
        pb.rotation_euler = [random.uniform(-2, 2) for _ in range(3)]
        pb.scale = [random.uniform(0.5, 2) for _ in range(3)]
    custom = bpy.data.objects.new("Custom", None); bpy.context.scene.collection.objects.link(custom)
    custom.matrix_world = rnd_mat()
    bpy.context.view_layer.update()
    pb = arm.pose.bones["B"]
    x = rnd_mat()
    rec = {"flags": flags, "arm_world": M(arm.matrix_world), "custom_world": M(custom.matrix_world),
           "bones": {p.name: {"pose": M(p.matrix), "rest": M(p.bone.matrix_local), "basis": M(p.matrix_basis)} for p in arm.pose.bones},
           "x": M(x), "from_pose": {}, "to_pose": {}}
    for sp in ["WORLD", "POSE", "LOCAL_WITH_PARENT", "LOCAL", "LOCAL_OWNER_ORIENT"]:
        try:
            rec["from_pose"][sp] = M(arm.convert_space(pose_bone=pb, matrix=x, from_space="POSE", to_space=sp))
            rec["to_pose"][sp] = M(arm.convert_space(pose_bone=pb, matrix=x, from_space=sp, to_space="POSE"))
        except Exception as e:
            rec["from_pose"][sp] = str(e)
    results.append(rec)
# Objects
for i in range(8):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    par = bpy.data.objects.new("Par", None); ob = bpy.data.objects.new("Ob", None)
    for o in (par, ob): bpy.context.scene.collection.objects.link(o)
    par.matrix_world = rnd_mat()
    if i % 2: ob.parent = par; ob.matrix_parent_inverse = rnd_mat()
    ob.location = [random.uniform(-1, 1) for _ in range(3)]; ob.rotation_euler = [random.uniform(-2, 2) for _ in range(3)]; ob.scale = [random.uniform(.5, 2) for _ in range(3)]
    bpy.context.view_layer.update()
    x = rnd_mat()
    rec = {"object": True, "has_parent": bool(i % 2), "parent_world": M(par.matrix_world), "parent_inverse": M(ob.matrix_parent_inverse),
           "world": M(ob.matrix_world), "basis": M(ob.matrix_basis), "x": M(x), "from_world": {}, "to_world": {}}
    for sp in ["WORLD", "LOCAL"]:
        rec["from_world"][sp] = M(ob.convert_space(matrix=x, from_space="WORLD", to_space=sp))
        rec["to_world"][sp] = M(ob.convert_space(matrix=x, from_space=sp, to_space="WORLD"))
    results.append(rec)
json.dump(results, open(out, "w"), indent=1)
