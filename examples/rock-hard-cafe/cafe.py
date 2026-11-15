"""Rock Hard Café: a café counter whose customers are rocks, the scene of the game in src/.

A counter, a coffee machine, a door the rocks come in by, the barista behind the counter and one rock waiting. The
Rock and Cup collections are prefabs the game spawns copies of (excluded from the view layer); each object's
behaviours are its `behaviors` custom property group, as Object properties > Behaviors adds them. The rocks' noises and
the machine's hiss are short sounds this script writes into sounds/.

blender -b --factory-startup -P cafe.py   (writes rock-hard-cafe.blend and sounds/ beside this file)
"""
import math
import os
import random
import struct
import wave

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "Rock Hard Café"
scene.render.resolution_x, scene.render.resolution_y = 1280, 800
scene.frame_start, scene.frame_end, scene.render.fps = 1, 24, 24


def material(name, color, roughness=0.5, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return m


WOOD = material("Counter Wood", (0.28, 0.14, 0.06, 1), 0.55)
TILES = material("Floor Tiles", (0.55, 0.5, 0.44, 1), 0.7)
CHROME = material("Chrome", (0.75, 0.75, 0.78, 1), 0.2, 1.0)
STONE = material("Stone", (0.42, 0.4, 0.38, 1), 0.85)
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


def rock_mesh():
    """A lumpy rock: an icosphere pushed in and out a little, smooth shaded."""
    mesh = bpy.data.meshes.new("Rock")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.35)
    for v in bm.verts:
        v.co *= 1 + random.uniform(-0.12, 0.12)
        v.co.z *= 0.8
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(STONE)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return mesh


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
    return sound


SOUNDS = {name: tone(name, *args) for name, args in {
    "Grind": ([70, 93], 0.6, 0.6), "Rumble": ([45, 61], 0.9, 0.3), "Clack": ([900, 1400], 0.15, 0.4), "Steam": ([2000], 0.7, 0.9),
}.items()}

# The café: floor, counter, machine, the door the rocks come in by.
box("Floor", (8, 6, 0.1), (0, 0, -0.05), TILES)
counter = box("Counter", (3.2, 0.7, 1.0), (0, 0.6, 0.5), WOOD)
machine = box("Machine", (0.5, 0.4, 0.6), (-1.2, 0.6, 1.3), CHROME)


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
door = bpy.data.objects.new("Door", None)
door.empty_display_type, door.empty_display_size, door.location = "ARROWS", 0.5, (3.5, -2.0, 0)
link(door)

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

# The prefabs: one rock and one cup, in collections the view layer excludes, which the game spawns copies of.
prefabs = bpy.data.collections.new("Prefabs")
scene.collection.children.link(prefabs)
rock_prefabs = bpy.data.collections.new("Rock")
cup_prefabs = bpy.data.collections.new("Cup")
prefabs.children.link(rock_prefabs)
prefabs.children.link(cup_prefabs)
shared_rock = rock_mesh()
prefab_rock = link(bpy.data.objects.new("Rock Prefab", shared_rock), rock_prefabs)
cup = cylinder("Cup", 0.1, 0.14, (0, 0, 0.07), CHINA, cup_prefabs)  # larger than life, to read from the camera
bpy.context.view_layer.layer_collection.children["Prefabs"].exclude = True

# The rock waiting at the counter, a copy of the prefab's mesh.
rock = link(bpy.data.objects.new("Rock", shared_rock))
rock.location = (0.3, -0.75, 0.28)

# Wobble: the rock's admiring wobble, an object action.
wobble = bpy.data.actions.new("Wobble")
rock.animation_data_create().action = wobble
for frame, angle in ((1, 0), (7, 10), (13, -10), (19, 6), (24, 0)):
    rock.rotation_euler = (0, math.radians(angle), 0)
    rock.keyframe_insert("rotation_euler", index=1, frame=frame)
rock.rotation_euler = (0, 0, 0)
rock.animation_data.action = None
# On a muted NLA track of each rock, as a game file keeps its clips: the export ships it as a clip the game plays.
for ob in (rock, prefab_rock):
    track = (ob.animation_data or ob.animation_data_create()).nla_tracks.new()
    track.name, track.mute = "Wobble", True
    track.strips.new("Wobble", 1, wobble)

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


ROCK = {"patience": 8.0, "admire": wobble, "noises": {"0": SOUNDS["Grind"], "1": SOUNDS["Rumble"], "2": SOUNDS["Clack"]},
        "reaction": "rock_reaction", "stain": [0.24, 0.14, 0.07]}
for ob in (rock, prefab_rock):
    behaviors(ob, Rock=ROCK)
behaviors(machine, Machine={"cup": cup_prefabs, "brew": 0.6, "hiss": SOUNDS["Steam"]})
behaviors(door, Spawner={"prefab": rock_prefabs, "every": 4.0, "max": 3})
behaviors(barista, Character={"speed": 2.5, "feet": True, "gaze": True, "lean": True}, Barista={})
# Light and camera: a warm café, seen from the customers' side.
sun = bpy.data.lights.new("Window", "SUN")
sun.energy, sun.color, sun.angle = 3, (1.0, 0.86, 0.7), math.radians(8)
sun_ob = link(bpy.data.objects.new("Window", sun))
sun_ob.rotation_euler = (math.radians(50), 0, math.radians(35))
lamp = bpy.data.lights.new("Lamp", "POINT")
lamp.energy, lamp.color, lamp.shadow_soft_size = 300, (1.0, 0.75, 0.5), 0.3
lamp_ob = link(bpy.data.objects.new("Lamp", lamp))
lamp_ob.location = (0, 0.2, 2.6)

world = bpy.data.worlds.new("Café")
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.04, 0.035, 1)
scene.world = world

camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
camera.data.lens = 35
camera.location = (0.5, -5.2, 2.4)
camera.rotation_euler = (math.radians(72), 0, math.radians(4))
link(camera)
scene.camera = camera

bpy.ops.object.select_all(action="DESELECT")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "rock-hard-cafe.blend"), compress=True, relative_remap=True)
