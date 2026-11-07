# Saves a typical user's .blend from Blender's startup scene: the Default Cube with a Bevel and a Subdivision Surface
# modifier and a red Principled material, a second object in a collection of its own with an Array modifier, a sun,
# a text object, a dim blue world, the ball turned and keyed on two axes in XYZ Euler, the camera moved, location keys on the cube, and a light parented to a bone with Ctrl P (which keeps
# a parent inverse).
# usage: blender -b --factory-startup --python tools/blender-reference/user-file.py -- OUT.blend
import bpy, sys

out = sys.argv[sys.argv.index("--") + 1]
scene = bpy.context.scene
cube = bpy.data.objects["Cube"]
cube.modifiers.new("Bevel", "BEVEL").width = 0.1
cube.modifiers.new("Subdivision", "SUBSURF").levels = 2
material = bpy.data.materials.new("Red")
material.use_nodes = True
principled = material.node_tree.nodes["Principled BSDF"]
principled.inputs["Base Color"].default_value = (0.8, 0.05, 0.05, 1)
principled.inputs["Roughness"].default_value = 0.3
principled.inputs["Metallic"].default_value = 0.2
cube.data.materials[0] = material

props = bpy.data.collections.new("Props")
scene.collection.children.link(props)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, location=(2.5, 0, 0.5))
sphere = bpy.context.object
sphere.name = "Ball"
for c in sphere.users_collection:
    c.objects.unlink(sphere)
props.objects.link(sphere)
sphere.rotation_euler = (0.4, 0.9, 1.2)
sphere.keyframe_insert("rotation_euler", frame=1)
sphere.rotation_euler = (1.4, 2.9, 1.2)
sphere.keyframe_insert("rotation_euler", frame=40)
sphere.rotation_euler = (0.4, 0.9, 1.2)
array = sphere.modifiers.new("Array", "ARRAY")
array.count = 3
array.relative_offset_displace = (0, 1.5, 0)

bpy.ops.object.light_add(type="SUN", location=(0, 0, 6))
bpy.context.object.data.energy = 3
bpy.ops.object.text_add(location=(-3, 0, 0))
bpy.context.object.data.body = "Hello"
bpy.data.objects["Camera"].location = (8, -7, 5)
background = scene.world.node_tree.nodes["Background"]
background.inputs["Color"].default_value = (0.2, 0.3, 0.6, 1)
background.inputs["Strength"].default_value = 0.35

bpy.ops.object.armature_add(location=(4, 0, 0))
rig = bpy.context.object
rig.name = "Rig"
bpy.ops.object.light_add(type="POINT", location=(4.5, -1, 1.5))
lamp = bpy.context.object
lamp.name = "Lamp"
bpy.ops.object.select_all(action="DESELECT")
lamp.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
rig.data.bones.active = rig.data.bones["Bone"]
bpy.ops.object.parent_set(type="BONE")
bpy.ops.object.mode_set(mode="OBJECT")

cube.location = (0, 0, 0)
cube.keyframe_insert("location", frame=1)
cube.location = (0, 0, 2)
cube.keyframe_insert("location", frame=40)
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=out)
