"""The Shader Node Gallery's error per sphere: Bylonder's Render Image of examples/shader-gallery against EEVEE's
(tests/fixtures/shader-gallery-eevee.png), as the mean and 99th percentile of CIE76 dE in display space (sRGB as
shown) and of the absolute difference of linear values (x255), inside each sphere.

usage: python3 tools/blender-reference/shader-gallery-diff.py EEVEE.png BYLONDER.png
"""
import sys
import numpy as np
from PIL import Image

NAMES = ['Checker', 'Voronoi', 'Wave', 'Brick', 'Magic', 'Gradient', 'Normals', 'Fresnel', 'Facing', 'Noise Math',
         'Principled', 'Glossy', 'Mixed', 'Glow', 'Sheen', 'Bumped', 'Two Lobes', 'Glass', 'Half Transparent', 'Metal']


def load(path):
    return np.asarray(Image.open(path).convert('RGB').resize((256, 320)), dtype=np.float64) / 255


def linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lab(c):
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = linear(c) @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


a, b = load(sys.argv[1]), load(sys.argv[2])
de = np.linalg.norm(lab(a) - lab(b), axis=-1)
dl = np.abs(linear(a) - linear(b)).max(-1) * 255
yy, xx = np.mgrid[-24:25, -24:25]
disk = xx * xx + yy * yy <= 24 * 24
print('| # | sphere | dE mean | dE max | linear mean | linear max |')
print('|---|---|---|---|---|---|')
for i, name in enumerate(NAMES):
    cy, cx = 32 + (i // 4) * 64, 32 + (i % 4) * 64
    d, l = de[cy - 24:cy + 25, cx - 24:cx + 25][disk], dl[cy - 24:cy + 25, cx - 24:cx + 25][disk]
    print(f'| {i + 1} | {name} | {d.mean():.1f} | {np.percentile(d, 99):.1f} | {l.mean():.1f} | {np.percentile(l, 99):.1f} |')
