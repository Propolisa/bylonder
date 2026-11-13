# Writes tests/fixtures/world-drawn-background.blend: a cube under a World of two Background nodes, the first (grey,
# unlinked) left aside and the second (blue, Strength 2) drawn by the World Output.
# usage: blender -b --factory-startup --python tools/blender-reference/world-drawn-background-fixture.py -- OUT_FILE
import bpy, sys

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.mesh.primitive_cube_add()
world = scene.world = bpy.data.worlds.new("World")
world.use_nodes = True
tree = world.node_tree
aside = tree.nodes.get("Background") or tree.nodes.new("ShaderNodeBackground")
aside.inputs["Color"].default_value = (0.3, 0.3, 0.3, 1)
drawn = tree.nodes.new("ShaderNodeBackground")
drawn.inputs["Color"].default_value = (0.1, 0.2, 0.4, 1)
drawn.inputs["Strength"].default_value = 2
tree.links.new(drawn.outputs["Background"], tree.nodes["World Output"].inputs["Surface"])
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print("SAVED", out, aside.name, drawn.name)
