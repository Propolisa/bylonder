"""Builds sculpting.blend: a glazed ceramic owl on a plinth, its form shaped from a quad sphere by brush-like strokes
(grab, draw, inflate and crease, each a smooth falloff around a point or along a line, as Sculpt Mode's brushes move
vertices), ready to sculpt further, in Blender 5.2.3.

usage: blender -b --factory-startup -P sculpting.py [-- RENDER.png]   (RENDER.png: a Cycles preview of the camera)
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.resolution_x, scene.render.resolution_y = 1000, 1250
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('World')
world.color = (0.1, 0.11, 0.12)
world.node_tree.nodes['Background'].inputs['Color'].default_value = (*world.color, 1)
scene.world = world


def material(name, color, roughness=0.5, **inputs):
    ma = bpy.data.materials.new(name)
    bsdf = ma.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    for key, value in inputs.items():
        bsdf.inputs[key.replace('_', ' ')].default_value = value
    return ma


GLAZE = material('Celadon', (0.22, 0.4, 0.34), 0.12, Coat_Weight=0.6, Coat_Roughness=0.05)
EYE = material('Eye Glaze', (0.03, 0.025, 0.02), 0.05)
PLINTH = material('Walnut', (0.12, 0.06, 0.03), 0.4)
BACKDROP = material('Backdrop', (0.42, 0.36, 0.3), 0.85)

# The clay: a cube subdivided into a sphere of even quads.
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=2)
bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=40, use_grid_fill=True)
for v in bm.verts:
    v.co = v.co.normalized()
bm.normal_update()
base = {v: (v.co.copy(), v.normal.copy()) for v in bm.verts}


def falloff(d, radius):
    """Sculpt Mode's Smooth falloff: 1 at the center, 0 at the radius."""
    t = max(0.0, 1.0 - d / radius)
    return t * t * (3 - 2 * t)


def stroke(center, radius, move):
    """Moves each vertex within `radius` of `center` by move(vertex) times the falloff."""
    c = Vector(center)
    for v in bm.verts:
        d = (v.co - c).length
        if d < radius:
            v.co += move(v) * falloff(d, radius)
    bm.normal_update()


def grab(center, radius, offset):
    stroke(center, radius, lambda v: Vector(offset))


def draw(center, radius, strength):
    """Draw (strength > 0) or Draw with Subtract (strength < 0): along each vertex's normal."""
    stroke(center, radius, lambda v: v.normal * strength)


def crease(points, radius, depth, steps=24):
    """Crease along a line through `points`: dabs of a sharp, deep Draw with Subtract."""
    points = [Vector(p) for p in points]
    for a, b in zip(points, points[1:]):
        for i in range(steps):
            p = a.lerp(b, i / steps)
            near = min(bm.verts, key=lambda v: (v.co - p).length).co.copy()
            stroke(near, radius, lambda v: -v.normal * depth / steps * 4)


# The body: an egg, wider below, flat underneath.
for v in bm.verts:
    x, y, z = v.co
    width = 0.78 + 0.14 * (-z)
    v.co = Vector((x * width, y * width * 0.9, z * 1.1))
    if v.co.z < -0.85:
        v.co.z = -0.85 - (v.co.z + 0.85) * 0.15
bm.normal_update()

# Ear tufts grabbed up and out; the face's two discs pushed in; the eyes drawn out of them; the beak grabbed down.
for side in (-1, 1):
    grab((side * 0.48, -0.1, 0.92), 0.35, (side * 0.14, 0.02, 0.28))
    draw((side * 0.26, -0.62, 0.42), 0.34, -0.16)
    draw((side * 0.25, -0.62, 0.44), 0.14, 0.13)
