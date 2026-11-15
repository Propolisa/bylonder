"""Rock Hard Café: an open-air coffee stand in a low-poly forest by a brook, whose customers are rocks, the scene of the
game in src/.

A wooden counter with a coffee machine and a parasol beside it, the barista behind the counter, one rock waiting at the stand and
the trailhead the next rocks roll up from. The Rock and Cup collections are prefabs the game spawns copies of (excluded
from the view layer); each object's behaviours are its `behaviors` custom property group, as Object properties >
Behaviors adds them. The rocks' noises and the machine's hiss are short sounds this script writes into sounds/ and
packs. The forest is Quaternius' Stylized Nature MegaKit (CC0), as the character examples use it
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
from mathutils import Matrix

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
CANVAS = material("Parasol", (0.75, 0.22, 0.16, 1), 0.8)
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
    """A short sound written to sounds/<name>.wav: a sum of decaying tones and some noise, 22 kHz mono."""
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
            data += struct.pack("<h", int(max(-1, min(1, s * envelope)) * 20000))
        out.writeframes(bytes(data))
    sound = bpy.data.sounds.load(path)
    sound.name = name
    sound.use_fake_user = True
    sound.pack()  # in the .blend, which the app and an export read it from
    return sound


SOUNDS = {name: tone(name, *args) for name, args in {
    "Grind": ([70, 93], 0.6, 0.6), "Rumble": ([45, 61], 0.9, 0.3), "Clack": ([900, 1400], 0.15, 0.4), "Steam": ([2000], 0.7, 0.9),
}.items()}

# The forest: the character examples' ground, grass, rocks, bushes and pines, sky and sun (environment.py), then a brook
# across the clearing behind the rocks' side and pines around it.
environment.build()
brook = box("Brook", (40, 1.4, 0.02), (0, -5.5, 0.02), WATER)
for name, places in {"Pine_5": [(-6, -9, 1.1), (5, -10, 1.3), (-11, -3, 1.0), (10, -6, 1.2), (-8, 5, 0.9), (8, 6, 1.0)],
                     "Rock_Medium_1": [(-3.5, -6.4, 0.5), (2.5, -4.7, 0.4), (6.5, -6.3, 0.6)],
                     "Bush_Common_Flowers": [(-4.5, -1.5, 0.7), (6.8, -2.6, 0.9), (4.2, 3.0, 0.6)]}.items():
    environment.instanced(environment.megakit(name), f"Stand {name}", [(x, y, 0, size, random.uniform(0, math.tau)) for x, y, size in places])

# The stand, open to the sky: a counter with the coffee machine on it, and a parasol beside it for shade.
counter = box("Counter", (3.2, 0.7, 1.0), (0, 0.6, 0.5), WOOD)
machine = box("Machine", (0.5, 0.4, 0.6), (-1.2, 0.6, 1.3), CHROME)
box("Parasol Pole", (0.05, 0.05, 2.3), (3.3, 1.2, 1.15), WOOD)
parasol = bpy.data.meshes.new("Parasol")
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=False, segments=8, radius1=1.1, radius2=0.02, depth=0.45)
bm.to_mesh(parasol)
bm.free()
parasol.materials.append(CANVAS)
link(bpy.data.objects.new("Parasol", parasol)).location = (3.3, 1.2, 2.35)


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


# The menu board on the counter, written on both faces: the barista's side and the customers'.
board = box("Menu Board", (1.0, 0.04, 0.55), (0.95, 0.6, 1.3), CHALKBOARD)
for side, (y, turn) in {"Back": (0.63, math.pi), "Front": (0.57, 0)}.items():
    words(f"Menu {side}", "ROCK HARD CAFÉ\nespresso  2 pebbles\nflat white  3 pebbles", 0.075, (0.95, y, 1.3), (math.radians(90), 0, turn), CHALK)
# Where a rock waits at the stand, and the trailhead behind the bushes the rocks roll up from and back to.
spot = link(bpy.data.objects.new("Stand Spot", None))
spot.empty_display_type, spot.location = "CIRCLE", (0.3, -0.75, 0)
trailhead = link(bpy.data.objects.new("Trailhead", None))
trailhead.empty_display_type, trailhead.empty_display_size, trailhead.location = "ARROWS", 0.5, (7.5, -2.8, 0)

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
barista.location, barista.rotation_euler = (0.4, 1.5, 0), (0, 0, math.pi)
bpy.context.view_layer.objects.active = barista
idle_start, idle_end = barista.animation_data.action.frame_range
scene.frame_start, scene.frame_end = int(round(idle_start)), int(round(idle_end))

# The prefabs, in collections the view layer excludes, which the game spawns copies of: three kinds of rock, each a
# MegaKit rock of its own size, and the cup.
prefabs = bpy.data.collections.new("Prefabs")
scene.collection.children.link(prefabs)


def megakit_rock(name, model, size, tone):
    """A MegaKit rock (CC0) `size` metres across, its origin at its base, so it sits on the ground where it is placed, in
    a plain stone of its own `tone`, which the game tints (a customer's stain)."""
    rock = environment.megakit(model)
    rock.data.materials.clear()
    rock.data.materials.append(material(f"{name} Stone", (tone, tone * 0.96, tone * 0.9, 1), 0.85))
    rock.name = rock.data.name = name
    for c in list(rock.users_collection):
        c.objects.unlink(rock)
    largest = max(rock.dimensions)
    rock.data.transform(Matrix.Scale(size / largest, 4))
    lowest = min(v.co.z for v in rock.data.vertices)
    for v in rock.data.vertices:
        v.co.z -= lowest
    return rock


rock_kinds = {}
for kind, model, size, tone in (("Rock A", "Rock_Medium_1", 0.55, 0.42), ("Rock B", "Rock_Medium_2", 0.7, 0.33), ("Rock C", "Rock_Medium_3", 0.45, 0.5)):
    rock_kinds[kind] = bpy.data.collections.new(kind)
    prefabs.children.link(rock_kinds[kind])
    link(megakit_rock(f"{kind} Prefab", model, size, tone), rock_kinds[kind])
cup_prefabs = bpy.data.collections.new("Cup")
prefabs.children.link(cup_prefabs)
cup = cylinder("Cup", 0.1, 0.14, (0, 0, 0.07), CHINA, cup_prefabs)  # larger than life, to read from the camera
bpy.context.view_layer.layer_collection.children["Prefabs"].exclude = True

# The rock waiting at the stand.
rock = link(megakit_rock("Rock", "Rock_Medium_2", 0.6, 0.4))
rock.location = spot.location

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


ROCK = {"patience": 12.0, "noises": {"0": SOUNDS["Grind"], "1": SOUNDS["Rumble"], "2": SOUNDS["Clack"]},
        "reaction": "rock_reaction", "stain": [0.24, 0.14, 0.07], "spot": spot, "trailhead": trailhead, "speed": 1.2}
for ob in (rock, *(c.objects[0] for c in rock_kinds.values())):
    behaviors(ob, Rock=ROCK)
behaviors(machine, Machine={"cup": cup_prefabs, "brew": 0.6, "hiss": SOUNDS["Steam"]})
behaviors(trailhead, Spawner={"prefabs": {str(i): c for i, c in enumerate(rock_kinds.values())}, "every": 3.0})
behaviors(barista, Character={"speed": 2.5, "feet": True, "gaze": True, "lean": True}, Barista={})
# The camera, seen from the rocks' side (the game's follows the barista).
camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
camera.data.lens = 35
camera.location = (0.5, -5.2, 2.4)
camera.rotation_euler = (math.radians(72), 0, math.radians(4))
link(camera)
scene.camera = camera

bpy.ops.object.select_all(action="DESELECT")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "rock-hard-cafe.blend"), compress=True, relative_remap=True)
