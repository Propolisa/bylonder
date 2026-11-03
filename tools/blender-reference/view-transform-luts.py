"""Blender's view transforms as 3D LUTs, from Blender's own OCIO config (release/datafiles/colormanagement): each view's
processor from scene linear (Linear Rec.709) to the sRGB display, sampled on a grid whose axes are log2 of scene linear
(LOG_MIN to LOG_MAX stops, src/render/view-transform.js reads them the same way). Written as little endian uint16 RGB,
red fastest, to src/render/view-transforms/<id>.bin.

usage: <Blender>/5.2/python/bin/python3.13 tools/blender-reference/view-transform-luts.py <Blender>/5.2/datafiles/colormanagement/config.ocio
"""
import os
import sys
import numpy as np
import PyOpenColorIO as ocio

SIZE = 33
LOG_MIN, LOG_MAX = -12.5, 12.5
# Khronos PBR Neutral is Babylon's analytic tone map, closer to Blender's than a LUT; Standard is the sRGB curve.
VIEWS = {'AGX': 'AgX', 'FILMIC': 'Filmic'}

config = ocio.Config.CreateFromFile(sys.argv[1])
out = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'render', 'view-transforms')
os.makedirs(out, exist_ok=True)
axis = 2.0 ** np.linspace(LOG_MIN, LOG_MAX, SIZE)
b, g, r = np.meshgrid(axis, axis, axis, indexing='ij')
grid = np.stack([r, g, b], axis=-1).reshape(-1, 3).astype(np.float32)
for name, view in VIEWS.items():
    transform = ocio.DisplayViewTransform(src='Linear Rec.709', display='sRGB', view=view)
    cpu = config.getProcessor(transform).getDefaultCPUProcessor()
    pixels = grid.copy()
    cpu.applyRGB(pixels)
    data = np.round(np.clip(pixels, 0, 1) * 65535).astype('<u2')
    data.tofile(os.path.join(out, f'{name.lower()}.bin'))
    print(name, view, data.shape)
