import bpy, sys
bpy.ops.preferences.addon_enable(module="rigify")
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
bpy.ops.object.armature_human_metarig_add()
meta = bpy.context.object
bpy.ops.pose.rigify_generate()
rig = [o for o in bpy.data.objects if o.type == 'ARMATURE' and o != meta][0]
bpy.data.objects.remove(meta)
cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera")); bpy.context.scene.collection.objects.link(cam)
cam.location = (0, -1.0, 1.66); cam.rotation_euler = (1.5708, 0, 0); cam.data.lens = 50; bpy.context.scene.camera = cam
print("BONES", len(rig.data.bones), "DRIVERS", len(rig.animation_data.drivers) if rig.animation_data else 0, "CONSTRAINTS", sum(len(p.constraints) for p in rig.pose.bones), "WGTS", len([o for o in bpy.data.objects if o.name.startswith("WGT")]))
bpy.ops.wm.save_as_mainfile(filepath=sys.argv[-1])
