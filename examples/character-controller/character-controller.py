"""Builds character-controller.blend: Snow, Blender Studio's character rig (CC BY 4.0), with locomotion from
Quaternius' Universal Animation Library (CC0 1.0) retargeted onto its controls, in the demo environment (environment.py), in
Blender 5.2.3. Both are downloaded into downloads/ and checked against their hashes; their licences are in CREDITS.md.

Each UAL bone drives one of Snow's FK controls by world rotation, through a bone at the control's rest added under it
(the torso by location too); each action is then baked onto the controls, with L and R pose markers where each foot
plants, and kept on a muted NLA track, so File > Export > JavaScript with Animations set to Clips exports it as a clip.

With the Snow Bar Scene pack (Blender Studio, CC BY; it needs a Blender Studio login, so it is not downloaded), its
acting is added as the action "Acting", its F-Curves of bones this rig lacks left out:

usage: blender -b --factory-startup -P character-controller.py [-- <snow_barscene.anim.blend>]
"""
import math
import os
import re
import subprocess
import sys

import bpy
from mathutils import Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import environment  # noqa: E402
from environment import DOWNLOADS, fetch  # noqa: E402

SNOW = ('https://studio.blender.org/download-source/files/ba/0f/ba0fe6d810333b1d73c1c359e4dc03cb-6.zip',
        '98d58ef3a07083ede14140bc462cccb55d317062846aa0eb652d2e4a7ac422a6', 'Snow/snow_v4.2.blend')
UAL = ('https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip',
       '18ff1a7215f4852b320203e8aaf02a1578b5c8eef9027fbaedfcedc7b85a3ac2', 'Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb')
# UAL's actions and the names they take; the loops among them, and those whose feet plant (markers).
CLIPS = {'Idle_Loop': 'Idle', 'Walk_Loop': 'Walk', 'Jog_Fwd_Loop': 'Jog', 'Sprint_Loop': 'Sprint', 'Idle_Talking_Loop': 'Talk',
         'Jump_Start': 'Jump_Start', 'Jump_Loop': 'Jump_Loop', 'Jump_Land': 'Jump_Land'}
STEPPING = {'Walk', 'Jog', 'Sprint'}
# The clips that stand on the ground throughout, each raised so its lowest sole rests on it (the jumps leave it).
GROUNDED = STEPPING | {'Idle', 'Talk'}
SIDES = ('L', 'R')


def mapping():
    """UAL's deform bones to Snow's FK controls."""
    pairs = {'DEF-hips': 'TORSO-Spine', 'DEF-spine.001': 'FK-Spine', 'DEF-spine.002': 'FK-RibCage', 'DEF-spine.003': 'FK-Chest',
             'DEF-neck': 'FK-Neck', 'DEF-head': 'FK-Head'}
    for s in SIDES:
        pairs.update({f'DEF-shoulder.{s}': f'FK-Shoulder.{s}', f'DEF-upper_arm.{s}': f'FK-UpperArm.{s}', f'DEF-forearm.{s}': f'FK-Forearm.{s}',
                      f'DEF-hand.{s}': f'FK-Wrist.{s}', f'DEF-thigh.{s}': f'FK-Thigh.{s}', f'DEF-shin.{s}': f'FK-Knee.{s}', f'DEF-foot.{s}': f'FK-Foot.{s}'})
        for finger, name in (('f_index', 'Index'), ('f_middle', 'Middle'), ('f_ring', 'Ring'), ('f_pinky', 'Pinky'), ('thumb', 'Thumb')):
            for k in (1, 2, 3):
                pairs[f'DEF-{finger}.0{k}.{s}'] = f'FK-Finger_{name}{k}.{s}'
    return pairs


