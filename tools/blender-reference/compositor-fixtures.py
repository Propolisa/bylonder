# Writes what Blender's compositor outputs on its CPU path for the multi-pass nodes Blender's demo files use: each
# case is one node between a synthetic image (an Image node, as tests/compositor-cpu-wasm.test.js gives the same image
# as the render) and the Group Output, composited at the image's size and read back as float RGBA.
# usage: blender -b --factory-startup --python tools/blender-reference/compositor-fixtures.py -- OUT.json
import bpy, json, os, sys, tempfile

out_path = sys.argv[sys.argv.index("--") + 1]
WIDTH, HEIGHT = 48, 32
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 1
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = WIDTH, HEIGHT, 100
scene.render.compositor_device = "CPU"
scene.render.compositor_precision = "FULL"
scene.render.image_settings.file_format = "OPEN_EXR"
scene.render.image_settings.color_depth = "32"
scene.view_settings.view_transform = "Standard"
tree = bpy.data.node_groups.new("Fixtures", "CompositorNodeTree")
tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
scene.compositing_node_group = tree
exr = os.path.join(tempfile.mkdtemp(), "result.exr")


def pixel(x, y):
    """The synthetic image: gradients, with bright spots for glare to spread (tests/compositor-cpu-wasm.test.js)."""
    bright = (x, y) in ((12, 10), (30, 20), (40, 6))
    return [8.0, 6.0, 4.0, 1.0] if bright else [x / WIDTH, y / HEIGHT, 0.5 + 0.25 * ((x + y) % 2), 1.0]


source = bpy.data.images.new("Input", WIDTH, HEIGHT, float_buffer=True)
source.pixels[:] = [v for y in range(HEIGHT) for x in range(WIDTH) for v in pixel(x, y)]


def case(idname, inputs):
    tree.nodes.clear()
    node = tree.nodes.new(idname)
    for identifier, value in inputs.items():
        next(s for s in node.inputs if s.identifier == identifier).default_value = value
    image = tree.nodes.new("CompositorNodeImage")
    image.image = source
    tree.links.new(image.outputs["Image"], next(s for s in node.inputs if s.type == "RGBA"))
    output = tree.nodes.new("NodeGroupOutput")
    tree.links.new(next(s for s in node.outputs if s.type == "RGBA"), output.inputs[0])
    bpy.ops.render.render()
    bpy.data.images["Render Result"].save_render(exr)
    result = bpy.data.images.load(exr, check_existing=False)
    pixels = [round(v, 5) for v in result.pixels[:]]
    bpy.data.images.remove(result)
    return {"node": idname, "inputs": inputs, "result": pixels}


# Each with the settings a demo file gives it.
cases = [
    case("CompositorNodeGlare", {"Type": "Bloom", "Highlights Threshold": 2.0, "Clamp Highlights": True, "Strength": 1.6, "Size": 0.5}),  # impact_fracture
    case("CompositorNodeGlare", {"Type": "Streaks", "Highlights Threshold": 0.6, "Clamp Highlights": True, "Size": 0.09, "Streaks Angle": 0.785398, "Fade": 0.93,
                                 "Color Modulation": 0.0}),  # bike_ride
    case("CompositorNodeGlare", {"Type": "Sun Beams", "Quality": "High", "Highlights Threshold": 1.0, "Strength": 0.5, "Size": 0.22}),  # cloth_tear
    case("CompositorNodeGlare", {"Type": "Fog Glow", "Highlights Threshold": 1.0, "Size": 0.5}),
    case("CompositorNodeFilter", {"Type": "Diamond Sharpen", "Fac": 0.5}),  # impact_fracture
    case("CompositorNodeBlur", {"Type": "Gaussian", "Size": (6.0, 6.0)}),  # pizza_delivery, smaller
    case("CompositorNodeLensdist", {"Type": "Radial", "Dispersion": 0.1, "Jitter": False}),  # bike_ride, without jitter's noise
    case("CompositorNodeLensdist", {"Type": "Horizontal", "Dispersion": 0.3, "Jitter": False}),  # gaku
    case("CompositorNodeKuwahara", {"Type": "Anisotropic", "Size": 4.0}),  # pizza_delivery
    case("CompositorNodeKuwahara", {"Type": "Classic", "Size": 3.0}),
]
json.dump({"blender": bpy.app.version_string, "width": WIDTH, "height": HEIGHT, "cases": cases}, open(out_path, "w"))
print("wrote", out_path, len(cases), "cases")
