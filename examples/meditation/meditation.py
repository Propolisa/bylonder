"""Builds meditation.blend: the character examples' mannequin (Quaternius' Universal Animation Library, CC0 1.0) seated
cross-legged on a cushion in a bright earthen room, deep in thought, breathing, swaying and settling barely but
perceptibly, while low sun through an arched window and two round ports lays patches of light across the floor, the
curved walls and the figure. Everything is grey or off-white but a green turtle inlaid in the floor. In Blender 5.2.3.

The motion is the rig's own action, Meditation, 54 s that loop: breathing keyed once and repeated by a Cycles
modifier (12 breaths of 4.5 s), slow sway and micro-shifts from Noise modifiers on a few bones (their range blended in
and out, so the loop has no seam), and two slow settles of the head.

The room's light is baked with Cycles into lightmaps: each lit mesh has a second UV map, Lightmap (Smart UV Project),
and an image of the light reaching it (Diffuse, direct and indirect, without its colour), the figure in place (its contact shadows
baked). The figure's lightmap holds the light it gives back of the sky and the room's bounce (with its colour, darkened by its
own occlusion), so the sun lights it live as it breathes. Each is set as the object's Bylonder
lightmap (Object properties > Lightmap: `object.bylonder.lightmap`), which an export draws with Babylon's
lightmapTexture. MEDITATION_BAKE=0 skips the bakes, MEDITATION_SAMPLES sets their samples (default 256, then denoised) and
MEDITATION_GPU=1 bakes on the GPU.

usage: blender -b --factory-startup -P meditation.py
"""
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from bpy_extras import anim_utils
from mathutils import Matrix, Quaternion, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
# Bylonder's Bake Lightmaps, which bakes and stores each lightmap as the app does.
sys.path.insert(0, os.path.join(HERE, '..', '..', 'src', 'render'))
import bylonder_lightmaps as lightmaps  # noqa: E402
BAKE = os.environ.get('MEDITATION_BAKE', '1') != '0'
SAMPLES = int(os.environ.get('MEDITATION_SAMPLES', '256'))
FPS, BREATH, BREATHS = 30, 135, 12
LOOP = BREATH * BREATHS
random.seed(3)

bpy.ops.wm.read_factory_settings(use_empty=True)


# Bylonder's lightmap setting (Object properties > Lightmap), registered as Bylonder registers it, so the .blend keeps it
# where Bylonder reads it.
class BYLONDER_PG_lightmap(bpy.types.PropertyGroup):
    image: bpy.props.PointerProperty(type=bpy.types.Image)
    uv_map: bpy.props.StringProperty(default='Lightmap')
    intensity: bpy.props.FloatProperty(default=1, min=0)
    direct: bpy.props.BoolProperty(default=True)


class BYLONDER_PG_object(bpy.types.PropertyGroup):
    lightmap: bpy.props.PointerProperty(type=BYLONDER_PG_lightmap)


bpy.utils.register_class(BYLONDER_PG_lightmap)
bpy.utils.register_class(BYLONDER_PG_object)
bpy.types.Object.bylonder = bpy.props.PointerProperty(type=BYLONDER_PG_object)
scene = bpy.context.scene
scene.name = 'Meditation'
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, LOOP
scene.render.resolution_x, scene.render.resolution_y = 1280, 720
scene.render.engine = 'BLENDER_EEVEE'
scene.eevee.use_shadows = True
scene.eevee.use_raytracing = True
# Three shadow rays: the sun's soft shadow filtered at its finest, in EEVEE and in an export.
scene.eevee.shadow_ray_count = 3
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - High Contrast'
scene.view_settings.exposure = 0.2

world = bpy.data.worlds.new('Overcast')
scene.world = world
background = world.node_tree.nodes['Background']
background.inputs['Color'].default_value = (0.8, 0.8, 0.8, 1)
background.inputs['Strength'].default_value = 0.35


