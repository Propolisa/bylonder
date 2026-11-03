"""Chess Endgame: turned ivory and ebony pieces on a wooden board, lit by one low lamp.

Each piece is a lathe: a profile of (radius, height) points turned around Z; the knight's head is a bent block on a
turned base. The board is one mesh of 64 squares with two materials.

blender -b --factory-startup -P chess.py   (writes chess.blend beside this file)
"""
import math
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
SQUARE = 0.06

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.resolution_x, scene.render.resolution_y = 1280, 800


def material(name, color, roughness=0.5, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return m


IVORY = material("Ivory", (0.85, 0.78, 0.62, 1), 0.18)
EBONY = material("Ebony", (0.015, 0.012, 0.01, 1), 0.15)
MAPLE = material("Maple", (0.6, 0.42, 0.22, 1), 0.35)
WALNUT = material("Walnut", (0.12, 0.05, 0.02, 1), 0.35)
FRAME = material("Frame", (0.07, 0.03, 0.015, 1), 0.3)
CLOTH = material("Cloth", (0.05, 0.12, 0.08, 1), 0.95)

BASE = [(0, 0), (0.3, 0), (0.31, 0.03), (0.28, 0.06), (0.22, 0.08), (0.2, 0.1)]
PROFILES = {
    "Pawn": BASE + [(0.12, 0.14), (0.09, 0.3), (0.16, 0.32), (0.08, 0.35), (0.14, 0.42), (0.13, 0.5), (0.07, 0.56), (0, 0.57)],
    "Rook": BASE + [(0.16, 0.14), (0.14, 0.42), (0.21, 0.45), (0.21, 0.6), (0.15, 0.6), (0.15, 0.56), (0, 0.56)],
    "Bishop": BASE + [(0.12, 0.14), (0.08, 0.48), (0.17, 0.5), (0.09, 0.53), (0.13, 0.6), (0.12, 0.7), (0.06, 0.78), (0.04, 0.8), (0.05, 0.83), (0, 0.85)],
    "Queen": BASE + [(0.13, 0.14), (0.08, 0.6), (0.19, 0.62), (0.09, 0.66), (0.17, 0.82), (0.12, 0.84), (0.07, 0.86), (0.06, 0.9), (0, 0.92)],
    "King": BASE + [(0.14, 0.14), (0.09, 0.66), (0.2, 0.68), (0.1, 0.72), (0.17, 0.88), (0.06, 0.9), (0.03, 0.92), (0.03, 1.0), (0, 1.0)],
    "Knight": BASE + [(0.16, 0.14), (0.15, 0.2), (0, 0.2)],
}


def lathe(name, profile, mat, segments=40):
    verts, faces = [], []
    for k in range(segments):
        a = 2 * math.pi * k / segments
        verts += [(r * math.cos(a), r * math.sin(a), z) for r, z in profile]
    n = len(profile)
    for k in range(segments):
        for j in range(n - 1):
            a, b = k * n + j, ((k + 1) % segments) * n + j
            faces.append((a, b, b + 1, a + 1))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(mat)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    ob = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(ob)
    return ob


def piece(kind, color, file, rank, turn=0.0, scale=SQUARE * 0.75):
    mat = IVORY if color == "White" else EBONY
    ob = lathe(f"{color} {kind}", PROFILES[kind], mat)
    if kind == "Knight":
        # The head: a block leaned forward with a muzzle, on the turned base.
        bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0.42), scale=(0.1, 0.13, 0.24), rotation=(-0.35, 0, 0))
        head = bpy.context.object
        bevel = head.modifiers.new("Bevel", "BEVEL")
        bevel.width, bevel.segments = 0.05, 3
        bpy.ops.object.modifier_apply(modifier="Bevel")
        bpy.ops.mesh.primitive_cube_add(location=(0, -0.17, 0.52), scale=(0.08, 0.13, 0.08), rotation=(0.5, 0, 0))
        muzzle = bpy.context.object
        bevel = muzzle.modifiers.new("Bevel", "BEVEL")
        bevel.width, bevel.segments = 0.04, 3
        bpy.ops.object.modifier_apply(modifier="Bevel")
        bpy.ops.object.select_all(action="DESELECT")
        for part in (ob, head, muzzle):
            part.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.join()
        ob.data.materials.clear()
        ob.data.materials.append(mat)
    ob.scale = (scale,) * 3
    ob.location = ((file - 3.5) * SQUARE, (rank - 3.5) * SQUARE, 0)
    ob.rotation_euler = (0, 0, turn)
    return ob


