"""Robot Arm: a small workshop robot arm to pose, reaching for a brass gear on a workbench at night.

The arm is one mesh skinned to an armature (Base, Lower Arm, Upper Arm, Head), each part weighted fully to its bone,
so rotating a bone in Pose Mode bends the arm at that joint. The work light in its head is parented to the Head bone
and follows it; a cool window light fills the room.

blender -b --factory-startup -P robot-arm.py   (writes robot-arm.blend beside this file)
"""
import math
import os

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.resolution_x, scene.render.resolution_y = 1080, 1350


def material(name, color, roughness=0.5, metallic=0.0, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def part(add, mat, group=None, smooth=True, **kwargs):
    add(**kwargs)
    ob = bpy.context.object
    ob.data.materials.append(mat)
    if smooth:
        bpy.ops.object.shade_smooth()
    if group:
        ob.vertex_groups.new(name=group).add(range(len(ob.data.vertices)), 1.0, "REPLACE")
    return ob


def rod(a, b, radius, mat, group, vertices=12):
    a, b = Vector(a), Vector(b)
    return part(bpy.ops.mesh.primitive_cylinder_add, mat, group, vertices=vertices, radius=radius, depth=(b - a).length,
                location=(a + b) / 2, rotation=(b - a).to_track_quat("Z", "Y").to_euler())


def join(name, parts):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = ob.data.name = name
    return ob


enamel = material("Safety Orange", (0.8, 0.22, 0.02, 1), roughness=0.3)
steel = material("Steel", (0.75, 0.75, 0.78, 1), roughness=0.25, metallic=1.0)
bulb = material("Ring Light", (1, 0.9, 0.7, 1), roughness=0.2, emission=(1.0, 0.8, 0.5, 1), strength=30)
oak = material("Bench Steel", (0.08, 0.085, 0.09, 1), roughness=0.35, metallic=1.0)
paper = material("Brass", (0.8, 0.55, 0.2, 1), roughness=0.25, metallic=1.0)
cover = material("Rubber Mat", (0.02, 0.02, 0.02, 1), roughness=0.8)
ceramic = material("Ceramic", (0.9, 0.86, 0.78, 1), roughness=0.15)
wall = material("Wall", (0.18, 0.2, 0.24, 1), roughness=0.9)

# The joints: base swivel, shoulder, elbow, wrist.
SHOULDER, ELBOW, WRIST, TIP = (0, 0, 0.09), (0.14, 0, 0.42), (0.44, 0, 0.5), (0.5, 0, 0.42)
arm_parts = [
    part(bpy.ops.mesh.primitive_cylinder_add, enamel, "Base", vertices=48, radius=0.11, depth=0.035, location=(0, 0, 0.0175)),
    part(bpy.ops.mesh.primitive_cylinder_add, steel, "Base", vertices=24, radius=0.03, depth=0.06, location=(0, 0, 0.06)),
    part(bpy.ops.mesh.primitive_uv_sphere_add, steel, "Lower Arm", radius=0.022, location=SHOULDER),
    part(bpy.ops.mesh.primitive_uv_sphere_add, steel, "Upper Arm", radius=0.02, location=ELBOW),
    part(bpy.ops.mesh.primitive_uv_sphere_add, steel, "Head", radius=0.018, location=WRIST),
]
for side in (-0.018, 0.018):
    arm_parts.append(rod((SHOULDER[0], side, SHOULDER[2]), (ELBOW[0], side, ELBOW[2]), 0.007, enamel, "Lower Arm"))
    arm_parts.append(rod((ELBOW[0], side, ELBOW[2]), (WRIST[0], side, WRIST[2]), 0.006, enamel, "Upper Arm"))
arm_parts.append(rod((0.03, 0, 0.13), (0.3, 0, 0.47), 0.0025, steel, "Lower Arm", vertices=6))
# The head: a motor housing along the wrist-to-tip axis, a ring light at its end and two gripper fingers.
axis = Vector(TIP) - Vector(WRIST)
along = axis.normalized()
facing = axis.to_track_quat("Z", "Y").to_euler()
arm_parts.append(part(bpy.ops.mesh.primitive_cylinder_add, enamel, "Head", vertices=32, radius=0.035, depth=0.07, location=Vector(WRIST) + along * 0.035, rotation=facing))
arm_parts.append(part(bpy.ops.mesh.primitive_torus_add, bulb, "Head", major_radius=0.03, minor_radius=0.005, location=Vector(WRIST) + along * 0.072, rotation=facing))
side = along.cross(Vector((0, 1, 0))).normalized()
for k in (-1, 1):
    tip = Vector(WRIST) + along * 0.11 + side * k * 0.018
    arm_parts.append(rod(Vector(WRIST) + along * 0.07 + side * k * 0.022, tip, 0.006, steel, "Head", vertices=8))
arm = join("Robot Arm", arm_parts)

armature = bpy.data.armatures.new("Arm Rig")
rig = bpy.data.objects.new("Arm Rig", armature)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
parent = None
for name, head, tail in [("Base", (0, 0, 0), SHOULDER), ("Lower Arm", SHOULDER, ELBOW), ("Upper Arm", ELBOW, WRIST), ("Head", WRIST, TIP)]:
    bone = armature.edit_bones.new(name)
    bone.head, bone.tail = head, tail
    bone.parent, bone.use_connect = parent, parent is not None
    parent = bone
bpy.ops.object.mode_set(mode="OBJECT")
armature.display_type = "STICK"
arm.parent = rig
arm.modifiers.new("Armature", "ARMATURE").object = rig

spot = bpy.data.lights.new("Work Light", "SPOT")
spot.energy, spot.color, spot.spot_size, spot.spot_blend, spot.shadow_soft_size = 40, (1.0, 0.78, 0.5), math.radians(80), 0.35, 0.03
light = bpy.data.objects.new("Work Light", spot)
scene.collection.objects.link(light)
light.parent, light.parent_type, light.parent_bone = rig, "BONE", "Head"
# Relative to the Head bone's tail, pointing along the bone (a light shines down its local -Z).
light.location = (0, -0.03, 0)
light.rotation_euler = (math.radians(90), 0, 0)

# A pose: the arm turned toward the gear, its head bent down over it.
rig.location = (0.32, 0.18, 0.0)
rig.rotation_euler = (0, 0, math.radians(200))
pose = rig.pose.bones
pose["Base"].rotation_mode = pose["Lower Arm"].rotation_mode = pose["Upper Arm"].rotation_mode = pose["Head"].rotation_mode = "XYZ"
pose["Lower Arm"].rotation_euler = (math.radians(-8), 0, 0)
pose["Upper Arm"].rotation_euler = (math.radians(-18), 0, 0)
pose["Head"].rotation_euler = (math.radians(-35), 0, 0)

bpy.ops.mesh.primitive_cube_add(location=(0, 0, -0.02), scale=(0.9, 0.5, 0.02))
desk = bpy.context.object
desk.name = desk.data.name = "Workbench"
desk.data.materials.append(oak)
bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0.5, 1.0), rotation=(math.radians(90), 0, 0))
bpy.context.object.name = "Wall"
bpy.context.object.data.materials.append(wall)

