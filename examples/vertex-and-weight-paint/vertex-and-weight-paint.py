"""Builds vertex-and-weight-paint.blend: two koi under lily pads, their markings painted in a color attribute and their
tails swung by a Simple Deform modifier limited to a weight painted vertex group, in Blender 5.2.3.

usage: blender -b --factory-startup -P vertex-and-weight-paint.py [-- RENDER.png]   (a Cycles preview at frame 1)
"""
import math
import os
import random
import sys

import bmesh
import bpy
from bpy_extras.anim_utils import action_get_channelbag_for_slot
from mathutils import Vector, noise

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end, scene.render.fps = 1, 48, 24
scene.render.resolution_x, scene.render.resolution_y = 1400, 1400
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('World')
world.color = (0.12, 0.16, 0.18)
world.node_tree.nodes['Background'].inputs['Color'].default_value = (*world.color, 1)
scene.world = world
random.seed(4)

WHITE, RED, BLACK = (0.86, 0.84, 0.78, 1), (0.8, 0.16, 0.03, 1), (0.03, 0.03, 0.035, 1)
LENGTH = 1.6


def material(name, color, roughness=0.5):
    ma = bpy.data.materials.new(name)
    bsdf = ma.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    return ma


def koi_skin():
    """The fish's color attribute (Color Attribute node) as Base Color, glossy with a thin coat."""
    ma = material('Koi Skin', (1, 1, 1), 0.3)
    nodes = ma.node_tree.nodes
    attribute = nodes.new('ShaderNodeVertexColor')
    attribute.layer_name = 'Markings'
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Coat Weight'].default_value = 0.5
    ma.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Base Color'])
    return ma


def pond_floor():
    """Deep water over silt: a spherical Gradient Texture darkens it toward the edges, Noise mottles it, and a Voronoi
    Texture's cell edges add the caustic light of the ripples."""
    ma = material('Pond Floor', (0.05, 0.08, 0.06), 0.9)
    nodes, link = ma.node_tree.nodes, ma.node_tree.links.new
    coord = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (0.25, 0.25, 0.25)
    link(coord.outputs['Object'], mapping.inputs['Vector'])
    depth = nodes.new('ShaderNodeTexGradient')
    depth.gradient_type = 'SPHERICAL'
    link(mapping.outputs['Vector'], depth.inputs['Vector'])
    silt = nodes.new('ShaderNodeTexNoise')
    silt.inputs['Scale'].default_value, silt.inputs['Detail'].default_value = 1.5, 6.0
    link(coord.outputs['Object'], silt.inputs['Vector'])
    shade = nodes.new('ShaderNodeMix')
    shade.data_type, shade.blend_type = 'RGBA', 'MULTIPLY'
    shade.inputs['Factor'].default_value = 1.0
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.002, 0.008, 0.012, 1)
    ramp.color_ramp.elements[1].color = (0.05, 0.12, 0.11, 1)
    link(depth.outputs['Fac'], ramp.inputs['Fac'])
    link(ramp.outputs['Color'], shade.inputs['A'])
    link(silt.outputs['Color'], shade.inputs['B'])
    ripples = nodes.new('ShaderNodeTexVoronoi')
    ripples.feature = 'DISTANCE_TO_EDGE'
    ripples.inputs['Scale'].default_value = 4.0
    link(coord.outputs['Object'], ripples.inputs['Vector'])
    caustic = nodes.new('ShaderNodeValToRGB')
    caustic.color_ramp.elements[0].color = (0.05, 0.08, 0.06, 1)
    caustic.color_ramp.elements[1].position = 0.035
    caustic.color_ramp.elements[1].color = (0, 0, 0, 1)
    link(ripples.outputs['Distance'], caustic.inputs['Fac'])
    light = nodes.new('ShaderNodeMix')
    light.data_type, light.blend_type = 'RGBA', 'ADD'
    light.inputs['Factor'].default_value = 1.0
    link(shade.outputs['Result'], light.inputs['A'])
    link(caustic.outputs['Color'], light.inputs['B'])
    link(light.outputs['Result'], nodes['Principled BSDF'].inputs['Base Color'])
    return ma


