"""Array Modifiers: a spiral stair in a round stone tower, seen from below, lit by the sun through a skylight and by wall lamps.

One step is one beveled box. Its modifier stack (Bevel, then Array with an Object Offset) turns it into the whole
flight: each copy is placed by the Turn empty, which is raised and rotated around the tower's axis. The banister posts
use the same Array on a thin cylinder, and the handrail is a ring segment repeated the same way.

blender -b --factory-startup -P arrays.py   (writes arrays.blend beside this file)
"""
import math
import os

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
STEPS, RISE, TURN = 44, 0.19, math.radians(16)


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


def named(name, materials=()):
    ob = bpy.context.object
    ob.name = ob.data.name = name
    for m in materials:
        ob.data.materials.append(m)
    return ob


def spiral(ob, turn):
    """The object's origin moved to the tower's axis, where the Turn empty's rotation pivots, then the Array."""
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    array = ob.modifiers.new("Array", "ARRAY")
    array.count = STEPS
    array.use_relative_offset = False
    array.use_object_offset = True
    array.offset_object = turn
    return array


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.resolution_x, scene.render.resolution_y = 1080, 1350
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = -0.4

# The Turn empty: one step's rise and rotation, the offset every Array copy adds.
turn = bpy.data.objects.new("Turn", None)
turn.empty_display_type = "ARROWS"
turn.location = (0, 0, RISE)
turn.rotation_euler = (0, 0, TURN)
scene.collection.objects.link(turn)

stone = material("Sandstone", (0.62, 0.5, 0.38, 1), roughness=0.75)
oak = material("Oak", (0.5, 0.28, 0.13, 1), roughness=0.4)
brass = material("Brass", (0.85, 0.62, 0.3, 1), roughness=0.25, metallic=1.0)
plaster = material("Plaster", (0.2, 0.18, 0.16, 1), roughness=0.9)

bpy.ops.mesh.primitive_cube_add(location=(1.55, 0, 0.09), scale=(1.0, 0.36, 0.09))
step = named("Step", [oak])
bevel = step.modifiers.new("Bevel", "BEVEL")
bevel.width, bevel.segments = 0.025, 3
spiral(step, turn)

bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.018, depth=1.0, location=(0.7, 0, 0.68))
named("Baluster", [brass])
spiral(bpy.context.object, turn)

# The handrail: a slanted bar from one post to the next, so the Array makes a continuous rail.
p0 = Vector((0.7, 0, 1.18))
p1 = Matrix.Rotation(TURN, 3, "Z") @ p0 + Vector((0, 0, RISE))
bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.03, depth=(p1 - p0).length * 1.08, location=(p0 + p1) / 2,
                                    rotation=(p1 - p0).to_track_quat("Z", "Y").to_euler())
rail = named("Handrail", [brass])
spiral(rail, turn)

# The tower: a stone wall around the stair, open at the top to a skylight.
height = STEPS * RISE + 2.0
bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=2.65, depth=height, location=(0, 0, height / 2 - 0.4), end_fill_type="NOTHING")
wall = named("Tower", [plaster])
wall.data.flip_normals()
bpy.ops.object.shade_smooth()
bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=2.7, depth=0.2, location=(0, 0, -0.1))
named("Floor", [stone])

# Sunlight through the open top, and wall lamps up the shaft.
sky = bpy.data.lights.new("Skylight", "SUN")
sky.energy, sky.color, sky.angle = 8.0, (1.0, 0.9, 0.75), math.radians(1.5)
sky_ob = bpy.data.objects.new("Skylight", sky)
sky_ob.rotation_euler = (math.radians(14), 0, math.radians(30))
scene.collection.objects.link(sky_ob)
for i, z in enumerate((1.4, 4.2, 7.0)):
    lamp = bpy.data.lights.new(f"Sconce {i}", "POINT")
    lamp.energy, lamp.color, lamp.shadow_soft_size = 220, (1.0, 0.55, 0.25), 0.05
    lamp_ob = bpy.data.objects.new(lamp.name, lamp)
    lamp_ob.location = (2.3 * math.cos(2.2 * i + 1), 2.3 * math.sin(2.2 * i + 1), z)
    scene.collection.objects.link(lamp_ob)

world = bpy.data.worlds.new("Sky")
world.color = (0.25, 0.32, 0.45)
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.1, 0.13, 0.2, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
scene.world = world

camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
camera.data.lens = 19
camera.location = (0.05, 0.05, 0.25)
camera.rotation_euler = (math.radians(180), 0, math.radians(20))
scene.collection.objects.link(camera)
scene.camera = camera

bpy.ops.object.select_all(action="DESELECT")
step.select_set(True)
bpy.context.view_layer.objects.active = step
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "arrays.blend"), compress=True)
