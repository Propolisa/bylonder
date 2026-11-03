"""Builds lotus.blend: lotus flowers on a pond at golden hour, each petal ring opened from a bud by an Open shape key and
bent back by a Curl key; three flowers share the keys at different values, and the front one blooms over 96 frames,
in Blender 5.2.3.

usage: blender -b --factory-startup -P lotus.py
"""
import math
import os

import bpy
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end, scene.render.fps = 1, 96, 24
scene.render.resolution_x, scene.render.resolution_y = 1280, 800

NU, NV = 7, 12
# Per ring, inner first: petal count, length, width, base radius, and (tilt, curl, width scale) closed and open.
RINGS = [
    (6, 0.85, 0.3, 0.06, (0.08, -0.1, 0.75), (0.38, 0.04, 1.0)),
    (8, 1.0, 0.34, 0.1, (0.14, -0.14, 0.75), (0.72, 0.1, 1.0)),
    (10, 1.1, 0.38, 0.14, (0.2, -0.16, 0.8), (1.08, 0.18, 1.0)),
]


def petal_point(length, width, radius, azimuth, tilt, curl, width_scale, u, v):
    """A point of a petal (u across, -1 to 1; v along, 0 to 1), cupped across and curled along, tilted out by `tilt`
    from upright and turned to `azimuth`."""
    half = width * width_scale * math.sin(math.pi * min(1, 0.12 + 0.95 * v)) ** 0.6 * (1 - 0.45 * v)
    x = u * half
    y = -0.45 * half * (1 - u * u) + curl * v * v * length
    z = v * length
    y, z = y * math.cos(tilt) + z * math.sin(tilt), -y * math.sin(tilt) + z * math.cos(tilt)
    y += radius
    c, s = math.cos(azimuth), math.sin(azimuth)
    return (c * x - s * y, s * x + c * y, z)


def flower_points(state):
    """Every petal vertex for `state` (0 closed, 1 open)."""
    points = []
    for ring, (count, length, width, radius, closed, opened) in enumerate(RINGS):
        tilt, curl, width_scale = closed if state == 0 else opened
        for p in range(count):
            azimuth = 2 * math.pi * p / count + ring * 0.4
            for j in range(NV):
                for i in range(NU):
                    points.append(petal_point(length, width, radius, azimuth, tilt, curl, width_scale, 2 * i / (NU - 1) - 1, j / (NV - 1)))
    return points


def flower_mesh():
    verts, faces, uvs = flower_points(0), [], []
    start = 0
    for count, *_ in RINGS:
        for _ in range(count):
            for j in range(NV - 1):
                for i in range(NU - 1):
                    a = start + j * NU + i
                    faces.append((a, a + 1, a + NU + 1, a + NU))
                    uvs.append([(i / (NU - 1), j / (NV - 1)), ((i + 1) / (NU - 1), j / (NV - 1)),
                                ((i + 1) / (NU - 1), (j + 1) / (NV - 1)), (i / (NU - 1), (j + 1) / (NV - 1))])
            start += NU * NV
    mesh = bpy.data.meshes.new('Lotus')
    mesh.from_pydata(verts, [], faces)
    uv = mesh.uv_layers.new(name='Petal')
    for face, corners in zip(mesh.polygons, uvs):
        face.use_smooth = True
        for loop, co in zip(face.loop_indices, corners):
            uv.data[loop].uv = co
    return mesh


def material(name, color, roughness=0.5, metallic=0.0):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return mat


# Petals: white at the base to pink at the tip along the UV's V, with some light passing through.
petal = material('Petal', (1, 1, 1), roughness=0.4)
nodes, links = petal.node_tree.nodes, petal.node_tree.links
separate = nodes.new('ShaderNodeSeparateXYZ')
links.new(nodes.new('ShaderNodeTexCoord').outputs['UV'], separate.inputs['Vector'])
ramp = nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.95, 0.9, 0.82, 1)
ramp.color_ramp.elements[0].position = 0.25
ramp.color_ramp.elements[1].color = (0.85, 0.12, 0.35, 1)
links.new(separate.outputs['Y'], ramp.inputs['Fac'])
bsdf = nodes['Principled BSDF']
links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
translucent = nodes.new('ShaderNodeBsdfTranslucent')
links.new(ramp.outputs['Color'], translucent.inputs['Color'])
mix = nodes.new('ShaderNodeMixShader')
mix.inputs['Fac'].default_value = 0.3
links.new(bsdf.outputs['BSDF'], mix.inputs[1])
links.new(translucent.outputs['BSDF'], mix.inputs[2])
links.new(mix.outputs['Shader'], nodes['Material Output'].inputs['Surface'])

pod = material('Seed Pod', (0.75, 0.6, 0.1), roughness=0.6)
pad = material('Lily Pad', (0.04, 0.16, 0.05), roughness=0.6)
pad.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.15
water = material('Water', (0.004, 0.012, 0.014), roughness=0.02)

