# Blender coverage notes

Hand-written notes for the Blender coverage view (Splash Screen > Blender Coverage). The view compares Blender's interface, extracted from Blender itself by `tools/blender-reference/surface.py`, with the Blender identifiers in Bylonder's source (see `scripts/blender-coverage.mjs`). This file only holds what the code cannot say: design decisions, equivalents and tips. Keep it sparse.

### Format

Each entry is a level-2 heading naming a node, followed by optional fields and free text:

    ## TOPBAR_MT_file > wm.save_mainfile
    Status: partial
    See: VIEW3D_MT_object > object.duplicate_move
    Text shown with the node.

- **Heading:** a path of ids or labels separated by `>`. The last segment names the node; earlier segments are any of its ancestors, in order, so a bare id (`object.delete`) matches it everywhere. Labels can repeat across editors (a panel and an editor are both called Text Editor), so prefer ids; an editor is named by its id, such as `TEXT_EDITOR` or `VIEW_3D`. Ending the heading with `> *` applies the entry to the whole subtree: its status counts for every node below it that is not implemented (`partial` also marks implemented ones), and the text shows as a callout on the subtree.
- **Status:** `done`, `partial`, `equivalent`, `replaced`, `planned`, `missing` or `skip` (not applicable, left out of the totals). Without one, the status comes from the code: done when implemented, equivalent when `See` points at an implemented node, missing otherwise.
- **See:** the node that provides the same functionality in Bylonder, as a heading-style path. Shown as a link.

## CONSOLE > *
Status: partial
Blender's Python Console in the Scripting workspace: CPython (Pyodide) runs Blender's own `_console_python` with history, Tab completion and `C` and `D`. See `docs/blender-boundary.md` (Scripting).

## TEXT_EDITOR > *
Status: partial
Texts are the project's text files. Run Script runs CPython (Pyodide) over Bylonder's `bpy`. Autocomplete, live edit, Reload and the conflict tools are not there yet; Save downloads the text.

## INFO > *
Status: partial
Operator reports, Python operators' reports and script errors. Replay and Box Select are not there yet.

## TOPBAR_MT_file > wm.save_mainfile
Status: partial
Save Version stores a version in the project history. There is no .blend file; projects live in browser storage and export as ZIP.

## TOPBAR_MT_file > wm.read_homefile
Status: partial
New Project creates a project from code. Blender's templates map to File > New from Example.

## PREFERENCES > *
Edit > Preferences holds Bylonder's own settings (Keep Scenes Loaded). Blender's sections follow as features need them.

## SEQUENCE_EDITOR > *
The Video Sequencer and File Browser are KubeezCut islands. Their Blender identifiers live in the KubeezCut fork, which this scan does not read yet.

## mesh.primitive_uv_sphere_add
Blender's operator builds it in the module, with Blender's positions and edges; its face and edge order differs from Blender's after the spin and merge it runs, which the primitive tests note.

## mesh.primitive_torus_add
Blender's own Python operator (`add_mesh_torus.py`, transpiled) builds the torus, and the module derives its edges as `mesh.update()` does.

## object.modifier_add
Blender's modifiers run Blender's own code in the module (`tools/blender-port/wasm/modifier-api.cc`) on the object's Mesh. Settings are stored by RNA identifier (`use_axis[1]`), described by Blender's RNA (`tools/blender-reference/modifiers.py`) and written at the DNA offsets `tools/blender-port/modifier_dna.py` reads from `rna_modifier.cc`. Types that need other objects, vertex groups, binding or simulation are not offered yet. Array (Nodes) stands for Blender's Array node group asset and goes after Blender's modifiers in the stack. The Add Modifier menu is Blender's (`properties_data_modifier.py`, transpiled), and each panel is laid out by its own `panel_draw` in the module (`tools/blender-port/wasm/panel-layout.cc` records the layout; JS draws it). Fields for vertex groups, objects and operators in those panels come later.

Unlike Blender, evaluation never blocks the interface: it runs as a job (`src/windowmanager/wm-jobs.js`, after `wm_jobs.cc`) in a worker with its own instance of the module (`src/modifiers/evaluator.js`), and the last result stays drawn meanwhile. A job that takes longer than a moment shows in the running-jobs template with Cancel, which terminates the worker, the only way to stop WebAssembly, and goes back to the stack that evaluated last as an undo step. A stack estimated at more than 4 million faces asks before it starts. Edit Mode, Apply and renders use the same jobs; Bylonder's own modifiers (Array (Nodes), Geometry Nodes) still run on the main thread.