def lily_pad():
    """A waxy pad: two greens mixed by a Noise Texture, glossy."""
    ma = material('Lily Pad', (0.05, 0.2, 0.04), 0.2)
    nodes, link = ma.node_tree.nodes, ma.node_tree.links.new
    tex = nodes.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = 8.0
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.03, 0.12, 0.025, 1)
    ramp.color_ramp.elements[1].color = (0.12, 0.3, 0.06, 1)
    link(tex.outputs['Fac'], ramp.inputs['Fac'])
    link(ramp.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
    return ma


SKIN, FLOOR = koi_skin(), pond_floor()
PAD = lily_pad()
FLOWER = material('Lotus', (0.95, 0.62, 0.72), 0.5)
STONE = material('Pebble', (0.05, 0.05, 0.045), 0.5)


def width(u):
    """The body's half width from tail (u = 0) to head (u = 1)."""
    u = min(1.0, max(0.0, u))
    body = (1 - abs(2 * u ** 1.25 - 1) ** 2.4) ** (1 / 2.4)
    return 0.2 * body * (0.3 + 0.7 * min(1.0, u / 0.45) ** 0.7)


def koi_mesh(name, markings):
    """A koi along +X: a stretched sphere, a tail fan and two pectoral fins; `markings(point, u)` gives each
    vertex's color; the Tail group weighs 0 at the head to 1 at the tail."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1.0)
    for v in bm.verts:
        u = (v.co.z + 1) / 2
        w = width(0.03 + 0.97 * u)
        v.co = Vector(((u - 0.5) * LENGTH, v.co.x * w, v.co.y * w * 0.7))
    # The tail fan and the pectoral fins: flat grids.
    def fin(corner, along, across, cols, rows, shape):
        verts = [[bm.verts.new(corner + along * (i / cols) + across * shape(i / cols, j / rows)) for j in range(rows + 1)] for i in range(cols + 1)]
        for i in range(cols):
            for j in range(rows):
                bm.faces.new((verts[i][j], verts[i + 1][j], verts[i + 1][j + 1], verts[i][j + 1]))
    tail = Vector((-LENGTH / 2 + 0.02, 0, 0))
    fin(tail, Vector((-0.42, 0, 0)), Vector((0, 1, 0)), 6, 8, lambda s, t: (t - 0.5) * (0.05 + 0.48 * s ** 1.2) * (1 - 0.25 * (1 - abs(2 * t - 1)) * s))
    for side in (-1, 1):
        fin(Vector((0.3, side * 0.16, -0.04)), Vector((-0.12, side * 0.22, -0.03)), Vector((-1, 0, 0)), 4, 3, lambda s, t: t * 0.18 * (1 - 0.5 * s))
    # The fins face up, toward the sun and the camera.
    bm.normal_update()
    bmesh.ops.reverse_faces(bm, faces=[f for f in bm.faces if len(f.verts) == 4 and f.normal.z < -0.5 and abs(f.calc_center_median().z) < 1e-3])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
    mesh.materials.append(SKIN)
    colors = mesh.color_attributes.new('Markings', 'FLOAT_COLOR', 'POINT')
    tail_group = obj.vertex_groups.new(name='Tail')
    for v in mesh.vertices:
        u = v.co.x / LENGTH + 0.5
        colors.data[v.index].color = markings(v.co, u)
        tail_group.add([v.index], min(1.0, max(0.0, (0.6 - u) / 0.6)) ** 1.6, 'REPLACE')
    mesh.color_attributes.active_color = colors
    return obj


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def kohaku(p, u):
    """White, red patches over the back, fins pale."""
    if u < 0.05:
        return mix(WHITE, RED, 0.35)
    if abs(p.y) > 0.17 and u > 0.6:
        return mix(WHITE, (1, 0.9, 0.85, 1), 0.3)
    red = noise.noise(p * Vector((3.2, 5, 5)) + Vector((1.3, 0, 2))) + 0.25 * (p.z > 0)
    return RED if red > 0.2 and u < 0.93 else WHITE


def showa(p, u):
    """Black over the back with red and white, fins edged black."""
    if u < 0.05:
        return mix(mix(BLACK, WHITE, 0.6), RED, 0.25)
    black = noise.noise(p * 4 + Vector((5, 1, 0))) + 0.35 * (p.z > 0)
    red = noise.noise(p * 3 + Vector((0, 7, 3)))
    return BLACK if black > 0.25 else RED if red > 0.0 else WHITE


def swim(obj, location, heading, phase, amount):
    """Places the koi and swings its tail: a Simple Deform (Bend) limited to the Tail group, its angle keyed both
    ways and repeated by a Cycles modifier."""
    obj.location, obj.rotation_euler = location, (0, 0, heading)
    bend = obj.modifiers.new('Tail Swing', 'SIMPLE_DEFORM')
    bend.deform_method, bend.deform_axis, bend.vertex_group = 'BEND', 'Z', 'Tail'
    obj.modifiers.new('Subdivision', 'SUBSURF').levels = 1
    for i, frame in enumerate((1, 13, 25, 37, 49)):
        bend.angle = amount * math.cos(math.pi * i / 2 + phase) * (1 if i % 2 == 0 else 0.15)
        obj.keyframe_insert('modifiers["Tail Swing"].angle', frame=frame)
    curve = action_get_channelbag_for_slot(obj.animation_data.action, obj.animation_data.action_slot).fcurves[0]
    curve.modifiers.new('CYCLES')


swim(koi_mesh('Kohaku', kohaku), (-0.5, -0.35, 0.35), math.radians(25), 0, math.radians(40))
swim(koi_mesh('Showa', showa), (0.75, 0.75, 0.25), math.radians(200), math.pi, math.radians(35))

bpy.ops.mesh.primitive_plane_add(size=12)
floor = bpy.context.object
floor.name = 'Pond Floor'
floor.data.materials.append(FLOOR)
for i in range(14):
    a, r = random.uniform(0, 2 * math.pi), random.uniform(0.6, 3.0)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=random.uniform(0.05, 0.12), location=(r * math.cos(a), r * math.sin(a), 0.02))
    pebble = bpy.context.object
    pebble.name = 'Pebble'
    pebble.scale = (1, random.uniform(0.6, 0.9), 0.45)
    pebble.rotation_euler.z = random.uniform(0, math.pi)
    pebble.data.materials.append(STONE)
    bpy.ops.object.shade_smooth()
# Lily pads float above the fish: discs with a notch, one in flower.
for x, y, r, turn in [(0.9, -0.9, 0.42, 0.5), (1.5, -0.2, 0.3, 2.0), (-1.3, 0.8, 0.5, 4.0), (-0.4, 1.4, 0.28, 1.0), (1.7, 1.6, 0.36, 3.0)]:
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=r, fill_type='TRIFAN', location=(x, y, 0.62), rotation=(0, 0, turn))
    pad = bpy.context.object
    pad.name = pad.data.name = 'Lily Pad'
    bm = bmesh.new()
    bm.from_mesh(pad.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if abs(math.atan2(f.calc_center_median().y, f.calc_center_median().x)) < 0.18], context='FACES')
    bm.to_mesh(pad.data)
    bm.free()
    pad.modifiers.new('Solidify', 'SOLIDIFY').thickness = 0.015
    pad.data.materials.append(PAD)
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.12, location=(-1.25, 0.75, 0.7))
bud = bpy.context.object
bud.name = 'Lotus'
bud.scale = (1, 1, 1.4)
bud.data.materials.append(FLOWER)
bpy.ops.object.shade_smooth()

sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy, sun.data.color, sun.data.angle = 4.5, (1.0, 0.95, 0.85), math.radians(3)
sun.rotation_euler = (math.radians(25), math.radians(-15), 0)
scene.collection.objects.link(sun)

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 50
camera.location = (0.2, -0.6, 6.2)
camera.rotation_euler = (Vector((0.2, 0.15, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(camera)
scene.camera = camera

bpy.ops.object.select_all(action='DESELECT')
kohaku = bpy.data.objects['Kohaku']
bpy.context.view_layer.objects.active = kohaku
kohaku.select_set(True)
here = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(here, 'vertex-and-weight-paint.blend'), compress=True)

if '--' in sys.argv:
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_percentage = 30
    scene.render.filepath = sys.argv[sys.argv.index('--') + 1]
    bpy.ops.render.render(write_still=True)
