"""Builds shape-keys.blend: a jelly blob that squashes, stretches and bulges by shape keys, in Blender 5.2.3.

usage: blender -b --factory-startup -P shape-keys.py
"""
import math
import os

import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end, scene.render.fps = 1, 48, 24

# The blob: a smooth UV sphere resting on the ground.
bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1, location=(0, 0, 1))
blob = bpy.context.object
blob.name = blob.data.name = 'Blob'
bpy.ops.object.shade_smooth()

jelly = bpy.data.materials.new('Jelly')
principled = jelly.node_tree.nodes['Principled BSDF']
principled.inputs['Base Color'].default_value = (0.25, 0.75, 0.35, 1)
principled.inputs['Roughness'].default_value = 0.3
blob.data.materials.append(jelly)

# The top half as a vertex group, weighted by height, for the Bulge key.
top = blob.vertex_groups.new(name='Top')
for v in blob.data.vertices:
    if v.co.z > 0:
        top.add([v.index], v.co.z, 'REPLACE')


def shape(name, move, relative=None, vertex_group=''):
    """A shape key from Basis, each vertex moved by `move(x, y, z)` (z from the ground)."""
    kb = blob.shape_key_add(name=name, from_mix=False)
    for v, point in zip(blob.data.vertices, kb.data):
        point.co = move(v.co.x, v.co.y, v.co.z + 1)
        point.co.z -= 1
    if relative:
        kb.relative_key = relative
    kb.vertex_group = vertex_group
    return kb


basis = blob.shape_key_add(name='Basis', from_mix=False)
squash = shape('Squash', lambda x, y, z: (x * 1.35, y * 1.35, z * 0.55))
stretch = shape('Stretch', lambda x, y, z: (x * 0.8, y * 0.8, z * 1.45))
bulge = shape('Bulge', lambda x, y, z: (x * 1.4, y * 1.4, z), vertex_group='Top')
wobble = shape('Wobble', lambda x, y, z: (x + 0.25 * math.sin(3 * z), y, z))

# The bounce: Squash and Stretch keyed on their values, Bulge held, Wobble muted.
for frame, (s, t) in [(1, (0, 0)), (8, (1, 0)), (14, (0, 1)), (24, (0, 0)), (32, (1, 0)), (38, (0, 1)), (48, (0, 0))]:
    squash.value, stretch.value = s, t
    squash.keyframe_insert('value', frame=frame)
    stretch.keyframe_insert('value', frame=frame)
bulge.value = 0.3
wobble.mute = True
blob.active_shape_key_index = 1

bpy.ops.mesh.primitive_plane_add(size=8)
bpy.context.object.name = 'Ground'

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.location = (0, -8.5, 3.2)
camera.rotation_euler = (math.radians(75), 0, 0)
scene.collection.objects.link(camera)
scene.camera = camera
light = bpy.data.objects.new('Light', bpy.data.lights.new('Light', 'SUN'))
light.rotation_euler = (math.radians(40), 0, math.radians(30))
scene.collection.objects.link(light)

scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
blob.select_set(True)
bpy.context.view_layer.objects.active = blob
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shape-keys.blend'), compress=True)
