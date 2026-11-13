# Writes tests/fixtures/environment-light.blend: a plane in an image-textured Principled under a World of nodes (a
# gradient into its Background), which exports as a world baked into the page's environment probe.
# usage: blender -b --factory-startup --python tools/blender-reference/environment-light-fixture.py -- OUT_FILE
import bpy, sys

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
world = bpy.context.scene.world = bpy.data.worlds.new("World")
world.use_nodes = True
tree = world.node_tree
gradient = tree.nodes.new("ShaderNodeTexGradient")
tree.links.new(gradient.outputs["Color"], tree.nodes["Background"].inputs["Color"])
material = bpy.data.materials.new("Ground")
image = bpy.data.images.new("Ground Color", 64, 64)
image.generated_type = "UV_GRID"
image.pack()
texture = material.node_tree.nodes.new("ShaderNodeTexImage")
texture.image = image
material.node_tree.links.new(texture.outputs["Color"], material.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
bpy.ops.mesh.primitive_plane_add(size=4)
bpy.context.object.data.materials.append(material)
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