def import_source(path, rig):
    """UAL's rig, scaled by Snow's leg length over its own (hip joint to sole at rest), so its hips' moves, stride and
    bounce scale to its legs; its mannequin kept (hidden) to measure its feet, with no other mesh."""
    bpy.ops.import_scene.gltf(filepath=path)
    source = next(o for o in bpy.context.selected_objects if o.type == 'ARMATURE')
    mannequin = next(o for o in bpy.context.selected_objects if o.type == 'MESH' and len(o.data.vertices) > 1000)
    sole = lambda ob: min((ob.matrix_world @ v.co).z for v in ob.data.vertices)
    leg = lambda ob, bone, floor: (ob.matrix_world @ ob.data.bones[bone].head_local).z - floor
    shoes = min(sole(o) for o in bpy.data.objects if o.type == 'MESH' and 'shoe' in o.name.lower() and 'deformer' not in o.name and not o.hide_render)
    source.scale *= leg(rig, 'DEF-Thigh_1.L', shoes) / leg(source, 'DEF-thigh.L', sole(mannequin))
    for o in [o for o in bpy.context.selected_objects if o.type == 'MESH' and o is not mannequin]:
        bpy.data.objects.remove(o)
    mannequin.hide_render = True
    bpy.context.view_layer.update()
    source['mannequin'] = mannequin
    return source


def bridge(source, rig, pairs):
    """Under each UAL bone, a bone at its Snow control's rest; each unconstrained control follows it in world space."""
    to_source = source.matrix_world.inverted() @ rig.matrix_world
    bpy.context.view_layer.objects.active = source
    bpy.ops.object.mode_set(mode='EDIT')
    for src, tgt in pairs.items():
        bone = source.data.edit_bones.new('TGT-' + tgt)
        bone.head, bone.tail = Vector((0, 0, 0)), Vector((0, 0.05, 0))
        bone.matrix = to_source @ rig.data.bones[tgt].matrix_local
        bone.parent = source.data.edit_bones[src]
        bone.use_deform = False
    # Under each source foot, where Snow's ankle must be for its ball to land on the source's ball (the contact point of
    # a forefoot gait): the source's ball less Snow's ankle-to-ball, both turning with the source's foot.
    for side in SIDES:
        foot, toe = source.data.edit_bones.get(f'DEF-foot.{side}'), source.data.edit_bones.get(f'DEF-toe.{side}')
        if not (foot and toe):
            continue
        ankle = to_source @ rig.data.bones[f'FK-Foot.{side}'].head_local
        ball = to_source @ rig.data.bones[f'DEF-Toes.{side}'].head_local
        bone = source.data.edit_bones.new(f'ANKLE-{side}')
        bone.head = toe.head - (ball - ankle)
        bone.tail = bone.head + Vector((0, 0.05, 0))
        bone.parent, bone.use_deform = foot, False
    bpy.ops.object.mode_set(mode='OBJECT')
    controls = []
    for tgt in pairs.values():
        pb = rig.pose.bones[tgt]
        # A control its own constraints place would be moved twice by a visual bake (the toes follow the foot; the
        # fingers curl by Action constraints); the spine's IK copies are off.
        if any(c.influence > 0 and not c.mute for c in pb.constraints):
            continue
        kinds = ('COPY_ROTATION', 'COPY_LOCATION') if tgt == 'TORSO-Spine' else ('COPY_ROTATION',)
        for kind in kinds:
            c = pb.constraints.new(kind)
            c.target, c.subtarget, c.name = source, 'TGT-' + tgt, 'RETARGET'
        controls.append(tgt)
    # Each leg solved, from the copied angles, so its ankle is where its ball lands on the source's (scaled with it):
    # the feet then plant where the source's do, which copied angles alone miss on legs and feet of other proportions.
    for side in SIDES:
        knee = f'FK-Knee.{side}'
        if knee in controls and f'ANKLE-{side}' in source.data.bones:
            ik = rig.pose.bones[knee].constraints.new('IK')
            ik.target, ik.subtarget, ik.chain_count, ik.name = source, f'ANKLE-{side}', 2, 'RETARGET IK'
    return controls


