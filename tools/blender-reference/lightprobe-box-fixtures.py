# Saves a closed box room with an Irradiance Volume inside it, unbaked (tests/fixtures/lightprobe-box.blend): every
# direction from every sample meets a wall, so a bake sees no sky (tests/e2e/smoke.mjs).
# usage: blender -b --factory-startup --python tools/blender-reference/lightprobe-box-fixtures.py -- OUT.blend
import bpy, sys

out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
world = bpy.data.worlds.new('World')
scene.world = world
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
bpy.ops.mesh.primitive_cube_add(size=4)
room = bpy.context.object
room.name = 'Room'
# Its faces turned inward, so the probe sees their front faces.
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.flip_normals()
bpy.ops.object.mode_set(mode='OBJECT')
room.data.materials.append(bpy.data.materials.new('Wall'))
lamp = bpy.data.objects.new('Lamp', bpy.data.lights.new('Lamp', 'POINT'))
scene.collection.objects.link(lamp)
probe = bpy.data.objects.new('Volume', bpy.data.lightprobes.new('Volume', 'VOLUME'))
scene.collection.objects.link(probe)
probe.scale = (1.5, 1.5, 1.5)
probe.data.resolution_x = probe.data.resolution_y = probe.data.resolution_z = 3
bpy.ops.wm.save_as_mainfile(filepath=out)
