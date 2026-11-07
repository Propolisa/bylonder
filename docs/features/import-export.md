---
id: import-export
title: Import and Export
summary: Bring scenes in and write them out with Blender's own importers and exporters (Wavefront OBJ, Stanford PLY, STL, FBX) and its default add-ons (glTF 2.0, FBX export, Motion Capture, SVG as Curves), through the browser's file dialogs with each format's options.
expect: OBJ, PLY, STL, FBX, glTF 2.0, BVH and SVG import and export with Blender's own code and options; the add-ons' entries wait a few seconds for Python the first time File opens, Alembic and USD are greyed out, and an export's extra files download.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/files/import_export/index.html
  - https://docs.blender.org/manual/en/5.2/files/import_export/obj.html
  - https://docs.blender.org/manual/en/5.2/files/import_export/ply.html
  - https://docs.blender.org/manual/en/5.2/files/import_export/stl.html
  - https://docs.blender.org/manual/en/5.2/files/import_export/fbx.html
  - https://docs.blender.org/manual/en/5.2/addons/import_export/scene_gltf2.html
  - https://docs.blender.org/manual/en/5.2/addons/import_export/anim_bvh.html
  - https://docs.blender.org/manual/en/5.2/addons/import_export/curve_svg.html
example: import-export
thumbnail: import-export/thumbnail.png
media:
  - import-export/import-menu.png
  - import-export/import-options.png
  - import-export/place.gif
  - import-export/imported.png
  - import-export/export-menu.png
  - import-export/export-options.png
ui:
  - TOPBAR_MT_file
  - TOPBAR_MT_file_import*
  - TOPBAR_MT_file_export*
  - VIEW_3D
  - OBJECT
operators:
  - wm.obj_import
  - wm.obj_export
  - wm.ply_import
  - wm.ply_export
  - wm.stl_import
  - wm.stl_export
  - wm.fbx_import
  - import_scene.gltf
  - export_scene.gltf
  - import_scene.fbx
  - export_scene.fbx
  - import_anim.bvh
  - export_anim.bvh
  - import_curve.svg
  - object.delete
code:
  - src/windowmanager/wm-fileselect.js
  - tools/blender-port/wasm/fileselect.cc
  - src/editors/io/io-ops.js
  - src/editors/io/addon-menus.json
  - tools/blender-port/wasm/patches/gltf_ctypes.patch
  - src/draw/mesh-batch-buffers.js
tests:
  - tests/io-wasm.test.js
  - tests/io-addons-wasm.test.js
  - tests/e2e/smoke.mjs
limits:
  - Alembic is greyed out until the module is built with C++ exceptions, which its reader relies on.
  - Universal Scene Description is greyed out; OpenUSD needs threads and run-time plugins the module does not have.
  - glTF 2.0, FBX export, Motion Capture (.bvh) and SVG as Curves are Blender's Python add-ons: opening File starts Python, and their entries stay greyed out until it has (a few seconds the first time).
  - glTF's Draco and meshoptimizer compression are not available; their libraries are native ones Bylonder does not build.
  - The file dialogs are the browser's; an export with several files (an OBJ's .mtl, a .gltf's .bin and textures) saves the first where you choose and downloads the others.
  - Imported color attributes are kept in Main; Solid shading's Attribute color and the Color Attribute node do not draw them yet.
  - The splash's Open from URL downloads only from servers that allow downloads from a web page (CORS); Blender's demo files are served from Bylonder's own copy for that reason.
---
# Import and Export

File > Import and File > Export are Blender's own menus, and each format is Blender's own importer or exporter
compiled into the WebAssembly module: Wavefront OBJ (with its .mtl materials), Stanford PLY, STL and FBX import. The
add-ons Blender enables by default, glTF 2.0, FBX export, Motion Capture (.bvh) and SVG as Curves, are Blender's Python,
which runs in the module's CPython: opening File starts it, and their entries, at Blender's places, become live once
they have registered. Where
Blender opens its File Browser, Bylonder opens the browser's file dialog; the format's options are the ones Blender's
File Browser shows beside the files, drawn from the operator's own layout. What an import makes is in Main, so it is
undone with Ctrl Z, saved in the project and drawn by Babylon with its UVs, materials and normals, custom normals
included.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=import-export)

The demo, Import and Export, is a gallery: a plinth between two spot lights, and on it a bronze bust brought in
from the example's [bust.glb](../../examples/import-export/bust.glb), a glTF 2.0 file with the bust's mesh and its
Bronze and Marble materials. The steps below take the bust out and import it again.

## Steps

1. **Make room.** Click Bust in the Outliner, hover the 3D Viewport and press Delete. Open File > Import: OBJ, PLY,
   STL, FBX, SVG, Motion Capture and glTF 2.0 run; Alembic and USD are greyed out, their tooltip says why.

   ![File > Import](../media/features/import-export/import-menu.png)

2. **Import.** Choose glTF 2.0 (.glb/.gltf) and pick bust.glb in the file dialog. The importer's options follow;
   click Import glTF 2.0. The bust arrives at the world origin with its materials, selected and active.

   ![The glTF importer's options](../media/features/import-export/import-options.png)

3. **Place it.** Hover the 3D Viewport and press G, Z, type 1.1 and press Enter: the bust stands on the plinth.

   ![G Z 1.1: onto the plinth](../media/features/import-export/place.gif)

4. **Look at it.** Press Numpad 0 and pick Rendered shading: the spot lights pick out the bronze, as before.

   ![The bust in the gallery, Rendered](../media/features/import-export/imported.png)

5. **Export.** File > Export lists the exporters. Choose STL (.stl): its options come first (General, Geometry),
   then the save dialog. Wavefront (.obj), Stanford PLY (.ply), FBX and glTF 2.0 export the same way.

   ![File > Export](../media/features/import-export/export-menu.png)

   ![The STL exporter's options](../media/features/import-export/export-options.png)

## Project files

- [import-export.py](../../examples/import-export/import-export.py): writes bust.glb with Blender 5.2's glTF exporter,
  builds the gallery, imports the bust onto the plinth and saves import-export.blend.
- [bust.glb](../../examples/import-export/bust.glb): the asset.
- [import-export.blend](../../examples/import-export/import-export.blend): the file the script saves.
- [index.js](../../examples/import-export/index.js): opens the .blend with Blender's reader.
- [io-fixtures.py](../../tools/blender-reference/io-fixtures.py) and
  [io-addon-fixtures.py](../../tools/blender-reference/io-addon-fixtures.py): the files and Blender's own import results
  the tests compare with ([io-wasm.test.js](../../tests/io-wasm.test.js),
  [io-addons-wasm.test.js](../../tests/io-addons-wasm.test.js)).
- [record-import-export.mjs](../../tools/docs/record-import-export.mjs): records this page's pictures.
