"""Rock Hard Café: an open-air coffee stand in a low-poly forest by a brook, whose customers are rocks, the scene of the
game in src/.

A wooden counter with a coffee machine and a parasol beside it, the barista behind the counter, one rock waiting at the stand and
the trailhead the next rocks roll up from. The Rock and Cup collections are prefabs the game spawns copies of (excluded
from the view layer); each object's behaviours are its `behaviors` custom property group, as Object properties >
Behaviors adds them. The sounds are Kenney's (CC0: Impact Sounds and Interface Sounds, in sounds/ at a quiet level) and
one clack this script writes there, all packed. The forest is Quaternius' Stylized Nature MegaKit (CC0), as the character examples use it
(../character-controller/environment.py, which downloads it).

blender -b --factory-startup -P cafe.py   (writes rock-hard-cafe.blend and sounds/ beside this file)
"""
import math
import os
import random
import struct
import wave

import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "character-controller"))
import environment  # noqa: E402
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "Rock Hard Café"
scene.render.resolution_x, scene.render.resolution_y = 1280, 800
# The mannequin's actions are 30 fps; the scene's range is the barista's Idle (set below), as the character examples set it.
scene.render.fps = 30


def material(name, color, roughness=0.5, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return m


WOOD = material("Counter Wood", (0.28, 0.14, 0.06, 1), 0.55)
CANVAS = material("Parasol", (0.42, 0.5, 0.36, 1), 0.8)
WATER = material("Brook", (0.12, 0.32, 0.42, 1), 0.08)
CHROME = material("Chrome", (0.75, 0.75, 0.78, 1), 0.2, 1.0)
CHINA = material("China", (0.92, 0.9, 0.86, 1), 0.25)
CHALKBOARD = material("Chalkboard", (0.03, 0.05, 0.04, 1), 0.9)
CHALK = material("Chalk", (0.9, 0.88, 0.8, 1), 0.95)


def link(ob, collection=None):
    (collection or scene.collection).objects.link(ob)
    return ob


def box(name, size, location, mat, collection=None):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    ob = bpy.data.objects.new(name, mesh)
    ob.location = location
    return link(ob, collection)


def cylinder(name, radius, depth, location, mat, collection=None, segments=24):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=depth)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    for polygon in mesh.polygons:
        polygon.use_smooth = len(polygon.vertices) == 4
    ob = bpy.data.objects.new(name, mesh)
    ob.location = location
    return link(ob, collection)


def tone(name, freqs, seconds, noise=0.0):
    """A short, quiet sound written to sounds/<name>.wav: a sum of decaying tones and some noise, 22 kHz mono."""
    os.makedirs(os.path.join(HERE, "sounds"), exist_ok=True)
    path = os.path.join(HERE, "sounds", f"{name}.wav")
    rate, frames = 22050, int(22050 * seconds)
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        data = bytearray()
        for i in range(frames):
            t, envelope = i / rate, math.exp(-4 * i / frames)
            s = sum(math.sin(2 * math.pi * f * t) for f in freqs) / len(freqs) * (1 - noise) + random.uniform(-1, 1) * noise
            data += struct.pack("<h", int(max(-1, min(1, s * envelope)) * 6500))
        out.writeframes(bytes(data))
    return packed(name, path)


def packed(name, path=None):
    """A sound of sounds/ (<name>.ogg unless `path` says), packed into the .blend, which the app and an export read it from."""
    sound = bpy.data.sounds.load(path or os.path.join(HERE, "sounds", f"{name}.ogg"))
    sound.name = name
    sound.use_fake_user = True
    sound.pack()
    return sound


SOUNDS = {"Clack": tone("Clack", [900, 1400], 0.15, 0.4), **{name: packed(name) for name in ("Wood Clack", "Plank Clack", "Glass Clink", "Plate Clink", "Served", "Angry")}}

# The forest: the character examples' ground, grass, rocks, bushes and pines, sky and sun (environment.py), then a brook
# across a corner of the clearing, and pines and bushes around it, where the camera above the counter sees them.
environment.build()
brook = box("Brook", (14, 0.9, 0.02), (1.8, -1.7, 0.03), WATER)
brook.rotation_euler.z = math.radians(40)
for name, places in {"Pine_5": [(-4.2, 1.6, 0.8), (3.9, -2.2, 0.9), (4.4, 1.9, 0.7), (-1.6, -3.9, 0.75), (2.0, -4.4, 0.85)],
                     "Rock_Medium_1": [(-2.6, -1.2, 0.35), (2.6, -0.4, 0.3), (-1.1, -2.9, 0.25)],
                     "Bush_Common_Flowers": [(-2.3, 0.6, 0.6), (2.4, 1.1, 0.7), (1.6, -2.2, 0.5), (-3.0, -0.4, 0.5)]}.items():
    environment.instanced(environment.megakit(name), f"Stand {name}", [(x, y, 0, size, random.uniform(0, math.tau)) for x, y, size in places])

