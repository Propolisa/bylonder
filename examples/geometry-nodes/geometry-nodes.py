"""Builds geometry-nodes.blend: a tiny planet whose terrain, sea, forests and clouds are one Geometry Nodes modifier.

usage: blender -b --factory-startup -P geometry-nodes.py
"""
import math
import os

import bpy
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_end = 240


def material(name, color, roughness=0.6, emission=0.0):
    ma = bpy.data.materials.new(name)
    ma.diffuse_color = color
    bsdf = ma.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = color
        bsdf.inputs['Emission Strength'].default_value = emission
    return ma


def mesh_object(name, collection, build):
    bpy.ops.object.select_all(action='DESELECT')
    build()
    ob = bpy.context.object
    ob.name = ob.data.name = name
    for c in ob.users_collection:
        c.objects.unlink(ob)
    collection.objects.link(ob)
    return ob


# Terrain colors by height above the sea: sand, meadow, forest, rock and snow, read from the `height` attribute the
# modifier stores.
terrain = bpy.data.materials.new('Terrain')
nodes, links = terrain.node_tree.nodes, terrain.node_tree.links
height = nodes.new('ShaderNodeAttribute')
height.attribute_name = 'height'
height.location = (-700, 300)
ramp = nodes.new('ShaderNodeValToRGB')
ramp.location = (-450, 300)
stops = [(0.0, (0.76, 0.62, 0.38)), (0.06, (0.3, 0.42, 0.12)), (0.3, (0.08, 0.2, 0.05)), (0.62, (0.25, 0.22, 0.2)), (0.8, (0.9, 0.92, 0.95))]
ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = stops[0][0], (*stops[0][1], 1)
ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
for position, color in stops[1:-1]:
    ramp.color_ramp.elements.new(position).color = (*color, 1)
scale = nodes.new('ShaderNodeMath')
scale.operation = 'MULTIPLY'
scale.inputs[1].default_value = 5.0
scale.location = (-600, 300)
links.new(height.outputs['Fac'], scale.inputs[0])
links.new(scale.outputs[0], ramp.inputs['Fac'])
bsdf = nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = 0.85
links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
sea = material('Sea', (0.02, 0.12, 0.28, 1), roughness=0.08)
clouds = material('Cloud', (0.95, 0.96, 1.0, 1), roughness=1.0, emission=1.4)

# The trees the forests pick from, one material each: they stand on their origin, Z up, 6 cm tall.
trees = bpy.data.collections.new('Trees')
scene.collection.children.link(trees)
trees.hide_render = True
for ob_name, color, kind, radius, depth in [('Pine', (0.04, 0.16, 0.06, 1), 'cone', 0.018, 0.07),
                                            ('Fir', (0.07, 0.24, 0.08, 1), 'cone', 0.014, 0.085),
                                            ('Oak', (0.22, 0.34, 0.08, 1), 'ico', 0.022, 0.0),
                                            ('Maple', (0.62, 0.24, 0.05, 1), 'ico', 0.02, 0.0)]:
    if kind == 'cone':
        build = lambda: bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=radius, depth=depth, location=(0, 0, depth / 2))
    else:
        build = lambda: bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=radius, location=(0, 0, radius * 1.4))
    tree = mesh_object(ob_name, trees, build)
    tree.data.materials.append(material(ob_name, color, roughness=0.8))
trees.hide_viewport = False
scene.view_layers[0].layer_collection.children['Trees'].exclude = True

# The planet: an ico sphere the modifier shapes.
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=6, radius=1.0)
planet = bpy.context.object
planet.name = planet.data.name = 'Planet'
bpy.ops.object.shade_smooth()
for ma in (terrain, sea, clouds):
    planet.data.materials.append(ma)

group = bpy.data.node_groups.new('Planet', 'GeometryNodeTree')
interface = group.interface
interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
for name, kind, value, low, high in [('Seed', 'NodeSocketFloat', 2.0, 0.0, 100.0),
                                     ('Mountains', 'NodeSocketFloat', 0.22, 0.0, 0.5),
                                     ('Sea Level', 'NodeSocketFloat', 0.05, 0.0, 0.2),
                                     ('Forest Density', 'NodeSocketFloat', 900.0, 0.0, 3000.0),
                                     ('Cloud Cover', 'NodeSocketFloat', 0.6, 0.0, 1.0)]:
    socket = interface.new_socket(name, in_out='INPUT', socket_type=kind)
    socket.default_value, socket.min_value, socket.max_value = value, low, high

N, L = group.nodes, group.links


def node(idname, x, y, frame=None, label=None, **inputs):
    n = N.new(idname)
    n.location = (x, y)
    if label:
        n.label = label
    for key, value in inputs.items():
        if key.startswith('_'):
            setattr(n, key[1:], value)
        else:
            n.inputs[key.replace('__', ' ')].default_value = value
    if frame:
        n.parent = frame
    return n


def frame(label, color):
    f = N.new('NodeFrame')
    f.label = label
    f.use_custom_color, f.color = True, color
    return f


