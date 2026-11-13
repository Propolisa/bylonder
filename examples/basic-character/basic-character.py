"""Builds basic-character.blend: the mannequin of Quaternius' Universal Animation Library (CC0 1.0) as a Mixamo-style
character, an armature named Armature with baked actions Idle, Walk, Run and Jump and no markers, root motion or IK,
standing on the character examples' shared ground (../character-controller/environment.py) with a camera behind
it, in Blender 5.2.3. The library is downloaded into downloads/ and checked
against its hash; its licence is in CREDITS.md.

Jump is one action, as a Mixamo download has it: the library's start, half a second of its airborne loop and its
landing, in a row.
Each action is kept on a muted NLA track, so File > Export > JavaScript with Animations set to Clips exports it as a
clip; Idle is also the armature's active action.

usage: blender -b --factory-startup -P basic-character.py
"""
import hashlib
import os
import sys
import urllib.request
import zipfile

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
DOWNLOADS = os.path.join(HERE, 'downloads')
UAL = ('https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip',
       '18ff1a7215f4852b320203e8aaf02a1578b5c8eef9027fbaedfcedc7b85a3ac2', 'Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb')
# The library's actions and the names they take; Jump joins its three parts.
ACTIONS = {'Idle_Loop': 'Idle', 'Walk_Loop': 'Walk', 'Jog_Fwd_Loop': 'Run'}
# The jump's parts and the frames of each it takes (None: all of them).
JUMP = (('Jump_Start', None), ('Jump_Loop', 15), ('Jump_Land', None))


def fetch(url, sha256, member):
    """A file of a downloaded zip, the zip checked against its hash."""
    os.makedirs(DOWNLOADS, exist_ok=True)
    archive = os.path.join(DOWNLOADS, sha256[:16] + '.zip')
    if not os.path.exists(archive):
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request) as response, open(archive, 'wb') as out:
            out.write(response.read())
    with open(archive, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if digest != sha256:
        raise RuntimeError(f'{url}: sha256 {digest}, expected {sha256}')
    folder = archive[:-4]
    if not os.path.exists(os.path.join(folder, member)):
        zipfile.ZipFile(archive).extractall(folder)
    return os.path.join(folder, member)


def frames(action):
    start, end = action.frame_range
    return int(round(start)), int(round(end))


def on_track(rig, action, start):
    """`action` as a strip at `start` on a muted NLA track of its name."""
    track = rig.animation_data.nla_tracks.new()
    track.name, track.mute = action.name, True
    strip = track.strips.new(action.name, start, action)
    strip.action_slot = action.slots[0]
    return strip


def join_jump(rig):
    """The jump's parts in a row on one track, baked into one action, Jump."""
    track = rig.animation_data.nla_tracks.new()
    at = 1
    for name, length in JUMP:
        action = bpy.data.actions[name]
        start, end = frames(action)
        strip = track.strips.new(name, at, action)
        strip.action_slot = action.slots[0]
        if length:
            strip.action_frame_end = start + length
            strip.frame_end = at + length
        at = int(strip.frame_end)
    rig.animation_data.action = None
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(frame_start=1, frame_end=at, only_selected=True, visual_keying=False, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')
    jump = rig.animation_data.action
    jump.name = 'Jump'
    rig.animation_data.action = None
    rig.animation_data.nla_tracks.remove(track)
    return jump


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
# The library's frame rate, so its keys land on frames.
scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=fetch(*UAL))
for ob in [o for o in bpy.data.objects if o.type in {'CAMERA', 'LIGHT'} or o.name in {'Cube', 'Icosphere'}]:
    bpy.data.objects.remove(ob)
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
rig.name = rig.data.name = 'Armature'
rig.animation_data_create()
rig.animation_data.action = None
for track in list(rig.animation_data.nla_tracks):
    rig.animation_data.nla_tracks.remove(track)
jump = join_jump(rig)
for source, name in ACTIONS.items():
    bpy.data.actions[source].name = name
kept = {*ACTIONS.values(), 'Jump'}
for action in [a for a in bpy.data.actions if a.name not in kept]:
    bpy.data.actions.remove(action)
for name in ('Idle', 'Walk', 'Run', 'Jump'):
    on_track(rig, bpy.data.actions[name], 1)
idle = bpy.data.actions['Idle']
rig.animation_data.action = idle
rig.animation_data.action_slot = idle.slots[0]
scene.frame_start, scene.frame_end = frames(idle)

# The character examples' shared ground, sky and sun, and a camera behind the character.
sys.path.insert(0, os.path.join(HERE, '..', 'character-controller'))
import environment  # noqa: E402

environment.build()
bpy.ops.object.camera_add(location=(0, 5, 2.2))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, 1.0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = camera
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'basic-character.blend'), compress=True)
