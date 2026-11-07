# Saves a .blend whose material EEVEE compiles only once its node tree is inlined (tests/fixtures/shader-inline.blend):
# an Emission whose strength is a node group (a Multiply by 2 inside) of a repeat zone that adds 0.25 forty times to
# the object's random value, each time reading its value twice ((x + x) * 0.5 + 0.25).
# usage: blender -b --factory-startup --python tools/blender-reference/shader-inline-fixtures.py -- OUT.blend
import bpy, sys

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)

group = bpy.data.node_groups.new("Double", "ShaderNodeTree")
group.interface.new_socket("Value", in_out="INPUT", socket_type="NodeSocketFloat")
group.interface.new_socket("Value", in_out="OUTPUT", socket_type="NodeSocketFloat")
group_in, group_out = group.nodes.new("NodeGroupInput"), group.nodes.new("NodeGroupOutput")
double = group.nodes.new("ShaderNodeMath")
double.operation, double.inputs[1].default_value = "MULTIPLY", 2.0
group.links.new(group_in.outputs[0], double.inputs[0])
group.links.new(double.outputs[0], group_out.inputs[0])

material = bpy.data.materials.new("Inlined")
tree = material.node_tree
tree.nodes.clear()
start = tree.nodes.new("ShaderNodeObjectInfo")
repeat_in, repeat_out = tree.nodes.new("GeometryNodeRepeatInput"), tree.nodes.new("GeometryNodeRepeatOutput")
repeat_in.pair_with_output(repeat_out)
repeat_out.repeat_items.new("FLOAT", "Value")
repeat_in.inputs["Iterations"].default_value = 40
twice, step = tree.nodes.new("ShaderNodeMath"), tree.nodes.new("ShaderNodeMath")
twice.operation = "ADD"
step.operation, step.inputs[1].default_value, step.inputs[2].default_value = "MULTIPLY_ADD", 0.5, 0.25
tree.links.new(start.outputs["Random"], repeat_in.inputs["Value"])
tree.links.new(repeat_in.outputs["Value"], twice.inputs[0])
tree.links.new(repeat_in.outputs["Value"], twice.inputs[1])
tree.links.new(twice.outputs[0], step.inputs[0])
tree.links.new(step.outputs[0], repeat_out.inputs["Value"])
call = tree.nodes.new("ShaderNodeGroup")
call.node_tree = group
emission, output = tree.nodes.new("ShaderNodeEmission"), tree.nodes.new("ShaderNodeOutputMaterial")
tree.links.new(repeat_out.outputs["Value"], call.inputs[0])
tree.links.new(call.outputs[0], emission.inputs["Strength"])
tree.links.new(emission.outputs[0], output.inputs["Surface"])

bpy.ops.mesh.primitive_plane_add()
bpy.context.object.data.materials.append(material)
bpy.ops.wm.save_as_mainfile(filepath=out)
