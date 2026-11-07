"""Builds hair-dynamics.blend: a sea anemone on a reef whose tentacles float and sway with Blender's Hair Dynamics.

usage: blender -b --factory-startup -P hair-dynamics.py
"""
import math
import os

import bpy
from mathutils import Vector, noise

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_end = 160


def material(name, color, roughness=0.5, subsurface=0.0):
    ma = bpy.data.materials.new(name)
    ma.diffuse_color = color
    bsdf = ma.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Subsurface Weight'].default_value = subsurface
    return ma


def lumpy(ob, amount, scale, seed):
    for v in ob.data.vertices:
        v.co += v.normal * amount * noise.noise(v.co * scale + Vector((seed, 0, 0)))


# The anemone's column: a cylinder that flares into the oral disc, its top ring the Disc vertex group the tentacles
# grow from.
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=1, depth=1, location=(0, 0, 0))
anemone = bpy.context.object
anemone.name = anemone.data.name = 'Anemone'
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.subdivide(number_cuts=6)
bpy.ops.object.mode_set(mode='OBJECT')
for v in anemone.data.vertices:
    t = v.co.z + 0.5
    r = Vector((v.co.x, v.co.y)).length
    flare = 0.2 + 0.07 * math.cos(t * 4.0) + 0.12 * t ** 3
    v.co = Vector((v.co.x * flare, v.co.y * flare, t * 0.42)) if r > 0.99 else Vector((v.co.x * flare, v.co.y * flare, t * 0.42 - 0.03 * (1 - r)))
bpy.ops.object.shade_smooth()
lumpy(anemone, 0.006, 5.0, 3.0)
disc = anemone.vertex_groups.new(name='Disc')
for v in anemone.data.vertices:
    if v.co.z > 0.37:
        r = Vector((v.co.x, v.co.y)).length
        disc.add([v.index], max(0.0, min(1.0, (r - 0.05) / 0.12)), 'REPLACE')
anemone.data.materials.append(material('Column', (0.75, 0.22, 0.12, 1), 0.45, subsurface=0.3))

# The tentacles, as Add > Curve > Empty Hair makes them (with Hair Dynamics), their strands from Generate Hair Curves,
# both Essentials node groups appended so the file needs no library.
bpy.ops.object.curves_empty_hair_add()
tentacles = bpy.context.object
tentacles.name = 'Tentacles'
bpy.ops.object.modifier_add_node_group(asset_library_type='ESSENTIALS',
                                       relative_asset_identifier='nodes/procedural_hair_node_assets.blend/NodeTree/Generate Hair Curves')
bpy.ops.object.modifier_move_to_index(modifier='Generate Hair Curves', index=0)
linked = lambda: [b for c in (bpy.data.node_groups, bpy.data.materials, bpy.data.images, bpy.data.objects) for b in c if b.library]
while linked():
    for block in linked():
        block.make_local()
while bpy.data.libraries:
    bpy.data.libraries.remove(bpy.data.libraries[0])
generate, dynamics = tentacles.modifiers
generate.properties.inputs.Input_2.value = anemone
for name, value in {'Hair Length': 0.42, 'Density': 320.0, 'Control Points': 12}.items():
    for item in generate.node_group.interface.items_tree:
        if item.item_type == 'SOCKET' and item.in_out == 'INPUT' and item.name == name:
            getattr(generate.properties.inputs, item.identifier).value = value
mask = generate.properties.inputs.Input_14
mask.type, mask.attribute_name = 'ATTRIBUTE', 'Disc'
dynamics.properties.inputs.Socket_44.value = 'Physics (Experimental)'
# Tentacles in water: a fraction of gravity, so they splay and sway slowly.
dynamics.properties.inputs.Socket_24.value = (0, 0, -0.5)
# Wavy (Hair Curves Noise), then thick at the root and thin at the tip (Set Hair Curve Profile), before the simulation.
for asset in ('Hair Curves Noise', 'Set Hair Curve Profile'):
    bpy.ops.object.modifier_add_node_group(asset_library_type='ESSENTIALS',
                                           relative_asset_identifier=f'nodes/procedural_hair_node_assets.blend/NodeTree/{asset}')
    while linked():
        for block in linked():
            block.make_local()
    while bpy.data.libraries:
        bpy.data.libraries.remove(bpy.data.libraries[0])
    bpy.ops.object.modifier_move_to_index(modifier=asset, index=len(tentacles.modifiers) - 2)
noise_inputs = tentacles.modifiers['Hair Curves Noise'].properties.inputs
noise_inputs.Input_14.value, noise_inputs.Input_11.value = 0.035, 4.0
profile = tentacles.modifiers['Set Hair Curve Profile'].properties.inputs
profile.Input_3.value, profile.Input_2.value = 0.011, 0.6
scene.render.hair_type = 'STRIP'
scene.render.hair_subdiv = 1
tentacles.modifiers.active = generate