def toe_bend(scene, source, rig, start, end):
    """The source's toes bending at the ball, keyed on Snow's toe controls (which follow the foot by an Armature
    constraint, so a visual bake would move them twice): each frame the source toe's own rotation from its rest, so a
    planted forefoot keeps its toes on the floor as the source's do."""
    for side in SIDES:
        toe, control = source.pose.bones.get(f'DEF-toe.{side}'), rig.pose.bones.get(f'FK-Toes.{side}')
        if not (toe and control):
            continue
        control.rotation_mode = 'QUATERNION'
        # The same bend in the world, turned into Snow's toe's own rest frame (the two rigs' bones roll differently).
        source_rest = (source.matrix_world @ toe.bone.matrix_local).to_quaternion()
        snow_rest = (rig.matrix_world @ control.bone.matrix_local).to_quaternion()
        into = snow_rest.inverted() @ source_rest
        for f in range(start, end + 1):
            scene.frame_set(f)
            control.rotation_quaternion = into @ toe.matrix_basis.to_quaternion() @ into.inverted()
            control.keyframe_insert('rotation_quaternion', frame=f)


def source_lowest(scene, source, start, end):
    """The source mannequin's lowest point over the clip (scaled with the source), in metres: how far the source itself
    dips a toe, which the retarget keeps."""
    low = math.inf
    for f in range(start, end + 1):
        scene.frame_set(f)
        evaluated = source['mannequin'].evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        low = min(low, min((evaluated.matrix_world @ v.co).z for v in mesh.vertices))
        evaluated.to_mesh_clear()
    return low


def source_contacts(scene, source, markers):
    """The source's ball (DEF-toe's head) height on each side at Snow's contact frames (scaled with the source), in
    metres: where the retarget plants Snow's ball."""
    heights = {}
    for side, frame in markers.items():
        scene.frame_set(frame)
        heights[side] = (source.matrix_world @ source.pose.bones[f'DEF-toe.{side}'].head).z
    return heights


def contacts(scene, rig, action, start, end):
    """Each foot's contact: the frame its ball (DEF-Toes' head) is lowest, as the page finds contacts (contacts.js, the
    ball's frames): the moment a forefoot gait plants as well as a heel-and-toe one."""
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots[0]
    heights = {side: [] for side in SIDES}
    for f in range(start, end + 1):
        scene.frame_set(f)
        for side in SIDES:
            heights[side].append((rig.matrix_world @ rig.pose.bones[f'DEF-Toes.{side}'].head).z)
    rig.animation_data.action = None
    found = {side: start + min(range(len(h)), key=h.__getitem__) for side, h in heights.items()}
    print('CONTACTS', action.name, found)
    return found


def bake(scene, source, rig, controls):
    """Each UAL action baked onto the controls (rotation; the torso's location too), as an action of Snow's on a muted
    NLA track."""
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    for name, clip in CLIPS.items():
        action = bpy.data.actions['UAL ' + name]
        source.animation_data.action = action
        if action.slots:
            source.animation_data.action_slot = action.slots[0]
        start, end = (int(f) for f in action.frame_range)
        markers = {}
        bpy.ops.pose.select_all(action='DESELECT')
        for tgt in controls:
            rig.pose.bones[tgt].select = True
        rig.animation_data_create().action = None
        bpy.ops.nla.bake(frame_start=start, frame_end=end, only_selected=True, visual_keying=True, clear_constraints=False,
                         use_current_action=False, bake_types={'POSE'})
        baked = rig.animation_data.action
        baked.name, baked.use_fake_user = clip, True
        bag = baked.layers[0].strips[0].channelbag(baked.slots[0])
        torso = 'pose.bones["TORSO-Spine"]'
        for fc in [fc for fc in bag.fcurves if not fc.data_path.startswith(torso) and not fc.data_path.endswith(('rotation_euler', 'rotation_quaternion'))]:
            bag.fcurves.remove(fc)
        toe_bend(scene, source, rig, start, end)
        if clip in STEPPING:
            markers = contacts(scene, rig, baked, start, end)
        for side, frame in markers.items():
            baked.pose_markers.new(side).frame = frame
        if markers:
            baked['source_contacts'] = source_contacts(scene, source, markers)
        if clip in GROUNDED:
            baked['source_lowest'] = source_lowest(scene, source, start, end)
        track = rig.animation_data.nla_tracks.new()
        track.name, track.mute = clip, True
        track.strips.new(clip, start, baked)
        rig.animation_data.action = None
    bpy.ops.object.mode_set(mode='OBJECT')


