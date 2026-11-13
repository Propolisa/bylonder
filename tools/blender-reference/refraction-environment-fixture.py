# Writes tests/fixtures/refraction-environment.blend: a sphere in Snow's cornea material, Glossy and Refraction mixed
# beside a subsurface Principled, which exports as Babylon's PBR block with a sub-surface and a refraction block, under
# a grey World, whose environment the page makes after its materials.
# usage: blender -b --factory-startup --python tools/blender-reference/refraction-environment-fixture.py -- OUT_FILE
import bpy, sys

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
world = bpy.context.scene.world = bpy.data.worlds.new("World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.3, 0.3, 0.3, 1)
cornea = bpy.data.materials.new("Cornea")
tree = cornea.node_tree
tree.nodes.clear()
output, mix, lobes = (tree.nodes.new(t) for t in ("ShaderNodeOutputMaterial", "ShaderNodeMixShader", "ShaderNodeMixShader"))
glossy, refraction, skin = (tree.nodes.new(t) for t in ("ShaderNodeBsdfGlossy", "ShaderNodeBsdfRefraction", "ShaderNodeBsdfPrincipled"))
skin.inputs["Subsurface Weight"].default_value = 1.0
tree.links.new(glossy.outputs[0], lobes.inputs[1])
tree.links.new(refraction.outputs[0], lobes.inputs[2])
tree.links.new(lobes.outputs[0], mix.inputs[1])
tree.links.new(skin.outputs[0], mix.inputs[2])
tree.links.new(mix.outputs[0], output.inputs["Surface"])
bpy.ops.mesh.primitive_uv_sphere_add()
bpy.context.object.data.materials.append(cornea)
bpy.ops.object.camera_add(location=(0, -6, 0), rotation=(1.5708, 0, 0))
bpy.context.scene.camera = bpy.context.object
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
