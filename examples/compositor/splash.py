"""Renders Bylonder's splash (public/splash.webp) from compositor.blend: the last bowl of the night, steaming on the
window's sill, the rainy lane soft behind it. The bowl, its steam, a rim light and the Splash camera are added here
for the splash only, so the example stays as it is.

usage: blender -b compositor.blend -P splash.py [-- --engine CYCLES --width 640 --out PATH]
"""
import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
parser = argparse.ArgumentParser()
parser.add_argument('--engine', default='BLENDER_EEVEE')
# Twice the splash's 502 px display width.
parser.add_argument('--width', type=int, default=1004)
parser.add_argument('--out', default=os.path.join(HERE, '..', '..', 'public', 'splash.webp'))
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

scene = bpy.context.scene
collection = scene.collection
objects = bpy.data.objects
scene.frame_set(1)
# Where the bowl stands: on the window's sill, left of her stool.
BOWL = Vector((-0.75, -0.1, 1.0))


def material(name, color, roughness=0.5, emission=0.0, subsurface=0.0):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Subsurface Weight'].default_value = subsurface
    if emission:
        bsdf.inputs['Emission Color'].default_value, bsdf.inputs['Emission Strength'].default_value = (*color, 1), emission
    return mat


def finish(obj, mat):
    obj.data.materials.append(mat)
    if obj.type == 'MESH':
        obj.data.shade_smooth()
    collection.objects.link(obj)
    return obj


