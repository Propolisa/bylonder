"""Builds light-probes.blend: a reading corner in late afternoon sun, its room lit only by a sun through one window and
the light that bounces off the floor, the walls and the furniture, which an Irradiance Volume gathers, and a glazed vase
that mirrors the room through a Sphere probe, in Blender 5.2.3.

usage: blender -b --factory-startup -P light-probes.py
"""
import math
import os

import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1280, 720
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'

world = bpy.data.worlds.new('Evening Sky')
scene.world = world
background = world.node_tree.nodes['Background']
background.inputs['Color'].default_value = (0.32, 0.45, 0.75, 1)
background.inputs['Strength'].default_value = 0.4


def material(name, color, roughness=0.8, metallic=0.0, coat=0.0):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Coat Weight'].default_value = coat
    return mat


plaster = material('Plaster', (0.78, 0.74, 0.68))
terracotta = material('Terracotta', (0.62, 0.22, 0.12))
oak = material('Oak', (0.55, 0.33, 0.16), roughness=0.45)
mustard = material('Mustard Wool', (0.78, 0.52, 0.08), roughness=0.95)
teal = material('Teal Rug', (0.04, 0.28, 0.30), roughness=1.0)
walnut = material('Walnut', (0.20, 0.10, 0.05), roughness=0.5)
glaze = material('Glaze', (0.05, 0.12, 0.28), roughness=0.08, coat=1.0)
brass = material('Brass', (0.85, 0.62, 0.30), roughness=0.3, metallic=1.0)
linen = material('Linen', (0.92, 0.88, 0.80), roughness=0.9)
leaf = material('Leaf', (0.10, 0.32, 0.08), roughness=0.6)
clay = material('Clay Pot', (0.55, 0.30, 0.18), roughness=0.85)
paper = [material(f'Book {i}', color, roughness=0.7) for i, color in
         enumerate([(0.55, 0.08, 0.06), (0.10, 0.20, 0.38), (0.80, 0.70, 0.45), (0.12, 0.30, 0.14)])]


def box(name, location, size, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=location)
    ob = bpy.context.object
    ob.name = name
    ob.scale = [s / 2 for s in size]
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        modifier = ob.modifiers.new('Bevel', 'BEVEL')
        modifier.width, modifier.segments = bevel, 3
    ob.data.materials.append(mat)
    return ob


