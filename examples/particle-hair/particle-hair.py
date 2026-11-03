"""Builds particle-hair.blend: a grassy hill at sunset, its grass a hair particle system combed by the wind.

usage: blender -b --factory-startup -P particle-hair.py
"""
import math
import os

import bpy
from mathutils import Vector, noise

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, roughness=0.7):
    ma = bpy.data.materials.new(name)
    ma.diffuse_color = color
    bsdf = ma.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = roughness
    return ma


def hill_height(x, y):
    return 0.9 * math.exp(-((x - 0.4) ** 2 + (y - 0.6) ** 2 * 1.6) / 2.2) + 0.05 * noise.noise(Vector((x, y, 0)) * 0.8)


# The hill: a grid lifted into a rise, a little noise on it.
bpy.ops.mesh.primitive_grid_add(x_subdivisions=70, y_subdivisions=70, size=7)
hill = bpy.context.object
hill.name = hill.data.name = 'Hill'
for v in hill.data.vertices:
    v.co.z = hill_height(v.co.x, v.co.y)
bpy.ops.object.shade_smooth()
hill.data.materials.append(material('Soil', (0.05, 0.06, 0.02, 1), 0.95))

# The grass: dark at the root, sun-bleached at the tip (Hair Info's Intercept through a color ramp).
grass = bpy.data.materials.new('Grass')
nodes, links = grass.node_tree.nodes, grass.node_tree.links
bsdf = nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = 0.55
info = nodes.new('ShaderNodeHairInfo')
ramp = nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.02, 0.05, 0.01, 1)
ramp.color_ramp.elements[1].position = 0.55
ramp.color_ramp.elements[1].color = (0.16, 0.3, 0.04, 1)
ramp.color_ramp.elements.new(1.0).color = (0.62, 0.55, 0.18, 1)
links.new(info.outputs['Intercept'], ramp.inputs['Fac'])
links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
hill.data.materials.append(grass)

system = hill.modifiers.new('Grass', 'PARTICLE_SYSTEM').particle_system
settings = system.settings
settings.name = 'Grass'
settings.type = 'HAIR'
settings.count = 2600
settings.hair_length = 0.28
settings.hair_step = 5
settings.display_step = 3
settings.render_step = 3
settings.material_slot = 'Grass'
settings.use_advanced_hair = True
settings.child_type = 'INTERPOLATED'
settings.child_percent = 8
settings.rendered_child_count = 8
settings.child_length = 0.85
settings.child_length_threshold = 0.3
settings.clump_factor = -0.15
settings.roughness_1 = 0.03
settings.roughness_endpoint = 0.02
settings.root_radius = 1.0
settings.tip_radius = 0.0
settings.radius_scale = 0.006
settings.use_close_tip = True
scene.render.hair_type = 'STRIP'
scene.render.hair_subdiv = 1

# Combed by the wind, as Particle Edit's Comb brush would: each blade leaves its root along the normal and bends
# downwind, more toward its tip and more on the crest, the wind's heading wandering in gusts across the hill.
bpy.ops.object.mode_set(mode='PARTICLE_EDIT')
evaluated = hill.evaluated_get(bpy.context.evaluated_depsgraph_get())
modifier = evaluated.modifiers['Grass']
for particle in system.particles:
    keys = particle.hair_keys
    root = keys[0].co_object(evaluated, modifier, particle)
    heading = 0.6 + 0.9 * noise.noise(root * 0.9)
    wind = Vector((math.cos(heading), math.sin(heading), -0.15))
    strength = 0.35 + 0.5 * max(0.0, root.z) + 0.25 * noise.noise(root * 3.0 + Vector((5, 0, 0)))
    direction = Vector((0, 0, 1))
    step = settings.hair_length * (0.75 + 0.5 * (noise.noise(root * 11.0) * 0.5 + 0.5)) / (len(keys) - 1)
    position = root
    for k, key in enumerate(keys):
        if k:
            direction = (direction + wind * strength * k / len(keys) * 1.6).normalized()
            position = position + direction * step
        key.co_object_set(evaluated, modifier, particle, position)
bpy.ops.object.mode_set(mode='OBJECT')
assert system.is_edited and len(system.particles) == settings.count

# A lone tree below the crest, leaning with the wind.
bark = material('Bark', (0.06, 0.04, 0.03, 1), 0.9)
leaves = material('Leaves', (0.06, 0.13, 0.03, 1), 0.8)
base = Vector((1.5, 1.6, hill_height(1.5, 1.6) - 0.05))
bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.08, radius2=0.04, depth=1.4, location=base + Vector((0.05, 0.03, 0.7)))
trunk = bpy.context.object
trunk.name = trunk.data.name = 'Trunk'
trunk.rotation_euler = (0.05, -0.08, 0)
trunk.data.materials.append(bark)
for i, (offset, size) in enumerate([((0.1, 0.05, 1.45), 0.45), ((-0.25, 0.1, 1.3), 0.32), ((0.4, -0.05, 1.3), 0.34), ((0.15, 0.2, 1.75), 0.3)]):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=size, location=base + Vector(offset))
    crown = bpy.context.object
    crown.name = crown.data.name = f'Crown.{i:03}'
    crown.scale = (1.0, 1.0, 0.75)
    for v in crown.data.vertices:
        v.co += v.normal * 0.05 * noise.noise(v.co * 6.0 + Vector((i, 0, 0)))
    bpy.ops.object.shade_smooth()
    crown.data.materials.append(leaves)

# Sunset: a low warm sun behind the hill's shoulder, so the blades' tips catch it; the sky fills the shadows.
sun_data = bpy.data.lights.new('Sun', 'SUN')
sun_data.energy = 5.0
sun_data.angle = math.radians(2.5)
sun_data.color = (1.0, 0.62, 0.32)
sun = bpy.data.objects.new('Sun', sun_data)
sun.rotation_euler = Vector((-0.55, 0.8, 0.22)).to_track_quat('Z', 'Y').to_euler()
scene.collection.objects.link(sun)
world = bpy.data.worlds.new('Dusk')
sky = (0.36, 0.3, 0.42)
world.color = sky
world.node_tree.nodes['Background'].inputs['Color'].default_value = (*sky, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.5
scene.world = world

camera_data = bpy.data.cameras.new('Camera')
camera_data.lens = 35
camera = bpy.data.objects.new('Camera', camera_data)
camera.location = (-0.9, -2.9, 0.55)
camera.rotation_euler = (Vector((0.6, 0.8, 0.75)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(camera)
scene.camera = camera
scene.render.resolution_x, scene.render.resolution_y = 1280, 800

for ob in scene.objects:
    ob.select_set(False)
hill.select_set(True)
bpy.context.view_layer.objects.active = hill
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'particle-hair.blend'), compress=True)
