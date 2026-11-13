# Writes tests/fixtures/render-disabled-light.blend: a cube lit by two lights, Kept and Off, Off disabled in renders.
# usage: blender -b --factory-startup --python tools/blender-reference/render-disabled-light-fixture.py -- OUT_FILE
import bpy, sys

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
for name, x in (("Kept", -3), ("Off", 3)):
    light = bpy.data.objects.new(name, bpy.data.lights.new(name, "POINT"))
    light.location = (x, -3, 2)
    bpy.context.scene.collection.objects.link(light)
bpy.data.objects["Off"].hide_render = True
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