grab((0, -0.66, 0.3), 0.14, (0, -0.16, -0.1))
draw((0, -0.75, 0.24), 0.08, 0.03)
# The brow between the discs, the wings' edges and their tips, as creases.
crease([(-0.5, -0.5, 0.62), (-0.2, -0.68, 0.6), (0, -0.7, 0.42)], 0.05, 0.05)
crease([(0.5, -0.5, 0.62), (0.2, -0.68, 0.6), (0, -0.7, 0.42)], 0.05, 0.05)
for side in (-1, 1):
    crease([(side * 0.7, -0.45, 0.3), (side * 0.78, -0.42, -0.1), (side * 0.66, -0.42, -0.55), (side * 0.4, -0.5, -0.82)], 0.07, 0.1)
    draw((side * 0.82, 0.0, -0.1), 0.45, 0.05)
# Feathers on the chest: rows of small dabs.
SCALLOP = [Vector(p) for p in ((-0.08, 0, 0.01), (-0.06, 0, -0.04), (0, 0, -0.065), (0.06, 0, -0.04), (0.08, 0, 0.01))]
for row in range(4):
    z = 0.02 - row * 0.2
    for i in range(-1, 2 - row % 2):
        x = i * 0.2 + (row % 2) * 0.1
        p = min(bm.verts, key=lambda v: (v.co - Vector((x, -0.9, z))).length if v.co.y < 0 else 9).co.copy()
        draw(p, 0.1, 0.02)
        crease([p + d for d in SCALLOP], 0.03, 0.02, steps=5)

# Where the eyes sit: the surface in the middle of each eye's swelling.
EYES = [min((v for v in bm.verts if v.co.y < 0), key=lambda v: (v.co.x - side * 0.25) ** 2 + (v.co.z - 0.44) ** 2) for side in (-1, 1)]
EYES = [(v.co.copy(), v.normal.copy()) for v in EYES]
mesh = bpy.data.meshes.new('Owl')
bm.to_mesh(mesh)
bm.free()
owl = bpy.data.objects.new('Owl', mesh)
owl.location = (0, 0, 1.05)
scene.collection.objects.link(owl)
mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
mesh.materials.append(GLAZE)
# Glass eyes, set into the sculpted swellings.
for name, (co, normal) in zip(('Eye.L', 'Eye.R'), EYES):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.075, location=owl.location + co - normal * 0.035)
    eye = bpy.context.object
    eye.name = eye.data.name = name
    eye.data.materials.append(EYE)
    bpy.ops.object.shade_smooth()

bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.75, depth=0.2, location=(0, 0, 0.1))
plinth = bpy.context.object
plinth.name = plinth.data.name = 'Plinth'
plinth.data.materials.append(PLINTH)
bevel = plinth.modifiers.new('Bevel', 'BEVEL')
bevel.width, bevel.segments, bevel.limit_method = 0.02, 3, 'ANGLE'
bpy.ops.object.shade_smooth()
bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
bpy.context.object.name = 'Backdrop'
bpy.context.object.data.materials.append(BACKDROP)

key = bpy.data.objects.new('Key Light', bpy.data.lights.new('Key Light', 'AREA'))
key.data.energy, key.data.size, key.data.color = 400, 2.0, (1.0, 0.93, 0.85)
key.location = (-2.4, -2.6, 3.4)
key.rotation_euler = (Vector((0, 0, 1.1)) - key.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(key)
rim = bpy.data.objects.new('Rim Light', bpy.data.lights.new('Rim Light', 'SPOT'))
rim.data.energy, rim.data.color, rim.data.shadow_soft_size = 600, (0.7, 0.85, 1.0), 0.3
rim.location = (2.4, 2.6, 2.8)
rim.rotation_euler = (Vector((0, 0, 1.2)) - rim.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(rim)

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 70
camera.location = (1.6, -5.2, 2.3)
camera.rotation_euler = (Vector((0, 0, 1.05)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(camera)
scene.camera = camera

bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = owl
owl.select_set(True)
here = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(here, 'sculpting.blend'), compress=True)

if '--' in sys.argv:
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_percentage = 40
    scene.render.filepath = sys.argv[sys.argv.index('--') + 1]
    bpy.ops.render.render(write_still=True)