def grey(name, value, roughness=0.8):
    """A material of one grey."""
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (value, value, value, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    mat.diffuse_color = (value, value, value, 1)
    return mat


PLASTER = grey('Plaster', 0.8, 0.9)
# The one colour in the room: the turtle inlaid in the floor.
TURTLE = bpy.data.materials.new('Turtle Green')
TURTLE.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = TURTLE.diffuse_color = (0.05, 0.22, 0.08, 1)
# Matte, as worn inlay is: a lightmap holds diffuse light only, so a sheen would be lost in the page.
TURTLE.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
TURTLE.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.0


EARTH = grey('Earthen Plaster', 0.72, 0.9)
CUSHION = grey('Cushion', 0.2, 1.0)
WOOD = grey('Driftwood', 0.5, 0.7)
STONE = grey('Stone', 0.2, 0.5)


def link(ob):
    scene.collection.objects.link(ob)
    return ob


def mesh_object(name, build, mat, location=(0, 0, 0)):
    """An object of a mesh `build(bm)` makes."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    build(bm)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    ob = bpy.data.objects.new(name, mesh)
    ob.location = location
    return link(ob)


def cuboid(bm, lo, hi):
    verts = bmesh.ops.create_cube(bm, size=1.0)['verts']
    bmesh.ops.scale(bm, vec=[h - l for l, h in zip(lo, hi)], verts=verts)
    bmesh.ops.translate(bm, vec=[(l + h) / 2 for l, h in zip(lo, hi)], verts=verts)
    return verts


def boxes(name, parts, mat):
    """One object of boxes, each (min, max)."""
    def build(bm):
        for lo, hi in parts:
            cuboid(bm, lo, hi)
    return mesh_object(name, build, mat)


def smooth(ob, levels=2, bevel=None):
    """Bevel and Subdivision Surface, applied, so the lightmap's UV map is the mesh's own."""
    if bevel:
        mod = ob.modifiers.new('Bevel', 'BEVEL')
        mod.width, mod.segments = bevel, 3
    if levels:
        ob.modifiers.new('Subdivision', 'SUBSURF').levels = levels
    bpy.context.view_layer.objects.active = ob
    for mod in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for poly in ob.data.polygons:
        poly.use_smooth = True
    return ob


# ---- The room: an earthen room 5 m by 5.5 m and 2.8 m high, hand-plastered, its walls flowing into the floor and the
# ceiling in wide curves, an arched window and two round light ports in the left wall (-X), and a niche in the back
# wall. The sun comes in low through them from the left and the camera's side: the arch lays a long patch across the
# floor and the figure that bends up the curve of the back wall, the ports round spots above the niche. Built as a box with
# rounded edges, thickened, cut, remeshed and smoothed (which rounds the cuts' rims too), then undulated a few centimetres
# by slow noise; the floor stays flat where the figure sits.
W, D0, D1, H = 2.5, -3.0, 2.5, 2.8
T = 0.3
SILL, SPRING, WIN0, WIN1 = 0.4, 1.45, -1.95, -0.05
HEAD = SPRING + (WIN1 - WIN0) / 2
# The light ports: (y, z, radius) on the left wall.
PORTS = [(1.25, 2.0, 0.19), (1.75, 1.78, 0.14)]
ELEVATION, AZIMUTH = math.radians(15), math.radians(35)
SUN = Vector((math.cos(ELEVATION) * math.cos(AZIMUTH), math.cos(ELEVATION) * math.sin(AZIMUTH), -math.sin(ELEVATION)))


def arch(name, axis, center, half_width, bottom, spring, depth):
    """A cutter: a prism of an arch's outline (straight sides, a round top) along `axis` ('X' or 'Y')."""
    def build(bm):
        outline = [(-half_width, bottom), (half_width, bottom)] + [
            (half_width * math.cos(a), spring + half_width * math.sin(a)) for a in np.linspace(0, math.pi, 24)]
        verts = [bm.verts.new((d, u, v) if axis == 'X' else (u, d, v)) for u, v in outline for d in (0,)]
        face = bm.faces.new(verts)
        extruded = bmesh.ops.extrude_face_region(bm, geom=[face])['geom']
        bmesh.ops.translate(bm, vec=(depth, 0, 0) if axis == 'X' else (0, depth, 0), verts=[g for g in extruded if isinstance(g, bmesh.types.BMVert)])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_object(name, build, PLASTER)
    ob.location = center
    return ob


def port(y, z, radius):
    """A cutter: a round port through the left wall."""
    def build(bm):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=radius, radius2=radius, depth=1.0)
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    return mesh_object('Port Cutter', build, PLASTER, (-W - T / 2, y, z))


