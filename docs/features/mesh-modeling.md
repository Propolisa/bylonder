---
id: mesh-modeling
title: Mesh Modeling
summary: Model a mesh in Edit Mode with Blender's own tools, Loop Cut, Inset, Extrude, Bevel, Bisect and Spin, here shaping a rangefinder camera.
expect: Edit Mode's tools, their keys, modal options and gizmos are Blender's code and give Blender's result; picking elements under the pointer works as in X-ray, so hidden faces can be picked.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/editing/index.html
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/editing/edge/loopcut_slide.html
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/editing/face/inset_faces.html
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/editing/face/extrude_faces.html
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/editing/edge/bevel.html
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/editing/mesh/bisect.html
  - https://docs.blender.org/manual/en/5.2/modeling/meshes/tools/spin.html
example: mesh-modeling
thumbnail: mesh-modeling/thumbnail.png
media:
  - mesh-modeling/scale.gif
  - mesh-modeling/loop-cut.gif
  - mesh-modeling/inset-extrude.gif
  - mesh-modeling/bevel.gif
  - mesh-modeling/bisect.gif
  - mesh-modeling/lens.png
  - mesh-modeling/render.png
ui:
  - VIEW_3D
  - EDIT
  - VIEW3D_MT_edit_mesh*
  - builtin.loop_cut
  - builtin.inset_faces
  - builtin.extrude_region
  - builtin.bevel
  - builtin.bisect
  - builtin.spin
operators:
  - object.editmode_toggle
  - mesh.select_mode
  - mesh.select_all
  - transform.resize
  - mesh.loopcut_slide
  - mesh.inset
  - mesh.extrude_region_move
  - mesh.bevel
  - mesh.bisect
  - mesh.spin
code:
  - src/editors/mesh/editmesh-mode.js
  - src/editors/mesh/editmesh-preselect-edgering.js
  - src/editors/object/edit-modes.js
tests:
  - tests/editmesh-wasm.test.js
  - tests/editmode-main.test.js
  - tests/tools-wasm.test.js
  - tests/feature-examples-wasm.test.js
limits:
  - Clicking selects as in X-ray, the element nearest the pointer whether or not a face in front hides it.
  - The example's model is built by its script with the bmesh operators these tools run (bmesh.ops.inset_region, bevel, spin, bisect_plane), not by recorded tool use.
---
# Mesh Modeling

Edit Mode edits a mesh's vertices, edges and faces with Blender's own tools: Tab enters it, 1, 2 and 3 pick vertex,
edge or face selection, and the tools run Blender's operators in the module, with their keys, modal maps (typed
values, the mouse wheel for segments and cuts), gizmos and the Adjust Last Operation panel. The mesh they edit is
Blender's, so its topology is exactly what Blender would make.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=mesh-modeling)

The demo, Rangefinder Camera, is made in Blender by a script (`mesh-modeling.py`): a body from a box with loop cuts,
an inset and extruded top plate, inset windows and beveled edges; a lens, two knobs and a shutter button spun from
profiles. The steps below start the body from the Default Cube.

## Steps

1. **A slab.** Open the Default Cube, press Tab, then S Y 0.32 Enter and S Z 0.55 Enter: typed values scale along one
   axis.

   ![Scale along Y and Z](../media/features/mesh-modeling/scale.gif)

2. **A loop cut.** Ctrl R over a vertical edge previews a loop around the body (the mouse wheel would add more cuts);
   a click places it, the mouse slides it along the edges and a second click confirms. It marks the leather band.

   ![Ctrl R](../media/features/mesh-modeling/loop-cut.gif)

3. **Inset and extrude.** Press 3 for faces and click the top. I 0.12 Enter insets it (or by the mouse); E 0.2 Enter
   extrudes the inset face up into the housing of the viewfinder.

   ![I, then E](../media/features/mesh-modeling/inset-extrude.gif)

4. **Bevel.** A selects everything; Ctrl B bevels the edges, by the mouse or here a typed 0.04, and the wheel adds
   segments while it runs, so the corners round off as cast metal does.

   ![Ctrl B](../media/features/mesh-modeling/bevel.gif)

5. **Bisect.** With everything selected, the Bisect tool (in the Knife's tool group) cuts the mesh along the line
   dragged across it, through faces front and back.

   ![The Bisect tool](../media/features/mesh-modeling/bisect.gif)

6. **Spin.** The lens is a profile of edges spun 360 degrees about its axis (Spin, or the Spin tool's gizmo), with
   ridges for the focus ring and a recess for the glass. Its topology is rings of quads.

   ![The lens in Edit Mode](../media/features/mesh-modeling/lens.png)

7. **Render it.** Out of Edit Mode, Render > Render Image renders the camera on its desk.

   ![The Rangefinder Camera rendered](../media/features/mesh-modeling/render.png)

## Project files

- [mesh-modeling.py](../../examples/mesh-modeling/mesh-modeling.py): builds the camera with Edit Mode's bmesh
  operators, its materials, the desk, lights and camera, in Blender 5.2.
- [mesh-modeling.blend](../../examples/mesh-modeling/mesh-modeling.blend): the file the script saves.
- [index.js](../../examples/mesh-modeling/index.js): opens the .blend with Blender's reader.
- Recorded by [record-mesh-modeling.mjs](../../tools/docs/record-mesh-modeling.mjs).