def link(a, out, b, into):
    L.new(a.outputs[out], b.inputs[into])


inputs = node('NodeGroupInput', -1400, 0)
output = node('NodeGroupOutput', 1500, 0)

# Terrain: noise in 4D (the Seed is W) lifts the sphere along its normals; below the sea level it sinks under the sea.
land = frame('Terrain', (0.25, 0.32, 0.2))
position = node('GeometryNodeInputPosition', -1150, 300, land)
noise = node('ShaderNodeTexNoise', -950, 300, land, _noise_dimensions='4D', Scale=1.6, Detail=7.0, Roughness=0.55)
link(position, 0, noise, 'Vector')
link(inputs, 'Seed', noise, 'W')
lift = node('ShaderNodeMapRange', -750, 300, land, label='Height', **{'From Min': 0.45, 'From Max': 0.75})
link(noise, 'Fac', lift, 'Value')
link(inputs, 'Mountains', lift, 'To Max')
land_height = node('ShaderNodeMath', -550, 300, land, _operation='SUBTRACT')
link(lift, 'Result', land_height, 0)
link(inputs, 'Sea Level', land_height, 1)
ridge = node('ShaderNodeMath', -550, 140, land, _operation='MAXIMUM', _use_clamp=False)
ridge.inputs[1].default_value = -0.03
link(land_height, 0, ridge, 0)
normal = node('GeometryNodeInputNormal', -550, 20, land)
offset = node('ShaderNodeVectorMath', -350, 140, land, _operation='SCALE')
link(normal, 'Normal', offset, 0)
link(ridge, 0, offset, 'Scale')
shaped = node('GeometryNodeSetPosition', -150, 0, land)
link(inputs, 'Geometry', shaped, 'Geometry')
link(offset, 0, shaped, 'Offset')
stored = node('GeometryNodeStoreNamedAttribute', 50, 0, land, _data_type='FLOAT', Name='height')
link(shaped, 0, stored, 'Geometry')
link(ridge, 0, stored, 'Value')
painted = node('GeometryNodeSetMaterial', 250, 0, land, Material=terrain)
link(stored, 0, painted, 'Geometry')

# The sea: a smooth sphere at radius 1.
water = frame('Sea', (0.18, 0.25, 0.38))
sea_sphere = node('GeometryNodeMeshIcoSphere', 50, -260, water, Radius=1.0, Subdivisions=5)
sea_smooth = node('GeometryNodeSetShadeSmooth', 250, -260, water)
link(sea_sphere, 'Mesh', sea_smooth, 'Geometry')
sea_painted = node('GeometryNodeSetMaterial', 450, -260, water, Material=sea)
link(sea_smooth, 0, sea_painted, 'Geometry')

# Forests: points where the land is between the shore and the tree line, thinned by a second noise into woods, each
# instancing one of the Trees at a random size, standing on the ground and turned at random about it.
wood = frame('Forests', (0.2, 0.3, 0.22))
height_in = node('GeometryNodeInputNamedAttribute', 250, 420, wood, _data_type='FLOAT', Name='height')
above_shore = node('FunctionNodeCompare', 450, 520, wood, _data_type='FLOAT', _operation='GREATER_THAN', B=0.008)
link(height_in, 'Attribute', above_shore, 'A')
below_rock = node('FunctionNodeCompare', 450, 360, wood, _data_type='FLOAT', _operation='LESS_THAN', B=0.11)
link(height_in, 'Attribute', below_rock, 'A')
woods_noise = node('ShaderNodeTexNoise', 450, 200, wood, Scale=4.0, Detail=2.0)
woods = node('FunctionNodeCompare', 650, 200, wood, _data_type='FLOAT', _operation='GREATER_THAN', B=0.48)
link(woods_noise, 'Fac', woods, 'A')
both = node('FunctionNodeBooleanMath', 650, 440, wood, _operation='AND')
link(above_shore, 0, both, 0)
link(below_rock, 0, both, 1)
grows = node('FunctionNodeBooleanMath', 850, 360, wood, _operation='AND')
link(both, 0, grows, 0)
link(woods, 0, grows, 1)
scatter = node('GeometryNodeDistributePointsOnFaces', 850, 600, wood)
link(painted, 0, scatter, 'Mesh')
link(grows, 0, scatter, 'Selection')
link(inputs, 'Forest Density', scatter, 'Density')
species = node('GeometryNodeCollectionInfo', 850, 120, wood, _transform_space='ORIGINAL', Collection=trees, **{'Separate Children': True, 'Reset Children': True})
pick = node('FunctionNodeRandomValue', 1050, 120, wood, _data_type='INT', Max=3)
size = node('FunctionNodeRandomValue', 1050, -60, wood, _data_type='FLOAT', Min=0.6, Max=1.4)
turn = node('FunctionNodeRandomValue', 850, -60, wood, _data_type='FLOAT', Min=0.0, Max=6.283)
spin = node('FunctionNodeRotateRotation', 1050, 440, wood, _rotation_space='LOCAL')
link(scatter, 'Rotation', spin, 'Rotation')
about_z = node('ShaderNodeCombineXYZ', 850, -220, wood)
link(turn, 0, about_z, 'Z')
link(about_z, 0, spin, 'Rotate By')
forest = node('GeometryNodeInstanceOnPoints', 1250, 400, wood, **{'Pick Instance': True})
link(scatter, 'Points', forest, 'Points')
link(species, 0, forest, 'Instance')
link(pick, 0, forest, 'Instance Index')
link(spin, 0, forest, 'Rotation')
link(size, 0, forest, 'Scale')
tree_scale = node('GeometryNodeStoreNamedAttribute', 1250, 140, wood, _data_type='FLOAT', _domain='INSTANCE', Name='tree_scale')
link(forest, 0, tree_scale, 'Geometry')
link(size, 0, tree_scale, 'Value')

