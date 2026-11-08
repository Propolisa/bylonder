"""Builds compositor.blend: a noodle bar's neon sign on a brick wall over a wet street at night, finished in the
compositor (Glare's Fog Glow, Lens Distortion, a Color Balance grade and a vignette), in Blender 5.2.3.

usage: blender -b --factory-startup -P compositor.py
"""
import math
import os

import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def emission(name, color, strength):
    mat = bpy.data.materials.new(name)
    principled = mat.node_tree.nodes['Principled BSDF']
    principled.inputs['Base Color'].default_value = (*color, 1)
    principled.inputs['Emission Color'].default_value = (*color, 1)
    principled.inputs['Emission Strength'].default_value = strength
    return mat


def plane(name, size, location, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_plane_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (*size, 1)
    bpy.ops.object.transform_apply(scale=True)
    return obj


# The wall: Brick Texture over the UVs, scaled to the wall's size in meters.
wall = plane('Wall', (16, 9), (0, 0.05, 3.5), (math.pi / 2, 0, 0))
mat = bpy.data.materials.new('Brick')
nodes, links = mat.node_tree.nodes, mat.node_tree.links
principled = nodes['Principled BSDF']
principled.inputs['Roughness'].default_value = 0.85
coord = nodes.new('ShaderNodeTexCoord')
wall_size = nodes.new('ShaderNodeMapping')
wall_size.inputs['Scale'].default_value = (16, 9, 1)
brick = nodes.new('ShaderNodeTexBrick')
brick.inputs['Scale'].default_value = 0.8
brick.inputs['Color1'].default_value = (0.10, 0.035, 0.03, 1)
brick.inputs['Color2'].default_value = (0.06, 0.03, 0.025, 1)
brick.inputs['Mortar'].default_value = (0.025, 0.025, 0.025, 1)
brick.inputs['Mortar Size'].default_value = 0.02
bump = nodes.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = 0.4
links.new(coord.outputs['UV'], wall_size.inputs['Vector'])
links.new(wall_size.outputs['Vector'], brick.inputs['Vector'])
links.new(brick.outputs['Color'], principled.inputs['Base Color'])
links.new(brick.outputs['Fac'], bump.inputs['Height'])
links.new(bump.outputs['Normal'], principled.inputs['Normal'])
wall.data.materials.append(mat)

# The street: dark and glossy where a Noise Texture leaves puddles, rough elsewhere.
street = plane('Street', (16, 10), (0, -4.9, -1.0))
mat = bpy.data.materials.new('Wet Asphalt')
nodes, links = mat.node_tree.nodes, mat.node_tree.links
principled = nodes['Principled BSDF']
principled.inputs['Base Color'].default_value = (0.012, 0.012, 0.014, 1)
noise = nodes.new('ShaderNodeTexNoise')
noise.inputs['Scale'].default_value = 0.6
noise.inputs['Detail'].default_value = 4
puddles = nodes.new('ShaderNodeMapRange')
puddles.inputs['From Min'].default_value = 0.45
puddles.inputs['From Max'].default_value = 0.55
puddles.inputs['To Min'].default_value = 0.02
puddles.inputs['To Max'].default_value = 0.45
links.new(noise.outputs['Fac'], puddles.inputs['Value'])
links.new(puddles.outputs['Result'], principled.inputs['Roughness'])
street.data.materials.append(mat)

pink = emission('Neon Pink', (1.0, 0.06, 0.35), 3)
blue = emission('Neon Blue', (0.05, 0.5, 1.0), 3)
amber = emission('Window Glow', (1.0, 0.42, 0.12), 0.95)


def text(name, body, location, size, material, extrude=0.03):
    bpy.ops.object.text_add(location=location, rotation=(math.pi / 2, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.data.body = body
    obj.data.align_x = 'CENTER'
    obj.data.align_y = 'CENTER'
    obj.data.size = size
    obj.data.extrude = extrude
    obj.data.bevel_depth = 0.02
    obj.data.bevel_resolution = 3
    obj.data.materials.append(material)
    return obj


def tube(name, points, material, depth=0.035, cyclic=False):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth, curve.bevel_resolution, curve.use_fill_caps = depth, 4, True
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for point, (x, z) in zip(spline.points, points):
        point.co = (x, -0.15, z, 1)
    spline.use_cyclic_u = cyclic
    curve.materials.append(material)
    obj = bpy.data.objects.new(name, curve)
    scene.collection.objects.link(obj)
    return obj


sign = text('Noodles', 'NOODLES', (-0.6, -0.15, 4.1), 1.3, pink)
text('Open Late', 'open late', (-0.6, -0.15, 3.05), 0.6, blue, 0.02)
# A frame around the words and an arrow pointing to the door.
tube('Frame', [(-3.7, 2.6), (2.5, 2.6), (2.5, 4.9), (-3.7, 4.9)], blue, cyclic=True)
tube('Arrow', [(3.0, 3.2), (3.8, 3.2), (3.8, 1.6)], pink)
tube('Arrow Head', [(3.45, 1.95), (3.8, 1.6), (4.15, 1.95)], pink)

# The bar's window and door, warm light from inside: each a glowing plane in a painted frame, the window half behind
# blinds, the door ajar.
wood = bpy.data.materials.new('Painted Wood')
wood.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.015, 0.03, 0.025, 1)
wood.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.5


def box(name, size, location, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(wood)
    return obj


def framed(name, width, height, x, z, glow):
    plane(name, (width, height), (x, 0.0, z), (math.pi / 2, 0, 0)).data.materials.append(glow)
    t = 0.12
    for side, size, at in (('Top', (width + 2 * t, 0.2, t), (x, z + (height + t) / 2)), ('Bottom', (width + 2 * t, 0.2, t), (x, z - (height + t) / 2)),
                           ('Left', (t, 0.2, height), (x - (width + t) / 2, z)), ('Right', (t, 0.2, height), (x + (width + t) / 2, z))):
        box(f'{name} Frame {side}', size, (at[0], -0.05, at[1]))


framed('Window', 3.2, 1.6, -1.0, 0.9, amber)
for i in range(6):
    box(f'Blind {i + 1}', (3.2, 0.02, 0.07), (-1.0, -0.04, 1.65 - i * 0.13), (math.radians(-35), 0, 0))
framed('Door', 1.2, 2.1, 3.8, 0.05, amber)
# The door's leaf, turned 70 degrees out about its hinge on the left.
swing = math.radians(-70)
box('Door Leaf', (1.2, 0.06, 2.1), (3.2 + 0.6 * math.cos(swing), -0.03 + 0.6 * math.sin(swing), 0.05), (0, 0, swing))
# The light the tubes and the window give the wall and the street.
for name, color, location, energy in (('Pink Light', (1, 0.1, 0.4), (-0.6, -0.8, 4.0), 250),
                                      ('Blue Light', (0.1, 0.5, 1), (-0.6, -0.6, 2.4), 120),
                                      ('Window Light', (1, 0.5, 0.2), (-1.0, -1.2, 0.8), 150),
                                      ('Door Light', (1, 0.5, 0.2), (3.6, -0.8, 0.4), 120)):
    light = bpy.data.lights.new(name, 'POINT')
    light.color, light.energy, light.shadow_soft_size = color, energy, 0.1
    obj = bpy.data.objects.new(name, light)
    obj.location = location
    scene.collection.objects.link(obj)

world = bpy.data.worlds.new('Night')
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.003, 0.004, 0.01, 1)
scene.world = world

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 24
camera.location = (2.2, -10.5, 1.2)
camera.rotation_euler = (math.radians(89), 0, math.radians(13))
scene.collection.objects.link(camera)
scene.camera = camera
scene.render.resolution_x, scene.render.resolution_y = 1280, 720
scene.view_settings.view_transform = 'Standard'
# Blender's EEVEE reflects the neon in the puddles by ray tracing.
scene.eevee.use_raytracing = True

# The compositor: Render Layers, Glare's Fog Glow around what is brighter than 1, a little Lens Distortion with color
# fringes, a Color Balance that cools the shadows and warms the highlights, then a vignette: a soft Ellipse Mask
# multiplied over the image.
tree = bpy.data.node_groups.new('Compositor Nodes', 'CompositorNodeTree')
tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
scene.compositing_node_group = tree
nodes, links = tree.nodes, tree.links


def socket(sockets, identifier):
    return next(s for s in sockets if s.identifier == identifier)


def node(idname, location, **inputs):
    n = nodes.new(idname)
    n.location = location
    for identifier, value in inputs.items():
        socket(n.inputs, identifier.replace('_', ' ')).default_value = value
    return n


layers = node('CompositorNodeRLayers', (-700, 0))
glare = node('CompositorNodeGlare', (-450, 0), Type='Fog Glow', Quality='High', Highlights_Threshold=0.7, Size=0.85, Strength=1.8)
lens = node('CompositorNodeLensdist', (-200, 0), Distortion=-0.03, Dispersion=0.04)
grade = node('CompositorNodeColorBalance', (50, 0))
grade.inputs['Color Lift'].default_value = (0.99, 1.0, 1.02, 1)
grade.inputs['Color Gain'].default_value = (1.05, 1.0, 0.95, 1)
mask = node('CompositorNodeEllipseMask', (-200, -380), Size=(0.95, 0.8))
soft = node('CompositorNodeBlur', (50, -380), Size=(160, 160))
vignette = nodes.new('ShaderNodeMix')
vignette.data_type, vignette.blend_type = 'RGBA', 'MULTIPLY'
vignette.location = (300, 0)
socket(vignette.inputs, 'Factor_Float').default_value = 0.5
output = nodes.new('NodeGroupOutput')
output.location = (550, 0)
viewer = nodes.new('CompositorNodeViewer')
viewer.location = (550, -200)
links.new(layers.outputs['Image'], glare.inputs['Image'])
links.new(glare.outputs['Image'], lens.inputs['Image'])
links.new(lens.outputs['Image'], grade.inputs['Image'])
links.new(grade.outputs['Image'], socket(vignette.inputs, 'A_Color'))
links.new(mask.outputs['Mask'], soft.inputs['Image'])
links.new(soft.outputs['Image'], socket(vignette.inputs, 'B_Color'))
links.new(socket(vignette.outputs, 'Result_Color'), output.inputs[0])
links.new(socket(vignette.outputs, 'Result_Color'), viewer.inputs['Image'])

sign.select_set(True)
bpy.context.view_layer.objects.active = sign
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'compositor.blend'), compress=True)
