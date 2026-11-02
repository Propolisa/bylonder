"""Builds nla.blend: a box that slides, hops and turns, three actions layered in the Nonlinear Animation editor, in
Blender 5.2.3.

usage: blender -b --factory-startup -P nla.py
"""
import math
import os

import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end, scene.render.fps = 1, 96, 24

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.5))
box = bpy.context.object
box.name = box.data.name = 'Box'
paint = bpy.data.materials.new('Paint')
paint.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.9, 0.45, 0.15, 1)
box.data.materials.append(paint)


def action(name, keys):
    """An action of the box's: `keys` as (data_path, index, [(frame, value), ...])."""
    box.animation_data_create()
    act = bpy.data.actions.new(name)
    box.animation_data.action = act
    for path, index, points in keys:
        for frame, value in points:
            getattr(box, path)[index] = value
            box.keyframe_insert(path, index=index, frame=frame)
    box.animation_data.action = None
    act.use_fake_user = True
    return act


slide = action('Slide', [('location', 0, [(1, -3), (96, 3)]), ('location', 2, [(1, 0.5)])])
hop = action('Hop', [('location', 2, [(1, 0), (8, 1.1), (16, 0)])])
turn = action('Turn', [('rotation_euler', 2, [(1, 0), (24, math.pi / 2)])])

# One track per action, lowest first: Slide over the whole range; Hop repeated three times and added on top; Turn at
# half influence, combined.
tracks = box.animation_data.nla_tracks
base = tracks.new()
base.name = 'Slide'
base.strips.new('Slide', 1, slide)
hops = tracks.new()
hops.name = 'Hop'
strip = hops.strips.new('Hop', 1, hop)
strip.repeat = 3
strip.blend_type = 'ADD'
strip.blend_in = strip.blend_out = 2
turns = tracks.new()
turns.name = 'Turn'
strip = turns.strips.new('Turn', 49, turn)
strip.blend_type = 'COMBINE'
strip.use_animated_influence = True
strip.influence = 0.5
strip.keyframe_insert('influence', frame=49)

bpy.ops.mesh.primitive_plane_add(size=10)
bpy.context.object.name = 'Ground'
camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.location = (0, -10, 3.5)
camera.rotation_euler = (math.radians(75), 0, 0)
scene.collection.objects.link(camera)
scene.camera = camera
light = bpy.data.objects.new('Light', bpy.data.lights.new('Light', 'SUN'))
light.rotation_euler = (math.radians(40), 0, math.radians(30))
scene.collection.objects.link(light)

scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
box.select_set(True)
bpy.context.view_layer.objects.active = box
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'nla.blend'), compress=True)