def apply(ob, kind, **settings):
    mod = ob.modifiers.new(kind.title(), kind)
    for key, value in settings.items():
        setattr(mod, key, value)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)


def shell():
    room = boxes('Room', [((-W, D0, 0), (W, D1, H))], EARTH)
    bm = bmesh.new()
    bm.from_mesh(room.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(room.data)
    bm.free()
    apply(room, 'BEVEL', width=0.7, segments=10)
    apply(room, 'SOLIDIFY', thickness=T, offset=-1)
    window = arch('Window Cutter', 'X', (-W - T - 0.2, (WIN0 + WIN1) / 2, 0), (WIN1 - WIN0) / 2, SILL, SPRING, T + 0.5)
    niche = arch('Niche Cutter', 'Y', (-1.45, D1 - 0.2, 0), 0.45, 0.6, 1.15, 0.42)
    ports = [port(y, z, r) for y, z, r in PORTS]
    for cutter in (window, niche, *ports):
        apply(room, 'BOOLEAN', object=cutter, operation='DIFFERENCE', solver='EXACT')
        bpy.data.objects.remove(cutter)
    apply(room, 'REMESH', mode='VOXEL', voxel_size=0.06)
    # The cutters' material came along; the remeshed faces are all the plaster's.
    while len(room.data.materials) > 1:
        room.data.materials.pop()
    apply(room, 'SMOOTH', factor=1.0, iterations=6)
    # Only the inside: what is further out than the plaster's thickness goes.
    bm = bmesh.new()
    bm.from_mesh(room.data)
    outside = [v for v in bm.verts if v.co.x < -W - T * 0.6 or v.co.x > W + 0.05 or v.co.y < D0 - 0.05 or v.co.y > D1 + T * 0.75
               or v.co.z < -0.05 or v.co.z > H + 0.05]
    bmesh.ops.delete(bm, geom=outside, context='VERTS')
    bm.normal_update()
    # The hand-plastered undulation, none on the floor where it is flat.
    for v in bm.verts:
        weight = min(1.0, max(0.0, (v.co.z - 0.02) / 0.3))
        bump = noise.noise(v.co * 0.9) * 0.035 + noise.noise(v.co * 3.1 + Vector((7, 3, 1))) * 0.008
        v.co += v.normal * bump * weight
    for face in bm.faces:
        face.smooth = True
    bm.to_mesh(room.data)
    bm.free()
    return room


room = shell()

# ---- The zafu, round and soft, and a log bench below the niche with a stone bowl in the niche.
SEAT, TURN = Vector((0.6, 0.9, 0)), math.radians(20)


def zafu(bm):
    bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=0.2, radius2=0.2, depth=0.17)
    bmesh.ops.translate(bm, vec=(0, 0, 0.085), verts=bm.verts)


cushion = smooth(mesh_object('Cushion', zafu, CUSHION), levels=2, bevel=0.06)
# Under the hips, behind the knees and shins.
cushion.location = SEAT + Matrix.Rotation(TURN, 3, 'Z') @ Vector((0, 0.09, 0))


