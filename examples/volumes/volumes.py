"""Builds volumes.blend: a dusty temple hall at sunset, a low sun through its tall windows into drifting dust, wooden
columns down the hall, a bronze bell over a stone altar and two candles, in Blender 5.2.3. The dust is one Principled
Volume over the hall whose density is a Noise Texture; its box is keyed to move slowly, so the dust drifts through the
shafts as the frames play.

usage: blender -b --factory-startup -P volumes.py [-- RENDER.png]   (RENDER.png: an EEVEE render of the camera)
"""
import math
import os
import sys

import bpy
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.eevee.taa_render_samples = 32
scene.view_settings.view_transform = 'Standard'
scene.frame_start, scene.frame_end = 1, 240
scene.render.fps = 24

world = bpy.data.worlds.new('World')
world.color = (0.03, 0.04, 0.07)
world.node_tree.nodes['Background'].inputs['Color'].default_value = (*world.color, 1)
scene.world = world

# The hall: x across, y down its length, z up.
HALF_WIDTH, LENGTH_FROM, LENGTH_TO, HEIGHT = 4.0, -6.0, 8.0, 5.0


def node(nodes, idname, inputs=None, **properties):
    made = nodes.new(idname)
    for key, value in properties.items():
        setattr(made, key, value)
    for key, value in (inputs or {}).items():
        made.inputs[key].default_value = value
    return made


def material(name, color, roughness=0.5, **inputs):
    """A Principled BSDF material; `inputs` are its other inputs by name, underscores for spaces."""
    ma = bpy.data.materials.new(name)
    bsdf = ma.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    for key, value in inputs.items():
        bsdf.inputs[key.replace('_', ' ')].default_value = value
    return ma


