# Writes what Blender's nodes output for fixed inputs, run on Blender's GPU compositor (its GLSL, as EEVEE runs it):
# each case is one node feeding the compositor's output, rendered at Blender's smallest size (4 by 4) and read
# back. Its first input is linked from an image of the input's value, since the compositor evaluates a node whose
# inputs are all constant on the CPU instead. A NaN (undefined in GLSL) is written as null.
# usage: LIBGL_ALWAYS_SOFTWARE=1 blender -b --factory-startup --python tools/blender-reference/node-fixtures.py -- OUT.json
import bpy, json, math, os, sys, tempfile

out_path = sys.argv[sys.argv.index("--") + 1]
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 1
SIZE = 4
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.resolution_percentage = 100
scene.render.compositor_device = "GPU"
scene.render.image_settings.file_format = "OPEN_EXR"
scene.render.image_settings.color_depth = "32"
scene.view_settings.view_transform = "Standard"
tree = bpy.data.node_groups.new("Fixtures", "CompositorNodeTree")
tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
scene.compositing_node_group = tree
exr = os.path.join(tempfile.mkdtemp(), "result.exr")

MATH_INPUTS = [(0.7, 1.3, 0.25), (-2.5, 0.4, 3.0)]
COLORS = {"A_Color": (0.2, 0.5, 0.9, 1.0), "B_Color": (0.8, 0.3, 0.1, 1.0), "Factor_Float": 0.6}
IMAGE = (0.3, 0.6, 0.9, 1.0)
BALANCE = {
    "Lift/Gamma/Gain": {"Base Lift": 0.1, "Color Lift": (1.0, 0.9, 0.8, 1.0), "Base Gamma": 1.2, "Color Gamma": (0.9, 1.0, 1.1, 1.0),
                        "Base Gain": 0.9, "Color Gain": (1.1, 1.0, 0.95, 1.0), "Fac": 0.8},
    "Offset/Power/Slope (ASC-CDL)": {"Base Offset": 0.05, "Color Offset": (0.1, 0.0, 0.05, 1.0), "Base Power": 1.1,
                                     "Color Power": (1.0, 0.9, 1.2, 1.0), "Base Slope": 0.95, "Color Slope": (1.2, 1.0, 0.8, 1.0)},
    "White Point": {"Input Temperature": 5000.0, "Input Tint": 10.0, "Output Temperature": 6500.0, "Output Tint": 0.0},
}


source = bpy.data.images.new("Input", SIZE, SIZE, float_buffer=True)


def evaluate(idname, properties, inputs, output):
    tree.nodes.clear()
    node = tree.nodes.new(idname)
    for key, value in properties.items():
        setattr(node, key, value)
    for identifier, value in inputs.items():
        socket = next(s for s in node.inputs if s.identifier == identifier)
        socket.default_value = value
    first, value = next(iter(inputs.items()))
    source.pixels[:] = (list(value) if isinstance(value, tuple) else [value, value, value, 1.0]) * SIZE * SIZE
    image = tree.nodes.new("CompositorNodeImage")
    image.image = source
    tree.links.new(image.outputs["Image"], next(s for s in node.inputs if s.identifier == first))
    group_output = tree.nodes.new("NodeGroupOutput")
    tree.links.new(next(s for s in node.outputs if s.identifier == output), group_output.inputs[0])
    bpy.ops.render.render()
    bpy.data.images["Render Result"].save_render(exr)
    result = bpy.data.images.load(exr, check_existing=False)
    pixel = [None if math.isnan(v) else round(v, 6) for v in result.pixels[:4]]
    bpy.data.images.remove(result)
    return pixel


def case(tree_type, idname, properties, inputs, output):
    result = evaluate(idname, properties, inputs, output)
    return {"tree": tree_type, "node": idname, "properties": properties, "inputs": inputs, "output": output, "result": result}


cases = []
for operation in bpy.types.ShaderNodeMath.bl_rna.properties["operation"].enum_items.keys():
    for a, b, c in MATH_INPUTS:
        cases.append(case("shader", "ShaderNodeMath", {"operation": operation}, {"Value": a, "Value_001": b, "Value_002": c}, "Value"))
for blend in bpy.types.ShaderNodeMix.bl_rna.properties["blend_type"].enum_items.keys():
    cases.append(case("shader", "ShaderNodeMix", {"data_type": "RGBA", "blend_type": blend}, COLORS, "Result_Color"))
cases.append(case("shader", "ShaderNodeMath", {"operation": "ADD", "use_clamp": True}, {"Value": 0.7, "Value_001": 1.3}, "Value"))
for mode, inputs in BALANCE.items():
    cases.append(case("compositor", "CompositorNodeColorBalance", {}, {"Image": IMAGE, "Type": mode, **inputs}, "Image"))
json.dump({"blender": bpy.app.version_string, "cases": cases}, open(out_path, "w"), indent=1)
print("wrote", out_path, len(cases), "cases")
