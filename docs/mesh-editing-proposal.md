# Mesh editing proposal

Scope for the next slice: Blender's mesh data and Edit Mode, mapped onto Babylon. Written 2026-10-26 from Blender `main` source (`makesdna/DNA_mesh_types.h`, `blenkernel`, `bmesh`, `editors/mesh`, `editors/transform`, `draw/intern/mesh_extractors`, `geometry`, `blenlib`) and Babylon 8.32.

## Goal

An experienced Blender user enters Edit Mode with Tab and works without relearning: the same primitives with the same topology and Adjust Last Operation fields, the same select modes, keys, operators, results and undo. Babylon has no mesh editing, so Blender's model leads here, and Babylon is only the display and picking backend.

## Decisions

1. **License.** Decided: Bylonder is GPL-3.0-or-later, so `src/bmesh`, `src/blenkernel/mesh` and `src/editors/mesh` can port Blender (GPL-2.0-or-later) faithfully. MIT KubeezCut, Apache-2.0 Babylon and manifold-3d, and MPL-2.0 mediabunny combine under it.
2. **Identifiers.** Keep Blender's names exactly for ported API (`BM_edge_split`, `bmo_extrude_face_region_exec`, `corner_verts`, operator idnames `mesh.extrude_region`, RNA property names), so a Blender change set greps straight to our code. Glue code stays in the repo's camelCase. Recommendation: yes.
3. **BMesh layout.** Decided by benchmark (Grid 316 x 316, about 100k verts, Node 22): typed arrays build BMesh in about 200 ms against 270 to 520 ms for one JS object per element, compute normals in 20 ms against 90 to 155 ms, and use about 29 MB against 94 MB. BMesh stays in typed arrays.
4. **Code-built meshes.** A mesh that `createScene` builds becomes Mesh data on its first edit, saved as a scene edit that replaces the code's geometry on every build, like a library override. A "Reset to Code Geometry" operator drops it. Recommendation: yes.

## Blender's model and ours