# Their material: deep violet at the root to glowing pink tips, Hair Info's Intercept through a color ramp.
glow = bpy.data.materials.new('Tentacle')
nodes, links = glow.node_tree.nodes, glow.node_tree.links
bsdf = nodes['Principled BSDF']
info = nodes.new('ShaderNodeHairInfo')
ramp = nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.18, 0.03, 0.2, 1)
ramp.color_ramp.elements[1].position = 0.7
ramp.color_ramp.elements[1].color = (0.9, 0.35, 0.55, 1)
tip = ramp.color_ramp.elements.new(1.0)
tip.color = (1.0, 0.85, 0.9, 1)
glow_amount = nodes.new('ShaderNodeMath')
glow_amount.operation = 'POWER'
glow_amount.inputs[1].default_value = 4.0
links.new(info.outputs['Intercept'], ramp.inputs['Fac'])
links.new(info.outputs['Intercept'], glow_amount.inputs[0])
links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
links.new(ramp.outputs['Color'], bsdf.inputs['Emission Color'])
links.new(glow_amount.outputs[0], bsdf.inputs['Emission Strength'])
bsdf.inputs['Roughness'].default_value = 0.35
tentacles.data.materials.append(glow)
generate.properties.inputs.Input_22.value = glow

# The reef: a sand floor and a few rocks.
bpy.ops.mesh.primitive_grid_add(x_subdivisions=80, y_subdivisions=80, size=8)
floor = bpy.context.object
floor.name = floor.data.name = 'Seabed'
for v in floor.data.vertices:
    v.co.z = 0.08 * noise.noise(v.co * 0.7) + 0.015 * noise.noise(v.co * 6.0) - 0.02
bpy.ops.object.shade_smooth()
floor.data.materials.append(material('Sand', (0.2, 0.17, 0.12, 1), 0.9))
rock = material('Rock', (0.16, 0.15, 0.14, 1), 0.8)
for i, (location, size) in enumerate([((-0.5, 0.35, 0.0), 0.32), ((0.55, 0.6, 0.0), 0.22), ((0.25, -0.45, -0.02), 0.12), ((-1.4, 1.6, 0), 0.6)]):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=size, location=location)
    stone = bpy.context.object
    stone.name = stone.data.name = f'Rock.{i:03}'
    stone.scale = (1.0, 0.85, 0.6)
    lumpy(stone, size * 0.35, 2.5, i * 5.0)
    bpy.ops.object.shade_smooth()
    stone.data.materials.append(rock)

# The current rocks the anemone back and forth, and its tentacles trail.
anemone.rotation_mode = 'XYZ'
for frame, x, y in [(1, 0, 0), (25, 0, 0), (45, 0.22, -0.08), (70, -0.18, 0.1), (95, 0.16, 0.05), (120, -0.1, -0.06), (150, 0, 0)]:
    anemone.rotation_euler = (x, y, 0)
    anemone.keyframe_insert('rotation_euler', frame=frame)

# Light from the surface: a soft spot from above, a cool rim behind, and blue water that fogs the distance.
for name, energy, color, location, size, spot in [('Surface', 300, (0.75, 0.9, 1.0), (0.6, -0.8, 3.0), 0.8, True),
                                                  ('Rim', 300, (0.2, 0.7, 1.0), (-0.6, 1.4, 1.0), 1.0, False)]:
    light_data = bpy.data.lights.new(name, 'SPOT' if spot else 'AREA')
    light_data.energy, light_data.color = energy, color
    if spot:
        light_data.shadow_soft_size = size
        light_data.spot_size = math.radians(55)
        light_data.spot_blend = 0.6
    else:
        light_data.size = size
    light = bpy.data.objects.new(name, light_data)
    light.location = location
    light.rotation_euler = (Vector((0, 0, 0.3)) - Vector(location)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(light)
world = bpy.data.worlds.new('Water')
water = (0.01, 0.07, 0.1)
world.color = water
nodes = world.node_tree.nodes
nodes['Background'].inputs['Color'].default_value = (*water, 1)
scatter = nodes.new('ShaderNodeVolumeScatter')
scatter.inputs['Color'].default_value = (0.1, 0.45, 0.6, 1)
scatter.inputs['Density'].default_value = 0.08
world.node_tree.links.new(scatter.outputs[0], nodes['World Output'].inputs['Volume'])
scene.world = world

camera_data = bpy.data.cameras.new('Camera')
camera_data.lens = 50
camera = bpy.data.objects.new('Camera', camera_data)
camera.location = (0.0, -2.1, 0.55)
camera.rotation_euler = (Vector((0, 0, 0.42)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(camera)
scene.camera = camera
scene.render.resolution_x, scene.render.resolution_y = 1280, 800

for ob in scene.objects:
    ob.select_set(False)
tentacles.select_set(True)
bpy.context.view_layer.objects.active = tentacles
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hair-dynamics.blend'), compress=True)
