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


def color_ramp(node, ramp):
    """A Color Ramp's settings by RNA name, its elements as {position, color} (the first two exist already)."""
    for key in ("color_mode", "interpolation", "hue_interpolation"):
        setattr(node.color_ramp, key, ramp[key])
    elements = node.color_ramp.elements
    while len(elements) < len(ramp["elements"]):
        elements.new(0.5)
    for element, settings in zip(elements, sorted(ramp["elements"], key=lambda e: e["position"])):
        element.position, element.color = settings["position"], settings["color"]


def evaluate(idname, properties, inputs, output):
    tree.nodes.clear()
    node = tree.nodes.new(idname)
    for key, value in properties.items():
        if key == "color_ramp":
            color_ramp(node, value)
        else:
            setattr(node, key, value)
    for identifier, value in inputs.items():
        socket = next(s for s in node.inputs if s.identifier == identifier)
        socket.default_value = value
    first, value = next(iter(inputs.items()))
    source.pixels[:] = ((list(value) + [1.0])[:4] if isinstance(value, tuple) else [value, value, value, 1.0]) * SIZE * SIZE
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
VECTOR = (0.31, 0.62, 0.93)
NOISE = {"W": 1.7, "Scale": 3.0, "Detail": 4.5, "Roughness": 0.6, "Lacunarity": 2.2, "Offset": 0.3, "Gain": 1.4, "Distortion": 0.4}
for noise_type in bpy.types.ShaderNodeTexNoise.bl_rna.properties["noise_type"].enum_items.keys():
    for dimensions in ("1D", "2D", "3D", "4D"):
        first = {"W": NOISE["W"]} if dimensions == "1D" else {"Vector": VECTOR}
        for output in ("Fac", "Color"):
            cases.append(case("shader", "ShaderNodeTexNoise", {"noise_type": noise_type, "noise_dimensions": dimensions},
                              {**first, **NOISE}, output))
for settings, inputs in [({"noise_dimensions": "3D", "normalize": False}, {"Detail": 0.0}), ({"noise_dimensions": "3D"}, {"Detail": 15.0, "Distortion": 0.0}),
                         ({"noise_dimensions": "4D"}, {"W": 2.5, "Scale": 6.0, "Detail": 8.0, "Roughness": 0.55})]:
    cases.append(case("shader", "ShaderNodeTexNoise", settings, {"Vector": VECTOR, **inputs}, "Fac"))
# The lava material's noises (docs/lava-material.md): 4D, W as the seed, the color noise and the bump's finer one.
LAVA_VECTOR = (0.42, -0.17, 0.73)
for detail in (2.0, 8.0):
    for output in ("Fac", "Color"):
        cases.append(case("shader", "ShaderNodeTexNoise", {"noise_dimensions": "4D"},
                          {"Vector": LAVA_VECTOR, "W": 1.3, "Scale": 2.5, "Detail": detail, "Roughness": 0.6, "Lacunarity": 2.0}, output))
RAMPS = [
    {"interpolation": "LINEAR", "elements": [{"position": 0.2, "color": (0.1, 0.0, 0.0, 1.0)}, {"position": 0.7, "color": (1.0, 0.4, 0.05, 0.5)}]},
    {"interpolation": "EASE", "elements": [{"position": 0.0, "color": (0.0, 0.0, 0.0, 1.0)}, {"position": 1.0, "color": (1.0, 0.8, 0.2, 1.0)}]},
    {"interpolation": "CONSTANT", "elements": [{"position": 0.3, "color": (0.2, 0.1, 0.0, 1.0)}, {"position": 0.6, "color": (0.9, 0.3, 0.1, 1.0)}]},
    {"interpolation": "LINEAR", "elements": [{"position": 0.0, "color": (0.0, 0.0, 0.0, 1.0)}, {"position": 0.45, "color": (0.8, 0.05, 0.0, 1.0)},
                                             {"position": 0.75, "color": (1.0, 0.5, 0.0, 1.0)}, {"position": 1.0, "color": (1.0, 0.95, 0.4, 1.0)}]},
    {"interpolation": "B_SPLINE", "elements": [{"position": 0.1, "color": (0.0, 0.1, 0.2, 1.0)}, {"position": 0.5, "color": (0.9, 0.2, 0.1, 1.0)},
                                               {"position": 0.9, "color": (0.2, 0.9, 0.3, 1.0)}]},
    {"interpolation": "CARDINAL", "elements": [{"position": 0.1, "color": (0.0, 0.1, 0.2, 1.0)}, {"position": 0.5, "color": (0.9, 0.2, 0.1, 1.0)},
                                               {"position": 0.9, "color": (0.2, 0.9, 0.3, 1.0)}]},
    {"interpolation": "CONSTANT", "elements": [{"position": 0.1, "color": (0.0, 0.1, 0.2, 1.0)}, {"position": 0.5, "color": (0.9, 0.2, 0.1, 1.0)},
                                               {"position": 0.9, "color": (0.2, 0.9, 0.3, 1.0)}]},
    {"color_mode": "HSV", "hue_interpolation": "FAR", "elements": [{"position": 0.0, "color": (1.0, 0.0, 0.0, 1.0)}, {"position": 1.0, "color": (0.0, 0.0, 1.0, 1.0)}]},
    {"interpolation": "LINEAR", "elements": [{"position": 0.35, "color": (0.0, 0.0, 0.0, 1.0)}, {"position": 0.5, "color": (0.6, 0.02, 0.0, 1.0)},
                                             {"position": 0.62, "color": (1.0, 0.25, 0.0, 1.0)}, {"position": 0.75, "color": (1.0, 0.8, 0.2, 1.0)}]},
    {"color_mode": "HSL", "hue_interpolation": "CW", "elements": [{"position": 0.2, "color": (0.9, 0.6, 0.1, 1.0)}, {"position": 0.8, "color": (0.1, 0.3, 0.9, 1.0)}]},
]
for ramp in RAMPS:
    ramp = {"color_mode": "RGB", "interpolation": "LINEAR", "hue_interpolation": "NEAR", **ramp}
    for fac in (0.37, 0.81):
        for output in ("Color", "Alpha"):
            cases.append(case("shader", "ShaderNodeValToRGB", {"color_ramp": ramp}, {"Fac": fac}, output))
for mode, inputs in BALANCE.items():
    cases.append(case("compositor", "CompositorNodeColorBalance", {}, {"Image": IMAGE, "Type": mode, **inputs}, "Image"))
json.dump({"blender": bpy.app.version_string, "cases": cases}, open(out_path, "w"), indent=1)
print("wrote", out_path, len(cases), "cases")
