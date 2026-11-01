"""Builds lava.blend: the displaced lava sphere of docs/lava-material.md, in Blender 5.2.3.

usage: blender -b --factory-startup -P lava.py
"""
import os

import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# The sphere: Subdivision Surface, then Displace by a Clouds texture.
bpy.ops.mesh.primitive_uv_sphere_add()
sphere = bpy.context.object
sphere.modifiers.new('Subdivision', 'SUBSURF')
clouds = bpy.data.textures.new('Texture', 'CLOUDS')
displace = sphere.modifiers.new('Displace', 'DISPLACE')
displace.texture = clouds

# The lava: Texture Coordinate's Object into two 4D Noise Textures, the first through a Color Ramp (black at 0.5 to
# orange) into Principled BSDF's Emission Color and Strength, the second (Detail 8) through Bump into its Normal.
lava = bpy.data.materials.new('Material')
nodes, links = lava.node_tree.nodes, lava.node_tree.links
principled = nodes['Principled BSDF']
principled.inputs['Base Color'].default_value = (0.003, 0.003, 0.003, 1)
coord = nodes.new('ShaderNodeTexCoord')
coord.location = (-900, 200)
noise, detail = nodes.new('ShaderNodeTexNoise'), nodes.new('ShaderNodeTexNoise')
for node, y in ((noise, 300), (detail, -200)):
    node.noise_dimensions = '4D'
    node.location = (-650, y)
detail.inputs['Detail'].default_value = 8
ramp = nodes.new('ShaderNodeValToRGB')
ramp.location = (-400, 300)
ramp.color_ramp.elements[0].position = 0.5
ramp.color_ramp.elements[1].color = (1, 0.138, 0, 1)
bump = nodes.new('ShaderNodeBump')
bump.location = (-300, -200)
links.new(coord.outputs['Object'], noise.inputs['Vector'])
links.new(coord.outputs['Object'], detail.inputs['Vector'])
links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
links.new(ramp.outputs['Color'], principled.inputs['Emission Color'])
links.new(noise.outputs['Fac'], principled.inputs['Emission Strength'])
links.new(detail.outputs['Fac'], bump.inputs['Height'])
links.new(bump.outputs['Normal'], principled.inputs['Normal'])
sphere.data.materials.append(lava)

cam_data = bpy.data.cameras.new('Camera')
camera = bpy.data.objects.new('Camera', cam_data)
camera.location = (0, -6, 1.2)
camera.rotation_euler = (1.4, 0, 0)
scene.collection.objects.link(camera)
scene.camera = camera
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lava.blend'), compress=True)