## object.shade_smooth
Status: partial
Project code calls `shadeSmooth(mesh)` (and `shadeSmooth(mesh, false)` for Shade Flat), which clears or sets `sharp_face` on the object's Mesh. The Object menu entry comes later. Mesh data from code is `createMesh`, Blender's `Mesh.from_pydata`.

## Transform Modal Map > *
Typed values, the Global and Local cycling of repeated axis keys and the header text follow transform.cc. The scene orientation is always Global, so the second axis press is Local. Ctrl snaps to 1 unit in every view; Blender's orthographic axis views step the grid with zoom.

## node.add_node
Shift A opens Blender's own Add menu (`node_add_menu*.py`, transpiled), with search as you type. It adds the Blender nodes Bylonder runs (Math, Mix, Color Balance so far); Babylon's blocks are in a Babylon sub-menu of each category. See `docs/node-editors.md`.

## DOPESHEET_EDITOR > *
Status: partial
The Timeline and the Dope Sheet run Blender's `space_action` and `editors/animation` code in the module; see `docs/blender-boundary.md` (Animation). Markers are the scene's (Scene.timeline_markers in the module), saved with the animation. The Action, Shape Key, Grease Pencil, Mask and Cache File modes are not shown yet.

## GRAPH_EDITOR > *
Status: partial
Blender's `space_graph` code in the module, with the same window manager as the Dope Sheet. Its sidebar panels (graph_buttons.cc) are ported as their layout calls in `editors/animation/anim-buttons.js`; the F-Modifier panels are Blender's own `fmodifier_ui.cc`, drawn in the module and recorded. Drivers mode is not shown yet.
## OUTLINER > *
Status: partial
Blender's `space_outliner` code in the module, drawn on a canvas from its own draw calls; see `docs/blender-boundary.md` (Outliner). View Layer display mode only; other display modes, context menus on IDs that are not objects or collections, and scroll bars are not shown yet.

## VIEW3D_PT_transform
The C panel (`view3d_buttons.cc`) is ported as its layout calls in `editors/space_view3d/view3d-buttons.js`. Edit Mode's Median panel is not ported yet.

## VIEW3D_HT_header > *
The transform settings (`draw_xform_template`) draw from Blender's Python. Transform orientation slots are stored but no transform uses them yet.

## 3D View Tool: Measure > *
Rulers are kept in the scene's annotations (`RulerData3D`) as Blender keeps them, and drawn with Blender's units. Snapping (Ctrl) reaches vertices, edges and faces of the objects drawn; Blender also snaps to edge midpoints and perpendiculars.

## Generic Tool: Annotate > *
Strokes are smoothed and simplified as `annotate_paint.cc` does and drawn in screen space with the layer's color and thickness. Pressure is the pointer's; the stabilizer and the onion skin are not drawn yet.

## 3D View Tool: Edit Mesh, Loop Cut > *
Status: partial
A press cuts at the edge ring under the mouse and slides it. The ring's preview under the pointer (`VIEW3D_GGT_mesh_preselect_edgering`) is not drawn yet.

## 3D View Tool: Edit Mesh, Spin > *
Status: partial
Spin runs Blender's operator from the drag; its gizmo (`MESH_GGT_spin`) and the redo gizmo that drags out the angle are not drawn yet, so the angle comes from the Adjust Last Operation panel.

## 3D View Tool: Edit Mesh, Poly Build > *
Status: missing
Needs the preselection gizmo (`VIEW3D_GGT_mesh_preselect_elem`), which picks the element its macros act on.

## 3D View Tool: Edit Mesh, Extrude Manifold > *
Status: partial
Extrudes and moves as Blender's macro does; the automerge and split of faces the move dissolves into its neighbors is not run yet.

## VIEW3D_MT_curve_add
Blender's own primitive operators fill the curve, in the module (`ED_curve_add_nurbs_primitive`). Surfaces (Add > Surface) are not offered yet. See `docs/curves-and-text.md`.

## object.text_add
Text objects are Blender's: its text layout (`BKE_vfont_to_curve`) with its built-in font, FreeType in the module. Fonts other than the built-in one load from their files' bytes; a font file picker is not offered yet.