def cylinder(name, location, radius, depth, mat, vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(location=location, radius=radius, depth=depth, vertices=vertices)
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return ob


# The room: 5 m wide (x), 4 m deep (y), 3 m high; the window in the right wall (+x).
W, D, H, T = 5.0, 4.0, 3.0, 0.2
box('Floor', (0, 0, -T / 2), (W + 2 * T, D + 2 * T, T), oak)
box('Ceiling', (0, 0, H + T / 2), (W + 2 * T, D + 2 * T, T), plaster)
box('Back Wall', (0, D / 2 + T / 2, H / 2), (W, T, H), terracotta)
box('Left Wall', (-W / 2 - T / 2, 0, H / 2), (T, D + 2 * T, H), plaster)
box('Front Wall', (0, -D / 2 - T / 2, H / 2), (W, T, H), plaster)
# The window: 1.6 m wide, 2 m high, its sill at 0.6 m, and its frame's mullions.
x, wy, sill, top = W / 2 + T / 2, 1.6, 0.6, 2.6
box('Right Wall Below', (x, 0, sill / 2), (T, D, sill), plaster)
box('Right Wall Above', (x, 0, (top + H) / 2), (T, D, H - top), plaster)
side = (D - wy) / 2
box('Right Wall Back', (x, wy / 2 + side / 2, (sill + top) / 2), (T, side, top - sill), plaster)
box('Right Wall Front', (x, -wy / 2 - side / 2, (sill + top) / 2), (T, side, top - sill), plaster)
box('Mullion', (x, 0, (sill + top) / 2), (0.08, 0.05, top - sill), linen)
box('Transom', (x, 0, 1.9), (0.08, wy, 0.05), linen)

# The reading corner: rug, armchair, side table with a vase, a lamp, books and a plant.
box('Rug', (-0.6, 0.6, 0.01), (2.4, 1.8, 0.02), teal)
box('Seat', (-1.2, 1.1, 0.35), (1.0, 0.9, 0.3), mustard, bevel=0.08)
box('Back Rest', (-1.2, 1.5, 0.75), (1.0, 0.25, 0.9), mustard, bevel=0.08)
box('Arm Left', (-1.65, 1.05, 0.55), (0.18, 0.9, 0.5), mustard, bevel=0.06)
box('Arm Right', (-0.75, 1.05, 0.55), (0.18, 0.9, 0.5), mustard, bevel=0.06)
for i, (dx, dy) in enumerate([(-0.4, -0.35), (0.4, -0.35), (-0.4, 0.35), (0.4, 0.35)]):
    cylinder(f'Leg {i}', (-1.2 + dx, 1.1 + dy, 0.1), 0.03, 0.2, walnut, vertices=12)
cylinder('Table Top', (0.1, 1.2, 0.6), 0.35, 0.04, walnut)
cylinder('Table Stem', (0.1, 1.2, 0.3), 0.04, 0.6, walnut, vertices=16)
cylinder('Table Foot', (0.1, 1.2, 0.02), 0.2, 0.04, walnut)
bpy.ops.mesh.primitive_uv_sphere_add(location=(0.15, 1.2, 0.78), radius=0.14, segments=48, ring_count=24)
vase = bpy.context.object
vase.name = 'Vase'
vase.scale = (1, 1, 1.3)
vase.data.materials.append(glaze)
bpy.ops.object.shade_smooth()
for i, mat in enumerate(paper):
    box(f'Book {i}', (-0.05 + 0.02 * i, 1.05, 0.64 + 0.035 * i), (0.22, 0.16, 0.035), mat)
cylinder('Lamp Pole', (-1.95, 1.6, 0.8), 0.015, 1.6, brass, vertices=12)
cylinder('Lamp Base', (-1.95, 1.6, 0.02), 0.15, 0.04, brass)
cylinder('Lamp Shade', (-1.95, 1.6, 1.65), 0.2, 0.3, linen)
cylinder('Pot', (1.8, 1.6, 0.25), 0.2, 0.5, clay)
for i in range(7):
    angle = i * 2 * math.pi / 7
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.22,
                                          location=(1.8 + 0.18 * math.cos(angle), 1.6 + 0.18 * math.sin(angle), 0.75 + 0.12 * (i % 3)))
    bpy.context.object.name = f'Leaves {i}'
    bpy.context.object.data.materials.append(leaf)
box('Frame', (-0.9, D / 2 - 0.02, 1.9), (1.0, 0.04, 0.7), walnut)
box('Picture', (-0.9, D / 2 - 0.045, 1.9), (0.86, 0.02, 0.56), linen)

# The sun, low and warm, through the window onto the floor and the rug.
sun = bpy.data.lights.new('Sun', 'SUN')
sun.energy, sun.angle, sun.color = 7.0, math.radians(1.5), (1.0, 0.82, 0.62)
sun_object = bpy.data.objects.new('Sun', sun)
scene.collection.objects.link(sun_object)
sun_object.rotation_euler = (math.radians(62), 0, math.radians(75))

# The probes: an Irradiance Volume filling the room, a Sphere probe at the reading corner.
volume = bpy.data.lightprobes.new('Room Volume', 'VOLUME')
volume.resolution_x, volume.resolution_y, volume.resolution_z = 10, 8, 6
volume_object = bpy.data.objects.new('Room Volume', volume)
scene.collection.objects.link(volume_object)
volume_object.location = (0, 0, H / 2)
volume_object.scale = (W / 2 - 0.05, D / 2 - 0.05, H / 2 - 0.05)
sphere = bpy.data.lightprobes.new('Corner Sphere', 'SPHERE')
sphere.influence_distance = 2.5
sphere_object = bpy.data.objects.new('Corner Sphere', sphere)
scene.collection.objects.link(sphere_object)
sphere_object.location = (0, 0.6, 1.2)

camera = bpy.data.cameras.new('Camera')
camera.lens = 22
camera_object = bpy.data.objects.new('Camera', camera)
scene.collection.objects.link(camera_object)
camera_object.location = (1.6, -1.75, 1.35)
camera_object.rotation_euler = (math.radians(84), 0, math.radians(30))
scene.camera = camera_object

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'light-probes.blend'), compress=True)
