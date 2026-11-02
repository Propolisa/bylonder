# Writes what Blender's nodes output for fixed inputs, run on Blender's GPU compositor (its GLSL, as EEVEE runs it):
# each case is one node feeding the compositor's output, rendered at Blender's smallest size (4 by 4) and read
# back. Its first input is linked from an image of the input's value, since the compositor evaluates a node whose
# inputs are all constant on the CPU instead. A NaN (undefined in GLSL) is written as null. Shader nodes the compositor
# lacks run in EEVEE: the node in a material on a plane filling an orthographic camera, its output written to an AOV
# (half floats), which the compositor passes on.
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


def curve_mapping(node, mapping):
    """A curve mapping's settings by RNA name, its curves' points as {location, handle_type} (each curve has two)."""
    node.mapping.use_clip, node.mapping.extend = mapping["use_clip"], mapping["extend"]
    node.mapping.clip_min_x, node.mapping.clip_min_y, node.mapping.clip_max_x, node.mapping.clip_max_y = mapping["clip"]
    for curve, points in zip(node.mapping.curves, mapping["curves"]):
        while len(curve.points) < len(points):
            curve.points.new(0.5, 0.5)
        for point, settings in zip(curve.points, points):
            point.location, point.handle_type = settings["location"], settings["handle_type"]
    node.mapping.update()


def evaluate(idname, properties, inputs, output):
    tree.nodes.clear()
    node = tree.nodes.new(idname)
    for key, value in properties.items():
        if key == "color_ramp":
            color_ramp(node, value)
        elif key == "mapping":
            curve_mapping(node, value)
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


eevee = bpy.data.scenes.new("EEVEE")
eevee.render.engine = "BLENDER_EEVEE"
eevee.eevee.taa_render_samples = 1
eevee.render.resolution_x = eevee.render.resolution_y = SIZE
eevee.render.resolution_percentage = 100
eevee.render.image_settings.file_format = "OPEN_EXR"
eevee.render.image_settings.color_depth = "32"
eevee.view_settings.view_transform = "Standard"
eevee.view_layers[0].aovs.add().name = "Value"
plane = bpy.data.objects.new("Plane", bpy.data.meshes.new("Plane"))
plane.data.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [], [(0, 1, 2, 3)])
camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
camera.data.type, camera.data.ortho_scale, camera.location = "ORTHO", 1.0, (0, 0, 5)
for ob in (plane, camera):
    eevee.collection.objects.link(ob)
eevee.camera = camera
material = bpy.data.materials.new("Case")
plane.data.materials.append(material)
aov_tree = bpy.data.node_groups.new("AOV", "CompositorNodeTree")
aov_tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
eevee.compositing_node_group = aov_tree
layers = aov_tree.nodes.new("CompositorNodeRLayers")
layers.scene = eevee
aov_tree.links.new(layers.outputs["Value"], aov_tree.nodes.new("NodeGroupOutput").inputs[0])


def eevee_case(idname, properties, inputs, output, outputs={}):
    """A shader node evaluated in EEVEE; `outputs` sets output sockets' own values (a Value node's). A texture's Vector
    is linked from a Combine XYZ of its value, as an unlinked one reads the Generated coordinates."""
    nodes = material.node_tree.nodes
    nodes.clear()
    node = nodes.new(idname)
    for key, value in properties.items():
        setattr(node, key, value)
    for identifier, value in inputs.items():
        socket = next(s for s in node.inputs if s.identifier == identifier)
        if socket.hide_value:
            combine = nodes.new("ShaderNodeCombineXYZ")
            for i, component in enumerate(value):
                combine.inputs[i].default_value = component
            material.node_tree.links.new(combine.outputs[0], socket)
        else:
            socket.default_value = value
    for identifier, value in outputs.items():
        next(s for s in node.outputs if s.identifier == identifier).default_value = value
    aov = nodes.new("ShaderNodeOutputAOV")
    aov.aov_name = "Value"
    material.node_tree.links.new(next(s for s in node.outputs if s.identifier == output), aov.inputs["Color"])
    with bpy.context.temp_override(scene=eevee):
        bpy.ops.render.render()
    bpy.data.images["Render Result"].save_render(exr, scene=eevee)
    result = bpy.data.images.load(exr, check_existing=False)
    pixel = [None if math.isnan(v) else round(v, 6) for v in result.pixels[:4]]
    bpy.data.images.remove(result)
    return {"tree": "shader", "engine": "EEVEE", "node": idname, "properties": properties,
            "inputs": {**inputs, **{"=" + k: v for k, v in outputs.items()}}, "output": output, "result": pixel}


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
A, B, C = (0.3, -0.6, 1.2), (0.7, 0.25, -1.5), (0.5, 0.5, 0.5)
VALUE_OPERATIONS = ("DOT_PRODUCT", "DISTANCE", "LENGTH")
for operation in bpy.types.ShaderNodeVectorMath.bl_rna.properties["operation"].enum_items.keys():
    cases.append(case("shader", "ShaderNodeVectorMath", {"operation": operation}, {"Vector": A, "Vector_001": B, "Vector_002": C, "Scale": 1.7},
                      "Value" if operation in VALUE_OPERATIONS else "Vector"))
