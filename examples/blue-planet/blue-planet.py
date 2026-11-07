"""Builds blue-planet.blend: a planet, its moon and a starry sky, every surface made of shader nodes, in Blender 5.2.3.

usage: blender -b --factory-startup -P blue-planet.py
"""
import os

import bpy
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def sphere(name, location, radius, segments=96):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=segments // 2, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    bpy.ops.object.shade_smooth()
    return obj


def material(name):
    mat = bpy.data.materials.new(name)
    return mat, mat.node_tree.nodes, mat.node_tree.links


def node(nodes, idname, x, y, **inputs):
    n = nodes.new(idname)
    n.location = (x, y)
    for key, value in inputs.items():
        n.inputs[key.replace('_', ' ')].default_value = value
    return n


def ramp(nodes, x, y, stops, interpolation='LINEAR'):
    n = node(nodes, 'ShaderNodeValToRGB', x, y)
    elements = n.color_ramp.elements
    n.color_ramp.interpolation = interpolation
    while len(elements) < len(stops):
        elements.new(0.5)
    for element, (position, color) in zip(elements, stops):
        element.position = position
        element.color = (*color, 1)
    return n


# The planet: a Noise Texture's height colored by a Color Ramp (sea, shore, land, rock), its Z through another ramp for
# the ice caps, the same height as Bump, and Layer Weight's Facing as the atmosphere's blue glow at the rim.
planet = sphere('Planet', (0, 0, 0), 1.6)
mat, nodes, links = material('Planet')
principled = nodes['Principled BSDF']
principled.location = (500, 200)
nodes['Material Output'].location = (800, 200)
coord = node(nodes, 'ShaderNodeTexCoord', -1100, 200)
noise = node(nodes, 'ShaderNodeTexNoise', -850, 300, Scale=1.6, Detail=12.0, Roughness=0.58, Lacunarity=2.2)
land = ramp(nodes, -600, 450, [
    (0.0, (0.004, 0.012, 0.06)), (0.5, (0.01, 0.06, 0.2)), (0.53, (0.55, 0.48, 0.3)), (0.56, (0.08, 0.2, 0.03)),
    (0.64, (0.17, 0.2, 0.05)), (0.72, (0.25, 0.17, 0.1))])
xyz = node(nodes, 'ShaderNodeSeparateXYZ', -850, -100)
pole = node(nodes, 'ShaderNodeMath', -600, -100)
pole.operation = 'ABSOLUTE'
ice_noise = node(nodes, 'ShaderNodeMath', -400, -100)
ice_noise.operation = 'MULTIPLY_ADD'
ice_noise.inputs[1].default_value = 0.35
ice = ramp(nodes, -200, -100, [(0.88, (0, 0, 0)), (0.92, (1, 1, 1))])
ice_mix = node(nodes, 'ShaderNodeMix', 50, 350)
ice_mix.data_type = 'RGBA'
ice_mix.inputs['B'].default_value = (0.85, 0.9, 1, 1)
shine = ramp(nodes, -300, 650, [(0.5, (0.25, 0.25, 0.25)), (0.53, (0.75, 0.75, 0.75))])
bump = node(nodes, 'ShaderNodeBump', 50, -300, Strength=0.25)
rim = node(nodes, 'ShaderNodeLayerWeight', -200, -450, Blend=0.35)
glow = node(nodes, 'ShaderNodeMath', 50, -500)
glow.operation = 'POWER'
glow.inputs[1].default_value = 5.0
links.new(coord.outputs['Object'], noise.inputs['Vector'])
links.new(noise.outputs['Fac'], land.inputs['Fac'])
links.new(coord.outputs['Object'], xyz.inputs['Vector'])
links.new(xyz.outputs['Z'], pole.inputs[0])
links.new(pole.outputs[0], ice_noise.inputs[0])
links.new(noise.outputs['Fac'], ice_noise.inputs[2])
links.new(ice_noise.outputs[0], ice.inputs['Fac'])
links.new(ice.outputs['Color'], ice_mix.inputs['Factor'])
links.new(land.outputs['Color'], ice_mix.inputs['A'])
links.new(ice_mix.outputs['Result'], principled.inputs['Base Color'])
links.new(noise.outputs['Fac'], shine.inputs['Fac'])
links.new(shine.outputs['Color'], principled.inputs['Roughness'])
links.new(noise.outputs['Fac'], bump.inputs['Height'])
links.new(bump.outputs['Normal'], principled.inputs['Normal'])
links.new(rim.outputs['Facing'], glow.inputs[0])
links.new(glow.outputs[0], principled.inputs['Emission Strength'])
principled.inputs['Emission Color'].default_value = (0.15, 0.45, 1, 1)
planet.data.materials.append(mat)

# The moon: Voronoi cells as craters, their distance through a ramp into Bump, over a grey Noise.
moon = sphere('Moon', (2.6, 1.8, 1.0), 0.38, 64)
mat, nodes, links = material('Moon')
principled = nodes['Principled BSDF']
principled.inputs['Roughness'].default_value = 0.9
voronoi = node(nodes, 'ShaderNodeTexVoronoi', -700, -100, Scale=6.0)
crater = ramp(nodes, -450, -100, [(0.0, (0, 0, 0)), (0.35, (1, 1, 1))])
moon_bump = node(nodes, 'ShaderNodeBump', -150, -100, Strength=0.6)
grey = node(nodes, 'ShaderNodeTexNoise', -700, 300, Scale=4.0, Detail=6.0)
grey_ramp = ramp(nodes, -450, 300, [(0.3, (0.12, 0.11, 0.1)), (0.7, (0.5, 0.48, 0.45))])
links.new(voronoi.outputs['Distance'], crater.inputs['Fac'])
links.new(crater.outputs['Color'], moon_bump.inputs['Height'])
links.new(moon_bump.outputs['Normal'], principled.inputs['Normal'])
links.new(grey.outputs['Fac'], grey_ramp.inputs['Fac'])
links.new(grey_ramp.outputs['Color'], principled.inputs['Base Color'])
moon.data.materials.append(mat)

# The sky: a large sphere around the scene, Voronoi's distance to the nearest point through a ramp as stars.
sky = sphere('Sky', (0, 0, 0), 40, 64)
mat, nodes, links = material('Stars')
nodes.remove(nodes['Principled BSDF'])
emission = node(nodes, 'ShaderNodeEmission', 0, 300, Strength=4.0)
stars = node(nodes, 'ShaderNodeTexVoronoi', -500, 300, Scale=60.0)
stars.feature = 'F1'
dots = ramp(nodes, -250, 300, [(0.0, (1, 1, 1)), (0.06, (0, 0, 0))])
links.new(stars.outputs['Distance'], dots.inputs['Fac'])
links.new(dots.outputs['Color'], emission.inputs['Color'])
links.new(emission.outputs['Emission'], nodes['Material Output'].inputs['Surface'])
sky.data.materials.append(mat)
sky.visible_shadow = False

world = bpy.data.worlds.new('Space')
world.color = (0, 0, 0)
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.002, 0.002, 0.004, 1)
scene.world = world

sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy = 4.0
# Lit from the camera's right, so the night side makes a crescent of shadow on the left.
sun.rotation_euler = Vector((-1.0, 0.25, -0.3)).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(sun)

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 50
camera.location = (3.2, -8.2, 2.0)
camera.rotation_euler = (1.36, 0, 0.42)
scene.collection.objects.link(camera)
scene.camera = camera
scene.render.resolution_x, scene.render.resolution_y = 1280, 800

planet.select_set(True)
bpy.context.view_layer.objects.active = planet
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'blue-planet.blend'), compress=True)
