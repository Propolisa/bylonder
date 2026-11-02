"""Builds texture-paint.blend: a Suzanne UV unwrapped with Smart UV Project and painted with an image texture, and a
sphere painted with a color attribute, in Blender 5.2.3.

usage: blender -b --factory-startup -P texture-paint.py
"""
import math
import os

import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# Suzanne, unwrapped by Smart UV Project.
bpy.ops.mesh.primitive_monkey_add(location=(-1.4, 0, 0))
monkey = bpy.context.object
bpy.ops.object.shade_smooth()
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(island_margin=0.02)
bpy.ops.object.mode_set(mode='OBJECT')

# Its paint: a 512 x 512 image, a warm ramp across U with a stripe of each UV island's V, packed into the file.
SIZE = 512
image = bpy.data.images.new('Suzanne Paint', SIZE, SIZE)
pixels = []
for y in range(SIZE):
    for x in range(SIZE):
        u, v = x / (SIZE - 1), y / (SIZE - 1)
        stripe = 0.5 + 0.5 * math.sin(v * math.pi * 16)
        pixels += [0.9 * u + 0.1, 0.35 + 0.3 * stripe, 0.15 + 0.6 * (1 - u), 1.0]
image.pixels.foreach_set(pixels)
image.pack()

# Its material: the image into Principled BSDF's Base Color, as Texture Paint's Base Color slot makes it.
material = bpy.data.materials.new('Painted')
nodes, links = material.node_tree.nodes, material.node_tree.links
texture = nodes.new('ShaderNodeTexImage')
texture.image = image
texture.location = (-350, 300)
links.new(texture.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
monkey.data.materials.append(material)

# A sphere with a color attribute, as Vertex Paint paints it: red at the top to blue at the bottom.
bpy.ops.mesh.primitive_uv_sphere_add(location=(1.4, 0, 0))
sphere = bpy.context.object
bpy.ops.object.shade_smooth()
colors = sphere.data.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
for loop in sphere.data.loops:
    z = sphere.data.vertices[loop.vertex_index].co.z
    t = (z + 1) / 2
    colors.data[loop.index].color = (t, 0.2, 1 - t, 1)
sphere.data.color_attributes.active_color = colors

cam_data = bpy.data.cameras.new('Camera')
camera = bpy.data.objects.new('Camera', cam_data)
camera.location = (0, -7, 0.4)
camera.rotation_euler = (1.5, 0, 0)
scene.collection.objects.link(camera)
scene.camera = camera
light = bpy.data.objects.new('Light', bpy.data.lights.new('Light', 'SUN'))
light.rotation_euler = (0.6, 0.2, 0.4)
scene.collection.objects.link(light)
# Suzanne active and selected, as the Texture Paint workspace paints the active object.
sphere.select_set(False)
monkey.select_set(True)
bpy.context.view_layer.objects.active = monkey
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'texture-paint.blend'), compress=True)