def retarget(rig, glb):
    props = rig.pose.bones['Properties']
    for limb in ('left_thigh', 'right_thigh', 'left_upperarm', 'right_upperarm'):
        props[f'ik_{limb}'] = 0.0
    scene = bpy.context.scene
    for name in CLIPS:
        if name in bpy.data.actions:
            bpy.data.actions[name].name = 'Snow ' + name
    source = import_source(glb, rig)
    for name in CLIPS:
        bpy.data.actions[name].name = 'UAL ' + name
    source.animation_data_create()
    pairs = {s: t for s, t in mapping().items() if s in source.data.bones and t in rig.data.bones}
    bake(scene, source, rig, bridge(source, rig, pairs))
    for pb in rig.pose.bones:
        for c in [c for c in pb.constraints if c.name.startswith('RETARGET')]:
            pb.constraints.remove(c)
    bpy.data.objects.remove(source['mannequin'])
    bpy.data.objects.remove(source)
    for name in CLIPS:
        bpy.data.actions.remove(bpy.data.actions['UAL ' + name])


# Snow's own face poses (its pose library's mouth and eye shapes, on its face controls), kept as clips: the visemes a
# talking face mixes (rest, open, spread, rounded, closed lips, lip on teeth, teeth), blinks and expressions.
FACE = ['Mouth Default', 'Mouth Opensmile', 'Mouth Teethsmile', 'Mouth Oo', 'Mouth Uu', 'Mouth Ff', 'Mouth Compressed', 'Mouth Narrow',
        'Mouth Teethfrown', 'Mouth Openfrown', 'Eyemask Default', 'Eyemask Closed', 'Eyemask Angry', 'Eyemask Sad', 'Eyemask Relaxed']


def face_clips(rig):
    """Snow's face poses on muted NLA tracks, so File > Export > JavaScript exports each as a clip."""
    for name in FACE:
        action = bpy.data.actions[name]
        start = int(action.frame_range[0])
        track = rig.animation_data.nla_tracks.new()
        track.name, track.mute = name, True
        track.strips.new(name, start, action)


