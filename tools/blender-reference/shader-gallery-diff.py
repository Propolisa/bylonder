"""The Shader Node Gallery's error per sphere and per tile of its shadow floor: Bylonder's Render Image of
examples/shader-gallery against EEVEE's (tests/fixtures/shader-gallery-eevee.png), as the mean and 99th percentile of
CIE76 dE in display space (sRGB as shown) and of the absolute difference of linear values (x255), inside each sphere and
over each floor tile; with the Perspective camera's renders too, over the band of its frame the floor fills.

usage: python3 tools/blender-reference/shader-gallery-diff.py EEVEE.png BYLONDER.png [EEVEE_PERSPECTIVE.png BYLONDER_PERSPECTIVE.png]
"""
import sys
import numpy as np
from PIL import Image

NAMES = ['Checker', 'Voronoi', 'Wave', 'Brick', 'Magic', 'Gradient', 'Normals', 'Fresnel', 'Facing', 'Noise Math',
         'Principled', 'Glossy', 'Mixed', 'Glow', 'Sheen', 'Bumped', 'Two Lobes', 'Glass', 'Half Transparent', 'Metal',
         'Cube Shadow', 'Ball Shadow', 'Pole Shadow', 'Ring Shadow']


def load(path):
    return np.asarray(Image.open(path).convert('RGB').resize((256, 384)), dtype=np.float64) / 255


def linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lab(c):
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = linear(c) @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def differences(eevee, bylonder):
    a, b = load(eevee), load(bylonder)
    return np.linalg.norm(lab(a) - lab(b), axis=-1), np.abs(linear(a) - linear(b)).max(-1) * 255


def row(number, name, d, l):
    print(f'| {number} | {name} | {d.mean():.1f} | {np.percentile(d, 99):.1f} | {l.mean():.1f} | {np.percentile(l, 99):.1f} |')


de, dl = differences(sys.argv[1], sys.argv[2])
yy, xx = np.mgrid[-24:25, -24:25]
disk, square = xx * xx + yy * yy <= 24 * 24, np.ones_like(xx, dtype=bool)
print('| # | sphere | dE mean | dE max | linear mean | linear max |')
print('|---|---|---|---|---|---|')
for i, name in enumerate(NAMES):
    cy, cx = 32 + (i // 4) * 64, 32 + (i % 4) * 64
    area = disk if i < 20 else square
    row(i + 1, name, de[cy - 24:cy + 25, cx - 24:cx + 25][area], dl[cy - 24:cy + 25, cx - 24:cx + 25][area])
if len(sys.argv) > 4:
    de, dl = differences(sys.argv[3], sys.argv[4])
    # Rows 160 to 215 of the Perspective camera's frame: the floor, the casters and their shadows.
    row('P', 'Perspective Floor', de[160:216], dl[160:216])
