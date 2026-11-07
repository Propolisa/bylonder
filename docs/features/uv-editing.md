---
id: uv-editing
title: UV Editing
summary: Unwrap a mesh with UV > Unwrap, Smart UV Project or Project from View, mark seams, and select, move, pin, stitch and pack its UVs in the UV Editor over the image they map, here four food cans whose labels and lids come from one image.
expect: Unwrapping and UV editing run Blender's operators; UV Sculpt has no brush cursor and Display Stretch is not drawn.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/uv/index.html
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/editing/uv.html
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/uv/workflows/layout.html
  - https://docs.blender.org/manual/en/5.2/editors/uv/index.html
example: tin-cans
thumbnail: uv-editing/thumbnail.png
media:
  - uv-editing/workspace.png
  - uv-editing/unwrap.gif
  - uv-editing/select-move.gif
  - uv-editing/render.png
ui:
  - IMAGE_EDITOR
  - UV
  - EDIT
  - IMAGE_HT_header
  - IMAGE_HT_tool_header
  - IMAGE_MT_editor_menus
  - IMAGE_MT_uvs*
  - IMAGE_MT_select*
  - IMAGE_PT_uv*
  - IMAGE_PT_tools_active
  - VIEW3D_MT_uv_map
operators:
  - uv.unwrap
  - uv.smart_project
  - uv.project_from_view
  - uv.select
  - uv.select_box
  - uv.select_all
  - uv.pin
  - uv.stitch
  - uv.pack_islands
  - mesh.mark_seam
  - transform.translate
code:
  - src/editors/space_image/image-editor.js
  - src/editors/space_image/image-view.js
  - src/editors/screen/blender-area.js
  - tools/blender-port/wasm/image-api.cc
tests:
  - tests/texture-paint-wasm.test.js
limits:
  - UV Sculpt tools are not drawn with a brush cursor.
  - The UV Editor's stretch display (Overlays, Display Stretch) is not drawn.
  - The UV Editor's sidebar does not hide with N or View > Sidebar.
---
# UV Editing

A UV map places each face corner of a mesh on an image. The UV Editor shows the UVs of the mesh in Edit Mode over the
image, and its operators are Blender's own (`uv.*` in the module, run in Blender's window with the UV Editor's
keymap), as are its header, menus, toolbar and sidebar. Babylon draws the image and the UVs with Blender's overlay
flags (selected, active, pinned), through the editor's View2D.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=tin-cans)

The demo, Tin Cans, is four food cans on a counter whose labels and lids all come from one 2048 by 2048 image: three
labels stacked as bands and a lid in the bottom corner. Each can's side is unwrapped onto its label's band and its caps
onto the lid, so which label a can wears is only where its UVs sit. It is built by a Blender script (`tin-cans.py`).

![The cans rendered through the camera](../media/features/uv-editing/render.png)

## Steps

1. **Unwrap.** In the Default Cube example, click the cube, press X > Delete and Shift A > Mesh > Cylinder. Pick UV
   Editing in the topbar's workspace tabs: the cylinder enters Edit Mode. Hover the 3D Viewport, press A to select all
   and U for the UV menu: Unwrap uses the seams (Edge > Mark Seam), Smart UV Project splits by angle, Cylinder
   Projection wraps the faces around the view's axis, as here.

   ![Shift A > Mesh > Cylinder, UV Editing, A, U > Cylinder Projection](../media/features/uv-editing/unwrap.gif)

2. **See a can's UVs.** Open the example and pick UV Editing. The Tomato can enters Edit Mode, and the UV Editor on
   the left shows its UVs over the label atlas: the side's island covers the top band, the caps the lid. Home over the
   UV Editor fits the image.

   ![The UV Editing workspace with the Tomato can's UVs](../media/features/uv-editing/workspace.png)

3. **Select and move UVs.** In the UV Editor, Alt A deselects, L over the side's island picks it, and G Y -0.25 Enter
   moves it one band down: the can now wears the pea label (Material Preview shows it). Click a UV vertex or drag a
   box with the Select Box tool to pick fewer; R rotates and S scales. P pins the selection, so Unwrap keeps it in
   place; UV > Pack Islands lays the islands out again.

   ![The side's island picked with L and moved a band down with G](../media/features/uv-editing/select-move.gif)

## Project files

- [tin-cans.py](../../examples/tin-cans/tin-cans.py): the Blender script that builds the demo, its atlas and the cans'
  UVs.
- [tin-cans.blend](../../examples/tin-cans/tin-cans.blend): the file the script saves, with its image packed.
- [index.js](../../examples/tin-cans/index.js): opens the .blend with Blender's reader.
- Recorded by [record-texture-paint.mjs](../../tools/docs/record-texture-paint.mjs).