# Clouds: points on a sphere above the land, kept where a noise is high, their radius growing with it; points draw as
# spheres.
sky = frame('Clouds', (0.3, 0.3, 0.34))
shell = node('GeometryNodeMeshIcoSphere', 250, -560, sky, Radius=1.28, Subdivisions=3)
cloud_noise = node('ShaderNodeTexNoise', 250, -760, sky, _noise_dimensions='4D', Scale=2.2, Detail=3.0, W=7.0)
cloudy = node('FunctionNodeCompare', 450, -760, sky, _data_type='FLOAT', _operation='GREATER_THAN')
link(cloud_noise, 'Fac', cloudy, 'A')
link(inputs, 'Cloud Cover', cloudy, 'B')
puffs = node('GeometryNodeDistributePointsOnFaces', 650, -560, sky, Density=500.0)
link(shell, 'Mesh', puffs, 'Mesh')
link(cloudy, 0, puffs, 'Selection')
puff_size = node('ShaderNodeMapRange', 650, -800, sky, **{'From Min': 0.5, 'From Max': 0.8, 'To Min': 0.012, 'To Max': 0.05})
link(cloud_noise, 'Fac', puff_size, 'Value')
radius = node('GeometryNodeSetPointRadius', 850, -560, sky)
link(puffs, 'Points', radius, 'Points')
link(puff_size, 'Result', radius, 'Radius')
cloud_painted = node('GeometryNodeSetMaterial', 1050, -560, sky, Material=clouds)
link(radius, 0, cloud_painted, 'Geometry')

join = node('GeometryNodeJoinGeometry', 1350, 0)
for geometry in (cloud_painted, sea_painted, tree_scale, painted):
    link(geometry, 0, join, 0)
link(join, 0, output, 0)

modifier = planet.modifiers.new('Planet', 'NODES')
modifier.node_group = group

# The planet turns once over the scene, as a slow linear spin.
planet.rotation_euler = (math.radians(18), 0, 0)
planet.keyframe_insert('rotation_euler', index=2, frame=1)
planet.rotation_euler[2] = math.radians(90)
planet.keyframe_insert('rotation_euler', index=2, frame=241)
for fcurve in planet.animation_data.action.layers[0].strips[0].channelbags[0].fcurves:
    for key in fcurve.keyframe_points:
        key.interpolation = 'LINEAR'

# A small moon, lit by the same sun.
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=0.16, location=(-1.9, 1.6, 0.7))
moon = bpy.context.object
moon.name = moon.data.name = 'Moon'
bpy.ops.object.shade_smooth()
moon.data.materials.append(material('Moon', (0.42, 0.4, 0.38, 1), roughness=0.95))

# A low sun from the right, its shadow a sharp terminator; a faint blue fill from the left.
sun_data = bpy.data.lights.new('Sun', 'SUN')
sun_data.energy = 4.0
sun_data.angle = math.radians(1.5)
sun_data.color = (1.0, 0.95, 0.86)
sun = bpy.data.objects.new('Sun', sun_data)
sun.rotation_euler = Vector((0.91, 0.26, 0.3)).to_track_quat('Z', 'Y').to_euler()
scene.collection.objects.link(sun)
fill_data = bpy.data.lights.new('Fill', 'SUN')
fill_data.energy = 0.25
fill_data.color = (0.45, 0.6, 1.0)
fill_data.use_shadow = False
fill = bpy.data.objects.new('Fill', fill_data)
fill.rotation_euler = (math.radians(100), 0, math.radians(-120))
scene.collection.objects.link(fill)

world = bpy.data.worlds.new('Space')
world.color = (0.005, 0.007, 0.018)
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.005, 0.007, 0.018, 1)
scene.world = world

camera_data = bpy.data.cameras.new('Camera')
camera_data.lens = 60
camera = bpy.data.objects.new('Camera', camera_data)
camera.location = (4.3, -6.4, 2.0)
scene.collection.objects.link(camera)
camera.rotation_euler = (Vector((-0.35, 0.1, 0.05)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = camera
scene.render.resolution_x, scene.render.resolution_y = 1280, 800

for ob in scene.objects:
    ob.select_set(False)
planet.select_set(True)
bpy.context.view_layer.objects.active = planet
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'geometry-nodes.blend'), compress=True)
