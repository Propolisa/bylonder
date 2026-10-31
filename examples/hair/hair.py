"""Builds hair.blend: Suzanne with combed hair, in Blender 5.2.3.

usage: blender -b --factory-startup -P hair.py
"""
import math
import os

import bpy
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# The head: Suzanne, subdivided and smoothed, with the scalp as a vertex group weighted by height and toward the back.
bpy.ops.mesh.primitive_monkey_add(size=2)
head = bpy.context.object
head.name = 'Head'
bpy.ops.object.shade_smooth()
subsurf = head.modifiers.new('Subdivision', 'SUBSURF')
subsurf.levels = subsurf.render_levels = 2
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

# The hair: strands from the scalp, their roots dark and their tips light (Hair Info's Intercept on a color ramp)
# through Principled Hair BSDF.
hair = bpy.data.materials.new('Hair')
nodes, links = hair.node_tree.nodes, hair.node_tree.links
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
head.data.materials.append(hair)

system = head.modifiers.new('Hair', 'PARTICLE_SYSTEM').particle_system
settings = system.settings
settings.name = 'Hair'
settings.type = 'HAIR'
settings.count = 1200
settings.hair_length = 1.1
settings.hair_step = 6
settings.display_step = 3
settings.render_step = 4
settings.material_slot = 'Hair'
settings.use_advanced_hair = True
settings.child_type = 'INTERPOLATED'
settings.child_percent = 6
settings.rendered_child_count = 12
settings.clump_factor = 0.2
settings.roughness_endpoint = 0.04
settings.root_radius = 0.6
settings.tip_radius = 0.1
system.vertex_group_density = 'Scalp'
scene.render.hair_type = 'STRIP'
scene.render.hair_subdiv = 1

# Combed back and down in Particle Edit Mode, as a comb would: each strand leaves its root along its normal, turns
# toward the back of the head and is pulled down more toward its tip. Keys are written in object space against the
# evaluated head (its roots), co_object_set marking the hair edited, as Particle Edit's brushes do.
bpy.ops.object.mode_set(mode='PARTICLE_EDIT')
evaluated = head.evaluated_get(bpy.context.evaluated_depsgraph_get())
modifier = evaluated.modifiers['Hair']
back = Vector((0, 1, -0.2)).normalized()
for particle in system.particles:
    keys = particle.hair_keys
    position = keys[0].co_object(evaluated, modifier, particle)
    direction = (keys[-1].co_object(evaluated, modifier, particle) - position).normalized()
    step = settings.hair_length / (len(keys) - 1)
    for k, key in enumerate(keys):
        if k:
            direction = (direction + back * 0.5 + Vector((0, 0, -0.8)) * (k / len(keys))).normalized()
            position = position + direction * step
        key.co_object_set(evaluated, modifier, particle, position)
bpy.ops.object.mode_set(mode='OBJECT')
assert system.is_edited and len(system.particles) == settings.count

camera_data = bpy.data.cameras.new('Camera')
camera_data.lens = 70
camera = bpy.data.objects.new('Camera', camera_data)
scene.collection.objects.link(camera)
camera.location = (4.2, -5.2, 1.0)
camera.rotation_euler = (math.radians(84), 0, math.radians(39))
scene.camera = camera
for name, kind, energy, location, rotation in [('Key', 'AREA', 600, (2.6, -2.4, 3.2), (0.8, 0.2, 0.9)), ('Rim', 'AREA', 400, (-2.4, 2.6, 2.4), (-0.9, -0.3, -2.5))]:
    light_data = bpy.data.lights.new(name, kind)
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

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hair.blend'), compress=False)