def log(bm, a, b, radius, seed):
    """A length of branch from `a` to `b`, its girth and line wandering a little, rounded at the ends."""
    rng = random.Random(seed)
    axis = b - a
    ring, rings = 16, 14
    side = axis.orthogonal().normalized()
    up = axis.cross(side).normalized()
    rows = []
    for i in range(rings + 1):
        t = i / rings
        end = min(t, 1 - t) * rings
        r = radius * (1 + 0.1 * noise.noise(Vector((t * 3, seed, 0)))) * (0.75 + 0.25 * min(1.0, end))
        bend = up * 0.03 * math.sin(math.pi * t) + side * 0.02 * noise.noise(Vector((t * 2, 0, seed)))
        center = a + axis * t + bend
        rows.append([bm.verts.new(center + (side * math.cos(k / ring * math.tau) + up * math.sin(k / ring * math.tau)) * r * (1 + rng.uniform(-0.02, 0.02)))
                     for k in range(ring)])
    for r0, r1 in zip(rows, rows[1:]):
        for k in range(ring):
            bm.faces.new((r0[k], r0[(k + 1) % ring], r1[(k + 1) % ring], r1[k]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])


def bench_parts(bm):
    log(bm, Vector((-2.15, 2.12, 0.3)), Vector((-0.75, 2.18, 0.31)), 0.09, 1)
    for x, seed in ((-1.95, 2), (-0.95, 3)):
        log(bm, Vector((x, 2.15, 0)), Vector((x + 0.02, 2.15, 0.26)), 0.07, seed)


bench = mesh_object('Bench', bench_parts, WOOD)
for poly in bench.data.polygons:
    poly.use_smooth = True
bowl = mesh_object('Bowl', lambda bm: bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=0.12), STONE, (-1.45, D1 + 0.05, 0.65))
bowl.scale.z = 0.45


# ---- The turtle: a green sea turtle inlaid in the floor, flat and graphic, the figure seated on its shell. Its shell is
# seven large plates (three down the middle, two each side) with plaster showing between them; a head on a neck, four
# flippers and a short tail; every edge wanders a centimetre, as worn inlay does.
SHELL = (1.0, 1.25)
# Swimming toward the window, across the camera's view, where it reads at its full length.
TURTLE_AT, HEADING = SEAT + Vector((-0.1, 0.05, 0)), math.radians(-69)
GAP = 0.05


def wander(points, seed):
    return [p + Vector((noise.noise(Vector((p.x * 6, p.y * 6, seed))), noise.noise(Vector((p.y * 6, seed, p.x * 6))), 0)) * 0.012 for p in points]


def shell_plate(x0, x1, y0, y1, steps=10):
    """A plate of the shell: the box x0..x1, y0..y1 (in the shell's radii) inset by the gap and clipped to the shell."""
    rx, ry = SHELL
    gx, gy = GAP / 2 / rx, GAP / 2 / ry
    x0, x1, y0, y1 = x0 + gx, x1 - gx, y0 + gy, y1 - gy
    edge = lambda a, b: [a.lerp(b, t) for t in np.linspace(0, 1, steps, endpoint=False)]
    corners = [Vector((x0, y0, 0)), Vector((x1, y0, 0)), Vector((x1, y1, 0)), Vector((x0, y1, 0))]
    rim = 1 - GAP / ry
    points = [p if p.length <= rim else p * (rim / p.length) for i in range(4) for p in edge(corners[i], corners[(i + 1) % 4])]
    return [Vector((p.x * rx, p.y * ry, 0)) for p in points]


def limb(base, direction, length, width, bend, steps=12, head=0.0):
    """A flipper, tail or neck outline: a curved paddle from `base` along `direction`, tapering to its tip, or with
    `head`, swelling into a head of that half width at its end."""
    d = Vector(direction).normalized()
    side = Vector((-d.y, d.x, 0))
    left, right = [], []
    for i in range(steps + 1):
        t = i / steps
        center = base + d * (length * t) + side * (bend * t * t)
        half = (width + (head - width) * math.sin(math.pi * max(0.0, t - 0.45) / 0.55) ** 0.7 if head
                else width * math.sin(math.pi * min(1.0, 0.15 + 0.85 * t)) ** 0.6 * (1 - 0.45 * t)) + 0.004
        left.append(center + side * half)
        right.append(center - side * half)
    return left + right[::-1]


