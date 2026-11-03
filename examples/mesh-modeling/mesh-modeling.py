"""Builds mesh-modeling.blend: a rangefinder film camera modeled with Edit Mode's tools (loop cuts, bevel, inset,
extrude, spin and bisect, here as the bmesh operators those tools run), on a desk, in Blender 5.2.3.

usage: blender -b --factory-startup -P mesh-modeling.py [-- RENDER.png]   (RENDER.png: a Cycles preview of the camera)
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('World')
world.color = (0.18, 0.19, 0.21)
world.node_tree.nodes['Background'].inputs['Color'].default_value = (*world.color, 1)
scene.world = world


def node(nodes, idname, inputs=None, **properties):
    made = nodes.new(idname)
    for key, value in properties.items():
        setattr(made, key, value)
    for key, value in (inputs or {}).items():
        made.inputs[key].default_value = value
    return made


def material(name, color, roughness=0.5, **inputs):
    ma = bpy.data.materials.new(name)
    bsdf = ma.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    for key, value in inputs.items():
        bsdf.inputs[key.replace('_', ' ')].default_value = value
    return ma


CHROME = material('Chrome', (0.85, 0.85, 0.83), 0.18, Metallic=1.0)
BLACK = material('Black Metal', (0.03, 0.03, 0.03), 0.35, Metallic=1.0)
LEATHER = material('Leatherette', (0.03, 0.028, 0.026), 0.65)
LENS = material('Lens Glass', (0.02, 0.03, 0.05), 0.02, Coat_Weight=1.0, Coat_Tint=(0.6, 0.75, 1.0, 1))
DESK = material('Desk', (0.36, 0.2, 0.1), 0.4)
FELT = material('Felt', (0.12, 0.22, 0.2), 0.95)


def mesh_object(name, bm, materials, location=(0, 0, 0), smooth=True):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    scene.collection.objects.link(obj)
    for ma in materials:
        mesh.materials.append(ma)
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    return obj


def cut(bm, co, no):
    """A loop cut across the whole mesh: Bisect with a plane through `co` facing `no`."""
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no)


def faces_where(bm, test):
    return [f for f in bm.faces if test(f.calc_center_median(), f.normal)]


def body():
    """The body: a box with loop cuts for the leather band and the top plate, beveled, the top inset and extruded
    into the viewfinder housing, the front inset for the rangefinder windows."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((1.4, 0.36, 0.78, 1)))
    for z in (-0.25, 0.2):
        cut(bm, (0, 0, z), (0, 0, 1))
    for x in (-0.36, 0.36):
        cut(bm, (x, 0, 0), (1, 0, 0))
    # The top plate rises over the middle: the top's middle face, inset and extruded up.
    top = faces_where(bm, lambda c, n: n.z > 0.9 and abs(c.x) < 0.3)
    bmesh.ops.inset_region(bm, faces=top, thickness=0.04, depth=0)
    ext = bmesh.ops.extrude_face_region(bm, geom=top)
    up = [v for v in ext['geom'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=up, vec=(0, 0, 0.12))
    bmesh.ops.scale(bm, verts=up, vec=(0.85, 0.85, 1), space=Matrix.Translation((0, 0, -0.51)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    outer = [e for e in bm.edges if e.calc_face_angle(0) > 1.2]
    bmesh.ops.bevel(bm, geom=outer, offset=0.025, segments=3, profile=0.5, affect='EDGES', clamp_overlap=True)
    # The windows: the front's upper side faces inset, then pushed in.
    for side in (-1, 1):
        window = faces_where(bm, lambda c, n: n.y < -0.9 and c.z > 0.2 and side * c.x > 0.36)
        bmesh.ops.inset_region(bm, faces=window, thickness=0.05, depth=-0.015)
        bmesh.ops.inset_region(bm, faces=window, thickness=0.01, depth=-0.01)
    # Leather below the top plate, chrome above; the windows' insides black.
    for f in bm.faces:
        c = f.calc_center_median()
        f.material_index = 1 if -0.24 < c.z < 0.19 else 0
        if f.normal.y < -0.9 and c.z > 0.2 and abs(c.x) > 0.42 and c.y > -0.17:
            f.material_index = 2
    return mesh_object('Camera Body', bm, [CHROME, LEATHER, LENS], (0, 0, 0.39 + 0.02))


def spun(name, profile, materials, location, steps=64, rotation=(math.pi / 2, 0, 0)):
    """A profile of (radius, depth, material) points spun 360 degrees about its axis (Spin)."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, z)) for r, z, _ in profile]
    edges = [bm.edges.new(pair) for pair in zip(verts, verts[1:])]
    result = bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=2 * math.pi, steps=steps, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    for f in bm.faces:
        c = f.calc_center_median()
        r = math.hypot(c.x, c.y)
        f.material_index = min(profile, key=lambda p: abs(p[0] - r) + abs(p[1] - c.z))[2]
    obj = mesh_object(name, bm, materials, location)
    obj.rotation_euler = rotation
    return obj


def lens():
    """The lens: a profile spun, with grip ridges on the focus ring and the glass set back in a black throat."""
    ridges = []
    for i in range(10):
        z = 0.1 + 0.018 * i
        ridges += [(0.235, z, 0), (0.245, z + 0.004, 0), (0.245, z + 0.01, 0), (0.235, z + 0.014, 0)]
    profile = [(0.26, 0.0, 0), (0.26, 0.04, 0), (0.24, 0.05, 0), (0.235, 0.09, 0), *ridges, (0.235, 0.3, 0),
               (0.22, 0.31, 1), (0.22, 0.38, 1), (0.215, 0.39, 0), (0.2, 0.39, 0), (0.17, 0.36, 1), (0.15, 0.34, 2),
               (0.08, 0.33, 2), (0.0, 0.325, 2)]
    return spun('Lens', profile, [CHROME, BLACK, LENS], (0, -0.18, 0.4))


def knob(name, x, height):
    profile = [(0.0, 0.0, 0), (0.09, 0.0, 0), (0.09, height * 0.8, 0), (0.08, height, 0), (0.03, height, 0), (0.0, height, 0)]
    return spun(name, profile, [CHROME], (x, 0.0, 0.8 + 0.02), steps=32, rotation=(0, 0, 0))


body()
lens()
knob('Shutter Dial', 0.48, 0.07)
knob('Rewind Knob', -0.5, 0.09)
shutter = spun('Shutter Button', [(0.0, 0.0, 0), (0.03, 0.0, 0), (0.03, 0.05, 0), (0.025, 0.06, 0), (0.0, 0.06, 0)],
               [CHROME], (0.48, 0.0, 0.89 + 0.02), steps=24, rotation=(0, 0, 0))
cam = bpy.data.objects
for part in ('Lens', 'Shutter Dial', 'Rewind Knob', 'Shutter Button'):
    cam[part].parent = cam['Camera Body']
    cam[part].location -= cam['Camera Body'].location

bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0.6, 0))
bpy.context.object.name = 'Desk'
bpy.context.object.data.materials.append(DESK)
bpy.ops.mesh.primitive_plane_add(size=1.5, location=(0.2, 0.1, 0.002))
bpy.context.object.name = 'Felt Mat'
bpy.context.object.rotation_euler.z = 0.12
bpy.context.object.data.materials.append(FELT)
cam['Camera Body'].rotation_euler.z = math.radians(-24)

key = bpy.data.objects.new('Key Light', bpy.data.lights.new('Key Light', 'AREA'))
key.data.energy, key.data.size, key.data.color = 220, 1.5, (1.0, 0.92, 0.82)
key.location = (-1.6, -1.4, 2.0)
key.rotation_euler = (Vector((0, 0, 0.4)) - key.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(key)
rim = bpy.data.objects.new('Rim Light', bpy.data.lights.new('Rim Light', 'SPOT'))
rim.data.energy, rim.data.color, rim.data.shadow_soft_size = 300, (0.7, 0.85, 1.0), 0.3
rim.location = (1.8, 1.8, 1.6)
rim.rotation_euler = (Vector((0, 0, 0.4)) - rim.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(rim)

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 55
camera.location = (1.2, -3.4, 1.8)
camera.rotation_euler = (Vector((0.0, 0, 0.42)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(camera)
scene.camera = camera

bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = cam['Camera Body']
cam['Camera Body'].select_set(True)
here = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(here, 'mesh-modeling.blend'), compress=True)

if '--' in sys.argv:
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_percentage = 30
    scene.render.filepath = sys.argv[sys.argv.index('--') + 1]
    bpy.ops.render.render(write_still=True)
