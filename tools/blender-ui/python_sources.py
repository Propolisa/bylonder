"""Blender's scripts that run as they are in CPython (Pyodide, src/python/pyodide.js) rather than transpiled: the Python
Console's language module and its completion, which need code.InteractiveConsole and introspection of the console's
own namespace. Written to src/python/scripts/ in Blender's layout under scripts/modules, at the port's tag.

usage: python3 tools/blender-ui/python_sources.py
"""
import os
import shutil

import transpile

OUT = os.path.join(transpile.REPO, 'src', 'python', 'scripts')
SOURCES = ['scripts/modules/_console_python.py', *transpile.listing('scripts/modules/_bl_console_utils')]


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    for path in SOURCES:
        target = os.path.join(OUT, os.path.relpath(path, 'scripts/modules'))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        open(target, 'w').write(f'# Blender {transpile.TAG}: {path}, copied by tools/blender-ui/python_sources.py; do not edit.\n' + transpile.fetch(path))
    print(f'wrote {len(SOURCES)} files to {os.path.relpath(OUT, transpile.REPO)}')


if __name__ == '__main__':
    main()
