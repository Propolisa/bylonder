---
id: uv-editing
title: UV Editing
summary: Unwrap a mesh with UV > Unwrap, Smart UV Project or Project from View, mark seams, and select, move, pin, stitch and pack its UVs in the UV Editor over the image they map.
status: partial
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/uv/index.html
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/editing/uv.html
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/uv/workflows/layout.html
  - https://docs.blender.org/manual/en/5.2/editors/uv/index.html
example: texture-paint
thumbnail: uv-editing/thumbnail.png
media:
  - uv-editing/workspace.png
  - uv-editing/unwrap.gif
  - uv-editing/select-move.gif
ui:
  - IMAGE_EDITOR
  - EDIT
  - IMAGE_HT_header
  - IMAGE_MT_uvs
  - IMAGE_MT_select
  - VIEW3D_MT_uv_map
  - IMAGE_PT_tools_active
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
---
# UV Editing

A UV map places each face corner of a mesh on an image. The UV Editor shows the UVs of the mesh in Edit Mode over the
image, and its operators are Blender's own (`uv.*` in the module, run in Blender's window with the UV Editor's
keymap), as are its header, menus, toolbar and sidebar. Babylon draws the image and the UVs with Blender's overlay
flags (selected, active, pinned), through the editor's View2D.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=texture-paint)

The demo, Texture Paint, has Suzanne unwrapped with Smart UV Project and painted with an image.

## Steps

1. **Open the UV Editing workspace.** Pick UV Editing in the topbar's workspace tabs. Suzanne enters Edit Mode; the
   UV Editor on the left shows the UVs of the selected faces. Pick the image in the UV Editor's header to see it under
   them.

   ![The UV Editing workspace with Suzanne's UVs](../media/features/uv-editing/workspace.png)

2. **Unwrap.** Hover the 3D Viewport, press A to select all and U for the UV menu: Unwrap uses the seams (Edge >
   Mark Seam), Smart UV Project splits by angle, Project from View maps as the view sees the mesh.

   ![U, Smart UV Project](../media/features/uv-editing/unwrap.gif)

3. **Select and move UVs.** In the UV Editor click a UV vertex, drag a box with the Select Box tool, or press L over
   an island. G moves, R rotates and S scales. P pins the selection, so Unwrap keeps it in place; UV > Pack Islands
   lays the islands out again.

   ![An island selected with L and moved with G](../media/features/uv-editing/select-move.gif)

## Project files

- `examples/texture-paint/texture-paint.py`: the Blender script that builds the demo.
- `examples/texture-paint/texture-paint.blend`: the demo.

## Not done yet

See the limits above.
