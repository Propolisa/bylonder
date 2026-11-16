# Saves Bake Corner (tests/fixtures/bake-corner.blend), the small scene the bake tests use: a floor and two walls in a
# corner, a red block on the floor, a sun and a sky, a glowing tile, and a smooth pebble with a low copy of it for
# Selected to Active.
# usage: blender -b --factory-startup --python tools/blender-reference/bake-fixtures.py -- OUT.blend
import bpy, sys, math

out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = 'Bake Corner'
world = bpy.data.worlds.new('Sky')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.45, 0.6, 0.9, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6


def material(name, color, emission=0.0, roughness=0.7):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = emission
    return mat


def box(name, location, size, mat):
    bpy.ops.mesh.primitive_cube_add(location=location)
    ob = bpy.context.object
    ob.name = ob.data.name = name
    ob.scale = [s / 2 for s in size]
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(mat)
    return ob


plaster, red = material('Plaster', (0.8, 0.78, 0.72)), material('Red', (0.8, 0.08, 0.05), roughness=0.4)
box('Floor', (0, 0, -0.05), (4, 4, 0.1), plaster)
box('Back Wall', (0, 2.05, 1), (4, 0.1, 2), plaster)
box('Side Wall', (-2.05, 0, 1), (0.1, 4, 2), plaster)
box('Block', (-0.6, 0.6, 0.4), (0.8, 0.8, 0.8), red)
box('Tile', (1.2, 1.9, 1.2), (0.4, 0.1, 0.4), material('Glow', (1.0, 0.7, 0.3), emission=4.0))
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.3, location=(0.9, -0.6, 0.3), segments=48, ring_count=24)
pebble = bpy.context.object
pebble.name = pebble.data.name = 'Pebble'
bpy.ops.object.shade_smooth()
pebble.data.materials.append(red)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.3, location=(0.9, -0.6, 0.3), segments=8, ring_count=6)
low = bpy.context.object
low.name = low.data.name = 'Pebble Low'
low.data.materials.append(material('Pebble Low', (0.5, 0.5, 0.5)))
low.visible_camera = False
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy, sun.data.angle = 4, math.radians(3)
sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
scene.collection.objects.link(sun)
camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.location, camera.rotation_euler = (3.2, -3.4, 2.4), (math.radians(65), 0, math.radians(43))
scene.collection.objects.link(camera)
scene.camera = camera
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
