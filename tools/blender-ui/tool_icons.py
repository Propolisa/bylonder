"""The 3D View's tool icons as SVG: Blender draws each from the triangles of release/datafiles/icons/NAME.dat, with
colors per vertex; here each triangle takes its vertices' average color, triangles of one color forming one path.
Writes public/icons/blender/tools/NAME.svg for the tools of the modes Bylonder has (from Blender's Python tree).

usage: python3 tools/blender-ui/tool_icons.py   (after tree.py)
"""
import json
import os
import subprocess
import urllib.parse
from collections import defaultdict

import transpile

OUT = os.path.join(transpile.REPO, 'public', 'icons', 'blender', 'tools')
MODES = ['OBJECT', 'EDIT_MESH']
# The icons the tools of MODES name, and Blender's fallback for a missing one.
ICONS = '''
const { registered: { VIEW3D_PT_tools_active: P } } = await import('./src/python/bpy_interface.js');
const names = new Set(['none']);
for (const mode of %s) for (const item of P.tools_from_context({ mode })) for (const tool of [item ?? []].flat()) names.add(tool.icon);
console.log(JSON.stringify([...names]));
'''


def fetch_bytes(path):
    """A file of Blender's at the tag, from Git LFS (the icons are stored there), cached."""
    cache = os.path.join(os.path.expanduser('~/.cache/bylonder/blender'), transpile.TAG, path)
    if not os.path.exists(cache):
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        url = f'{transpile.BLENDER}/media/{urllib.parse.quote(path, safe="")}?ref={transpile.TAG}'
        open(cache, 'wb').write(subprocess.run(['curl', '-sfL', url], capture_output=True, check=True).stdout)
    return open(cache, 'rb').read()


def svg(data):
    """BKE_icon_geom_from_memory's format: "VCO", a version, the size and offset, then the triangles' coordinates
    (two bytes per vertex) and their colors (RGBA per vertex)."""
    assert data[:3] == b'VCO', 'not an icon geometry file'
    body = data[8:]
    count = len(body) // 18
    coords, colors = body[:count * 6], body[count * 6:count * 18]
    paths = defaultdict(list)
    for t in range(count):
        points = [(coords[t * 6 + v * 2], 255 - coords[t * 6 + v * 2 + 1]) for v in range(3)]
        rgba = [round(sum(colors[t * 12 + v * 4 + c] for v in range(3)) / 3) for c in range(4)]
        if rgba[3]:
            paths[tuple(rgba)].append('M{},{}L{},{}L{},{}Z'.format(*[n for p in points for n in p]))
    fills = ''.join(f'<path fill="#{r:02x}{g:02x}{b:02x}"{"" if a == 255 else f" fill-opacity={a / 255:.3g}"} d="{"".join(d)}"/>'
                    for (r, g, b, a), d in paths.items())
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">{fills}</svg>\n'


def main():
    names = json.loads(subprocess.run(['node', '--input-type=module', '-e', ICONS % json.dumps(MODES)], cwd=transpile.REPO,
                                      capture_output=True, text=True, check=True).stdout)
    os.makedirs(OUT, exist_ok=True)
    for name in names:
        open(os.path.join(OUT, name + '.svg'), 'w').write(svg(fetch_bytes(f'release/datafiles/icons/{name}.dat')))
    print(f'wrote {len(names)} icons to {os.path.relpath(OUT, transpile.REPO)}')


if __name__ == '__main__':
    main()
