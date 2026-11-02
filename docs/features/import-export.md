---
id: import-export
title: Import and Export
summary: Bring meshes in and write them out with Blender's own Wavefront OBJ, Stanford PLY, STL and FBX importers and exporters, through the browser's file dialogs with each format's options.
expect: OBJ, PLY, STL and FBX import and export with Blender's own code and options; glTF, BVH, SVG and FBX export wait for the Python add-ons, Alembic and USD are greyed out, and an export's extra files download.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/files/import_export/index.html
  - https://docs.blender.org/manual/en/5.2/files/import_export/obj.html
  - https://docs.blender.org/manual/en/5.2/files/import_export/ply.html
  - https://docs.blender.org/manual/en/5.2/files/import_export/stl.html
  - https://docs.blender.org/manual/en/5.2/files/import_export/fbx.html
example: import-export
thumbnail: import-export/thumbnail.png
media:
  - import-export/import-menu.png
  - import-export/import-options.png
  - import-export/imported.png
  - import-export/export-menu.png
  - import-export/export-options.png
ui:
  - TOPBAR_MT_file
  - TOPBAR_MT_file_import
  - TOPBAR_MT_file_export
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
  - object.delete
code:
  - src/windowmanager/wm-fileselect.js
  - tools/blender-port/wasm/fileselect.cc
  - src/editors/io/io-ops.js
  - src/draw/mesh-batch-buffers.js
tests:
  - tests/io-wasm.test.js
  - tests/e2e/smoke.mjs
limits:
  - Alembic is greyed out until the module is built with C++ exceptions, which its reader relies on.
  - Universal Scene Description is greyed out; OpenUSD needs threads and run-time plugins the module does not have.
  - glTF 2.0, FBX export, Motion Capture (.bvh) and SVG as Curves are Blender's Python add-ons, greyed out until Blender's Python runs in Bylonder.
  - The file dialogs are the browser's; an export with several files (an OBJ's .mtl) saves the first where you choose and downloads the others.
  - Imported color attributes are kept in Main; Solid shading's Attribute color and the Color Attribute node do not draw them yet.
---
# Import and Export

File > Import and File > Export are Blender's own menus, and each format is Blender's own importer or exporter
compiled into the WebAssembly module: Wavefront OBJ (with its .mtl materials), Stanford PLY, STL and FBX import. Where
Blender opens its File Browser, Bylonder opens the browser's file dialog; the format's options are the ones Blender's
File Browser shows beside the files, drawn from the operator's own layout. What an import makes is in Main, so it is
undone with Ctrl Z, saved in the project and drawn by Babylon with its UVs, materials and normals, custom normals
included.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=import-export)

The demo, Import and Export, is the Default Cube's scene with Suzanne imported from the example's
[suzanne.obj](../../examples/import-export/suzanne.obj) and [suzanne.mtl](../../examples/import-export/suzanne.mtl).
The steps below make it from the Default Cube.

## Steps

1. **An empty scene.** In the Default Cube example, click the cube and press Delete. Open File > Import: OBJ, PLY, STL
   and FBX run; the formats Bylonder cannot run yet are greyed out, their tooltip says why.

   ![File > Import](../media/features/import-export/import-menu.png)

2. **Import.** Choose Wavefront (.obj) and pick both suzanne.obj and suzanne.mtl in the file dialog. The importer's
   options follow (General, Options, Materials); click Import Wavefront OBJ.

   ![The OBJ importer's options](../media/features/import-export/import-options.png)

3. **The result.** Suzanne is in the scene with her Skin material, UV map and smooth normals, selected and active, as
   Blender's importer leaves her.

   ![Suzanne imported](../media/features/import-export/imported.png)

4. **Export.** File > Export lists the exporters. Choose STL (.stl): its options come first (General, Geometry),
   then the save dialog. Wavefront (.obj) and Stanford PLY (.ply) export the same way.

   ![File > Export](../media/features/import-export/export-menu.png)

   ![The STL exporter's options](../media/features/import-export/export-options.png)

## Project files

- [import-export.py](../../examples/import-export/import-export.py): writes suzanne.obj and suzanne.mtl with Blender
  5.2's OBJ exporter, imports them into the Default Cube's scene and saves import-export.blend.
- [import-export.blend](../../examples/import-export/import-export.blend): the file the script saves.
- [index.js](../../examples/import-export/index.js): opens the .blend with Blender's reader.
- [io-fixtures.py](../../tools/blender-reference/io-fixtures.py): the files and Blender's own import results the tests
  compare with ([io-wasm.test.js](../../tests/io-wasm.test.js)).
- [record-import-export.mjs](../../tools/docs/record-import-export.mjs): records this page's pictures.