def lathe(name, profile, mats, segments=48):
    """A surface of revolution from (radius, height) points about the bowl's axis; the outside gets the first
    material, the inside the second (bmesh's spin winds the faces so their normals point in)."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, z)) for r, z in profile]
    edges = [bm.edges.new(pair) for pair in zip(verts, verts[1:])]
    bmesh.ops.spin(bm, geom=verts + edges, axis=(0, 0, 1), cent=(0, 0, 0), angle=2 * math.pi, steps=segments, use_merge=True)
    bm.to_mesh(mesh)
    bm.free()
    obj = objects.new(name, mesh)
    for mat in mats:
        mesh.materials.append(mat)
    for poly in mesh.polygons:
        radial = Vector((poly.center.x, poly.center.y, 0)).normalized()
        poly.material_index = 0 if poly.normal.dot(radial) < 0 else 1
    mesh.shade_smooth()
    obj.location = BOWL
    collection.objects.link(obj)
    return obj


def strand(name, points, mat, radius):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions, curve.bevel_depth, curve.bevel_resolution, curve.use_fill_caps = '3D', radius, 3, True
    spline = curve.splines.new('NURBS')
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (*(BOWL + Vector(co)), 1)
    spline.use_endpoint_u, spline.order_u = True, 4
    return finish(objects.new(name, curve), mat)


def blob(name, location, scale, mat, rotation=(0, 0, 0)):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1)
    bm.to_mesh(mesh)
    bm.free()
    obj = objects.new(name, mesh)
    obj.location, obj.scale, obj.rotation_euler = BOWL + Vector(location), scale, rotation
    return finish(obj, mat)


def disc(name, location, radius, depth, mat, rotation=(0, 0, 0)):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=radius, radius2=radius, depth=depth)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=depth * 0.4, segments=2, affect='EDGES')
    bm.to_mesh(mesh)
    bm.free()
    obj = objects.new(name, mesh)
    obj.location, obj.rotation_euler = BOWL + Vector(location), rotation
    finish(obj, mat)
    mesh.set_sharp_from_angle(angle=math.radians(40))
    return obj


def ramen():
    """A glazed bowl of tonkotsu ramen: wavy noodles, two slices of chashu, a jammy egg, nori, scallions, chopsticks."""
    glaze = material('Splash Bowl Glaze', (0.02, 0.025, 0.06), 0.35)
    inside = material('Splash Bowl Inside', (0.85, 0.82, 0.76), 0.2)
    # Outside up from the foot to the rim, then back down the inside.
    lathe('Splash Bowl', [(0.045, 0.0), (0.05, 0.004), (0.055, 0.006), (0.08, 0.03), (0.096, 0.065), (0.1, 0.078),
                          (0.096, 0.08), (0.09, 0.07), (0.075, 0.035), (0.05, 0.012), (0.0, 0.01)], [glaze, inside])
    broth = material('Splash Broth', (0.72, 0.46, 0.2), 0.06, subsurface=0.3)
    disc('Splash Broth', (0, 0, 0.062), 0.087, 0.002, broth)
    noodle = material('Splash Noodles', (0.93, 0.78, 0.42), 0.35, subsurface=0.3)
    # A loose nest: each strand a wavy arc around the bowl, rising out of the broth and dipping back.
    for i in range(26):
        a = i * 2.4
        r = 0.015 + 0.05 * ((i * 7) % 9) / 8
        points = [(math.cos(a + t * 0.45) * (r + 0.008 * math.sin(t * 3 + i)),
                   math.sin(a + t * 0.45) * (r + 0.008 * math.sin(t * 3 + i)),
                   0.068 + 0.007 * math.sin(t * 1.7 + i) + 0.002 * (i % 4)) for t in [k * 0.35 for k in range(12)]]
        strand(f'Splash Noodle {i + 1}', points, noodle, 0.0026)
    # Chashu: pink meat in a browned rind.
    meat = material('Splash Chashu', (0.72, 0.42, 0.34), 0.45, subsurface=0.4)
    rind = material('Splash Chashu Rind', (0.28, 0.12, 0.05), 0.35)
    for k, (x, y, turn) in enumerate(((0.042, 0.028, 0.35), (0.05, -0.014, -0.25))):
        location, rotation = (x, y, 0.074 + 0.005 * k), (0.3, turn, k * 0.8)
        disc(f'Splash Chashu {k + 1}', location, 0.022, 0.006, meat, rotation).scale.x = 1.2
        disc(f'Splash Chashu Rind {k + 1}', location, 0.025, 0.005, rind, rotation).scale.x = 1.2
    white = material('Splash Egg White', (0.92, 0.9, 0.84), 0.25, subsurface=0.3)
    yolk = material('Splash Yolk', (0.95, 0.5, 0.06), 0.2, subsurface=0.5)
    blob('Splash Egg', (-0.03, -0.03, 0.068), (0.03, 0.021, 0.014), white, (0, 0, 0.5))
    blob('Splash Yolk', (-0.03, -0.03, 0.08), (0.016, 0.012, 0.004), yolk, (0, 0, 0.5))
    nori = material('Splash Nori', (0.015, 0.03, 0.02), 0.6)
    sheet = finish(objects.new('Splash Nori', bpy.data.meshes.new('Splash Nori')), nori)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bm.to_mesh(sheet.data)
    bm.free()
    sheet.data.shade_flat()
    sheet.location, sheet.scale, sheet.rotation_euler = BOWL + Vector((-0.02, 0.06, 0.1)), (0.06, 0.0015, 0.07), (0.3, 0, 0.15)
    scallion = material('Splash Scallion', (0.25, 0.55, 0.12), 0.4)
    for k in range(14):
        a, r = k * 2.4, 0.015 + 0.004 * (k % 5)
        blob(f'Splash Scallion {k + 1}', (math.cos(a) * r + 0.005, math.sin(a) * r - 0.01, 0.075), (0.006, 0.006, 0.0025), scallion)
    wood = material('Splash Chopsticks', (0.45, 0.28, 0.14), 0.45)
    for side in (-0.007, 0.007):
        strand('Splash Chopstick', [(-0.1, side - 0.02, 0.083), (0.0, side, 0.082), (0.14, side + 0.03, 0.08)], wood, 0.0028)
    steam = objects['Bowl Steam Emitter'].copy()
    steam.location = BOWL + Vector((0, 0, 0.08))
    collection.objects.link(steam)
    settings = steam.particle_systems[0].settings.copy()
    steam.particle_systems[0].settings = settings
    settings.count, settings.particle_size = settings.count * 8, settings.particle_size * 0.8
    # Straight up from the bowl, out of the lane's wind; its own cards, glowing a little in the warm light and casting
    # no shadow (they would darken the sill like smoke).
    settings.effector_weights.all = 0
    card = settings.instance_object.copy()
    card.data = card.data.copy()
    puff = card.data.materials[0].copy()
    puff.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 1.0
    card.data.materials[0] = puff
    card.visible_shadow = False
    settings.instance_object = card
    return steam


def light(name, color, energy, location, radius):
    data = bpy.data.lights.new(name, 'POINT')
    data.color, data.energy, data.shadow_soft_size = color, energy, radius
    # Light without a highlight of its own: the glaze would mirror it as a white dot.
    data.specular_factor = 0
    obj = objects.new(name, data)
    obj.location = location
    collection.objects.link(obj)


def dim(factor, keep):
    """Every light and glowing material but the shop's own warmth and the rain dimmed, so the bowl is the one subject."""
    for data in bpy.data.lights:
        if not any(k in data.name for k in keep):
            data.energy *= factor.get(next((k for k in factor if k in data.name), ''), factor[''])
    for mat in bpy.data.materials:
        if any(k in mat.name for k in keep) or not mat.node_tree:
            continue
        gain = factor.get(next((k for k in factor if k in mat.name), ''), factor[''])
        for node in mat.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                node.inputs['Emission Strength'].default_value *= gain