for interpolation in ("LINEAR", "STEPPED", "SMOOTHSTEP", "SMOOTHERSTEP"):
    for clamp in (True, False):
        cases.append(case("shader", "ShaderNodeMapRange", {"interpolation_type": interpolation, "clamp": clamp},
                          {"Value": 1.35, "From Min": 0.2, "From Max": 1.1, "To Min": -1.0, "To Max": 3.0, "Steps": 3.0}, "Result"))
        cases.append(case("shader", "ShaderNodeMapRange", {"interpolation_type": interpolation, "clamp": clamp, "data_type": "FLOAT_VECTOR"},
                          {"Vector": (0.4, 1.3, -0.2), "From_Min_FLOAT3": (0.2, 0.0, -1.0), "From_Max_FLOAT3": (1.1, 1.0, 1.0),
                           "To_Min_FLOAT3": (-1.0, 0.0, 0.0), "To_Max_FLOAT3": (3.0, 2.0, 1.0), "Steps_FLOAT3": (3.0, 4.0, 2.0)}, "Vector"))
for clamp_type in ("MINMAX", "RANGE"):
    cases.append(case("shader", "ShaderNodeClamp", {"clamp_type": clamp_type}, {"Value": 0.7, "Min": 0.9, "Max": 0.2}, "Result"))
MIX_RGB = {"Fac": 0.6, "Color1": COLORS["A_Color"], "Color2": COLORS["B_Color"]}
for blend in bpy.types.ShaderNodeMixRGB.bl_rna.properties["blend_type"].enum_items.keys():
    cases.append(case("shader", "ShaderNodeMixRGB", {"blend_type": blend}, MIX_RGB, "Color"))
cases.append(case("shader", "ShaderNodeMixRGB", {"blend_type": "ADD", "use_clamp": True}, {**MIX_RGB, "Fac": 1.4}, "Color"))
cases.append(case("shader", "ShaderNodeGamma", {}, {"Color": COLORS["A_Color"], "Gamma": 2.2}, "Color"))
for axis in ("X", "Y", "Z"):
    cases.append(case("shader", "ShaderNodeSeparateXYZ", {}, {"Vector": A}, axis))
cases.append(case("shader", "ShaderNodeCombineXYZ", {}, {"X": 0.3, "Y": -0.6, "Z": 1.2}, "Vector"))
for rotation_type in bpy.types.ShaderNodeVectorRotate.bl_rna.properties["rotation_type"].enum_items.keys():
    for invert in (False, True):
        cases.append(case("shader", "ShaderNodeVectorRotate", {"rotation_type": rotation_type, "invert": invert},
                          {"Vector": A, "Center": (0.1, 0.2, 0.3), "Axis": (0.2, 0.9, 0.4), "Angle": 0.8, "Rotation": (0.3, -0.5, 1.1)}, "Vector"))
TEXTURE_VECTOR = (0.37, 0.71, 0.29)
for gradient_type in bpy.types.ShaderNodeTexGradient.bl_rna.properties["gradient_type"].enum_items.keys():
    for output in ("Color", "Fac"):
        cases.append(case("shader", "ShaderNodeTexGradient", {"gradient_type": gradient_type}, {"Vector": (0.37, 0.71, -0.29)}, output))