| Blender | Role | Ours |
|---|---|---|
| `Mesh` (ID) | Object Mode data. Struct of arrays: `vert_positions`, `edges` (`.edge_verts`), `face_offsets`, `corner_verts`, `corner_edges`, plus generic attributes by domain (point, edge, face, corner) | `src/blenkernel/mesh/`: typed arrays, the same names and domains; attributes `position`, `material_index`, `sharp_face`, `sharp_edge`, `UVMap`, `.select_vert`, `.hide_vert`, and so on |
| Implicit sharing | Copies share unchanged arrays (evaluated copies, undo, duplicates) | Arrays are immutable once shared; a write copies them. One `ImplicitSharing` helper |
| Runtime caches | Lazy `face_normals()`, `vert_normals()`, `corner_normals()`, `corner_tris()`, `bounds_min_max()`, `loose_edges()`, invalidated by `tag_positions_changed()`, `tag_topology_changed()`, `tag_sharpness_changed()` | The same caches and tag functions |
| Object and object data | Objects reference a mesh; several objects can share it (Alt D) | New: objects reference mesh datablocks by id. Properties > Object Data |
| `BMesh` | Edit Mode only. Linked topology: verts, edges with disk cycles, loops with radial cycles, faces; header flags `BM_ELEM_SELECT`, `BM_ELEM_HIDDEN`, `BM_ELEM_SEAM`, `BM_ELEM_SMOOTH`, `BM_ELEM_TAG`; CustomData per element | `src/bmesh/`: the same structure stored in growable typed arrays with elements as integer indices and free lists, not one JS object per element. Same kernel functions (`bmesh_kernel_split_face_make_edge`, `bmesh_kernel_join_face_kill_edge`, `bmesh_kernel_split_edge_make_vert`, `bmesh_kernel_join_edge_kill_vert`), constructors, queries, walkers and iterators |
| `BM_mesh_bm_from_me` / `BM_mesh_bm_to_me` | Enter and exit Edit Mode | The same two functions |
| BMesh operators (`bmo_*`) | Slots in, slots out, operator flags; the editor calls them and then selects the output | `src/bmesh/operators/bmo-*.js` with the same slot names. `EDBM_op_call_and_selectf` equivalent |
| `editors/mesh` | `MESH_OT_*` operators, selection, undo, the Add menu | `src/editors/mesh/` with the same file split |
| `wmOperator` | `exec`, `invoke`, `modal`, properties, REGISTER and UNDO flags; redo reruns `exec` on the pre-operator undo step (Adjust Last Operation, F9) | `src/windowmanager/wm-operators.js`. The current Add Mesh panel becomes its first user |
| Edit Mode undo (`editmesh_undo.cc`) | Each step is a Mesh copy deduplicated by `BLI_array_store` | A port of the array store. History entries hold references, never arrays, so commits stay cheap |
| Draw cache (`draw_cache_impl_mesh.cc`, `mesh_extractors`) | Per-corner vertex buffers plus index buffers from `corner_tris`; dirty tags (`BKE_MESH_BATCH_DIRTY_ALL`, `_SELECT`, `_SHADING`) rebuild only what changed | `src/draw/mesh-batch-cache.js`: the only code that writes Babylon geometry. Babylon vertices are Blender corners; positions update in place with `updateDirectly`; a selection change touches only the flag buffer |
| Overlay engine, edit mesh | Vertex points, edges colored by selection (a gradient from the selected end in vertex mode), face tint, face dots, active element in white, theme colors | `src/draw/overlay-edit-mesh.js`: one ShaderMaterial per pass over the batch cache buffers. The edge buffer holds two entries per edge, carrying the edge flag and each end's vertex flag |
| Select buffer (`DRW_select_buffer_*`) | Element ids drawn offscreen; picking reads around the cursor and takes the nearest; box and circle select read a rect. In X-ray, CPU projection of all elements | `src/draw/select-buffer.js`: an R32UI render target (WebGL2) drawn only when the view or the mesh changed, read synchronously. CPU projection in X-ray |
| `BMPartialUpdate` | During a transform, only faces around moved verts recompute normals and tessellation | The same: `BM_mesh_partial_create_from_verts` |
| `BLI_polyfill_2d` and its beautify step | N-gon tessellation, also the Beauty method of Triangulate | A port, replacing earcut for meshes so n-gons shade identically |
| `BLI_kdopbvh` | Ray casts and snapping | A flat BVH over `corner_tris` in typed arrays |

Porting conventions, applied by the generator in `tools/blender-port` (see CLAUDE.md, Ports of Blender code):

- Function, struct field and slot names stay Blender's. Parameters stay in Blender's order. Functions that need the mesh and have no `bm` or `bp` take `bm` first.
- Elements are indices, -1 for none. `v->co` is `vco(bm, v)`, `e->v1` is `bm.e.v1[e]`.
- Vectors are `[x, y, z]` arrays used as values. Matrices are arrays of columns, `m[col][row]` as in C.
- Out parameters are returned: alone from a void function, the out or null from a bool function with one, else `[return value, ...outs]` in parameter order.
- Iterators are arrays named after Blender's iterator types: `for (const e of BM_EDGES_OF_VERT(bm, v))`.
- Blender's overloads per element type are one function taking the element's pool first; an element's embedded struct field is a pool field (`e->v1_disk_link.next` is `bm.e.v1_disk_link_next[e]`).
- `bmo_*_exec(bm, slots)` takes Blender's input slot names (`bmo_opdefines.cc`) and returns its output slots under the same names. A `bmesh` and `bpy.ops` facade over these, for scripts written against Blender's Python API, is planned.

Axes: Mesh data is in Blender's axes (Z up, right-handed), so every ported algorithm and every Blender fixture applies unchanged. `src/draw/mesh-batch-cache.js` is the one place it meets Babylon's axes: (x, y, z) becomes (x, z, y). Swapping two axes also flips handedness, so Blender's winding stays front facing in Babylon. A test checks Babylon's own normals against ours.

