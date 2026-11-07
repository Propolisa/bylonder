"""Builds neon-sign.blend: a neon sign on a brick wall at night, its letters a text object and its tubes Bezier curves
with a round bevel, in Blender 5.2.3.

usage: blender -b --factory-startup -P neon-sign.py
"""
import math
import os

import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def emission(name, color, strength):
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    principled = nodes['Principled BSDF']
    principled.inputs['Base Color'].default_value = (*color, 1)
    principled.inputs['Emission Color'].default_value = (*color, 1)
    principled.inputs['Emission Strength'].default_value = strength
    return mat


def bevel(curve, depth):
    curve.data.bevel_depth = depth
    curve.data.bevel_resolution = 4
    curve.data.use_fill_caps = True


# The wall: Brick Texture over the UVs into Base Color and, through Bump, the Normal.
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0.05, 0), rotation=(math.pi / 2, 0, 0))
wall = bpy.context.object
wall.name = 'Wall'
wall.scale = (14, 8, 1)
bpy.ops.object.transform_apply(scale=True)
mat = bpy.data.materials.new('Brick')
nodes, links = mat.node_tree.nodes, mat.node_tree.links
principled = nodes['Principled BSDF']
principled.inputs['Roughness'].default_value = 0.85
coord = nodes.new('ShaderNodeTexCoord')
# The UVs span the wall: scaled to its size in meters, so the bricks keep their proportions.
wall_size = nodes.new('ShaderNodeMapping')
wall_size.inputs['Scale'].default_value = (14, 8, 1)
brick = nodes.new('ShaderNodeTexBrick')
brick.inputs['Scale'].default_value = 0.7
brick.inputs['Color1'].default_value = (0.12, 0.04, 0.03, 1)
brick.inputs['Color2'].default_value = (0.07, 0.03, 0.025, 1)
brick.inputs['Mortar'].default_value = (0.03, 0.03, 0.03, 1)
brick.inputs['Mortar Size'].default_value = 0.025
bump = nodes.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = 0.5
links.new(coord.outputs['UV'], wall_size.inputs['Vector'])
links.new(wall_size.outputs['Vector'], brick.inputs['Vector'])
links.new(brick.outputs['Color'], principled.inputs['Base Color'])
links.new(brick.outputs['Fac'], bump.inputs['Height'])
links.new(bump.outputs['Normal'], principled.inputs['Normal'])
wall.data.materials.append(mat)
wall.data.update()

# The words: text objects stood up against the wall, a little depth and a round bevel, so they read as glass tubes.
pink = emission('Neon Pink', (1.0, 0.08, 0.45), 2.5)
blue = emission('Neon Blue', (0.05, 0.55, 1.0), 2.5)


def text(body, location, size, material):
    bpy.ops.object.text_add(location=location, rotation=(math.pi / 2, 0, 0))
    obj = bpy.context.object
    obj.data.body = body
    obj.data.align_x = 'CENTER'
    obj.data.align_y = 'CENTER'
    obj.data.size = size
    obj.data.extrude = 0.02
    obj.data.bevel_depth = 0.02
    obj.data.bevel_resolution = 3
    obj.data.materials.append(material)
    return obj


words = text('Open Late', (0, -0.15, 0.25), 1.15, pink)
words.name = 'Open Late'

# The frame: a Bezier circle stretched to a rounded oval, its curve beveled to a round tube.
bpy.ops.curve.primitive_bezier_circle_add(radius=1, location=(0, -0.15, 0.1), rotation=(math.pi / 2, 0, 0))
frame = bpy.context.object
frame.name = 'Frame'
frame.scale = (3.4, 1.5, 1)
bevel(frame, 0.035)
frame.data.materials.append(blue)

# A swoosh under the words: a Bezier curve whose two points and handles draw a wave.
bpy.ops.curve.primitive_bezier_curve_add(location=(0, -0.15, -0.75), rotation=(math.pi / 2, 0, 0))
swoosh = bpy.context.object
swoosh.name = 'Swoosh'
points = swoosh.data.splines[0].bezier_points
points[0].co, points[0].handle_left, points[0].handle_right = (-2.0, 0, 0), (-2.6, -0.3, 0), (-1.0, 0.45, 0)
points[1].co, points[1].handle_left, points[1].handle_right = (2.0, 0, 0), (1.0, -0.45, 0), (2.6, 0.3, 0)
bevel(swoosh, 0.03)
swoosh.data.materials.append(pink)

# Light the tubes give the wall: an area light per color, close to the wall.
for name, color, location, energy in (('Pink Glow', (1, 0.15, 0.5), (0, -1.2, 0.4), 120), ('Blue Glow', (0.1, 0.5, 1), (0, -1.0, -1.8), 90)):
    light = bpy.data.lights.new(name, 'POINT')
    light.color, light.energy, light.shadow_soft_size = color, energy, 1.5
    obj = bpy.data.objects.new(name, light)
    obj.location = location
    scene.collection.objects.link(obj)

world = bpy.data.worlds.new('Night')
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.005, 0.012, 1)
scene.world = world

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 40
camera.location = (2.4, -8.5, -0.6)
camera.rotation_euler = (math.radians(93), 0, math.radians(16))
scene.collection.objects.link(camera)
scene.camera = camera
scene.render.resolution_x, scene.render.resolution_y = 1280, 800

words.select_set(True)
bpy.context.view_layer.objects.active = words
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'neon-sign.blend'), compress=True)