def turtle(bm):
    rx, ry = SHELL
    shapes = [shell_plate(-0.34, 0.34, y0, y1) for y0, y1 in ((-1, -0.3), (-0.3, 0.3), (0.3, 1))]
    shapes += [shell_plate(x0, x1, y0, y1) for x0, x1 in ((-1, -0.34), (0.34, 1)) for y0, y1 in ((-1, 0), (0, 1))]
    # Its front is -Y: the head on its neck out of the shell's front, the flippers sweeping back, the tail behind.
    shapes.append(limb(Vector((0, -ry + 0.05, 0)), (0, -1, 0), 0.75, 0.12, 0.0, 16, head=0.22))
    for side in (1, -1):
        shapes.append(limb(Vector((side * (rx - 0.05), -ry * 0.4, 0)), (side * 1.0, -0.25, 0), 1.2, 0.24, side * 0.6))
        shapes.append(limb(Vector((side * (rx * 0.75), ry * 0.6, 0)), (side * 0.8, 0.6, 0), 0.6, 0.17, side * 0.12))
    shapes.append(limb(Vector((0, ry - 0.05, 0)), (0, 1, 0), 0.38, 0.09, 0.0, 6))
    turn = Matrix.Rotation(HEADING, 3, 'Z')
    for i, outline in enumerate(shapes):
        # The shell's plates lie over the neck and the flippers where they meet.
        lift = 0.004 if i < 7 else 0.003
        bm.faces.new([bm.verts.new(TURTLE_AT + turn @ p + Vector((0, 0, lift))) for p in wander(outline, i)])
    # Every face up, as the floor's: a page draws one side only.
    bm.normal_update()
    for face in bm.faces:
        if face.normal.z < 0:
            face.normal_flip()
    bmesh.ops.triangulate(bm, faces=bm.faces[:])


inlay = mesh_object('Turtle', turtle, TURTLE)
# Lying in the floor, it shades nothing: the floor under it bakes as lit as the plaster between its plates.
inlay.visible_shadow = False

# ---- The sun: small (1 degree), so the openings' shadows are sharp near and soft far.
sun_data = bpy.data.lights.new('Sun', 'SUN')
sun_data.energy, sun_data.angle = 6.0, math.radians(1.0)
sun = link(bpy.data.objects.new('Sun', sun_data))
sun.location = (-4, -2, 4)
sun.rotation_euler = SUN.to_track_quat('-Z', 'Y').to_euler()

# ---- The figure: appended from ../basic-character/basic-character.blend, its colours made grey.
with bpy.data.libraries.load(os.path.join(HERE, '..', 'basic-character', 'basic-character.blend'), link=False) as (source, data):
    data.objects = list(source.objects)
rig = next(ob for ob in data.objects if ob and ob.type == 'ARMATURE')
for ob in data.objects:
    if ob and (ob == rig or ob.parent == rig):
        link(ob)
    elif ob:
        bpy.data.objects.remove(ob)
# What came with the rig and nothing uses (the character examples' ground and its images) goes.
bpy.data.orphans_purge(do_recursive=True)
figure = next(ob for ob in rig.children if ob.type == 'MESH')
rig.name, figure.name = 'Meditator', 'Mannequin'
for mat, value in zip(figure.data.materials, (0.62, 0.32)):
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (value, value, value, 1)
    bsdf.inputs['Roughness'].default_value = 0.55
    mat.diffuse_color = (value, value, value, 1)
