# Python

A seashell on a beach, made by `python.py` in Blender, with two Python files, as texts in the Scripting workspace's Text Editor:

- `seashell.py`, a script: Run Script (Alt P) builds the shell with numpy, a tube swept along a logarithmic spiral,
  through `foreach_set`. Change TURNS, GROWTH or DROP and run it again.
- `scatter_cubes.py`, an add-on: an operator with properties (Adjust Last Operation), a sidebar panel, entries appended
  to Object and Add, and a keymap item. Run Script registers it once; installed from Preferences > Add-ons it stays.

Python is CPython 3.13 with Blender's own `bpy` and numpy, built into Blender's module; it starts when the Scripting
workspace's Python Console shows or a script first runs.