def camera(location, target, fx, fy, lens, fstop):
    """The Splash camera at `location`, `target` at the frame position (fx, fy) from the top left."""
    cam = objects.new('Splash', bpy.data.cameras.new('Splash'))
    cam.data.lens, cam.data.clip_start = lens, 0.02
    d = Vector(target) - Vector(location)
    yaw = math.atan2(-d.x, d.y) + math.atan((fx - 0.5) * 36 / lens)
    tilt = math.pi / 2 + math.atan2(d.z, d.xy.length) - math.atan((0.5 - fy) * 18 / lens)
    cam.location, cam.rotation_euler = location, (tilt, 0, yaw)
    cam.data.dof.use_dof, cam.data.dof.aperture_fstop, cam.data.dof.focus_distance = True, fstop, d.length
    collection.objects.link(cam)
    scene.camera = cam
    return cam


def darken_top_left(strength):
    """A soft darkening where the splash draws its logo and wordmark, after the scene's own grade and vignette."""
    tree = scene.compositing_node_group
    nodes, links = tree.nodes, tree.links
    output = next(n for n in nodes if n.bl_idname == 'NodeGroupOutput')
    graded = output.inputs[0].links[0].from_socket
    socket = lambda sockets, identifier: next(s for s in sockets if s.identifier == identifier)
    mask = nodes.new('CompositorNodeEllipseMask')
    mask.inputs['Position'].default_value, mask.inputs['Size'].default_value = (0.2, 0.88), (0.85, 0.6)
    soft = nodes.new('CompositorNodeBlur')
    soft.inputs['Size'].default_value = (args.width / 4, args.width / 4)
    amount = nodes.new('ShaderNodeMath')
    amount.operation, amount.inputs[1].default_value = 'MULTIPLY', strength
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    socket(mix.inputs, 'B_Color').default_value = (0, 0, 0, 1)
    links.new(mask.outputs['Mask'], soft.inputs['Image'])
    links.new(soft.outputs['Image'], amount.inputs[0])
    links.new(amount.outputs[0], socket(mix.inputs, 'Factor_Float'))
    links.new(graded, socket(mix.inputs, 'A_Color'))
    links.new(socket(mix.outputs, 'Result_Color'), output.inputs[0])


# She has gone back inside; her cup's steam with her.
for name in ('Tea Break', 'Tea Cup', 'Tea Steam Emitter'):
    objects[name].hide_render = True
steam = ramen()
# The sill under the bowl wiped clean: its weathered stains read as smoke this close.
objects['Window Frame'].data.materials[0] = material('Splash Sill', (0.07, 0.04, 0.022), 0.3)
light('Splash Bowl Rim', (1, 0.55, 0.25), 45, BOWL + Vector((0.15, 0.35, 0.25)), 0.15)
dim({'': 0.35, 'Lantern': 0.2, 'Neighbor': 0.4}, keep=('Window', 'Lamplit', 'Bar Light', 'Tube', 'Steam', 'Rain', 'Dim Shop', 'Splash'))
rain = bpy.data.materials['Rain'].node_tree.nodes['Principled BSDF'].inputs['Emission Strength']
rain.default_value *= 3
cam = camera((-0.2, -0.62, 1.38), BOWL + Vector((0, 0, 0.07)), 0.64, 0.6, 50, 1.4)
# Steam cards face the camera.
steam.rotation_euler.z = math.atan2(-(cam.location.x - steam.location.x), cam.location.y - steam.location.y)
darken_top_left(0.7)

render = scene.render
render.engine = args.engine
render.resolution_x, render.resolution_y, render.resolution_percentage = args.width, args.width // 2, 100
if args.engine == 'CYCLES':
    scene.cycles.device, scene.cycles.samples, scene.cycles.use_denoising = 'CPU', 64, True
else:
    scene.eevee.taa_render_samples = 128
render.image_settings.file_format = 'WEBP'
render.image_settings.quality = 90
render.filepath = os.path.abspath(args.out)
render.use_file_extension = False
bpy.ops.render.render(write_still=True)