rig.animation_data.action = None
for track in list(rig.animation_data.nla_tracks):
    rig.animation_data.nla_tracks.remove(track)
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
rig.rotation_mode = 'XYZ'
rig.location, rig.rotation_euler = SEAT, (0, 0, TURN)

# ---- The seated pose, set with the rig's bones: each aimed at a point in the rig's space (it faces -Y, left is +X).
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
pose = rig.pose.bones


def head_of(name):
    pb = pose[name]
    if not pb.parent:
        return pb.bone.head_local.copy()
    return (pb.parent.matrix @ pb.parent.bone.matrix_local.inverted() @ pb.bone.matrix_local).translation


def aim(name, direction, twist=0.0, at=None):
    """Turns a bone so it points along `direction` (the least turn from its rest), then about itself by `twist` degrees."""
    pb = pose[name]
    rest = pb.bone.matrix_local.to_3x3()
    turned = rest.col[1].rotation_difference(Vector(direction).normalized()).to_matrix() @ rest
    turned = Matrix.Rotation(math.radians(twist), 3, turned.col[1]) @ turned
    matrix = turned.to_4x4()
    matrix.translation = Vector(at) if at else head_of(name)
    pb.matrix = matrix
    bpy.context.view_layer.update()


def reach(upper, lower, target, pole):
    """Two bones from the upper's head to `target`, bending toward `pole` (a direction), as an IK chain settles."""
    a, target = head_of(upper), Vector(target)
    l1, l2 = pose[upper].bone.length, pose[lower].bone.length
    d = target - a
    dist = min(d.length, (l1 + l2) * 0.999)
    dn = d.normalized()
    cos_a = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
    p = (Vector(pole) - dn * Vector(pole).dot(dn)).normalized()
    joint = a + dn * (l1 * cos_a) + p * (l1 * math.sqrt(max(0.0, 1 - cos_a * cos_a)))
    aim(upper, joint - a)
    aim(lower, (a + dn * dist) - joint)


# Sitting on the front of the cushion, the spine upright and long, the head bowed a little.
HIP_HEIGHT = 0.26
aim('DEF-hips', (0, 0.0, 1), at=(0, 0.0, HIP_HEIGHT))
for name, direction in (('DEF-spine.001', (0, 0.03, 1)), ('DEF-spine.002', (0, 0.02, 1)), ('DEF-spine.003', (0, 0.0, 1)),
                        ('DEF-neck', (0, -0.12, 1)), ('DEF-head', (0, -0.5, 1))):
    aim(name, direction)
for side in (1, -1):
    s = 'L' if side > 0 else 'R'
    # The shoulders dropped; the hands resting on the thighs, palms down, the elbows soft.
    aim(f'DEF-shoulder.{s}', (side * 0.19, 0.11, -0.07))
    reach(f'DEF-upper_arm.{s}', f'DEF-forearm.{s}', (side * 0.2, -0.2, HIP_HEIGHT + 0.06), (side * 0.6, 1, -0.2))
    forearm = pose[f'DEF-forearm.{s}']
    along = (forearm.tail - forearm.head).normalized()
    # Palms up on the thighs in a mudra: thumb and index touching, the other fingers soft.
    aim(f'DEF-hand.{s}', along + Vector((side * 0.3, -0.3, -0.35)), twist=side * 170)
    for finger, degrees in (('thumb', 22), ('index', 38), ('middle', 16), ('ring', 18), ('pinky', 20)):
        for joint in ('01', '02', '03'):
            pose[f'DEF-{"thumb" if finger == "thumb" else "f_" + finger}.{joint}.{s}'].rotation_quaternion = Quaternion((1, 0, 0), math.radians(degrees))
    bpy.context.view_layer.update()
