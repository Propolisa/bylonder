# Writes tests/fixtures/world-up.blend: a white diffuse sphere under a World of nodes, blue above the horizon and light
# grey below (Generated Z into a Color Ramp), with no lights, and a camera level with the sphere: Blender lights the
# sphere's top blue and its bottom grey.
# usage: blender -b --factory-startup --python tools/blender-reference/world-up-fixture.py -- OUT_FILE
import bpy, sys

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
world = scene.world = bpy.data.worlds.new("World")
world.use_nodes = True
tree = world.node_tree
coords, split, ramp = (tree.nodes.new(t) for t in ("ShaderNodeTexCoord", "ShaderNodeSeparateXYZ", "ShaderNodeValToRGB"))
tree.links.new(coords.outputs["Generated"], split.inputs["Vector"])
tree.links.new(split.outputs["Z"], ramp.inputs["Fac"])
ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = 0.45, (0.8, 0.8, 0.8, 1)
ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = 0.55, (0.05, 0.15, 0.8, 1)
tree.links.new(ramp.outputs["Color"], tree.nodes["Background"].inputs["Color"])
white = bpy.data.materials.new("White")
white.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
white.node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.0
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=48, ring_count=24)
bpy.ops.object.shade_smooth()
bpy.context.object.data.materials.append(white)
camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
camera.data.sensor_fit, camera.data.angle_y = "VERTICAL", 0.8
camera.location, camera.rotation_euler = (0, -6, 0), (1.5708, 0, 0)
scene.collection.objects.link(camera)
scene.camera = camera
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
