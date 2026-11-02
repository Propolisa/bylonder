# Image files as Blender writes and reads them, for tests/images-wasm.test.js: a small image with known pixels saved in
# each format the module reads (JPEG, PNG 8 and 16 bit, TIFF, Radiance HDR, Targa, BMP, OpenEXR with each compression),
# and each file's pixels and settings as Blender's own readers give them back.
#   blender -b --factory-startup --python image-fixtures.py -- OUT_DIR
import json
import os
import sys

import bpy

out = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out, exist_ok=True)
WIDTH, HEIGHT = 8, 4
# A ramp per channel, with alpha, and values over 1 for the float formats.
PIXELS = [v for y in range(HEIGHT) for x in range(WIDTH)
          for v in (x / (WIDTH - 1) * 2, y / (HEIGHT - 1), (x + y) % 3 / 2, 1 - x / (WIDTH * 2))]
FILES = {
    "ramp.jpg": {"file_format": "JPEG", "quality": 90},
    "ramp.png": {"file_format": "PNG", "color_depth": "8"},
    "ramp-16.png": {"file_format": "PNG", "color_depth": "16"},
    "ramp.tif": {"file_format": "TIFF", "color_depth": "16"},
    "ramp.hdr": {"file_format": "HDR"},
    "ramp.tga": {"file_format": "TARGA"},
    "ramp.bmp": {"file_format": "BMP"},
    "ramp-zip.exr": {"file_format": "OPEN_EXR", "exr_codec": "ZIP", "color_depth": "16"},
    "ramp-piz.exr": {"file_format": "OPEN_EXR", "exr_codec": "PIZ", "color_depth": "16"},
    "ramp-dwaa.exr": {"file_format": "OPEN_EXR", "exr_codec": "DWAA", "color_depth": "16"},
    "ramp-none.exr": {"file_format": "OPEN_EXR", "exr_codec": "NONE", "color_depth": "32"},
}

source = bpy.data.images.new("ramp", WIDTH, HEIGHT, alpha=True, float_buffer=True)
source.pixels.foreach_set(PIXELS)
settings = bpy.context.scene.render.image_settings
expected = {}
for name, options in FILES.items():
    settings.file_format = options["file_format"]
    for key, value in options.items():
        setattr(settings, key, value)
    settings.color_mode = "RGB" if options["file_format"] in ("JPEG", "HDR", "BMP") else "RGBA"
    path = os.path.join(out, name)
    source.save_render(path)
    image = bpy.data.images.load(path)
    pixels = [0.0] * (image.size[0] * image.size[1] * 4)
    image.pixels.foreach_get(pixels)
    expected[name] = {"size": list(image.size), "is_float": image.is_float, "colorspace": image.colorspace_settings.name,
                      "file_format": image.file_format, "pixels": [round(v, 6) for v in pixels]}

with open(os.path.join(out, "images.json"), "w") as f:
    json.dump(expected, f, indent=1)
print("wrote", len(expected), "image fixtures to", out)