# The front flower with its keys; Open moves every petal from the bud to the bloom, Curl bends the tips back on top.
lotus = bpy.data.objects.new('Lotus', flower_mesh())
lotus.data.materials.append(petal)
scene.collection.objects.link(lotus)
lotus.shape_key_add(name='Basis', from_mix=False)
opened = lotus.shape_key_add(name='Open', from_mix=False)
for point, co in zip(opened.data, flower_points(1)):
    point.co = co
curl = lotus.shape_key_add(name='Curl', from_mix=False)
for point, (x, y, z) in zip(curl.data, flower_points(1)):
    lean = max(0.0, math.hypot(x, y) - 0.4)
    point.co = (x * (1 + 0.3 * lean), y * (1 + 0.3 * lean), z - 0.5 * lean * lean)
curl.relative_key = opened
for frame, value in [(1, 0), (72, 1)]:
    opened.value = value
    opened.keyframe_insert('value', frame=frame)
for frame, value in [(48, 0), (96, 0.5)]:
    curl.value = value
    curl.keyframe_insert('value', frame=frame)
lotus.active_shape_key_index = 1


def lily_pad(name, location, radius, rotation):
    bpy.ops.mesh.primitive_circle_add(vertices=40, radius=radius, fill_type='TRIFAN', location=location, rotation=(0, 0, rotation))
    ob = bpy.context.object
    ob.name = ob.data.name = name
    ob.data.materials.append(pad)
    for v in ob.data.vertices[:3]:
        v.co = (0.15 * v.co.x, 0.15 * v.co.y, 0)
    return ob


def flower(name, location, scale, open_value, curl_value):
    """Another flower, the front one's mesh copied with its keys and set at its own values."""
    ob = bpy.data.objects.new(name, lotus.data.copy())
    scene.collection.objects.link(ob)
    ob.location, ob.scale = location, (scale,) * 3
    ob.data.shape_keys.animation_data_clear()
    ob.data.shape_keys.key_blocks['Open'].value = open_value
    ob.data.shape_keys.key_blocks['Curl'].value = curl_value
    return ob


def seed_pod(location, scale):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.12 * scale, depth=0.16 * scale, location=(location[0], location[1], location[2] + 0.1 * scale))
    ob = bpy.context.object
    ob.name = ob.data.name = 'Seed Pod'
    ob.data.materials.append(pod)


lotus.location = (0, 0, 0.04)
seed_pod(lotus.location, 1)
lily_pad('Lily Pad', (0.1, 0.2, 0.01), 1.3, 0.6)
for name, location, scale, open_value, curl_value in [('Lotus Half Open', (-2.6, 3.2, 0.04), 0.85, 0.45, 0),
                                                     ('Lotus Bud', (2.2, 4.6, 0.04), 0.7, 0, 0)]:
    flower(name, location, scale, open_value, curl_value)
    seed_pod(location, scale)
    lily_pad('Lily Pad', (location[0] + 0.2, location[1], 0.01), 1.1 * scale, scale * 4)
for i, (x, y, r) in enumerate([(-3.5, 0.8, 0.9), (1.8, 1.8, 0.7), (4.2, 2.5, 1.0), (-1, 5.5, 1.1), (-5, 5, 0.8), (3.2, -0.8, 0.6)]):
    lily_pad('Lily Pad', (x, y, 0.005), r, i * 1.7)

bpy.ops.mesh.primitive_plane_add(size=60)
pond = bpy.context.object
pond.name = pond.data.name = 'Pond'
pond.data.materials.append(water)

# A low golden sun behind the flowers lights the petals through, a pale sky fill from the front.
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy, sun.data.color, sun.data.angle = 3.5, (1, 0.72, 0.45), math.radians(3)
sun.rotation_euler = (math.radians(70), 0, math.radians(160))
scene.collection.objects.link(sun)
fill = bpy.data.objects.new('Sky Fill', bpy.data.lights.new('Sky Fill', 'SUN'))
fill.data.energy, fill.data.color, fill.data.use_shadow = 0.6, (0.6, 0.7, 1), False
fill.rotation_euler = (math.radians(50), 0, math.radians(-20))
scene.collection.objects.link(fill)

world = bpy.data.worlds.new('Dusk Sky')
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.11, 0.09, 0.15, 1)
scene.world = world

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.lens = 45
camera.location = (0.5, -6.4, 1.35)
camera.rotation_euler = (camera.location - Vector((-0.2, 1.2, 0.35))).to_track_quat('Z', 'Y').to_euler()
scene.collection.objects.link(camera)
scene.camera = camera

scene.frame_set(72)
bpy.ops.object.select_all(action='DESELECT')
lotus.select_set(True)
bpy.context.view_layer.objects.active = lotus
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lotus.blend'), compress=True)