part(bpy.ops.mesh.primitive_cube_add, cover, None, False, location=(-0.2, 0.04, 0.002), scale=(0.24, 0.17, 0.002)).name = "Mat"
teeth = [part(bpy.ops.mesh.primitive_cylinder_add, paper, None, vertices=48, radius=0.075, depth=0.02, location=(-0.18, 0.04, 0.014))]
for k in range(18):
    a = 2 * math.pi * k / 18
    teeth.append(part(bpy.ops.mesh.primitive_cube_add, paper, None, False, location=(-0.18 + 0.08 * math.cos(a), 0.04 + 0.08 * math.sin(a), 0.014),
                      scale=(0.012, 0.008, 0.01), rotation=(0, 0, a)))
gear = join("Gear", teeth)
bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.022, depth=0.03, location=(-0.18, 0.04, 0.016))
bpy.context.object.name = "Axle"
bpy.context.object.data.materials.append(steel)
mug = part(bpy.ops.mesh.primitive_cylinder_add, ceramic, None, vertices=48, radius=0.04, depth=0.1, location=(0.55, -0.12, 0.05))
mug.name = "Oil Can"
pencil = rod((-0.05, -0.28, 0.006), (0.12, -0.22, 0.006), 0.004, material("Pencil", (0.95, 0.65, 0.05, 1), 0.4), None, vertices=6)
pencil.name = "Pencil"

window = bpy.data.lights.new("Window", "AREA")
window.energy, window.color, window.size = 60, (0.45, 0.6, 1.0), 1.2
window_ob = bpy.data.objects.new("Window", window)
window_ob.location, window_ob.rotation_euler = (-1.4, -0.6, 1.1), (math.radians(60), 0, math.radians(-60))
scene.collection.objects.link(window_ob)

world = bpy.data.worlds.new("Night")
world.color = (0.01, 0.012, 0.02)
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.02, 0.025, 0.045, 1)
scene.world = world

camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
camera.data.lens = 45
camera.location = (-0.75, -1.05, 0.55)
camera.rotation_euler = (math.radians(72), 0, math.radians(-36))
scene.collection.objects.link(camera)
scene.camera = camera

bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
# Saved in Pose Mode with the Upper Arm bone active, ready to pose.
bpy.ops.object.mode_set(mode="POSE")
for bone in rig.pose.bones:
    bone.select = bone.name == "Upper Arm"
armature.bones.active = armature.bones["Upper Arm"]
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "robot-arm.blend"), compress=True)
