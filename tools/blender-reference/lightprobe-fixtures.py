# Saves a room lit by a sun through one window, with an Irradiance Volume filling it, baked by EEVEE
# (tests/fixtures/lightprobe-room.blend): EEVEE's own light cache, which Bylonder reads through lightprobe-api.cc.
# usage: blender -b --factory-startup --python tools/blender-reference/lightprobe-fixtures.py -- OUT.blend
import bpy, sys, math

out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
world = bpy.data.worlds.new('World'); scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.4, 0.55, 0.8, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.3
def mat(name, color):
    m = bpy.data.materials.new(name); m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*color, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
    return m
def box(name, loc, size, material):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    o = bpy.context.object; o.name = name; o.scale = [s / 2 for s in size]
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material); return o
white, red, floor = mat('Wall', (0.8, 0.8, 0.8)), mat('Red', (0.8, 0.05, 0.03)), mat('Floor', (0.8, 0.5, 0.2))
box('Floor', (0, 0, -0.1), (6, 6, 0.2), floor)
box('Ceiling', (0, 0, 3.1), (6, 6, 0.2), white)
box('Back', (0, 3.1, 1.5), (6, 0.2, 3), white)
box('Left', (-3.1, 0, 1.5), (0.2, 6, 3), red)
box('Front', (0, -3.1, 1.5), (6, 0.2, 3), white)
# Right wall with a window: four pieces around a 2 x 1.4 opening.
box('Right Low', (3.1, 0, 0.4), (0.2, 6, 0.8), white)
box('Right High', (3.1, 0, 2.6), (0.2, 6, 0.8), white)
box('Right A', (3.1, -2, 1.5), (0.2, 2, 1.4), white)
box('Right B', (3.1, 2, 1.5), (0.2, 2, 1.4), white)
box('Block', (-1, 0.5, 0.6), (1.2, 1.2, 1.2), white)
sun = bpy.data.lights.new('Sun', 'SUN'); sun.energy = 6; sun.angle = math.radians(2)
so = bpy.data.objects.new('Sun', sun); scene.collection.objects.link(so)
so.rotation_euler = (math.radians(55), 0, math.radians(90 + 10))
probe = bpy.data.lightprobes.new('Volume', 'VOLUME')
po = bpy.data.objects.new('Volume', probe); scene.collection.objects.link(po)
po.location = (0, 0, 1.5); po.scale = (3.3, 3.3, 1.8)
probe.resolution_x = probe.resolution_y = 6; probe.resolution_z = 4
cam = bpy.data.cameras.new('Camera'); co = bpy.data.objects.new('Camera', cam); scene.collection.objects.link(co)
co.location = (-2.6, -2.7, 1.6); co.rotation_euler = (math.radians(88), 0, math.radians(-40)); cam.lens = 18
scene.camera = co
scene.render.resolution_x, scene.render.resolution_y = 960, 540
bpy.context.view_layer.objects.active = po
bpy.ops.object.lightprobe_cache_bake(subset='ALL')
bpy.ops.wm.save_as_mainfile(filepath=out)