def acting(rig, shot):
    """The Snow Bar Scene's acting (animation by Rik Schutte) as "Acting", on a muted NLA track like the face poses. The
    shot's 2022 rig moves its limbs, spine and eye target through IK and torso masters this rig lacks, so its evaluated
    pose is baked onto this rig's FK controls, its limbs set to FK, then the arms keyed again to point and twist as the
    shot's and the fingers baked over them."""
    with bpy.data.libraries.load(shot, link=False) as (src, dst):
        dst.actions = ['ANI-Snow_acting01.001']
    action = dst.actions[0]
    action.name = 'Acting'
    bones = {b.name for b in rig.data.bones}
    for bag in [bag for layer in action.layers for strip in layer.strips for bag in strip.channelbags]:
        for fc in list(bag.fcurves):
            m = re.match(r'pose\.bones\["([^"]+)"\]', fc.data_path)
            if m and m.group(1) not in bones:
                bag.fcurves.remove(fc)
    with bpy.data.libraries.load(shot, link=False) as (src, dst):
        dst.objects = ['RIG-Snow']
    source = dst.objects[0]
    bpy.context.scene.collection.objects.link(source)
    source.matrix_world = rig.matrix_world.copy()
    theirs = {b.name for b in source.data.bones}
    pairs = {}
    for name in sorted(bones):
        m = re.match(r'^FK-(UpperArm|Forearm|Wrist|Thigh|Knee|Foot|Toes|Spine|RibCage|Chest|Neck|Head|Shoulder|Finger_\w+?)(\.[LR])?$', name)
        # A control parented by an Armature constraint (the toes, which follow the foot) keeps it: the bake below clears
        # its bones' constraints, and the toes left at rest would stretch the foot and its shoe in every action.
        follows = any(c.type == 'ARMATURE' for c in rig.pose.bones[name].constraints)
        if m and not follows and 'HNG' not in name and f'ORG-{m.group(1)}{m.group(2) or ""}' in theirs:
            pairs[name] = f'ORG-{m.group(1)}{m.group(2) or ""}'
    pairs.update({k: v for k, v in {'TORSO-Spine': 'MSTR-Spine_Torso', 'TGT-Eyes': 'MSTR-TGT-Eyes'}.items() if k in bones and v in theirs})
    for ob, act in ((rig, action), (source, source.animation_data.action)):
        ob.animation_data.use_nla = False
        ob.animation_data.action = act
        if not ob.animation_data.action_slot and len(act.slots) == 1:
            ob.animation_data.action_slot = act.slots[0]
    start, end = (int(v) for v in action.frame_range)
    # The limbs on FK.
    bag = action.layers[0].strips[0].channelbags[0]
    for side in ('left', 'right'):
        for limb in ['upperarm', 'thigh'] + [f'finger_{f}1' for f in ('index', 'middle', 'pinky', 'ring', 'thumb')]:
            if rig.pose.bones['Properties'].get(f'ik_{side}_{limb}') is None:
                continue
            path = f'pose.bones["Properties"]["ik_{side}_{limb}"]'
            fc = bag.fcurves.find(path) or bag.fcurves.new(path)
            fc.keyframe_points.clear()
            fc.keyframe_points.insert(start, 0)
    # Each limb segment points at the shot's next joint (the rigs rest and roll their limbs differently), the rest take
    # the shot's world rotation, the torso master and eye target its place too; Bake Action keys the result.
    joint = {'UpperArm': 'Forearm', 'Forearm': 'Wrist', 'Wrist': 'Finger_Middle1', 'Thigh': 'Knee', 'Knee': 'Foot'}
    for name, found in pairs.items():
        c = rig.pose.bones[name].constraints.new('COPY_ROTATION')
        c.name, c.target, c.subtarget, c.target_space, c.owner_space = 'BAKE', source, found, 'WORLD', 'WORLD'
        m = re.match(r'^FK-(\w+?)(\.[LR])$', name)
        nxt = m and joint.get(m.group(1))
        if nxt and f'ORG-{nxt}{m.group(2)}' in theirs:
            c = rig.pose.bones[name].constraints.new('DAMPED_TRACK')
            c.name, c.target, c.subtarget, c.track_axis = 'BAKE', source, f'ORG-{nxt}{m.group(2)}', 'TRACK_Y'
        if name in ('TORSO-Spine', 'TGT-Eyes'):
            c = rig.pose.bones[name].constraints.new('COPY_LOCATION')
            c.name, c.target, c.subtarget, c.target_space, c.owner_space = 'BAKE', source, found, 'WORLD', 'WORLD'
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    for pb in rig.pose.bones:
        pb.select = pb.name in pairs
    bpy.ops.nla.bake(frame_start=start, frame_end=end, only_selected=True, visual_keying=True, clear_constraints=True, use_current_action=True, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')
    arms_roll(rig, source, pairs, start, end)
    fingers(rig, source, pairs, start, end)
    bpy.data.objects.remove(source, do_unlink=True)
    rig.animation_data.action = None
    rig.animation_data.use_nla = True
    track = rig.animation_data.nla_tracks.new()
    track.name, track.mute = 'Acting', True
    track.strips.new('Acting', start, action)


def dialogue(scene, start):
    """The Bar Scene's dialogue as the scene's sound strip "Dialogue" from the acting's first frame, packed into the file
    (the page reads nothing beside the .blend) and credited."""
    path = os.path.join(HERE, '..', '..', 'docs', 'demos', 'character-controller', 'acting.mp3')
    editor = scene.sequence_editor or scene.sequence_editor_create()
    strip = editor.strips.new_sound('Dialogue', os.path.normpath(path), 1, start)
    strip.sound.name = 'Dialogue'
    strip.sound.pack()
    strip.sound['credit'] = 'Snow Bar Scene dialogue and animation, Blender Studio, CC BY'


def twist(q):
    """The part of a rotation about the bone's own Y axis."""
    t = Quaternion((q.w, 0, q.y, 0))
    return t.normalized() if t.magnitude > 1e-9 else Quaternion()


def arms_roll(rig, source, pairs, start, end):
    """Keys the arms' FK controls (upper arm, forearm, wrist) from the shot's ORG bones so they point and twist as the
    shot's do: our rest frame in the shot bone's is kept as its roll about the bone only. Parents are posed first."""
    arms = {n: f for n, f in pairs.items() if re.match(r'^FK-(UpperArm|Forearm|Wrist)\.[LR]$', n)}
    twists = {n: twist(source.data.bones[f].matrix_local.to_quaternion().inverted() @ rig.data.bones[n].matrix_local.to_quaternion()) for n, f in arms.items()}
    depth = lambda pb: 0 if pb.parent is None else 1 + depth(pb.parent)
    levels = sorted({depth(rig.pose.bones[n]) for n in arms})
    to_rig = rig.matrix_world.inverted().to_quaternion()
    scene, layer = bpy.context.scene, bpy.context.view_layer
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        for level in levels:
            for name in [n for n in arms if depth(rig.pose.bones[n]) == level]:
                pb = rig.pose.bones[name]
                m = (to_rig @ (source.matrix_world @ source.pose.bones[arms[name]].matrix).to_quaternion() @ twists[name]).to_matrix().to_4x4()
                m.translation = pb.matrix.translation
                pb.matrix = m
            layer.update()
        for name in arms:
            pb = rig.pose.bones[name]
            pb.keyframe_insert('rotation_quaternion' if pb.rotation_mode == 'QUATERNION' else 'rotation_euler', frame=frame, group=name)


def fingers(rig, source, pairs, start, end):
    """Bakes the fingers' FK controls again over the keyed arms, each taking its shot finger's world rotation."""
    names = [n for n in pairs if n.startswith('FK-Finger_')]
    for name in names:
        c = rig.pose.bones[name].constraints.new('COPY_ROTATION')
        c.name, c.target, c.subtarget, c.target_space, c.owner_space = 'BAKE', source, pairs[name], 'WORLD', 'WORLD'
    bpy.ops.object.mode_set(mode='POSE')
    for pb in rig.pose.bones:
        pb.select = pb.name in names
    bpy.ops.nla.bake(frame_start=start, frame_end=end, only_selected=True, visual_keying=True, clear_constraints=True, use_current_action=True, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')


def web_textures(color=2048, other=1024):
    """Snow's images for the web, packed into the file: color at most 2K as JPEG (quality 85; Blender's module in the
    app reads JPEG and PNG, not WebP), the rest (roughness, normals, masks, color with alpha) at most 1K as PNG. Written through the render's image settings, with the Standard view so the pixels
    are kept as they are."""
    folder = os.path.join(DOWNLOADS, 'web')
    os.makedirs(folder, exist_ok=True)
    scene = bpy.context.scene
    view, look = scene.view_settings.view_transform, scene.view_settings.look
    scene.view_settings.view_transform, scene.view_settings.look = 'Standard', 'None'
    settings = scene.render.image_settings
    if hasattr(settings, 'media_type'):
        settings.media_type = 'IMAGE'
    for image in [i for i in bpy.data.images if i.source == 'FILE' and i.filepath]:
        image.reload()
        # Color: sRGB and opaque, or a diffuse map whose alpha is unused (Snow's carry an empty one).
        colored = image.colorspace_settings.name == 'sRGB' and (image.channels == 3 or 'diffuse' in image.name.lower())
        w, h = image.size
        limit = color if colored else other
        if max(w, h) > limit:
            image.scale(max(1, w * limit // max(w, h)), max(1, h * limit // max(w, h)))
        settings.file_format = 'JPEG' if colored else 'PNG'
        settings.quality, settings.color_mode = 85, 'RGBA' if image.channels == 4 and not colored else 'RGB'
        path = os.path.join(folder, bpy.path.clean_name(image.name) + ('.jpg' if colored else '.png'))
        image.save_render(path, scene=scene)
        if image.packed_file:
            image.unpack(method='REMOVE')
        image.filepath = path
        image.reload()
        image.pack()
    # UDIM images (Snow's skin) the same way, tile by tile: each tile's file written at the limit, then all packed.
    found = {f: os.path.join(d, f) for d, _, files in os.walk(DOWNLOADS) for f in files}
    for tiled in [i for i in bpy.data.images if i.source == 'TILED']:
        # Its tiles' files by name (Snow's file points at a folder its download lays out differently).
        names = [os.path.basename(tiled.filepath.replace(chr(92), '/')).replace('<UDIM>', '1001'), tiled.name]
        first = next((n for n in names if n in found), names[-1])
        sources = {t.number: found.get(first.replace('1001', str(t.number))) for t in tiled.tiles}
        if not all(sources.values()):
            print('UDIM tiles missing, left as they are:', tiled.name, tiled.filepath, sources)
            continue
        colored = tiled.colorspace_settings.name == 'sRGB' and 'diffuse' in tiled.name.lower()
        limit, extension = (color, '.jpg') if colored else (other, '.png')
        settings.file_format, settings.quality, settings.color_mode = ('JPEG' if colored else 'PNG'), 85, 'RGB' if colored else 'RGBA'
        stem = bpy.path.clean_name(tiled.name.replace('.1001', '').rsplit('.', 1)[0])
        for number, source in sources.items():
            tile = bpy.data.images.load(source)
            tile.colorspace_settings.name = tiled.colorspace_settings.name
            w, h = tile.size
            if max(w, h) > limit:
                tile.scale(max(1, w * limit // max(w, h)), max(1, h * limit // max(w, h)))
            tile.save_render(os.path.join(folder, f'{stem}.{number}{extension}'), scene=scene)
            bpy.data.images.remove(tile)
        tiled.filepath = os.path.join(folder, f'{stem}.<UDIM>{extension}')
        tiled.reload()
        tiled.pack()
    scene.view_settings.view_transform, scene.view_settings.look = view, look



bpy.ops.wm.open_mainfile(filepath=fetch(*SNOW))
rig = bpy.data.objects['RIG-Snow']
# Its soles rest 3.3 cm below its rig's origin: raised so they stand on the ground.
rig.location.z += 0.033
retarget(rig, fetch(*UAL))
face_clips(rig)
SHOT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv[:-1] else None
if SHOT:
    acting(rig, SHOT)
web_textures()
# The scene's one camera: Snow's own studio camera goes.
for camera in [o for o in bpy.data.objects if o.type == 'CAMERA']:
    bpy.data.objects.remove(camera)
bpy.ops.object.camera_add(location=(0, -6, 2.2))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, 1.1)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = camera
# Outdoors: Snow's studio lights (four suns) give way to the environment's sun and sky.
for light in [o for o in bpy.data.objects if o.type == 'LIGHT' and o.data.type == 'SUN']:
    bpy.data.objects.remove(light)
environment.build()
# The scene's frame range is the acting's, and the file opens at its first frame.
acted = bpy.data.actions.get('Acting')
scene = bpy.context.scene
scene.frame_start, scene.frame_end = (int(acted.frame_range[0]), int(acted.frame_range[1])) if acted else (1, 120)
if acted:
    dialogue(scene, scene.frame_start)
# With no action active, the rig shows the pose its bones hold: the last baked frame. It is saved at rest instead.
for bone in rig.pose.bones:
    bone.location, bone.rotation_quaternion, bone.rotation_euler, bone.scale = (0, 0, 0), (1, 0, 0, 0), (0, 0, 0), (1, 1, 1)
scene.frame_set(scene.frame_start)
# Written to a temporary file, its clips grounded there (ground.py, in a Blender of its own: edits of baked keys in this
# session do not reach the evaluated pose), and the example replaced only once every check passed.
made = os.path.join(HERE, 'character-controller.new.blend')
bpy.ops.wm.save_as_mainfile(filepath=made, compress=True, copy=True)
subprocess.run([bpy.app.binary_path, '-b', made, '--python-exit-code', '1', '--python', os.path.join(HERE, 'ground.py'), '--', *sorted(GROUNDED)], check=True)
os.replace(made, os.path.join(HERE, 'character-controller.blend'))
for leftover in (made + '1',):
    if os.path.exists(leftover):
        os.remove(leftover)