def mottled(name, dark, light, scale, roughness):
    """Two colors mixed by a Noise Texture: worn stone, old plaster."""
    ma = material(name, light, roughness)
    nodes, link = ma.node_tree.nodes, ma.node_tree.links.new
    noise = node(nodes, 'ShaderNodeTexNoise', {'Scale': scale, 'Detail': 8.0, 'Roughness': 0.6})
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*dark, 1)
    ramp.color_ramp.elements[1].color = (*light, 1)
    link(noise.outputs['Fac'], ramp.inputs['Fac'])
    link(ramp.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
    return ma


def wood(name, dark, light):
    """Wood: Wave Texture bands along the grain into Base Color."""
    ma = material(name, light, 0.6)
    nodes, link = ma.node_tree.nodes, ma.node_tree.links.new
    coord = nodes.new('ShaderNodeTexCoord')
    mapping = node(nodes, 'ShaderNodeMapping', {'Scale': (1.0, 1.0, 0.15)})
    wave = node(nodes, 'ShaderNodeTexWave', {'Scale': 4.0, 'Distortion': 10.0, 'Detail': 3.0}, wave_type='BANDS', bands_direction='X')
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*dark, 1)
    ramp.color_ramp.elements[1].color = (*light, 1)
    link(coord.outputs['Object'], mapping.inputs['Vector'])
    link(mapping.outputs['Vector'], wave.inputs['Vector'])
    link(wave.outputs['Fac'], ramp.inputs['Fac'])
    link(ramp.outputs['Color'], ma.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    return ma


STONE = mottled('Stone', (0.16, 0.14, 0.12), (0.36, 0.32, 0.27), 2.5, 0.85)
PLASTER = mottled('Plaster', (0.32, 0.25, 0.19), (0.5, 0.42, 0.33), 1.5, 0.95)
TIMBER = wood('Timber', (0.08, 0.04, 0.02), (0.22, 0.12, 0.06))
FLOOR = wood('Floor Boards', (0.06, 0.035, 0.02), (0.16, 0.09, 0.05))
BRONZE = material('Bronze', (0.55, 0.36, 0.17), 0.35, Metallic=1.0)
WAX = material('Candle Wax', (0.85, 0.8, 0.68), 0.6)
FLAME = material('Flame', (1.0, 0.6, 0.25), 0.5, Emission_Color=(1.0, 0.55, 0.2, 1), Emission_Strength=12.0)


def box(name, center, size, ma):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    ob = bpy.context.object
    ob.name, ob.scale = name, size
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(ma)
    return ob


def cylinder(name, center, radius, depth, ma, vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=center)
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(ma)
    bpy.ops.object.shade_smooth()
    return ob


# Floor, ceiling, the right and back walls.
length, middle = LENGTH_TO - LENGTH_FROM, (LENGTH_FROM + LENGTH_TO) / 2
box('Floor', (0, middle, -0.1), (2 * HALF_WIDTH + 0.4, length + 0.4, 0.2), FLOOR)
box('Ceiling', (0, middle, HEIGHT + 0.1), (2 * HALF_WIDTH + 0.4, length + 0.4, 0.2), TIMBER)
box('Right Wall', (HALF_WIDTH + 0.15, middle, HEIGHT / 2), (0.3, length + 0.4, HEIGHT), PLASTER)
box('Back Wall', (0, LENGTH_TO + 0.15, HEIGHT / 2), (2 * HALF_WIDTH + 0.4, 0.3, HEIGHT), PLASTER)

# The left wall: piers between five tall windows, a sill below them and a lintel above, each window split by two
# mullions, so the sun comes in as bars of light.
WINDOWS = [-3.5, -0.5, 2.5, 5.5]
WINDOW_WIDTH, SILL, LINTEL = 1.4, 1.0, 4.0
x = -HALF_WIDTH - 0.15
box('Sill', (x, middle, SILL / 2), (0.3, length + 0.4, SILL), PLASTER)
box('Lintel', (x, middle, (LINTEL + HEIGHT) / 2), (0.3, length + 0.4, HEIGHT - LINTEL), PLASTER)
edges = [LENGTH_FROM - 0.2] + [edge for y in WINDOWS for edge in (y - WINDOW_WIDTH / 2, y + WINDOW_WIDTH / 2)] + [LENGTH_TO + 0.2]
for i in range(0, len(edges), 2):
    a, b = edges[i], edges[i + 1]
    box(f'Pier {i // 2 + 1}', (x, (a + b) / 2, (SILL + LINTEL) / 2), (0.3, b - a, LINTEL - SILL), PLASTER)
for i, y in enumerate(WINDOWS):
    for k in (-1, 1):
        box(f'Mullion {i + 1}{"ab"[k > 0]}', (x, y + k * WINDOW_WIDTH / 6, (SILL + LINTEL) / 2), (0.12, 0.08, LINTEL - SILL), TIMBER)
    for z in (SILL + 1.0, SILL + 2.0):
        box(f'Transom {i + 1} {z:.0f}', (x, y, z), (0.12, WINDOW_WIDTH, 0.06), TIMBER)

# Two rows of columns down the hall, and the beams they carry.
for side in (-1, 1):
    for i, y in enumerate((-3.0, 0.0, 3.0, 6.0)):
        cylinder(f'Column {"LR"[side > 0]}{i + 1}', (side * 2.3, y, HEIGHT / 2), 0.2, HEIGHT, TIMBER)
        box(f'Plinth {"LR"[side > 0]}{i + 1}', (side * 2.3, y, 0.1), (0.6, 0.6, 0.2), STONE)
    box(f'Beam {"LR"[side > 0]}', (side * 2.3, middle, HEIGHT - 0.2), (0.3, length, 0.3), TIMBER)
for y in (-3.0, 0.0, 3.0, 6.0):
    box(f'Tie Beam {y:+.0f}', (0, y, HEIGHT - 0.35), (2 * HALF_WIDTH, 0.25, 0.25), TIMBER)

# The altar at the end of the hall: stone steps, a table, two candles and a bell hanging above.
for i, (width, depth) in enumerate(((4.0, 2.4), (3.2, 1.8), (2.4, 1.2))):
    box(f'Step {i + 1}', (0, LENGTH_TO - depth / 2, 0.15 + i * 0.3), (width, depth, 0.3), STONE)
box('Altar', (0, LENGTH_TO - 0.7, 1.25), (1.6, 0.8, 0.5), STONE)
for side in (-1, 1):
    cylinder(f'Candle {"LR"[side > 0]}', (side * 0.55, LENGTH_TO - 0.7, 1.68), 0.05, 0.36, WAX, 12)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.035, location=(side * 0.55, LENGTH_TO - 0.7, 1.9))
    flame = bpy.context.object
    flame.name, flame.scale = f'Flame {"LR"[side > 0]}', (1, 1, 1.8)
    flame.data.materials.append(FLAME)
    bpy.ops.object.light_add(type='POINT', location=(side * 0.55, LENGTH_TO - 0.85, 2.0))
    candle = bpy.context.object
    candle.name = f'Candle Light {"LR"[side > 0]}'
    candle.data.energy, candle.data.color, candle.data.shadow_soft_size = 25.0, (1.0, 0.55, 0.25), 0.05
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.6, location=(0, LENGTH_TO - 1.8, 3.4))
bell = bpy.context.object
bell.name, bell.scale = 'Bell', (1, 1, 1.3)
bell.data.materials.append(BRONZE)
bpy.ops.object.shade_smooth()
cylinder('Bell Rope', (0, LENGTH_TO - 1.8, 4.5), 0.03, 1.2, TIMBER, 8)

