"""Builds hair-dynamics.blend: Suzanne's hair falling and swinging under Blender's Hair Dynamics.

usage: blender -b --factory-startup -P hair-dynamics.py
"""
import math
import os

import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_end = 120

# The head: Suzanne, smooth.
bpy.ops.mesh.primitive_monkey_add(size=2)
head = bpy.context.object
head.name = 'Head'
bpy.ops.object.shade_smooth()
# The scalp, a vertex group weighted by height and toward the back, which masks where hair grows.
scalp = head.vertex_groups.new(name='Scalp')
for v in head.data.vertices:
    weight = max(0.0, min(1.0, (v.co.z - 0.15) / 0.35)) * max(0.0, min(1.0, (v.co.y + 0.55) / 0.3))
    if weight > 0:
        scalp.add([v.index], weight, 'REPLACE')
skin = bpy.data.materials.new('Skin')
principled = skin.node_tree.nodes['Principled BSDF']
principled.inputs['Base Color'].default_value = (0.8, 0.52, 0.4, 1)
principled.inputs['Roughness'].default_value = 0.55
head.data.materials.append(skin)

# The hair, as Add > Curve > Empty Hair makes it (with Hair Dynamics), its strands from Generate Hair Curves above it,
# both Essentials node groups appended so the file needs no library.
bpy.ops.object.curves_empty_hair_add()
hair = bpy.context.object
hair.name = 'Hair'
bpy.ops.object.modifier_add_node_group(asset_library_type='ESSENTIALS',
                                       relative_asset_identifier='nodes/procedural_hair_node_assets.blend/NodeTree/Generate Hair Curves')
bpy.ops.object.modifier_move_to_index(modifier='Generate Hair Curves', index=0)
linked = lambda: [b for c in (bpy.data.node_groups, bpy.data.materials, bpy.data.images, bpy.data.objects) for b in c if b.library]
while linked():
    for block in linked():
        block.make_local()
while bpy.data.libraries:
    bpy.data.libraries.remove(bpy.data.libraries[0])
generate, dynamics = hair.modifiers
# Surface, Hair Length, Density and Control Points, then the scalp as the Density Mask.
for identifier, value in {'Input_2': head, 'Input_20': 1.0, 'Input_15': 160.0, 'Input_27': 8}.items():
    getattr(generate.properties.inputs, identifier).value = value
mask = generate.properties.inputs.Input_14
mask.type, mask.attribute_name = 'ATTRIBUTE', 'Scalp'
dynamics.properties.inputs.Socket_44.value = 'Physics (Experimental)'

# Its material: dark at the root, lighter at the tip (Hair Info's Intercept on a color ramp), Principled Hair BSDF.
material = bpy.data.materials.new('Hair')
nodes, links = material.node_tree.nodes, material.node_tree.links
nodes.remove(nodes['Principled BSDF'])
info = nodes.new('ShaderNodeHairInfo')
ramp = nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.03, 0.012, 0.006, 1)
ramp.color_ramp.elements[1].color = (0.28, 0.12, 0.05, 1)
bsdf = nodes.new('ShaderNodeBsdfHairPrincipled')
bsdf.parametrization = 'COLOR'
links.new(info.outputs['Intercept'], ramp.inputs['Fac'])
links.new(ramp.outputs['Color'], bsdf.inputs['Color'])
links.new(bsdf.outputs['BSDF'], nodes['Material Output'].inputs['Surface'])
hair.data.materials.append(material)
generate.properties.inputs.Input_22.value = material

camera_data = bpy.data.cameras.new('Camera')
camera_data.lens = 45
camera = bpy.data.objects.new('Camera', camera_data)
scene.collection.objects.link(camera)
camera.location = (5.2, -5.6, 1.2)
camera.rotation_euler = (math.radians(86), 0, math.radians(43))
scene.camera = camera
for name, energy, location, rotation in [('Key', 600, (2.6, -2.4, 3.2), (0.8, 0.2, 0.9)), ('Rim', 400, (-2.4, 2.6, 2.4), (-0.9, -0.3, -2.5))]:
    light_data = bpy.data.lights.new(name, 'AREA')
    light_data.energy = energy
    light_data.size = 2
    light = bpy.data.objects.new(name, light_data)
    light.location = location
    light.rotation_euler = rotation
    scene.collection.objects.link(light)
world = bpy.data.worlds.new('World')
world.color = (0.05, 0.055, 0.065)
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.055, 0.065, 1)
scene.world = world
# The head nods, so the hair swings.
head.rotation_mode = 'XYZ'
for frame, angle in [(1, 0), (20, 0), (35, -0.5), (55, 0.45), (75, -0.3), (95, 0.15), (115, 0)]:
    head.rotation_euler = (0, 0, angle)
    head.keyframe_insert('rotation_euler', index=2, frame=frame)

scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hair-dynamics.blend'), compress=True)
