"""Import and Export: a bronze bust brought into a gallery by File > Import > glTF 2.0.

bust.glb is an asset made elsewhere: Suzanne, subdivided and smooth, in bronze on a marble foot, written by Blender
5.2's glTF exporter with its two materials. The gallery (a plinth, walls, two spot lights and a camera) is built here,
and bust.glb is imported onto the plinth, as File > Import > glTF 2.0 does.

blender -b --factory-startup -P import-export.py   (writes bust.glb and import-export.blend beside this file)
"""
import math
import os

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.join(HERE, "bust.glb")
PLINTH = 1.1


def material(name, color, roughness=0.5, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return m


# The asset: its origin at the bottom of its foot.
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_monkey_add(location=(0, 0, 0.42), rotation=(math.radians(-10), 0, 0), size=0.3)
head = bpy.context.object
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
head.modifiers.new("Subdivision", "SUBSURF").levels = 2
bpy.ops.object.modifier_apply(modifier="Subdivision")
bpy.ops.object.shade_smooth()
head.data.materials.append(material("Bronze", (0.55, 0.32, 0.14, 1), 0.28, 1.0))
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.07, depth=0.16, location=(0, 0.02, 0.2))
neck = bpy.context.object
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.17, depth=0.12, location=(0, 0, 0.06))
foot = bpy.context.object
bevel = foot.modifiers.new("Bevel", "BEVEL")
bevel.width, bevel.segments = 0.015, 4
bpy.ops.object.modifier_apply(modifier="Bevel")
foot.data.materials.append(material("Marble", (0.85, 0.84, 0.8, 1), 0.12))
neck.data.materials.append(bpy.data.materials["Bronze"])
bpy.ops.object.select_all(action="DESELECT")
for ob in (head, neck, foot):
    ob.select_set(True)
bpy.context.view_layer.objects.active = head
bpy.ops.object.join()
head.name = head.data.name = "Bust"
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.export_scene.gltf(filepath=GLB, export_format="GLB", use_selection=True)

# The gallery.
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.resolution_x, scene.render.resolution_y = 1080, 1350
bpy.ops.mesh.primitive_cube_add(location=(0, 0, PLINTH / 2), scale=(0.3, 0.3, PLINTH / 2))
plinth = bpy.context.object
plinth.name = plinth.data.name = "Plinth"
plinth.data.materials.append(material("Gesso", (0.45, 0.44, 0.42, 1), 0.7))
bpy.ops.mesh.primitive_plane_add(size=12)
bpy.context.object.name = "Floor"
bpy.context.object.data.materials.append(material("Polished Concrete", (0.12, 0.11, 0.1, 1), 0.2))
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 2.2, 6), rotation=(math.radians(90), 0, 0))
bpy.context.object.name = "Wall"
bpy.context.object.data.materials.append(material("Wall Paint", (0.32, 0.12, 0.1, 1), 0.9))

key = bpy.data.lights.new("Key", "SPOT")
key.energy, key.spot_size, key.spot_blend, key.shadow_soft_size, key.color = 1100, math.radians(28), 0.4, 0.15, (1.0, 0.88, 0.72)
key_ob = bpy.data.objects.new("Key", key)
key_ob.location = (-1.6, -1.8, 3.6)
scene.collection.objects.link(key_ob)
rim = bpy.data.lights.new("Rim", "SPOT")
rim.energy, rim.spot_size, rim.spot_blend, rim.shadow_soft_size, rim.color = 900, math.radians(25), 0.5, 0.1, (0.7, 0.8, 1.0)
rim_ob = bpy.data.objects.new("Rim", rim)
rim_ob.location = (1.7, 1.4, 2.8)
scene.collection.objects.link(rim_ob)
target = (0, 0, PLINTH + 0.3)
for ob in (key_ob, rim_ob):
    direction = ob.location - Vector(target)
    ob.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()

world = bpy.data.worlds.new("Gallery")
world.color = (0.02, 0.02, 0.022)
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.03, 0.03, 0.035, 1)
scene.world = world

camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
camera.data.lens = 85
camera.location = (-0.9, -3.1, 1.75)
camera.rotation_euler = (math.radians(83.5), 0, math.radians(-16.2))
scene.collection.objects.link(camera)
scene.camera = camera

scene.cursor.location = (0, 0, PLINTH)
bpy.ops.import_scene.gltf(filepath=GLB)
bpy.data.objects["Bust"].location = (0, 0, PLINTH)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "import-export.blend"), compress=True)
