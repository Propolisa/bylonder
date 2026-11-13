# Blender's side of tools/docs/retarget-sheet.mjs: for each action, four frames across its cycle, rendered on the CPU
# (Cycles) from the front, side and three quarters with orthographic cameras centred on the hips, for the source rig
# (Quaternius' mannequin playing the library's action) and the character (playing its retargeted action), and both
# rigs' joints in world space at those frames, with the character's rest bone lengths, written to blender.json.
#   usage: blender -b <character.blend> --python retarget-sheet.blender.py -- <out> <spec.json>
import bpy, sys, json, math, os
from mathutils import Vector

out, spec = sys.argv[sys.argv.index('--') + 1:][:2]
spec = json.load(open(spec, encoding='utf-8'))
os.makedirs(out, exist_ok=True)
scene = bpy.context.scene
fps = scene.render.fps / scene.render.fps_base
character = bpy.data.objects[spec['rig']]
# Joints by role, for each rig: [bone, 'head' | 'tail'].
JOINTS = spec['joints']
VIEWS = {'front': 0.0, 'three-quarter': 45.0, 'side': 90.0}


def joints(rig, names):
    """Each role's joint in world space, from the evaluated pose."""
    def at(bone, end):
        pb = rig.pose.bones[bone]
        return list(rig.matrix_world @ (pb.head if end == 'head' else pb.tail))
    return {role: at(*where) for role, where in names.items()}


def rest(rig, names):
    """The same joints at the rig's rest pose."""
    def at(bone, end):
        b = rig.data.bones[bone]
        return list(rig.matrix_world @ (b.head_local if end == 'head' else b.tail_local))
    return {role: at(*where) for role, where in names.items()}


def play(rig, action):
    rig.animation_data_create()
    rig.animation_data.use_nla = False
    rig.animation_data.action = action
    if action.slots:
        rig.animation_data.action_slot = action.slots[0]


def frames_of(action):
    """Four frames a quarter of the cycle apart from the left foot's contact (its L marker), as locomotion's phases 0,
    0.25, 0.5 and 0.75 play them: left contact, passing, right contact, passing; else four even steps."""
    first, last = (int(round(v)) for v in action.frame_range)
    marks = {m.name: m.frame for m in action.pose_markers}
    left, length = marks.get('L', first), last - first
    return [int(round(left - first + length * k / 4)) % length + first for k in range(4)]


def camera(name):
    cam = bpy.data.objects.get(name) or bpy.data.objects.new(name, bpy.data.cameras.new(name))
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    cam.data.type, cam.data.clip_end = 'ORTHO', 200
    return cam


def render(rig_joints, height, path_of):
    """The three views of what the scene shows now, centred on the hips, framing `height` metres."""
    cam = camera('Retarget Camera')
    scene.camera = cam
    hips = Vector(rig_joints['hips'])
    centre = Vector((hips.x, hips.y, height * 0.52))
    cam.data.ortho_scale = height * 1.25
    for view, angle in VIEWS.items():
        # The characters face -Y; the camera turns from in front of them toward their left side.
        a = math.radians(angle)
        direction = Vector((-math.sin(a), -math.cos(a), 0.12)).normalized()
        cam.location = centre + direction * 8
        cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = path_of(view)
        bpy.ops.render.render(write_still=True)


def setup_render():
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = spec.get('samples', 8)
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = spec['size']
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'Standard'
    scene.render.film_transparent = False


# Only the character's own meshes render (the ground, grass and props stay out of the way of the legs).
kept = {o for o in bpy.data.objects if o.type == 'MESH' and (o.parent == character or any(m.type == 'ARMATURE' and m.object == character for m in o.modifiers))}
for o in bpy.data.objects:
    if o.type == 'MESH' and o not in kept:
        o.hide_render = True
if not any(o.type == 'LIGHT' and o.data.type == 'SUN' for o in bpy.data.objects):
    bpy.ops.object.light_add(type='SUN', rotation=(0.7, 0.2, 0.6))
setup_render()

result = {'fps': fps, 'actions': {}, 'rest': rest(character, JOINTS['character'])}
height = max(v[2] for v in result['rest'].values())

# The source: the library's glTF imported beside the character, its mannequin and rig, at the same frame rate. Its
# actions may share names with the character's (Jump_Start): they are found among those the import adds.
before = set(bpy.data.actions)
bpy.ops.import_scene.gltf(filepath=spec['source'])
imported = {a.name.split('.')[0] if a.name[-4:-3] == '.' else a.name: a for a in set(bpy.data.actions) - before}
source = next(o for o in bpy.context.selected_objects if o.type == 'ARMATURE')
source_meshes = [o for o in bpy.context.selected_objects if o.type == 'MESH']
for o in bpy.context.selected_objects:
    if o.type in {'CAMERA', 'LIGHT'} or (o.type == 'MESH' and len(o.data.vertices) < 1000):
        o.hide_render = True
source_meshes = [o for o in source_meshes if not o.hide_render]
source.location.x += 100
bpy.context.view_layer.update()
source_rest = rest(source, JOINTS['source'])
source_height = max(v[2] for v in source_rest.values())
result['source_rest'] = source_rest

for name, source_name in spec['actions'].items():
    action = bpy.data.actions[name]
    frames = frames_of(action)
    entry = result['actions'][name] = {'frames': frames, 'start': action.frame_range[0], 'character': [], 'source': []}
    folder = os.path.join(out, name)
    os.makedirs(folder, exist_ok=True)
    source_action = imported.get(source_name) if source_name else None
    for row, frame in enumerate(frames):
        # The character alone in the frame, then the source alone.
        play(character, action)
        for o in source_meshes:
            o.hide_render = True
        for o in kept:
            o.hide_render = False
        scene.frame_set(frame)
        pose = joints(character, JOINTS['character'])
        entry['character'].append(pose)
        render(pose, height, lambda view: os.path.join(folder, f'character-{row}-{view}.png'))
        if source_action:
            play(source, source_action)
            for o in kept:
                o.hide_render = True
            for o in source_meshes:
                o.hide_render = False
            scene.frame_set(frame)
            pose = joints(source, JOINTS['source'])
            entry['source'].append(pose)
            render(pose, source_height, lambda view: os.path.join(folder, f'source-{row}-{view}.png'))
json.dump(result, open(os.path.join(out, 'blender.json'), 'w', encoding='utf-8'), indent=1)
print('RETARGET BLENDER DONE', out)
