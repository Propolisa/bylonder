"""Builds rendering.blend: a table by a window in late sun, with a glass carafe, a tumbler, a copper jug and a bowl of
lemons, lit by a sun through the window panes and a soft fill light, in Blender 5.2.3.

usage: blender -b --factory-startup -P rendering.py [-- RENDER.png]   (RENDER.png: a Cycles preview of the camera)
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
scene.eevee.taa_render_samples = 32
scene.view_settings.view_transform = 'Standard'

world = bpy.data.worlds.new('World')
world.color = (0.16, 0.2, 0.28)
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
    """A Principled BSDF material; `inputs` are its other inputs by name, underscores for spaces."""
    ma = bpy.data.materials.new(name)
    bsdf = ma.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    for key, value in inputs.items():
        bsdf.inputs[key.replace('_', ' ')].default_value = value
    return ma


def wood():
    """Oak: Wave Texture bands, stretched along the grain, through a Color Ramp into Base Color and Roughness."""
    ma = material('Oak', (0.4, 0.22, 0.1), 0.45)
    nodes, link = ma.node_tree.nodes, ma.node_tree.links.new
    bsdf = nodes['Principled BSDF']
    coord = nodes.new('ShaderNodeTexCoord')
    mapping = node(nodes, 'ShaderNodeMapping', {'Scale': (0.12, 1.0, 1.0)})
    wave = node(nodes, 'ShaderNodeTexWave', {'Scale': 3.0, 'Distortion': 14.0, 'Detail': 4.0, 'Detail Scale': 2.0}, wave_type='BANDS', bands_direction='Y')
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.16, 0.07, 0.03, 1)
    ramp.color_ramp.elements[1].color = (0.42, 0.24, 0.11, 1)
    link(coord.outputs['Object'], mapping.inputs['Vector'])
    link(mapping.outputs['Vector'], wave.inputs['Vector'])
    link(wave.outputs['Fac'], ramp.inputs['Fac'])
    link(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    return ma


def plaster():
    """Lime plaster: two warm whites mixed by a Noise Texture."""
    ma = material('Plaster', (0.75, 0.66, 0.55), 0.9)
    nodes, link = ma.node_tree.nodes, ma.node_tree.links.new
    noise = node(nodes, 'ShaderNodeTexNoise', {'Scale': 3.0, 'Detail': 6.0})
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.62, 0.52, 0.42, 1)
    ramp.color_ramp.elements[1].color = (0.8, 0.72, 0.6, 1)
    link(noise.outputs['Fac'], ramp.inputs['Fac'])
    link(ramp.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
    return ma


OAK, PLASTER = wood(), plaster()
FRAME = material('Window Frame', (0.08, 0.1, 0.09), 0.6)
FLOOR = material('Floor', (0.12, 0.07, 0.05), 0.35)


def glass():
    """Clear glass: a Glass BSDF at grazing angles, mostly see-through face on (Layer Weight's Fresnel mixes them)."""
    ma = bpy.data.materials.new('Glass')
    nodes, link = ma.node_tree.nodes, ma.node_tree.links.new
    nodes.remove(nodes['Principled BSDF'])
    bsdf = node(nodes, 'ShaderNodeBsdfGlass', {'Color': (0.9, 0.97, 0.94, 1), 'Roughness': 0.02, 'IOR': 1.45})
    clear = node(nodes, 'ShaderNodeBsdfTransparent', {'Color': (0.93, 0.98, 0.95, 1)})
    weight = node(nodes, 'ShaderNodeLayerWeight', {'Blend': 0.35})
    mix = nodes.new('ShaderNodeMixShader')
    link(weight.outputs['Fresnel'], mix.inputs['Fac'])
    link(clear.outputs['BSDF'], mix.inputs[1])
    link(bsdf.outputs['BSDF'], mix.inputs[2])
    link(mix.outputs['Shader'], nodes['Material Output'].inputs['Surface'])
    return ma


GLASS = glass()
COPPER = material('Copper', (0.95, 0.5, 0.32), 0.22, Metallic=1.0)
GLAZE = material('Glaze', (0.12, 0.3, 0.32), 0.12)
LEMON = material('Lemon', (0.9, 0.62, 0.05), 0.4)


def place(obj, name, ma):
    obj.name = obj.data.name = name
    obj.data.materials.append(ma)
    return obj


def box(name, ma, center, size):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return place(obj, name, ma)


def lathe(name, ma, profile, location, segments=64):
    """A surface of revolution: `profile` is (radius, height) points from the bottom center around to the inside."""
    verts, faces = [], []
    for r, z in profile:
        for i in range(segments):
            a = 2 * math.pi * i / segments
            verts.append((r * math.cos(a), r * math.sin(a), z))
    for ring in range(len(profile) - 1):
        for i in range(segments):
            j = (i + 1) % segments
            a, b = ring * segments, (ring + 1) * segments
            faces.append((a + i, a + j, b + j, b + i))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    scene.collection.objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.materials.append(ma)
    obj.modifiers.new('Subdivision', 'SUBSURF').levels = 1
    return obj


# The room: floor, back wall and the left wall with a window of four panes.
box('Floor', FLOOR, (0, 0.5, -0.05), (8, 8, 0.1))
box('Back Wall', PLASTER, (0.4, 2.6, 2), (6, 0.2, 4))
WALL_X, OPEN_Y, OPEN_Z = -2.2, (0.0, 2.0), (1.1, 2.9)
for name, y, z in [('Wall Front', (-3.5, OPEN_Y[0]), (0, 4)), ('Wall Back', (OPEN_Y[1], 2.5), (0, 4)),
                   ('Wall Sill', OPEN_Y, (0, OPEN_Z[0])), ('Wall Lintel', OPEN_Y, (OPEN_Z[1], 4))]:
    box(name, PLASTER, (WALL_X, sum(y) / 2, sum(z) / 2), (0.2, y[1] - y[0], z[1] - z[0]))
mid_y, mid_z = sum(OPEN_Y) / 2, sum(OPEN_Z) / 2
box('Mullion', FRAME, (WALL_X, mid_y, mid_z), (0.08, 0.05, OPEN_Z[1] - OPEN_Z[0]))
box('Transom', FRAME, (WALL_X, mid_y, mid_z + 0.2), (0.08, OPEN_Y[1] - OPEN_Y[0], 0.05))

# The table against the back wall.
TOP = 0.92
box('Table', OAK, (0, 1.85, TOP - 0.03), (2.6, 1.2, 0.06))
for x in (-1.2, 1.2):
    for y in (1.35, 2.35):
        box('Table Leg', OAK, (x, y, (TOP - 0.06) / 2), (0.07, 0.07, TOP - 0.06))

# On the table: a carafe and a tumbler of glass, a copper jug and a bowl of lemons.
lathe('Carafe', GLASS, [(0, 0), (0.15, 0), (0.17, 0.02), (0.17, 0.2), (0.13, 0.3), (0.05, 0.38), (0.045, 0.5), (0.055, 0.52),
                        (0.045, 0.52), (0.035, 0.5), (0.04, 0.38), (0.12, 0.3), (0.16, 0.2), (0.16, 0.03), (0, 0.03)], (-0.45, 1.75, TOP))
lathe('Tumbler', GLASS, [(0, 0), (0.07, 0), (0.08, 0.16), (0.073, 0.16), (0.064, 0.02), (0, 0.02)], (-0.05, 1.45, TOP))
lathe('Jug', COPPER, [(0, 0), (0.13, 0), (0.15, 0.04), (0.16, 0.14), (0.12, 0.26), (0.1, 0.32), (0.12, 0.36),
                      (0.11, 0.36), (0.09, 0.32), (0.11, 0.26), (0.15, 0.14), (0.14, 0.04), (0, 0.02)], (-1.0, 2.05, TOP))
lathe('Bowl', GLAZE, [(0, 0), (0.1, 0), (0.12, 0.02), (0.22, 0.08), (0.27, 0.14), (0.26, 0.145), (0.21, 0.09),
                      (0.11, 0.035), (0, 0.035)], (0.6, 1.8, TOP))
for i, (x, y, z, turn) in enumerate([(0.52, 1.78, 0.1, 0.3), (0.7, 1.74, 0.1, 1.9), (0.6, 1.92, 0.1, 1.1)]):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.056, location=(x, y, TOP + z))
    lemon = place(bpy.context.object, f'Lemon.{i + 1:03d}' if i else 'Lemon', LEMON)
    lemon.scale = (1.3, 1, 1)
    lemon.rotation_euler = (0.2, 0.15, turn)
    bpy.ops.object.shade_smooth()

# Late sun through the window; a warm, soft fill from the right; the world's dusk blue in the shadows.
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy, sun.data.color, sun.data.angle = 6.0, (1.0, 0.72, 0.45), math.radians(1.5)
sun.rotation_euler = Vector((0.85, 0.33, -0.4)).to_track_quat('-Z', 'Y').to_euler()
sun.location = (-4, 0.5, 3.5)
scene.collection.objects.link(sun)
fill = bpy.data.objects.new('Fill', bpy.data.lights.new('Fill', 'POINT'))
fill.data.energy, fill.data.color, fill.data.shadow_soft_size = 60.0, (1.0, 0.85, 0.7), 0.8
fill.location = (2.2, -0.6, 2.4)
scene.collection.objects.link(fill)

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 45
camera.location = (0.4, -1.0, 1.45)
camera.rotation_euler = (Vector((-0.08, 1.9, 1.1)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(camera)
scene.camera = camera

bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = bpy.data.objects['Carafe']
bpy.data.objects['Carafe'].select_set(True)
here = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(here, 'rendering.blend'), compress=True)

if '--' in sys.argv:
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_percentage = 30
    scene.render.filepath = sys.argv[sys.argv.index('--') + 1]
    bpy.ops.render.render(write_still=True)
