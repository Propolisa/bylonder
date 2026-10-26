# Mesh editing proposal

Scope for the next slice: Blender's mesh data and Edit Mode, mapped onto Babylon. Written 2026-10-26 from Blender `main` source (`makesdna/DNA_mesh_types.h`, `blenkernel`, `bmesh`, `editors/mesh`, `editors/transform`, `draw/intern/mesh_extractors`, `geometry`, `blenlib`) and Babylon 8.32.

## Goal

An experienced Blender user enters Edit Mode with Tab and works without relearning: the same primitives with the same topology and Adjust Last Operation fields, the same select modes, keys, operators, results and undo. Babylon has no mesh editing, so Blender's model leads here, and Babylon is only the display and picking backend.

## Decisions

1. **License.** Decided: Bylonder is GPL-3.0-or-later, so `src/bmesh`, `src/blenkernel/mesh` and `src/editors/mesh` can port Blender (GPL-2.0-or-later) faithfully. MIT KubeezCut, Apache-2.0 Babylon and manifold-3d, and MPL-2.0 mediabunny combine under it.
2. **Identifiers.** Keep Blender's names exactly for ported API (`BM_edge_split`, `bmo_extrude_face_region_exec`, `corner_verts`, operator idnames `mesh.extrude_region`, RNA property names), so a Blender change set greps straight to our code. Glue code stays in the repo's camelCase. Recommendation: yes.
3. **Code-built meshes.** A mesh that `createScene` builds becomes Mesh data on its first edit, saved as a scene edit that replaces the code's geometry on every build, like a library override. A "Reset to Code Geometry" operator drops it. Recommendation: yes.

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

Axes: Bylonder keeps Babylon's Y-up, left-handed axes. Blender operators take a `matrix`. The Add menu passes one that maps Blender's Z-up to Babylon's Y-up. That map is a reflection, so primitives also reverse their corner order to keep normals pointing out. A test locks this (the cube's top face normal is +Y and it is front facing).

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

- **Core (Mesh, BMesh, operators): JS on typed arrays.** The topology code is branchy and local, the JIT handles it well, and the buffers go to WebGL without a copy. Move to WASM only when a benchmark fails. The flat layout keeps that option open.
- **Boolean:** `manifold-3d` (Apache-2.0, WASM). Since 4.5, Blender ships Manifold as a Boolean solver, so the Boolean modifier and Intersect (Boolean) with the Manifold solver give Blender's results. Blender's Exact solver is not ported.
- **Subdivision Surface:** Blender uses OpenSubdiv. Start with a JS port of OpenSubdiv's uniform Catmull-Clark rules (edge creases, boundary and UV smoothing modes), checked against Blender's output. Compile OpenSubdiv to WASM only if that is too slow. GPU subdivision waits for WebGPU.
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

Slices 1 to 4 are the minimum for a credible Edit Mode. After slice 3, a user can enter Edit Mode and select. After slice 4, they can model with transforms. From slice 5 on, slices are mostly independent and can be reordered.

## Out of scope

Sculpt, Weight and Vertex Paint, the UV Editor, Retopology tools, Remesh (OpenVDB, QuadriFlow), Curves and Grease Pencil editing, and Blender's Exact boolean solver. The data model leaves room for each.

## Risks

- **Scene edits as an override of code:** slice 2 changes how edits persist for meshes. Saved projects migrate once and keep loading.
- **Point and line width:** WebGPU draws points and lines 1 pixel wide, so the overlay draws them as screen-space quads from the start, so a later WebGPU engine needs no change.
- **Bevel and Knife size:** they are the largest ports. They are scheduled late and phased.
- **JS performance:** budgets catch regressions per slice. The typed-array layout keeps WASM as a local fix, not a rewrite.