# The stand, open to the sky: a counter the barista reaches across, the coffee machine at its right hand, a few things
# in the way (jars, a jug, a spare cup), and a parasol off to the side.
COUNTER_TOP = 0.9
counter = box("Counter", (2.4, 0.28, COUNTER_TOP), (0, 0.61, COUNTER_TOP / 2), WOOD)


def parts(name, pieces, location):
    """One object of boxes and cylinders, each ("box" | "cylinder", size, offset, material index), its origin at its base."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for kind, size, offset, index in pieces:
        made = bmesh.ops.create_cube(bm, size=1.0)["verts"] if kind == "box" else \
            bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=size[0], radius2=size[0], depth=size[2])["verts"]
        if kind == "box":
            bmesh.ops.scale(bm, vec=size, verts=made)
        bmesh.ops.translate(bm, vec=offset, verts=made)
        for face in {f for v in made for f in v.link_faces}:
            face.material_index = index
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    ob.location = location
    return link(ob)


# An espresso machine: a body, a black top, the group head and its spout, and the drip tray on the barista's side, its
# cup clear of the head, so the camera above sees it.
machine = parts("Machine", [("box", (0.34, 0.18, 0.4), (0, 0, 0.2), 0), ("box", (0.36, 0.2, 0.05), (0, 0, 0.425), 1),
                            ("box", (0.12, 0.08, 0.07), (0, 0.12, 0.33), 0), ("cylinder", (0.025, 0, 0.05), (0, 0.13, 0.27), 1),
                            ("box", (0.24, 0.15, 0.02), (0, 0.2, 0.01), 1)], (-0.55, 0.5, COUNTER_TOP))
machine.data.materials.append(CHROME)
machine.data.materials.append(material("Machine Black", (0.02, 0.02, 0.02, 1), 0.4))
tray = link(bpy.data.objects.new("Tray Spot", None))
tray.empty_display_type, tray.empty_display_size, tray.location = "CIRCLE", 0.06, (-0.55, 0.7, COUNTER_TOP + 0.02)
GLASS = material("Jar Glass", (0.75, 0.85, 0.82, 1), 0.1)
SUGAR = material("Sugar", (0.95, 0.93, 0.88, 1), 0.9)
things = [cylinder("Sugar Jar", 0.06, 0.16, (-0.27, 0.55, COUNTER_TOP + 0.08), GLASS), cylinder("Biscotti Jar", 0.075, 0.2, (0.0, 0.66, COUNTER_TOP + 0.1), GLASS),
          cylinder("Milk Jug", 0.05, 0.13, (0.55, 0.55, COUNTER_TOP + 0.065), CHINA)]
things[0].data.materials.append(SUGAR)
box("Parasol Pole", (0.04, 0.04, 2.1), (-2.0, 1.9, 1.05), WOOD)
parasol = bpy.data.meshes.new("Parasol")
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=False, segments=8, radius1=0.7, radius2=0.02, depth=0.3)
bm.to_mesh(parasol)
bm.free()
parasol.materials.append(CANVAS)
link(bpy.data.objects.new("Parasol", parasol)).location = (-2.0, 1.9, 2.15)


def words(name, text, size, location, rotation, mat):
    """Text as a mesh: a Blender text object's evaluated mesh, so it exports as any mesh."""
    curve = bpy.data.curves.new(name, "FONT")
    curve.body, curve.size, curve.align_x, curve.align_y, curve.extrude = text, size, "CENTER", "CENTER", 0.004
    source = bpy.data.objects.new(name, curve)
    scene.collection.objects.link(source)
    bpy.context.view_layer.update()
    mesh = bpy.data.meshes.new_from_object(source.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(source)
    bpy.data.curves.remove(curve)
    mesh.materials.append(mat)
    ob = bpy.data.objects.new(name, mesh)
    ob.location, ob.rotation_euler = location, rotation
    return link(ob)


# The menu board on a post beside the stand, written on both faces: the barista's side and the customers'.
board = box("Menu Board", (0.8, 0.04, 0.45), (-1.9, -0.5, 1.0), CHALKBOARD)
box("Menu Post", (0.04, 0.04, 0.8), (-1.9, -0.5, 0.4), WOOD)
for side, (y, turn) in {"Back": (-0.47, math.pi), "Front": (-0.53, 0)}.items():
    words(f"Menu {side}", "ROCK HARD CAFÉ\nespresso  2 pebbles\nflat white  3 pebbles", 0.06, (-1.9, y, 1.0), (math.radians(90), 0, turn), CHALK)
# Where a rock waits at the stand, and the trailhead behind the bushes the rocks roll up from and back to.
spot = link(bpy.data.objects.new("Stand Spot", None))
spot.empty_display_type, spot.location = "CIRCLE", (0.1, 0.16, 0)
trailhead = link(bpy.data.objects.new("Trailhead", None))
trailhead.empty_display_type, trailhead.empty_display_size, trailhead.location = "ARROWS", 0.5, (5.5, -2.2, 0)

# The barista behind the counter: the character examples' mannequin (Quaternius, CC0) with its Idle, Walk, Run and Jump,
# appended from ../basic-character/basic-character.blend, facing the customers.
with bpy.data.libraries.load(os.path.join(HERE, "..", "basic-character", "basic-character.blend"), link=False) as (source, data):
    data.objects = list(source.objects)
rig = next(ob for ob in data.objects if ob and ob.type == "ARMATURE")
for ob in data.objects:
    if ob and (ob == rig or ob.parent == rig):
        link(ob)
    elif ob:
        bpy.data.objects.remove(ob)
barista = rig
barista.name = "Barista"
barista.location, barista.rotation_euler = (0.2, 0.86, 0), (0, 0, 0)
bpy.context.view_layer.objects.active = barista
idle_start, idle_end = barista.animation_data.action.frame_range
scene.frame_start, scene.frame_end = int(round(idle_start)), int(round(idle_end))

# The barista's reach: Blender's IK, which the page solves live. The game moves only the Hand Target bone; the right arm
# reaches for it (IK on the forearm, two bones, the elbow toward the Hand Pole), the hand takes the target's turn (palm
# down, pointing ahead), and the chest leans after it: the Chest Target, at the top of the chest, follows most of the
# hand's move (Copy Location, offset, in local space), and an IK on the upper spine (two bones) reaches for it, so the
# shoulders lean toward the hand at their own height and the hips never fold; and the chest turns toward the hand about
# its own length (Locked Track, part way), as shoulders turn to reach to a side. The chest leans ahead only (the target
# copies the forward move alone), so the head never rolls to a shoulder. The free left arm keeps its elbow a little bent
# and swings a little against the chest's turn (a Transform constraint), as a person's off arm does.
HAND_TARGET, HAND_POLE, CHEST_TARGET = "Hand Target", "Hand Pole", "Chest Target"
bpy.ops.object.mode_set(mode="EDIT")
chest = barista.data.edit_bones["DEF-spine.003"].tail.copy()
for name, head in ((HAND_TARGET, (-0.22, -0.25, 1.05)), (HAND_POLE, (-0.45, 0.45, 0.9)), (CHEST_TARGET, tuple(chest))):
    bone = barista.data.edit_bones.new(name)
    bone.head, bone.tail, bone.parent, bone.use_deform = head, (head[0], head[1] - 0.08, head[2]), barista.data.edit_bones["root"], False
    # The hand's roll at rest, which is palm down: copying the target's turn points the hand ahead, palm down, and the
    # chest target's axes match the hand target's, so it copies its move axis for axis.
    bone.align_roll(barista.data.edit_bones["DEF-hand.R"].z_axis)
# The chest's own axis that faces ahead (the barista's front is -Y), which the turn tracks the hand with.
front = barista.data.edit_bones["DEF-spine.003"].matrix.to_3x3().inverted() @ Vector((0, -1, 0))
FRONT = max((("TRACK_X", front.x), ("TRACK_NEGATIVE_X", -front.x), ("TRACK_Z", front.z), ("TRACK_NEGATIVE_Z", -front.z)), key=lambda a: a[1])[0]



def axis_of(bone, direction):
    """The bone's own axis (X or Z) nearest to an armature direction, and its sign."""
    local = barista.data.edit_bones[bone].matrix.to_3x3().inverted() @ Vector(direction)
    return ("X", 1 if local.x > 0 else -1) if abs(local.x) > abs(local.z) else ("Z", 1 if local.z > 0 else -1)


SWING, ELBOW = axis_of("DEF-upper_arm.L", (0, 0, 1)), axis_of("DEF-forearm.L", (0, 0, 1))
bpy.ops.object.mode_set(mode="POSE")
arm = barista.pose.bones["DEF-forearm.R"].constraints.new("IK")
arm.target, arm.subtarget, arm.pole_target, arm.pole_subtarget = barista, HAND_TARGET, barista, HAND_POLE
arm.chain_count, arm.pole_angle = 2, math.radians(-90)
palm = barista.pose.bones["DEF-hand.R"].constraints.new("COPY_ROTATION")
palm.target, palm.subtarget = barista, HAND_TARGET
follow = barista.pose.bones[CHEST_TARGET].constraints.new("COPY_LOCATION")
follow.target, follow.subtarget, follow.use_offset, follow.influence = barista, HAND_TARGET, True, 0.7
follow.owner_space = follow.target_space = "LOCAL"
follow.use_x = follow.use_z = False
core = barista.pose.bones["DEF-spine.003"].constraints.new("IK")
core.target, core.subtarget, core.chain_count = barista, CHEST_TARGET, 2
turn = barista.pose.bones["DEF-spine.003"].constraints.new("LOCKED_TRACK")
turn.target, turn.subtarget, turn.lock_axis, turn.track_axis, turn.influence = barista, HAND_TARGET, "LOCK_Y", FRONT, 0.4
# The off arm: the chest turning toward the right hand (about its own Y, up the spine) swings it back a little, about the
# vertical; and its elbow stays bent at least 15 degrees, the hand toward the front.
swing = barista.pose.bones["DEF-upper_arm.L"].constraints.new("TRANSFORM")
swing.target, swing.subtarget, swing.owner_space, swing.target_space = barista, "DEF-spine.003", "LOCAL", "LOCAL"
swing.map_from, swing.map_to, swing.mix_mode_rot = "ROTATION", "ROTATION", "ADD"
swing.from_min_y_rot, swing.from_max_y_rot = math.radians(-60), math.radians(60)
axis, sign = SWING
setattr(swing, f"map_to_{axis.lower()}_from", "Y")
setattr(swing, f"to_min_{axis.lower()}_rot", sign * math.radians(18))
setattr(swing, f"to_max_{axis.lower()}_rot", -sign * math.radians(18))
bend = barista.pose.bones["DEF-forearm.L"].constraints.new("LIMIT_ROTATION")
axis, sign = ELBOW
bend.owner_space = "LOCAL"
setattr(bend, f"use_limit_{axis.lower()}", True)
setattr(bend, f"min_{axis.lower()}", math.radians(-150) if sign > 0 else math.radians(15))
setattr(bend, f"max_{axis.lower()}", math.radians(-15) if sign > 0 else math.radians(150))
bpy.ops.object.mode_set(mode="OBJECT")

# The prefabs, in collections the view layer excludes, which the game spawns copies of: three kinds of rock, each a
# MegaKit rock of its own size, and the cup.
prefabs = bpy.data.collections.new("Prefabs")
scene.collection.children.link(prefabs)


def megakit_rock(name, model, size, tone, height):
    """A MegaKit rock (CC0) `size` metres across and `height` tall (a customer whose top is about the counter's height),
    its origin at its base, so it sits on the ground where it is placed, in a plain stone of its own `tone`, which the
    game tints (a customer's stain)."""
    rock = environment.megakit(model)
    rock.data.materials.clear()
    rock.data.materials.append(material(f"{name} Stone", (tone, tone * 0.96, tone * 0.9, 1), 0.85))
    rock.name = rock.data.name = name
    for c in list(rock.users_collection):
        c.objects.unlink(rock)
    largest = max(rock.dimensions)
    rock.data.transform(Matrix.Scale(size / largest, 4))
    lowest = min(v.co.z for v in rock.data.vertices)
    tall = max(v.co.z for v in rock.data.vertices) - lowest
    for v in rock.data.vertices:
        v.co.z = (v.co.z - lowest) * height / tall
    return rock


rock_kinds = {}
for kind, model, size, tone, height in (("Rock A", "Rock_Medium_1", 0.75, 0.42, 0.88), ("Rock B", "Rock_Medium_2", 0.85, 0.33, 0.95), ("Rock C", "Rock_Medium_3", 0.7, 0.5, 0.82)):
    rock_kinds[kind] = bpy.data.collections.new(kind)
    prefabs.children.link(rock_kinds[kind])
    link(megakit_rock(f"{kind} Prefab", model, size, tone, height), rock_kinds[kind])
cup_prefabs = bpy.data.collections.new("Cup")
prefabs.children.link(cup_prefabs)
# The cup, its origin at its base, the coffee in it showing from above.
cup = parts("Cup", [("cylinder", (0.055, 0, 0.1), (0, 0, 0.05), 0), ("cylinder", (0.047, 0, 0.002), (0, 0, 0.1), 1)], (0, 0, 0))
cup.data.materials.append(CHINA)
cup.data.materials.append(material("Coffee", (0.12, 0.06, 0.03, 1), 0.15))
for c in list(cup.users_collection):
    c.objects.unlink(cup)
cup_prefabs.objects.link(cup)


def rigid(ob, kind, shape, mass=1.0, animated=False):
    """Blender's rigid body (Physics properties > Rigid Body), which a game with physics runs on Havok: Active falls and
    slides, Passive stays, and Animated follows what moves it (the rocks, moved by their code)."""
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.rigidbody.object_add(type=kind)
    ob.rigid_body.collision_shape, ob.rigid_body.mass, ob.rigid_body.kinematic = shape, mass, animated


for ob in (c.objects[0] for c in rock_kinds.values()):
    rigid(ob, "PASSIVE", "CONVEX_HULL", animated=True)
rigid(cup, "ACTIVE", "CYLINDER", 0.25)
bpy.context.view_layer.layer_collection.children["Prefabs"].exclude = True

# The rock waiting at the stand.
rock = link(megakit_rock("Rock", "Rock_Medium_2", 0.8, 0.4, 0.92))
rock.location = spot.location
rigid(rock, "PASSIVE", "CONVEX_HULL", animated=True)
# The stand on Havok: the ground, the counter and the machine (its own shape: the cup stands under its spout) stay; the
# jars, the jug and the cups fall and slide.
for ob in (bpy.data.objects["Ground"], counter, machine):
    rigid(ob, "PASSIVE", "BOX" if ob == counter else "MESH")
for ob, mass in zip(things, (0.5, 0.6, 0.4)):
    rigid(ob, "ACTIVE", "CYLINDER", mass)

# Each object's behaviours, as Object properties > Behaviors adds them: one group per behaviour, its props as members.
# Python cannot give a nested custom property its UI data (a colour's subtype, limits): the app gives each prop the
# kind its behaviour's code declares when the project opens (blenkernel/behaviors.js repairBehaviors).
def behaviors(ob, **groups):
    ob["behaviors"] = {}
    for name, props in groups.items():
        ob["behaviors"][name] = {}
        for prop, value in props.items():
            ob["behaviors"][name][prop] = value
    return ob


ROCK = {"patience": 20.0, "noises": {"0": SOUNDS["Wood Clack"], "1": SOUNDS["Plank Clack"], "2": SOUNDS["Clack"]}, "delight": SOUNDS["Served"],
        "reaction": "rock_reaction", "stain": [0.24, 0.14, 0.07], "spot": spot, "trailhead": trailhead, "speed": 1.2}
for ob in (rock, *(c.objects[0] for c in rock_kinds.values())):
    behaviors(ob, Rock=ROCK)
behaviors(machine, Machine={"cup": cup_prefabs, "tray": tray, "brew": 0.6})
behaviors(trailhead, Spawner={"prefabs": {str(i): c for i, c in enumerate(rock_kinds.values())}, "every": 3.0})
behaviors(barista, Character={"speed": 1.5, "radius": 0.16, "feet": True, "gaze": True, "lean": True}, Barista={})
behaviors(cup, Cup={"clinks": {"0": SOUNDS["Glass Clink"], "1": SOUNDS["Plate Clink"]}})
# The camera, high over the counter, just behind the barista's head, looking almost straight down: the whole counter top in view,
# the barista's head and shoulders at the frame's bottom edge, the waiting rock across the counter, the brook in a corner.
# The Play Area: the counter, the barista's reach and the rock's spot, which the game's camera keeps in view whatever the
# shape of the view (src/systems/framing.js).
area = link(bpy.data.objects.new("Play Area", None))
area.empty_display_type, area.empty_display_size, area.location, area.scale = "CUBE", 1.0, (0.0, 0.2, 0.5), (1.25, 0.65, 0.5)
camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
camera.data.lens = 40
camera.location = (0.0, 0.6, 5.2)
camera.rotation_euler = (math.radians(5), 0, math.pi)
link(camera)
scene.camera = camera

bpy.ops.object.select_all(action="DESELECT")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "rock-hard-cafe.blend"), compress=True, relative_remap=True)