## Module layout

These follow Blender's tree, as the restructure set up:

- `src/blenlib/`: `array-store.js`, `polyfill-2d.js`, `polyfill-2d-beautify.js`, `kdopbvh.js`
- `src/blenkernel/mesh/`: `mesh.js`, `attribute.js`, `mesh-normals.js`, `mesh-tessellate.js`, `mesh-from-babylon.js` (welding import for code-built meshes)
- `src/bmesh/intern/`: `bmesh-class.js`, `bmesh-core.js`, `bmesh-construct.js`, `bmesh-mesh-convert.js`, `bmesh-marking.js`, `bmesh-query.js`, `bmesh-walkers.js`, `bmesh-polygon.js`, `bmesh-interp.js`, `bmesh-mesh-normals.js`, `bmesh-mesh-partial-update.js`, `bmesh-delete.js`, `bmesh-mods.js`
- `src/bmesh/operators/`: `bmo-primitive.js`, `bmo-extrude.js`, `bmo-dissolve.js`, `bmo-subdivide.js`, and so on, one file per Blender file
- `src/bmesh/tools/`: `bmesh-bevel.js`
- `src/editors/mesh/`: `editmesh-select.js`, `editmesh-tools.js`, `editmesh-extrude.js`, `editmesh-add.js`, `editmesh-undo.js`, `editmesh-utils.js`, `editmesh-loopcut.js`, `mesh-data.js`
- `src/editors/transform/`: the modal transform, moved out of `editors/object/editor.js` and shared by both modes
- `src/draw/`: `mesh-batch-cache.js`, `overlay-edit-mesh.js`, `select-buffer.js`

## Performance rules

These are the lessons from Blender that we adopt:

1. No JS object per element in hot structures. Mesh and BMesh live in typed arrays, so a hot loop can later move to WASM without changing the data model.
2. BMesh exists only in Edit Mode. Object Mode, modifiers, rendering and storage use the compact Mesh.
3. Derived data is lazy and cached, and tag functions invalidate it per kind of change.
4. Transforms update positions in place and recompute normals and tessellation only around moved verts.
5. GPU buffers rebuild per dirty kind. Selection never re-uploads positions.
6. Undo and saved edits deduplicate arrays (array store, implicit sharing). History never serializes arrays to JSON.
7. Lookup tables (`BM_mesh_elem_table_ensure`, `BM_mesh_elem_index_ensure`) are built on demand and kept until topology changes.
8. Picking reads a cached id buffer and does not ray cast the scene.

Budgets, measured in headless Chromium on the CI machine, fail a test when a result is more than twice its recorded baseline:

| Case (Grid 316 x 316, about 100k verts) | Budget |
|---|---|
| Enter Edit Mode (`BM_mesh_bm_from_me` plus overlay buffers) | 150 ms |
| Exit Edit Mode | 100 ms |
| Click select | 8 ms |
| Transform frame with 10k selected verts | 8 ms |
| Selection change upload | 4 ms |
| Extrude Region of 10k faces | 120 ms |
| Undo step memory after moving one vert | Under 1% of the mesh size |
| Object Mode draw extraction, 1M triangles | 300 ms |

## WASM and libraries

