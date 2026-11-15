# Window Light (examples/rendering) rendered by desktop Blender's Cycles on the CPU, without denoising, as the module
# renders it (bench/cycles.bench.js, tests/cycles-wasm.test.js), to compare their images. OUT is a PNG, or with .rgba
# its 8-bit RGBA pixels, bottom row first, as wasm/render-api.cc's render_result_pixels gives them:
#   blender -b examples/rendering/rendering.blend --python cycles-window-light.py -- OUT PERCENT SAMPLES [WIDTH HEIGHT]
import os
import sys
import tempfile

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
out, percent, samples = args[0], int(args[1]), int(args[2])
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = samples
scene.cycles.use_denoising = False
if len(args) > 3:
    scene.render.resolution_x, scene.render.resolution_y = int(args[3]), int(args[4])
scene.render.resolution_percentage = percent
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
png = out if out.endswith(".png") else os.path.join(tempfile.mkdtemp(), "render.png")
scene.render.filepath = png
bpy.ops.render.render(write_still=True)
if not out.endswith(".png"):
    image = bpy.data.images.load(png)
    with open(out, "wb") as f:
        f.write(bytes(round(v * 255) for v in image.pixels[:]))