# An easy seat: the knees out and below the hips, each foot under the other knee, the left shin in front.
for side, knee, ankle in ((1, (0.4, -0.2, 0.06), (-0.2, -0.33, 0.05)), (-1, (-0.4, -0.18, 0.06), (0.2, -0.17, 0.05))):
    s = 'L' if side > 0 else 'R'
    aim(f'DEF-thigh.{s}', Vector(knee) - head_of(f'DEF-thigh.{s}'))
    aim(f'DEF-shin.{s}', Vector(ankle) - head_of(f'DEF-shin.{s}'))
    shin = pose[f'DEF-shin.{s}']
    across = (shin.tail - shin.head).normalized()
    aim(f'DEF-foot.{s}', across + Vector((0, 0, -0.25)), twist=side * 70)
    aim(f'DEF-toe.{s}', across + Vector((0, 0, -0.15)), twist=side * 70)
# The seat checked: both knees well below the hips, both feet in front of the pelvis (-Y), the hands above the thighs.
hips = pose['DEF-hips'].head
for s in 'LR':
    assert pose[f'DEF-shin.{s}'].head.z < hips.z - 0.12, f'the {s} knee is below the hips'
    assert pose[f'DEF-foot.{s}'].head.y < hips.y - 0.1, f'the {s} foot is in front of the pelvis'
    assert pose[f'DEF-hand.{s}'].head.z > 0.2, f'the {s} hand rests on the thigh, not the floor'

# ---- Meditation, the rig's action: the pose keyed, then breathing, sway and settles on top of it.
POSED = [pb for pb in pose if pb.matrix_basis != Matrix.Identity(4)]
for pb in POSED:
    pb.keyframe_insert('rotation_quaternion', frame=1)
pose['DEF-hips'].keyframe_insert('location', frame=1)
action = rig.animation_data.action
action.name = 'Meditation'
curves = anim_utils.action_get_channelbag_for_slot(action, rig.animation_data.action_slot).fcurves


def curve(bone, path, index):
    return curves.find(f'pose.bones["{bone}"].{path}', index=index)


def turned(bone, axis, degrees):
    """The bone's keyed rotation turned about its own axis by `degrees`."""
    rest = Quaternion([curve(bone, 'rotation_quaternion', i).keyframe_points[0].co.y for i in range(4)])
    return rest @ Quaternion(axis, math.radians(degrees))


def key_rotation(bone, frames):
    """Keys a bone's rotation at each (frame, quaternion), replacing its keys."""
    for i in range(4):
        fc = curve(bone, 'rotation_quaternion', i)
        fc.keyframe_points.clear()
        for frame, q in frames:
            fc.keyframe_points.insert(frame, q[i], options={'FAST'})
        fc.update()


# Breathing: in for 40% of the breath, out for the rest, the chest opening and the shoulders lifting about 1 cm;
# keyed over one breath and repeated by a Cycles modifier.
INHALE = 1 + round(BREATH * 0.4)
def lifting(bone):
    """The bone's own axis that turns its tip straight up."""
    pb = pose[bone]
    return pb.matrix.to_3x3().inverted() @ (pb.tail - pb.head).cross(Vector((0, 0, 1))).normalized()


for bone, axis, degrees in (('DEF-spine.002', (1, 0, 0), -0.7), ('DEF-spine.003', (1, 0, 0), -0.9),
                            ('DEF-shoulder.L', lifting('DEF-shoulder.L'), 2.6), ('DEF-shoulder.R', lifting('DEF-shoulder.R'), 2.6), ('DEF-neck', (1, 0, 0), 0.6)):
    rest = turned(bone, axis, 0)
    key_rotation(bone, [(1, rest), (INHALE, turned(bone, axis, degrees)), (1 + BREATH, rest)])
    for i in range(4):
        curve(bone, 'rotation_quaternion', i).modifiers.new('CYCLES')


# Sway and micro-shifts: slow noise of a fraction of a degree on the hips and the spine, a little more at the head, each
# of its own scale and phase so they never line up; faded in and out at the loop's ends so it repeats without a seam.
def noise(bone, path, index, strength, scale, phase):
    mod = curve(bone, path, index).modifiers.new('NOISE')
    mod.strength, mod.scale, mod.phase, mod.depth = strength, scale, phase, 1
    mod.use_restricted_range, mod.frame_start, mod.frame_end = True, 1, LOOP
    mod.blend_in = mod.blend_out = 150