# The dust: one Principled Volume over the hall, its density a Noise Texture of the box's Generated coordinates mapped to
# thin wisps over a faint haze; the box, larger than the hall, is keyed to move, so the dust drifts.
DUST = bpy.data.materials.new('Dust')
nodes, link = DUST.node_tree.nodes, DUST.node_tree.links.new
nodes.remove(nodes['Principled BSDF'])
volume = node(nodes, 'ShaderNodeVolumePrincipled', {'Color': (1.0, 0.93, 0.82, 1), 'Anisotropy': 0.5})
noise = node(nodes, 'ShaderNodeTexNoise', {'Scale': 1.6, 'Detail': 4.0, 'Roughness': 0.55})
wisps = node(nodes, 'ShaderNodeMapRange', {'From Min': 0.4, 'From Max': 0.75, 'To Min': 0.08, 'To Max': 0.4})
link(noise.outputs['Fac'], wisps.inputs['Value'])
link(wisps.outputs['Result'], volume.inputs['Density'])
link(volume.outputs['Volume'], nodes['Material Output'].inputs['Volume'])
dust = box('Dust', (0, middle, HEIGHT / 2), (2 * HALF_WIDTH, length, HEIGHT), DUST)
# box() bakes its place into the mesh, so the dust's keys are offsets from where it stands.
for frame, offset in ((scene.frame_start, (0, 0, 0)), (scene.frame_end, (0.4, 0.8, 0.2))):
    dust.location = offset
    dust.keyframe_insert('location', frame=frame)
for fcurve in dust.animation_data.action.layers[0].strips[0].channelbag(dust.animation_data.action_slot).fcurves:
    for key in fcurve.keyframe_points:
        key.interpolation = 'LINEAR'

# A low sun outside the windows; the dust shows its light where the windows and columns let it through.
bpy.ops.object.light_add(type='SUN', rotation=(math.radians(64), 0, math.radians(-118)))
sun = bpy.context.object
sun.name = 'Sun'
sun.data.energy, sun.data.color, sun.data.angle = 7.0, (1.0, 0.72, 0.45), math.radians(1.0)

# EEVEE's Volumes: 8 pixel froxels, 64 slices.
scene.eevee.volumetric_tile_size = '8'
scene.eevee.volumetric_samples = 64

bpy.ops.object.camera_add(location=(1.1, -5.7, 1.5))
camera = bpy.context.object
camera.name = 'Camera'
camera.data.lens = 20
camera.rotation_euler = (Vector((-0.4, 6.5, 2.2)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = camera
scene.frame_set(1)

here = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(here, 'volumes.blend'), compress=True)
if '--' in sys.argv and sys.argv[sys.argv.index('--') + 1:]:
    scene.render.filepath = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
    bpy.ops.render.render(write_still=True)
