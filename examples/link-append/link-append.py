"""Link and Append: a street at dusk set dressed from a library.

libraries/library.blend holds the props: the Street Lamp collection (an iron post, a glass lantern and its light), a
Bench outside it and a Cobblestone material no object uses. link-append.blend is a street: the lamp linked once and
instanced along both sides, the bench appended and the cobblestones appended onto the road, seen by a camera.

blender -b --factory-startup -P link-append.py   (writes libraries/library.blend and link-append.blend beside this file)

The library is linked by its relative path, //libraries/library.blend, which Blender and Bylonder both resolve.
"""
import math
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
LIBRARY = os.path.join(HERE, "libraries", "library.blend")


def material(name, color, roughness=0.5, metallic=0.0, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def mesh(name, add, materials, **kwargs):
    add(**kwargs)
    ob = bpy.context.object
    ob.name = ob.data.name = name
    for m in materials:
        ob.data.materials.append(m)
    return ob


def join(name, parts):
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = ob.data.name = name
    return ob


# The library.
bpy.ops.wm.read_factory_settings(use_empty=True)
lamp = bpy.data.collections.new("Street Lamp")
bpy.context.scene.collection.children.link(lamp)
bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children["Street Lamp"]
iron = material("Iron", (0.02, 0.022, 0.025, 1), roughness=0.35, metallic=1.0)
glass = material("Lantern Glass", (1.0, 0.75, 0.4, 1), roughness=0.2, emission=(1.0, 0.62, 0.28, 1), strength=12.0)
post = join("Post", [
    mesh("Base", bpy.ops.mesh.primitive_cylinder_add, [iron], vertices=16, radius=0.16, depth=0.5, location=(0, 0, 0.25)),
    mesh("Pole", bpy.ops.mesh.primitive_cylinder_add, [iron], vertices=12, radius=0.06, depth=3.4, location=(0, 0, 2.0)),
    mesh("Cap", bpy.ops.mesh.primitive_cone_add, [iron], vertices=4, radius1=0.32, depth=0.28, location=(0, 0, 4.25), rotation=(0, 0, math.pi / 4)),
    mesh("Frame", bpy.ops.mesh.primitive_cylinder_add, [iron], vertices=4, radius=0.17, depth=0.06, location=(0, 0, 3.72), rotation=(0, 0, math.pi / 4)),
])
bpy.ops.object.shade_smooth()
lantern = mesh("Lantern", bpy.ops.mesh.primitive_cylinder_add, [glass], vertices=4, radius=0.2, depth=0.4, location=(0, 0, 3.95), rotation=(0, 0, math.pi / 4))
lantern.visible_shadow = False
light = bpy.data.lights.new("Lamp Light", "POINT")
light.energy, light.color, light.shadow_soft_size = 180, (1.0, 0.62, 0.3), 0.15
light_ob = bpy.data.objects.new("Lamp Light", light)
light_ob.location = (0, 0, 3.95)
lamp.objects.link(light_ob)
for child in (lantern, light_ob):
    child.parent = post
    child.matrix_parent_inverse = post.matrix_world.inverted()

bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection
wood = material("Weathered Wood", (0.32, 0.18, 0.09, 1), roughness=0.7)
slats = [mesh(f"Slat {i}", bpy.ops.mesh.primitive_cube_add, [wood], location=(0, -0.2 + 0.14 * i, 0.45), scale=(0.8, 0.055, 0.025)) for i in range(4)]
back = [mesh(f"Back {i}", bpy.ops.mesh.primitive_cube_add, [wood], location=(0, 0.27, 0.7 + 0.13 * i), scale=(0.8, 0.025, 0.05), rotation=(-0.25, 0, 0)) for i in range(2)]
legs = [mesh(f"Leg {i}", bpy.ops.mesh.primitive_cube_add, [iron], location=(x, 0.05, 0.4), scale=(0.03, 0.27, 0.4)) for i, x in enumerate((-0.7, 0.7))]
join("Bench", slats + back + legs)
cobble = material("Cobblestone", (0.09, 0.08, 0.075, 1), roughness=0.25)
cobble.use_fake_user = True
os.makedirs(os.path.dirname(LIBRARY), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=LIBRARY)

# The street.
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
world = bpy.data.worlds.new("Dusk")
world.color = (0.03, 0.045, 0.09)
background = world.node_tree.nodes["Background"]
background.inputs["Color"].default_value = (0.035, 0.05, 0.11, 1)
background.inputs["Strength"].default_value = 0.6
scene.world = world
scene.render.resolution_x, scene.render.resolution_y = 1280, 720

bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 14, 0), scale=(4.2, 34, 1))
road = bpy.context.object
road.name = road.data.name = "Road"
for side in (-1, 1):
    bpy.ops.mesh.primitive_cube_add(location=(side * 3.6, 14, 0.08), scale=(1.5, 17, 0.08))
    kerb = bpy.context.object
    kerb.name = kerb.data.name = "Pavement Left" if side < 0 else "Pavement Right"
    kerb.data.materials.append(material(f"Pavement {side}", (0.16, 0.15, 0.14, 1), roughness=0.6))
    bpy.ops.mesh.primitive_cube_add(location=(side * 7.5, 14, 2.5), scale=(2.4, 17, 2.5))
    wall = bpy.context.object
    wall.name = wall.data.name = "Houses Left" if side < 0 else "Houses Right"
    wall.data.materials.append(material(f"Brick {side}", (0.22, 0.09, 0.06, 1), roughness=0.8))

bpy.ops.wm.append(directory=os.path.join(LIBRARY, "Material") + "/", filename="Cobblestone", files=[{"name": "Cobblestone"}])
road.data.materials.append(bpy.data.materials["Cobblestone"])

bpy.ops.wm.link(directory=os.path.join(LIBRARY, "Collection") + "/", filename="Street Lamp", files=[{"name": "Street Lamp"}])
first = bpy.data.objects["Street Lamp"]
first.location = (-2.9, 0, 0.16)
for i in range(1, 8):
    copy = first.copy()
    copy.location = ((-2.9 if i % 2 == 0 else 2.9), 4.5 * i, 0.16)
    scene.collection.objects.link(copy)
bpy.ops.wm.append(directory=os.path.join(LIBRARY, "Object") + "/", filename="Bench", files=[{"name": "Bench"}])
bench = bpy.data.objects["Bench"]
bench.location, bench.rotation_euler = (-3.7, 2.3, 0.16), (0, 0, -math.pi / 2)

moon = bpy.data.lights.new("Moon", "SUN")
moon.energy, moon.color, moon.angle = 0.6, (0.55, 0.65, 1.0), math.radians(2)
moon_ob = bpy.data.objects.new("Moon", moon)
moon_ob.rotation_euler = (math.radians(55), 0, math.radians(150))
scene.collection.objects.link(moon_ob)

camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
camera.data.lens = 32
camera.location = (0.6, -6.5, 1.5)
camera.rotation_euler = (math.radians(86), 0, math.radians(-3))
scene.collection.objects.link(camera)
scene.camera = camera

bpy.ops.object.select_all(action="DESELECT")
# Relative with forward slashes on every system, as the module's file system and Blender both read it.
bpy.data.libraries["library.blend"].filepath = "//libraries/library.blend"
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "link-append.blend"), compress=True, relative_remap=False)