for bone, strength, scales in (('DEF-hips', 0.006, (260, 410, 330)), ('DEF-spine.002', 0.005, (190, 290, 370)),
                               ('DEF-neck', 0.008, (230, 170, 310)), ('DEF-head', 0.012, (150, 270, 200))):
    for index, scale in zip((1, 2, 3), scales):
        noise(bone, 'rotation_quaternion', index, strength, scale, random.uniform(0, 100))

# The head's settles: twice in the loop it sinks a little lower over a few seconds and slowly comes back.
head = 'DEF-head'
key_rotation(head, [(1, turned(head, (1, 0, 0), 0)), (420, turned(head, (1, 0, 0), 0)), (520, turned(head, (1, 0, 0), 2.2)),
                    (760, turned(head, (1, 0, 0), 0.4)), (1150, turned(head, (1, 0, 0), 0.4)), (1240, turned(head, (1, 0, 0), 1.8)),
                    (1500, turned(head, (1, 0, 0), 0)), (LOOP, turned(head, (1, 0, 0), 0))])
for i in (1, 2, 3):
    noise(head, 'rotation_quaternion', i, 0.012, (150, 270, 200)[i - 1], random.uniform(0, 100))
bpy.ops.object.mode_set(mode='OBJECT')

# ---- The camera: low, at the figure's height, the figure on the right third, in the light; it drifts a few
# centimetres and back over the loop.
cam_data = bpy.data.cameras.new('Camera')
cam_data.lens = 22
camera = link(bpy.data.objects.new('Camera', cam_data))
scene.camera = camera
look = Vector((-0.5, 1.2, 0.3))
for frame, offset in ((1, 0.0), (LOOP // 2, 0.06), (LOOP, 0.0)):
    camera.location = Vector((1.9 + offset, -2.6, 1.75))
    camera.rotation_euler = (look - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.keyframe_insert('location', frame=frame)
    camera.keyframe_insert('rotation_euler', frame=frame)

# ---- Lightmaps: a second UV map on each lit mesh (Smart UV Project: few large islands, so the curves bake without
# seams), then Bylonder's Bake Lightmaps (src/render/bylonder_lightmaps.py): Cycles' bake of its light, denoised by Open
# Image Denoise, stored over its peak as the object's lightmap.
ROOM = {room: 2048, inlay: 1024, cushion: 256, bench: 256, bowl: 128}


def lightmap_uvs(ob):
    uv = ob.data.uv_layers.get('Lightmap') or ob.data.uv_layers.new(name='Lightmap')
    if not ob.data.uv_layers.get('UVMap') and len(ob.data.uv_layers) == 1:
        ob.data.uv_layers.new(name='UVMap')
        ob.data.uv_layers['UVMap'].active_render = True
    ob.data.uv_layers.active = uv
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, area_weight=1.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.data.uv_layers.active = ob.data.uv_layers[0]


for ob in [*ROOM, figure]:
    lightmap_uvs(ob)


if BAKE:
    scene.cycles.device = 'GPU' if os.environ.get('MEDITATION_GPU') else 'CPU'
    scene.frame_set(1)
    for ob, size in ROOM.items():
        # The floor under the turtle bakes as if it were not there (it lies a few millimetres above it).
        inlay.visible_diffuse = ob != room
        lightmaps.bake_lightmap(ob, size, direct=True, samples=SAMPLES)
    inlay.visible_diffuse = True
    # The figure: the light it gives back of everything but the sun's direct light, which the page gives it live.
    lightmaps.bake_lightmap(figure, 512, direct=False, samples=SAMPLES)

scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'meditation.blend'), compress=True)
