"""Python Scripts and Add-ons: a seashell on wet sand at golden hour, built by seashell.py, and the Scatter Cubes add-on.

The scene is the beach, the sea, the light and the camera; seashell.py (kept in the file as a text, and run here as
Alt P runs it) builds the Seashell collection with numpy. scatter_cubes.py is an add-on to install from Preferences.

blender -b --factory-startup -P python.py   (writes python.blend beside this file)
"""
import math
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.resolution_x, scene.render.resolution_y = 1280, 800


def material(name, color, roughness):
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    return m


world = bpy.data.worlds.new("Golden Hour")
world.color = (0.6, 0.45, 0.35)
background = world.node_tree.nodes["Background"]
background.inputs["Color"].default_value = (0.75, 0.55, 0.45, 1)
background.inputs["Strength"].default_value = 0.6
scene.world = world

bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 8, 0))
sand = bpy.context.object
sand.name = sand.data.name = "Sand"
sand.data.materials.append(material("Wet Sand", (0.42, 0.3, 0.2, 1), 0.3))
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 110, 0.02))
sea = bpy.context.object
sea.name = sea.data.name = "Sea"
sea.data.materials.append(material("Sea", (0.05, 0.08, 0.1, 1), 0.05))
for i, (x, y, r) in enumerate([(-1.1, 0.9, 0.09), (1.3, 1.6, 0.06), (0.7, -0.4, 0.04), (-0.4, 2.6, 0.12)]):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=r, location=(x, y, r * 0.4), scale=(1.3, 1, 0.6))
    pebble = bpy.context.object
    pebble.name = pebble.data.name = f"Pebble {i}"
    pebble.data.materials.append(material(f"Pebble {i}", (0.55 + 0.08 * i, 0.5 + 0.05 * i, 0.45, 1), 0.35))
    bpy.ops.object.shade_smooth()

sun = bpy.data.lights.new("Sun", "SUN")
sun.energy, sun.color, sun.angle = 5.0, (1.0, 0.68, 0.42), math.radians(2)
sun_ob = bpy.data.objects.new("Sun", sun)
sun_ob.rotation_euler = (math.radians(80), 0, math.radians(160))
scene.collection.objects.link(sun_ob)

camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
camera.data.lens = 95
camera.location = (0.35, -3.6, 0.9)
camera.rotation_euler = (math.radians(78), 0, math.radians(5))
scene.collection.objects.link(camera)
scene.camera = camera

for name in ("seashell.py", "scatter_cubes.py"):
    text = bpy.data.texts.new(name)
    text.from_string(open(os.path.join(HERE, name)).read())
exec(compile(bpy.data.texts["seashell.py"].as_string(), "seashell.py", "exec"), {"__name__": "__main__"})
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "python.blend"), compress=True)
