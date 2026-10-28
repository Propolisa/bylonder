"""Blender's interface icons (release/datafiles/icons_svg at the port's tag) into public/icons/blender, which BlIcon and
icon.js draw by Blender's icon name in lower case.

usage: python3 -P tools/blender-ui/icons.py
"""
import importlib.util
import os

# transpile.py by path: -P keeps this folder, whose packages stand in for Python's own, off the import path.
spec = importlib.util.spec_from_file_location('transpile', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'transpile.py'))
transpile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transpile)
REPO, fetch, listing = transpile.REPO, transpile.fetch, transpile.listing

FOLDER = 'release/datafiles/icons_svg'
OUT = os.path.join(REPO, 'public', 'icons', 'blender')

for path in listing(FOLDER):
    if path.endswith('.svg'):
        open(os.path.join(OUT, os.path.basename(path)), 'w').write(fetch(path))
print('icons written', len(os.listdir(OUT)))