# The board: 64 squares, light on maple and dark on walnut, in a frame on a green cloth.
verts, faces, mats = [], [], []
for i in range(8):
    for j in range(8):
        x0, y0 = (i - 4) * SQUARE, (j - 4) * SQUARE
        base = len(verts)
        verts += [(x0, y0, 0), (x0 + SQUARE, y0, 0), (x0 + SQUARE, y0 + SQUARE, 0), (x0, y0 + SQUARE, 0)]
        faces.append((base, base + 1, base + 2, base + 3))
        mats.append((i + j + 1) % 2)
board_mesh = bpy.data.meshes.new("Board")
board_mesh.from_pydata(verts, [], faces)
board_mesh.materials.append(WALNUT)
board_mesh.materials.append(MAPLE)
board_mesh.polygons.foreach_set("material_index", mats)
board = bpy.data.objects.new("Board", board_mesh)
scene.collection.objects.link(board)
bpy.ops.mesh.primitive_cube_add(location=(0, 0, -0.012), scale=(4.4 * SQUARE, 4.4 * SQUARE, 0.0119))
bpy.context.object.name = "Board Frame"
bpy.context.object.data.materials.append(FRAME)
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, -0.024))
bpy.context.object.name = "Table"
bpy.context.object.data.materials.append(CLOTH)

# The position: white to mate; a black queen taken lies on the cloth.
for kind, color, file, rank, turn in [
    ("King", "White", 5, 2, 0.3), ("Rook", "White", 0, 6, 0.0), ("Pawn", "White", 6, 4, 0.0), ("Pawn", "White", 7, 3, 0.0),
    ("Knight", "White", 3, 4, 2.6), ("Bishop", "White", 2, 1, 0.0),
    ("King", "Black", 6, 7, 0.2), ("Pawn", "Black", 6, 6, 0.0), ("Pawn", "Black", 7, 5, 0.0), ("Knight", "Black", 4, 6, -0.5),
]:
    piece(kind, color, file, rank, turn)
fallen = piece("Queen", "Black", 0, 0)
fallen.rotation_euler = (math.radians(90), 0, math.radians(30))
fallen.location = (5.9 * SQUARE, -2.6 * SQUARE, 0.31 * SQUARE * 0.75 - 0.024)

lamp = bpy.data.lights.new("Lamp", "SPOT")
lamp.energy, lamp.color, lamp.spot_size, lamp.spot_blend, lamp.shadow_soft_size = 60, (1.0, 0.8, 0.55), math.radians(70), 0.6, 0.12
lamp_ob = bpy.data.objects.new("Lamp", lamp)
lamp_ob.location = (0.45, 0.35, 0.65)
lamp_ob.rotation_euler = (math.radians(42), 0, math.radians(128))
scene.collection.objects.link(lamp_ob)
rim = bpy.data.lights.new("Rim", "AREA")
rim.energy, rim.size, rim.color = 6, 0.8, (0.55, 0.7, 1.0)
rim_ob = bpy.data.objects.new("Rim", rim)
rim_ob.location, rim_ob.rotation_euler = (-0.3, 0.7, 0.4), (math.radians(-60), 0, math.radians(-155))
scene.collection.objects.link(rim_ob)

world = bpy.data.worlds.new("Room")
world.color = (0.01, 0.01, 0.012)
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.015, 0.016, 0.02, 1)
scene.world = world

camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
camera.data.lens = 60
camera.location = (0.05, -0.62, 0.22)
camera.rotation_euler = (math.radians(73), 0, math.radians(8))
scene.collection.objects.link(camera)
scene.camera = camera

bpy.ops.object.select_all(action="DESELECT")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "chess.blend"), compress=True)