WAVE = {"Vector": TEXTURE_VECTOR, "Scale": 3.0, "Distortion": 1.5, "Detail": 3.0, "Detail Scale": 1.2, "Detail Roughness": 0.6, "Phase Offset": 0.4}
WAVES = [("BANDS", d) for d in ("X", "Y", "Z", "DIAGONAL")] + [("RINGS", d) for d in ("X", "Y", "Z", "SPHERICAL")]
for wave_type, direction in WAVES:
    for profile in ("SIN", "SAW", "TRI"):
        direction_key = "bands_direction" if wave_type == "BANDS" else "rings_direction"
        cases.append(case("shader", "ShaderNodeTexWave", {"wave_type": wave_type, "wave_profile": profile, direction_key: direction}, WAVE, "Fac"))
cases.append(case("shader", "ShaderNodeTexWave", {}, WAVE, "Color"))
VORONOI = {"Vector": TEXTURE_VECTOR, "W": 0.8, "Scale": 4.0, "Detail": 2.5, "Roughness": 0.6, "Lacunarity": 2.0, "Smoothness": 0.7,
           "Exponent": 1.5, "Randomness": 0.9}
VORONOI_OUTPUTS = {"F1": ("Distance", "Color", "Position", "W"), "F2": ("Distance", "Color", "Position", "W"),
                   "SMOOTH_F1": ("Distance", "Color", "Position", "W"), "DISTANCE_TO_EDGE": ("Distance",), "N_SPHERE_RADIUS": ("Radius",)}
for feature, outputs in VORONOI_OUTPUTS.items():
    for dimensions in ("1D", "2D", "3D", "4D"):
        for output in outputs:
            if (output == "Position" and dimensions == "1D") or (output == "W" and dimensions in ("2D", "3D")):
                continue
            first = {"W": 0.8} if dimensions == "1D" else {"Vector": TEXTURE_VECTOR}
            cases.append(case("shader", "ShaderNodeTexVoronoi", {"feature": feature, "voronoi_dimensions": dimensions}, {**first, **VORONOI}, output))
# Distances other than Euclidean and a normalized F2: in EEVEE, as Blender's compositor gives other values for them.
for distance in ("MANHATTAN", "CHEBYCHEV", "MINKOWSKI"):
    cases.append(eevee_case("ShaderNodeTexVoronoi", {"distance": distance}, VORONOI, "Distance"))
cases.append(eevee_case("ShaderNodeTexVoronoi", {"normalize": True, "feature": "F2"}, {**VORONOI, "Detail": 0.0}, "Distance"))
CHECKER = {"Vector": TEXTURE_VECTOR, "Color1": COLORS["A_Color"], "Color2": COLORS["B_Color"], "Scale": 7.0}
BRICK = {**CHECKER, "Scale": 6.0, "Mortar Size": 0.05, "Mortar Smooth": 0.2, "Bias": 0.1, "Brick Width": 0.6, "Row Height": 0.3}
for output in ("Color", "Fac"):
    cases.append(case("shader", "ShaderNodeTexChecker", {}, CHECKER, output))
    cases.append(case("shader", "ShaderNodeTexBrick", {"offset": 0.3, "offset_frequency": 3, "squash": 1.4, "squash_frequency": 2}, BRICK, output))
    for depth in (0, 2, 7):
        cases.append(case("shader", "ShaderNodeTexMagic", {"turbulence_depth": depth}, {"Vector": TEXTURE_VECTOR, "Scale": 4.0, "Distortion": 1.3}, output))
for dimensions in ("1D", "2D", "3D", "4D"):
    first = {"W": 0.8} if dimensions == "1D" else {"Vector": TEXTURE_VECTOR}
    for output in ("Value", "Color"):
        cases.append(case("shader", "ShaderNodeTexWhiteNoise", {"noise_dimensions": dimensions}, {**first, "W": 0.8}, output))
def mapping(curves, low=0.0, extend="EXTRAPOLATED"):
    return {"use_clip": True, "extend": extend, "clip": [low, low, 1.0, 1.0],
            "curves": [[{"location": location, "handle_type": handle} for location, handle in points] for points in curves]}


