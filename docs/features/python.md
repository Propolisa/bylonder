---
id: python
title: Python Scripts, Console and Add-ons
summary: Run Python scripts, type in the Python Console and install add-ons, with Blender's own bpy and numpy in CPython 3.13.
expect: Scripts, the Python Console and add-ons and extensions run on Blender's own bpy and numpy as in Blender once Python has loaded (a few seconds the first time); no threads, network or gpu module, and the interface itself stays on the app's own drawing.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/editors/text_editor.html
  - https://docs.blender.org/manual/en/5.2/editors/python_console.html
  - https://docs.blender.org/manual/en/5.2/editors/preferences/addons.html
  - https://docs.blender.org/manual/en/5.2/advanced/scripting/index.html
example: python
thumbnail: python/thumbnail.png
media:
  - python/run-script.gif
  - python/console.gif
  - python/install-addon.gif
  - python/use-addon.gif
ui:
  - TEXT_EDITOR
  - CONSOLE
  - PREFERENCES
  - TEXT_MT_text
  - CONSOLE_MT_console
  - USERPREF_PT_addons
  - VIEW3D_MT_add
  - VIEW3D_MT_object
operators:
  - text.run_script
  - console.execute
  - console.autocomplete
  - extensions.package_install_files
  - preferences.addon_install
  - preferences.addon_enable
  - preferences.addon_disable
  - preferences.addon_remove
code:
  - src/python/python.js
  - tools/blender-port/wasm/python.cc
  - tools/blender-port/python/startup/bylonder_cpython.py
  - tools/blender-port/wasm/fileselect.cc
  - src/windowmanager/wm-fileselect.js
  - tools/blender-port/deps/cpython.sh
  - tools/blender-port/deps/numpy.sh
  - src/editors/space_console/console.js
  - src/editors/space_text/text-editor.js
tests:
  - tests/python-wasm.test.js
  - tests/text-wasm.test.js
  - tests/scripting.test.js
limits:
  - One thread: threading starts no thread and multiprocessing does not run.
  - No network from Python (urllib, pip, the online extension repositories), and no ctypes.
  - The gpu module is not built, so draw handlers that draw with GPU shaders draw nothing.
  - The shipped interface stays on the transpiled tree; a function added to one of its menus or panels draws before or after its own items.
---
# Python Scripts, Console and Add-ons

Bylonder runs Python as Blender does: CPython 3.13 (Blender's version) with Blender's own `bpy`, `mathutils`, `bmesh`
and numpy 2.3, built into Blender's WebAssembly module. A script's `bpy.data` is the scene you edit, `bpy.ops` runs
Blender's operators, and the classes a script or add-on registers (operators, panels, menus, key map items,
properties) appear in the interface and work as in Blender. Python starts when it is first needed, so it does not slow
down opening the app.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=python)

The demo, Python Scripts and Add-ons, is a seashell on a beach at golden hour. The shell is built by a script kept in
the file, `seashell.py`: a tube swept along a logarithmic spiral, every vertex and its banded color computed at once
with numpy and written in one `foreach_set`. The file also holds `scatter_cubes.py`, an add-on. The steps below change
the script and run it, use the console and install the add-on.

## Steps

1. **Run a script.** Open the Scripting workspace. In the Text Editor, pick `seashell.py` from the text menu. Change
   `TURNS` from 5.5 to 2.5 and press Alt P (Text > Run Script): the script removes the old shell and builds one with
   fewer whorls.

   ![TURNS changed, then Alt P runs seashell.py](../media/features/python/run-script.gif)

2. **Type in the console.** Hover the Python Console and type `D.objects['Seashell'].dimensions`, then Enter, and
   `len(D.objects['Seashell'].data.vertices)`. `D` is `bpy.data` and `C` is `bpy.context`; Tab completes names and Up
   recalls history.

   ![The console prints the shell's size and vertex count](../media/features/python/console.gif)

3. **Install the add-on.** Open Edit > Preferences > Add-ons; Python starts. In the section's menu choose Install from
   Disk and pick `scatter_cubes.py` (download it from the project's files first). Blender installs it into your user
   directory, which the browser keeps, and enables it. An extension's `.zip` installs the same way.

   ![Install from Disk, then enable](../media/features/python/install-addon.gif)

4. **Use it.** Shift A > Scatter Cubes in the 3D Viewport adds cubes around the 3D cursor; Adjust Last Operation
   changes their count. The sidebar (N) has a Scatter tab, and Ctrl Shift R runs it too.

   ![Shift A > Scatter Cubes, then more cubes](../media/features/python/use-addon.gif)

## Project files

- [python.py](../../examples/python/python.py): builds the beach, the light and the camera, keeps the two texts and runs
  `seashell.py`, in Blender 5.2.
- [python.blend](../../examples/python/python.blend): the file the script saves.
- [seashell.py](../../examples/python/seashell.py): the script of step 1.
- [scatter_cubes.py](../../examples/python/scatter_cubes.py): the add-on of steps 3 and 4.
- [index.js](../../examples/python/index.js): opens the .blend with Blender's reader.
- Recorded by [record-python.mjs](../../tools/docs/record-python.mjs).