- **Core (BMesh, Edit Mode operators, modifiers): Blender's own code in WebAssembly.** Converting Blender's C++ to JS met a new pointer pattern with almost every operator, and many conversions were wrong without failing. Compiled to WASM, the same code gives Blender's results by construction: all of bmesh and 92 of the 94 modifier sources build unchanged. `tools/blender-port/wasm_module.py` builds them from a copy of the Blender tree with a few reviewed patches (`wasm/patches`), and every Blender symbol a module still lacks becomes an import that throws when called.
- **One module per shared state.** WASM modules do not share memory, so everything that works on the edit BMesh and the evaluated meshes (bmesh, the mesh editors, modifiers, the blenkernel parts they reach) is one module, `bmesh.wasm`. The edit mesh and modifier results stay in its memory. Stateless whole-mesh functions (tessellation) can be separate units loaded on demand.
- **One edit mesh.** As in Blender, the edit mesh (`BMEditMesh`, the `EditMesh` class in `src/bmesh/bmesh-wasm.js`) is the only one: operators, selection, hiding and transforms change it in the module. Drawing and picking read Mesh arrays extracted from it, as Blender's draw cache extracts its buffers, with the BMesh's own normals and triangles; an undo step stores them as Mesh data. Picking stays in JS and selects through Blender's functions. Loop Cut and Edge Slide are still JS ports and work on a BMesh of the arrays while they run.
- **Buffers are shared, and refilled by what changed.** The edit mesh owns its extracted arrays and JS reads them as typed array views over the module's memory, made again when a call grows memory and detaches them. A move refills positions (with normals and triangles), a selection change the flags, an operator everything; the viewport and the Edit Mode overlay keep their GPU buffers and update the same parts in place. Data is copied when JS keeps it past the next change (undo) or sends it to a worker.
- **Blender's UI scripts, transpiled.** Menus come from Blender's own Python (`space_view3d.py`): `tools/blender-ui/transpile.py` takes the classes `tools/blender-ui/manifest.json` names, with their base classes, from Blender's scripts at the port's tag and compiles them with Transcrypt into `src/bl_ui` (generated, never edited). They import a small `bpy` (`tools/blender-ui/bpy`) and draw with Bylonder's `UILayout` (`src/editors/interface/ui-layout.js`), which leaves out what Bylonder does not run yet. Enum items come from the operators' own item functions in the module, so menus filter as Blender's do (Merge's At First and At Last, Select Similar's types). Where Transcrypt's Python differs from what the scripts use, a reviewed patch in the transpiler fixes the output and fails loudly when it stops applying.
- **Operators run as Blender runs them.** Blender's `MESH_OT_*` functions register the operators and their properties; a small boundary layer supplies the context (one object in Edit Mode), operator properties and no-op window manager and depsgraph updates.
- **Boolean:** Blender's Manifold solver with the Manifold library at Blender's version (v3.5.2), built into the module. The Exact solver needs GMP and comes later.
- **Subdivision Surface:** Blender's subdivision code with OpenSubdiv at Blender's version (v3_7_0), whose CPU evaluator builds to WASM. GPU subdivision waits for WebGPU.
- **Modifiers run as Blender runs them.** `mesh_create_eval_final` evaluates the object's stack in the module with no depsgraph, and in Edit Mode `editbmesh_get_eval_cage` evaluates it on the edit mesh; the result's arrays are read in place as the edit mesh's are. Edit Mode draws the result shaded and the edit mesh as the overlay, as Blender does without On Cage, and picks faces through the result's `CD_ORIGINDEX`. JS writes each modifier's settings into its DNA struct at offsets generated from `rna_modifier.cc` by Clang, so no RNA runtime is needed. OpenVDB (voxel remesh) runs single-threaded on a serial stand-in for oneTBB (`wasm/include/tbb`).
- **Threads:** GitHub Pages cannot send COOP and COEP headers, so there is no SharedArrayBuffer and no WASM threads. Whole-mesh work (modifier evaluation) can run in a worker with transferred buffers. Edit operators stay on the main thread, as most of Blender's are.
- **Not used:** Babylon `VertexData` as the data model (triangles only, split vertices), earcut for meshes, CSG2 (Babylon's own Manifold wrapper) in place of the modifier.

## Parity testing

`tools/blender-reference/mesh-fixtures.py` runs Blender 5.2 in the background. It runs each case (a primitive with given fields, or an operator on a known mesh with its fields and selection) and dumps the resulting Mesh arrays to JSON under `tests/fixtures/mesh/`. Our tests run the same case and compare:

- topology exactly (counts, face sizes, `corner_verts` where the operator is deterministic);
- positions within 1e-5;
- selection after the operator.

The fixtures are committed, so tests need no Blender.

## Slices

Each slice ships in small pushes, each visible in the app and covered by tests. Size is relative (S, M, L).

| # | Slice | What a user sees | Tests | Size |
|---|---|---|---|---|
| 1 | Mesh core, draw cache, Blender primitives | Add > Mesh has Plane, Cube, Circle, UV Sphere, Ico Sphere, Cylinder, Cone, Torus, Grid, Monkey, Quad Sphere with Blender's topology and Adjust Last Operation fields (Size, Vertices, Radius, Depth, Fill Type, Generate UVs, Align, Location, Rotation). Object > Shade Smooth, Shade Flat, Shade Auto Smooth. Babylon builders move to an Add > Babylon submenu | Fixtures for every primitive; normals; tessellation; extraction benchmark | M |
| 2 | Object data and storage | Properties > Object Data (name, users, fake user). Alt D linked duplicate; Object > Make Single User. Code-built meshes convert on first edit (decision 3). Meshes saved per project in OPFS as content-hashed binary that scene edits reference; render contexts and scene revision hashes include them; undo uses the array store. Old `wbCreation` recipes migrate to Mesh data | Round trip; undo memory; migration of saved projects | M |
| 3 | Edit Mode shell and operator framework | Tab, the mode menu and Ctrl Tab. Overlay with theme colors. Select modes 1, 2, 3 (Shift extends, Ctrl expands). Click select with cycling, Shift toggle, A, Alt A, Ctrl I. Box (B, drag), circle (C) and lasso select. Alt Z X-ray. Several objects in Edit Mode together. Edit Mode undo. `wmOperator` with F9 and the Adjust Last Operation panel. Status bar hints | Selection flushing (`EDBM_selectmode_flush`); select buffer picking in Chromium; enter and exit benchmarks | L |
| 4 | Transform in Edit Mode | G, R, S with axis and plane constraints, numeric input, Shift precision, Ctrl increment; pivot points (Median, Individual Origins, Active Element, Bounding Box, 3D Cursor); transform orientations; Proportional Editing (O, falloffs, Connected Only, wheel radius); GG vertex and edge slide; the tool gizmos. Partial updates | Fixtures for slide and proportional editing; transform frame benchmark | M |
| 5 | Selection tools | L and Ctrl L linked, Alt click loop, Ctrl Alt click ring, Ctrl click shortest path, Ctrl Numpad Plus and Minus grow and shrink, Select Similar (Shift G), Select All by Trait (non-manifold, loose, interior faces, sides), Checker Deselect, Select Random, Select Mirror, Select Boundary Loop, Select Loop Inner-Region | Walker fixtures | M |
| 6 | Topology basics | Delete and Dissolve (X menu, Limited Dissolve, Edge Collapse, Edge Loops). Fill (F), Grid Fill, Beautify Faces. Merge (M: At Center, At Cursor, Collapse, At First, At Last, By Distance). Split (Y), Separate (P), Duplicate (Shift D), Join (Ctrl J). Flip, Recalculate Outside (Shift N). Triangulate (Ctrl T), Tris to Quads (Alt J). Subdivide. Mark Seam and Sharp, Edge Crease (Shift E), Bevel Weight | Fixtures per operator and option | L |
| 7 | Extrude family | Extrude Region, Along Normals, Individual Faces, Manifold, Edges, Vertices (E, Alt E). Extrude to Cursor (Ctrl right click). Inset (I, II individual). Spin, Screw. Poke, Wireframe | Fixtures | M |
| 8 | Loops and cuts | Loop Cut and Slide (Ctrl R with edge ring preselect, wheel for cuts), Offset Edge Slide, Knife (K, constraints, cut through), Bisect, Rip (V), Bridge Edge Loops, Connect Vertex Path (J) | Fixtures; interaction tests in Chromium | L |
| 9 | Bevel | Ctrl B and Ctrl Shift B: Offset, Width, Depth, Percent and Absolute types, Segments, Shape, Clamp Overlap, Loop Slide, Harden Normals, miters, custom profile. `bmesh_bevel.cc` is about 8000 lines, so it ships in phases | Fixtures per option | L |
| 10 | Snapping and 3D cursor | Snap menu (Shift Tab, increment, vertex, edge, face, volume, edge center, perpendicular), snap base and target, Shift right click cursor, Shift S pie, BVH | Fixtures; snap benchmark | M |
| 11 | Mesh data | UV Maps, Color Attributes, Attributes and Vertex Groups panels. Shape Keys mapped to Babylon's `MorphTargetManager` for display. Sharp edges and custom normals. Smooth by Angle as a modifier, as in Blender 4.1 and later | Attribute interpolation fixtures (`bmesh-interp`) | M |
| 12 | Modifiers on Mesh | The stack evaluates Mesh data instead of `VertexData`. Edit Mode cage and On Cage. Subdivision Surface, Mirror (with clipping in Edit Mode), Solidify, Bevel (uses slice 9), Boolean (Manifold), Weld, Array on Mesh. Geometry Nodes keeps working through a Mesh to `VertexData` bridge | Fixtures; evaluation benchmark | L |

## Critical path

Read from the coverage tree (Splash Screen > Blender Coverage > 3D Viewport > Edit Mode, 476 items: 383 menu entries and 93 Mesh keymap bindings). Every item needs Mesh data, BMesh and the Edit Mode shell first; after that, items unlock by operator. In time-to-value order:

1. Mesh data, BMesh kernel, draw cache and Blender's primitives. Done for Plane, Cube, Circle, Cylinder, Cone and Grid: all thirteen fixtures (defaults and option variants) match Blender 5.2 exactly, including element order and UVs. Still open: UV Sphere (spin), Ico Sphere (subdivide_edges), Torus, Monkey; n-gon tessellation (BLI_polyfill_2d).
2. Edit Mode shell: Tab, select modes 1, 2, 3, the overlay, select buffer picking, A, Alt A, Ctrl I, B, C, H, Alt H, Edit Mode undo. Unlocks the Select menu and most of the Mesh keymap. Done so far: Tab (any mesh object; Babylon geometry welds into Mesh data, which then overrides the code's geometry as a scene edit), the header mode menu and select mode buttons, select modes with Shift to combine, click select with cycling and Shift toggle (nearest element on screen, occlusion by ray test), A, Alt A, Ctrl I, H, Shift H, Alt H, the overlay in the theme's colors, and undo of every step. Box select: a drag in Edit Mode (Shift extends, Ctrl subtracts) or B, with Blender's edge passes (fully inside first, then crossing); visibility in solid shading uses ray tests until the select buffer is ported. Select More and Less (Ctrl Numpad Plus and Minus, by faces or edges) and Select Linked (Ctrl L, with Blender's seam, sharp, normal and material delimits) and Pick Linked (L, Shift L to deselect) port `bmo_region_extend` and the vert shell, loop shell and island walkers; thirteen fixtures match Blender exactly, selection included. The status bar shows selected and total verts, edges and faces. Still open: circle and lasso select, X-ray, select buffer picking, several objects at once, UV delimit.
3. G, R and S on components with partial updates. Unlocks the Transform menu. Done so far: G, R and S about the median point, X, Y and Z axis constraints and Shift X, Y and Z plane constraints in global axes, Shift precision, Ctrl increments, confirm and cancel with the mouse or Enter and Esc, one undo step per transform. Numeric input, the Global and Local orientation cycling of repeated axis keys and Blender's header text now follow transform.cc, shared with Object Mode. Still open: pivot points, the orientation menu, proportional editing, vertex slide, trackball, partial updates (every frame rebuilds the Mesh).
4. Operators by daily use: Extrude (E), Delete and Dissolve (X), Loop Cut (Ctrl R), Inset (I), Bevel (Ctrl B), Merge (M), Fill (F), Knife (K), Subdivide, Separate (P), Split (Y), Normals (Shift N). Each is checked against Blender's own result on a selection (`edit` fixtures from `mesh-fixtures.py`). Done so far: Delete (X and Delete open `VIEW3D_MT_edit_mesh_delete`; all five types match Blender exactly), Dissolve Faces (exact), Extrude (E extrudes the region, single edges or single vertices as Blender chooses from the selection, then moves along the summed face normal when faces were selected; cancelling the move keeps the extrusion, as in Blender), Subdivide (`bmo_subdivide_edges_exec` with every face pattern, grid fill and corner types; ten fixtures match Blender exactly; Smoothness and Fractal are shown but not ported yet), Adjust Last Operation (a Vue panel built from the property widgets: an operator with visible RNA properties opens it, and a change re-runs the operator from the Mesh as it was and replaces the undo step), Loop Cut (Ctrl R: the edge ring walker, the preview in the gizmo color, wheel and Page Up or Page Down for cuts, then `mesh.loopcut` with its redo panel; five fixtures match Blender exactly, with Blender's side made by ring select plus subdivide, since `mesh.loopcut` crashes in background mode; then Edge Slide as in `mesh.loopcut_slide`), Edge Slide (`transform_mesh_edge_slide_data_create` and the mode: E Even, F Flip, C or Alt unclamped, Ctrl increments; GG on edges; eight fixtures from `transform.edge_slide` match Blender exactly, including n-gon sides), Inset Faces (I: `bmo_inset_region_exec` with boundary, even, relative, edge rail, outset, depth and its interior length fallback; eleven fixtures match Blender exactly; the modal maps mouse distance to Thickness, Ctrl to Depth, Shift to precision, O and B to Outset and Boundary; individual insets and UV interpolation of the inset faces are not ported yet), and the header Mesh, Edge and Face menus. Extrude results match Blender as geometry, not in element order: Blender walks the new side edges through a pointer-keyed GHash, so its own order changes from run to run (checked over three runs). Merge (M opens `VIEW3D_MT_edit_mesh_merge`: At Center, At Cursor, Collapse, At First and At Last, filtered by the selection history as Blender does, and By Distance with its report; `bmo_weld_verts_exec`, `pointmerge`, `collapse` and `find_doubles` on a port of Blender 5.2's KD-tree, whose balanced node order decides the clusters; ten fixtures match Blender exactly). Fill (F, `mesh.edge_face_add`: `contextual_create` with edge net prepare and fill, the edge net path search, edge loop fill, vertex cloud n-gons, face attribute fill, normal recalculation and Blender's selection extension that lets F be pressed again and again; ten fixtures match Blender exactly). Dissolve Vertices, Dissolve Edges (with Blender 5.2's chain, angle and quad rules), Ctrl X by select mode and Edge Collapse (fourteen fixtures match Blender exactly). Still open: Limited Dissolve, Edge Loops, the other Extrude menu entries, UV merging (`uvs`), Grid Fill and Fill (Alt F). Known gap: Babylon culls back faces, so open meshes do not show their inside as Blender's solid shading does.
5. The remaining slices below, in table order.

Slices 1 to 4 are the minimum for a credible Edit Mode. After slice 3, a user can enter Edit Mode and select. After slice 4, they can model with transforms. From slice 5 on, slices are mostly independent and can be reordered.

## Out of scope

Sculpt, Weight and Vertex Paint, the UV Editor, Retopology tools, Remesh (OpenVDB, QuadriFlow), Curves and Grease Pencil editing, and Blender's Exact boolean solver. The data model leaves room for each.

## Risks

- **Scene edits as an override of code:** slice 2 changes how edits persist for meshes. Saved projects migrate once and keep loading.
- **Point and line width:** WebGPU draws points and lines 1 pixel wide, so the overlay draws them as screen-space quads from the start, so a later WebGPU engine needs no change.
- **Bevel and Knife size:** they are the largest ports. They are scheduled late and phased.
- **JS performance:** budgets catch regressions per slice. The typed-array layout keeps WASM as a local fix, not a rewrite.