LINE = [((0.0, 0.0), "AUTO"), ((1.0, 1.0), "AUTO")]
BENT = [((0.0, 0.1), "AUTO"), ((0.4, 0.7), "AUTO_CLAMPED"), ((1.0, 0.9), "VECTOR")]
for curves, extend in (([BENT, LINE, BENT, LINE], "EXTRAPOLATED"), ([LINE, LINE, LINE, BENT], "HORIZONTAL")):
    cases.append(case("shader", "ShaderNodeRGBCurve", {"mapping": mapping(curves, extend=extend)}, {"Color": (0.3, 0.6, 1.2, 1.0), "Fac": 0.8}, "Color"))
VECTOR_BENT = [((-1.0, -0.8), "AUTO"), ((0.2, 0.5), "AUTO"), ((1.0, 0.9), "AUTO")]
cases.append(case("shader", "ShaderNodeVectorCurve", {"mapping": mapping([VECTOR_BENT, LINE, VECTOR_BENT], low=-1.0)},
                  {"Vector": (0.3, -0.6, 0.8), "Fac": 0.9}, "Vector"))
cases.append(case("shader", "ShaderNodeFloatCurve", {"mapping": mapping([BENT])}, {"Value": 0.35, "Factor": 1.0}, "Value"))
for temperature in (1500.0, 6500.0):
    cases.append(case("shader", "ShaderNodeBlackbody", {}, {"Temperature": temperature}, "Color"))
for gabor_type in ("2D", "3D"):
    for output in ("Value", "Phase", "Intensity"):
        cases.append(case("shader", "ShaderNodeTexGabor", {"gabor_type": gabor_type},
                          {"Vector": TEXTURE_VECTOR, "Scale": 4.0, "Frequency": 2.5, "Anisotropy": 0.7, "Orientation 2D": 0.6}, output))
COLOR = (0.2, 0.5, 0.9, 1.0)
cases.append(eevee_case("ShaderNodeWavelength", {}, {"Wavelength": 540.0}, "Color"))
for vector_type in ("POINT", "TEXTURE", "VECTOR", "NORMAL"):
    cases.append(eevee_case("ShaderNodeMapping", {"vector_type": vector_type},
                            {"Vector": A, "Location": (0.5, -0.2, 0.1), "Rotation": (0.3, 0.6, -0.9), "Scale": (1.5, 0.7, 2.0)}, "Vector"))
cases.append(eevee_case("ShaderNodeHueSaturation", {}, {"Hue": 0.3, "Saturation": 1.4, "Value": 0.8, "Fac": 0.9, "Color": COLOR}, "Color"))
cases.append(eevee_case("ShaderNodeBrightContrast", {}, {"Color": COLOR, "Bright": 0.1, "Contrast": 0.4}, "Color"))
cases.append(eevee_case("ShaderNodeInvert", {}, {"Fac": 0.7, "Color": COLOR}, "Color"))
for mode in ("RGB", "HSV", "HSL"):
    cases.append(eevee_case("ShaderNodeSeparateColor", {"mode": mode}, {"Color": COLOR}, "Green"))
    cases.append(eevee_case("ShaderNodeCombineColor", {"mode": mode}, {"Red": 0.6, "Green": 0.4, "Blue": 0.7}, "Color"))
cases.append(eevee_case("ShaderNodeRGBToBW", {}, {"Color": COLOR}, "Val"))
for output in ("Normal", "Dot"):
    cases.append(eevee_case("ShaderNodeNormal", {}, {"Normal": (0.3, 0.5, 0.8)}, output, {"Normal": (0.6, 0.0, 0.8)}))
cases.append(eevee_case("ShaderNodeValue", {}, {}, "Value", {"Value": 0.37}))
cases.append(eevee_case("ShaderNodeRGB", {}, {}, "Color", {"Color": (0.1, 0.6, 0.3, 1.0)}))
for mode, inputs in BALANCE.items():
    cases.append(case("compositor", "CompositorNodeColorBalance", {}, {"Image": IMAGE, "Type": mode, **inputs}, "Image"))
json.dump({"blender": bpy.app.version_string, "cases": cases}, open(out_path, "w"), indent=1)
print("wrote", out_path, len(cases), "cases")
