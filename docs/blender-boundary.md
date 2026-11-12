# Blender boundary

How Blender's code sees Bylonder's data. Two parts of Bylonder are Blender's own code: Blender's Python in `src/bl_py` (all of its scripts, compiled by Transcrypt), which read `bpy.context` and RNA, and the C++ in `src/bmesh/bmesh.wasm`, which reads a `bContext` and DNA. Decided 2026-10-27.

## Decisions

1. **One RNA layer over live data.** `src/makesrna/rna-bylonder.js` binds Blender structs to Bylonder's objects, with no copies. Each struct is a table from Blender's property name to `{ get, set }`, or to a getter for a read-only property, so a new binding is one line. What a table leaves out reads as Blender's default (`src/makesrna/rna.js`, from `rna-structs.json`, dumped from Blender 5.2.3): a pointer as None, or as a struct of defaults where Blender's is never None, a collection as empty, a value as its default.
2. **Blender's values in Blender's axes.** Babylon's (x, y, z) is Blender's (x, z, y), as for Mesh data. A Babylon Euler rotation about x, y, z, applied z first, is a rotation about Blender's -X, -Z, -Y: Blender's YXZ order. So `rotation_mode` reads `YXZ` (or `QUATERNION` for a node with `rotationQuaternion`), `rotation_euler` is (-rx, -rz, -ry) and `rotation_quaternion` is (w, -x, -z, -y). These are exact, so values round trip. Bylonder's own UI keeps Babylon's axes (`babylon-blender.md`).
3. **One struct per owner.** `createRNA(host).pointer(struct, owner)` keeps one struct per owner, so `context.object` is `context.active_object` and `ob.data` is the same each time.
4. **Writes, updates and undo.** A write is RNA's set and update: it goes through the owning slice's method that does not commit (`time.configure(..., { record: false })`, `sceneSettings.set(..., false)`, `modifiers.set(..., { finish: false })`) and then calls `host.update(struct, name, owner)`, Blender's notifier, so the host redraws. Undo steps are pushed by the UI that made the edit (`host.undoPush(name)`), as Blender's buttons push them; a script or operator writing RNA pushes none. `propBinding(host)` gives `layout.prop` the bound booleans, as check items whose edits are undo steps. A read-only property throws on write, as Blender raises. A write to an unbound property stays on that struct and reaches nothing.
5. **A context per editor and region.** `createContext(r, { area, region, space })` (`src/blenkernel/context.js`) builds `bpy.context` for one editor: `window`, `screen`, `area` (type, `show_menus`), `region`, `space_data` (the editor's own data, a 3D Viewport's view for `SpaceView3D`), `region_data` (`RegionView3D` in a 3D Viewport's window region), `scene`, `view_layer`, `tool_settings`, `preferences`, `blend_data`, `mode`, `object`, `active_object`, `edit_object`, `pose_object`, `selected_objects`, `selected_editable_objects`, `visible_objects`, `selectable_objects`, `editable_objects`, `objects_in_mode` and `objects_in_mode_unique_data`. Members outside Context's RNA that the editor lacks (`sculpt_object`) are None, as in Blender. `drawMenu` makes it `bpy.context` while drawing, and `bpy.data` takes its `blend_data` (scenes, objects).
6. **The active object** is the object in Edit Mode, else the last selected. Blender's can be unselected; a `selection.active` would make it exact.
7. **Windows.** A context is built in the window that holds the data it reads: the scene window (3D Viewport, Properties). The app shell (topbar) holds no scene. Its menus read shell state, plus a snapshot of the scene properties they read, posted by the scene window; a write goes back through `send` as an RNA path and value (`scene.render.fps`), applied with the same bindings. Not built yet.

## Mapping

| Struct | Owner | Bound | Blender's defaults |
|---|---|---|---|
| Object | a Babylon node in `world.objects` | `name`, `type` (MESH, EMPTY, CAMERA, LIGHT, FONT, CURVE, ARMATURE), `mode`, `data`, `location`, `rotation_mode`, `rotation_euler`, `rotation_quaternion`, `scale`, `parent`, `children`, `modifiers`, `material_slots`, `active_material`, `hide_select`, and the functions `hide_get`, `hide_set`, `visible_get`, `select_get`, `select_set` | vertex groups, constraints, delta transforms, display settings |
| Mesh | the same node, which holds its mesh | `name`, `total_vert_sel`, `total_edge_sel`, `total_face_sel`, `count_selected_items()`, from the edit mesh in Edit Mode | element collections (Babylon's split vertices are not Blender's; later from the object's Mesh data) |
| Modifier | Blender's: Main's own (`modifiers/main-modifiers.js`); Bylonder's own: a record on the object (`metadata.wbModifiers`) | `name`, `type`, `show_viewport`, `show_render`, a Blender modifier's settings by RNA identifier, and `texture` (Displace's: its Tex) | Bylonder's own types (Array as Geometry Nodes) are `NODES` |
| Texture | Main's Tex, seen through the textures slice (`blenkernel/texture/textures.js`), which reads and writes it by RNA identifier; Blender's undo and file hold it, and modifiers point at it | `name`, `use_fake_user`, `users`, `type` and its type's settings (CloudsTexture's `noise_scale`, ...) at their DNA fields (`dna-textures.json`) | |
| Scene | the world | `name`, `frame_current`, `frame_start`, `frame_end`, `frame_step`, `use_preview_range`, `frame_preview_start`, `frame_preview_end`, `sync_mode`, `camera`, `objects`, `use_gravity`, `gravity`, `render`, `unit_settings`, `tool_settings` | keying sets, rigid body world, audio |
| ToolSettings | the world | `mesh_select_mode`, `use_keyframe_insert_auto` | snapping and proportional editing (Bylonder has no toggles; Ctrl snaps during a transform) |
| RenderSettings | the render slice | `fps`, `resolution_x`, `resolution_y`, `resolution_percentage`, `use_motion_blur`, `motion_blur_shutter`, `use_sequencer` | `engine` (Babylon is not one of Blender's engines) |
| UnitSettings | the scene slice's `unitSettings` | `system`, `scale_length`, `use_separate`, `system_rotation`, `length_unit` | mass, time and temperature units |
| SpaceView3D | a 3D Viewport's view | `type`, `shading`, `overlay`, `region_3d` | `show_gizmo` and the rest |
| View3DShading | the view's state | `type` (WIREFRAME, SOLID, MATERIAL, RENDERED), `show_xray` | lighting, color, cavity |
| View3DOverlay | the view's state | `show_overlays` | grid, floor and the other overlay toggles |
| RegionView3D | the view | `view_perspective`, `is_perspective` (read only) | matrices |

## The WASM side

The module (`src/bmesh/bmesh.wasm`) runs Blender's C++ in two worlds. Both answer the context as Blender does, run operators by their own exec (`operator_exec` on a `bContext`) and take their properties through `operator-properties.cc`, which gives operators and DNA structs RNA by identifier.

- **Blender's data** (`main-api.cc`, JS `BlenderMain`): a `Main` holding objects and their data, one Scene with ToolSettings and one ViewLayer whose Bases hold the selection and the active object, and a window whose screen answers context members through Blender's own `screen_context.cc` (`selected_editable_objects`, `active_object`, ...). Blender's `layer.cc` runs on these Bases. Blender's depsgraph evaluates Main (`main_evaluate`, as the window manager does after each event, and `view_frame_set` for a frame); its editors' update callback lists the IDs each evaluation updated with their recalc flags (`main_updates`), and the view draws those (`main-view.js` `drawEvaluated`).

### Who owns what

Decided 2026-10-29: `model.md`. Blender's Main owns what Blender has a type for, with its undo and its file; Babylon
draws Main's state and owns only what Blender has no type for. It replaces the two-way model of 2026-10-28, where
Babylon was the truth and Main a second model kept equal both ways. Where the code stands:

- **The view** (`src/blenkernel/main-view.js`) draws Main into Babylon after Blender's code ran, after an undo step
  loaded and after a frame change: every object's values through the RNA mapping (the `sync` bindings of
  `rna-bylonder.js`, at their DNA fields), its relations, base (selection, hidden) and name, the data Blender tagged (a
  mesh's geometry, a curve's or text's Curve data, an armature's bones), materials and worlds with their node trees'
  inputs, textures, the scene's settings and collections. An object Main holds without a Babylon object is linked to
  the one its `bylonder_id` names (the project's code built it, or an undo brought it back), else made of its type;
  one Main no longer holds is deleted, its children without it.
- **Geometry is Main's.** A mesh object's Mesh data (Bylonder's recipe of Mesh data or a Blender primitive) goes into
  Main once and stays there; Babylon draws it. A mesh Babylon built itself (a MeshBuilder's, an import) keeps its
  geometry: Main holds a stand-in (`bylonder_standin`), filled from it when Blender's code needs it, until Blender's
  code changes it, which makes it Main's.
- **Materials and worlds are Main's**: a Material or World ID and its node tree, edited by Blender's Properties
  editor and animated by Blender's animation system. The view draws a Principled BSDF into a PBRMaterial as Blender's
  glTF exporter writes it and Babylon's glTF loader reads it, both copied as tables
  (`src/blenkernel/material/principled-gltf.js`, checked against the exporter's output in
  `tests/fixtures/materials-gltf.json`, written by `tools/blender-reference/material-fixtures.py`, and against the
  loader in `tests/principled-gltf.test.js`). A Standard material or a world's Background takes its node inputs
  through the RNA mapping. The Viewport Display values
  (`diffuse_color`, a world's `color`) stay Main's. One Babylon makes that Main does not hold yet (the project's code,
  Bylonder's material library) goes into Main once, as Blender's node tree. A Node Material's graph is Babylon's: Main
  holds a stand-in Material with the graph in `bylonder_node_material`.
- **Undo is Blender's** (`tools/blender-port/wasm/undo-api.cc`): the window manager's undo stack with Blender's undo
  types, memfile steps of Main (and edit-mode steps once Edit Mode is Main's). The history
  (`src/editors/undo/storage.js`) keeps one list: each step is a Blender step with what Babylon owns at that moment
  (objects' native data, the document slices, the animation model, stores). Undo loads the Blender step, the view
  draws it, then Babylon's part is restored. A push that changes nothing in Main leaves Blender's stack as it was.
- **Frames.** `sync.frameChanged(frame)` sets the scene's frame and evaluates every ID's animation and drivers into it
  (`view-api.cc` `view_frame_set`, as a new frame's evaluation does without a graph), the matrices after, and the view
  writes the evaluated values by kind.
- **A project** saves its `.blend` (Main, gzipped) and its objects' native data (`src/runtime/project-state.js`). The
  project's code builds the scene, then the `.blend` is read: an object whose id it holds takes Blender's state from
  it, one the code built that it no longer holds stays deleted, and objects it adds are made. A project saved before
  (rows of objects' transforms) opens once through the old path and saves in the new form.
- **Writes go to Main.** A bound value Main holds (an object's transform and flags, its light's or camera's settings,
  the scene's settings, a collection's and layer collection's flags) is read from Main and written by Blender's own
  RNA (setter and update, through the module's bpy), then evaluated and drawn back (`main-sync.js` `held`, `write`).
  A gizmo's move places each object with `BKE_object_apply_mat4`, which keeps its rotation mode and parent. The
  collections slice is Main's collections read back: its edits are Blender's functions on them (`collectionEdits`),
  new objects go to the active collection as `BKE_object_add` puts them, and it keeps only the view layers but Main's
  own. Select All, Hide, Reveal and Clear Parent are Blender's operators on Main.
- **What still crosses from Babylon to Main**, until every editor writes Main: what code writes on Babylon's objects
  directly (`main-sync.js`, by setter hooks and a flush before Blender's code runs and before every undo push), the
  slices' state (scene settings, which materials and worlds exist and their names, other view layers' flags),
  Bylonder's modifier stack, curve data while a curve is edited, and an armature's record.
- **Undo between pushes.** Bylonder can change Main after the last step without a push of its own; loading a step from
  the last one pushes Main as it is first (`undo-api.cc`), so the memfile step reuses only the data-blocks unchanged
  from it, as Blender's editors make sure by pushing after every change.
- **Edit Mode** is Blender's on Main's object: `object.mode_set` gives the Mesh its BMEditMesh, Blender's window runs
  the Mesh keymap and its mesh operators on Main's context, Blender's menus and header are drawn, the view draws the
  edit mesh and its overlay (`view-api.cc` `view_edit_mesh_extract`), and undo loads Blender's edit-mode steps.
  `src/editors/mesh/editmesh-mode.js` is the editor's mode over it. A click and the region selections run Blender's
  `view3d.select`, `select_box`, `select_lasso` and `select_circle` from the page, picking as in X-ray
  (`view_xray_picking`: the module has no GPU select buffer, so there is no occlusion).
- **GPU selection.** Blender's `view3d_gpu_select_ex` (a click, box select and the picks of objects' parts) runs on
  Blender's `gpu_select.cc` and `gpu_select_next.cc`, compiled in `gpu-select.cc`; the draw loop that would render
  select ids into the selection rectangle is that file's seam, answered for armatures in Edit and Pose Mode from the
  overlay's own sync (`armature-draw.cc` `armature_select_hits`). Other object types draw no select ids yet.

### .blend files

File > Save As runs Blender's `wm.save_as_mainfile` (`wm_files.cc`, `writefile.cc` and the `blend_write` callbacks of
each ID type) on Main, through `sync.writeBlend(path)`, which fills the stand-ins of meshes Babylon built first;
`src/windowmanager/wm-files.js` downloads the bytes as `<project>.blend`. A project keeps its own `.blend` too (Who owns
what).

- **SDNA.** The module builds `makesdna` for wasm32 and runs it under Node's WASI (`sdna()` in `wasm_module.py`), so the
  file's struct layouts are the module's own: 4-byte pointers (Blender reads such files, as it reads 32-bit ones).
  Where wasm32 aligns a 64-bit member after 4-byte pointers and Blender's 64-bit layout does not, `WASM32_PADS` gives
  makesdna's copy of the header a pointer there; `dna_verify.cc` checks every struct against Clang's layout.
- **The scene** is `BKE_scene_add`'s, in Main. A file has no window manager or screen (the module's are outside Main),
  so Blender opens it with its own UI, as it does a file saved without UI.
- **Files.** `src/port/wasm.js` gives the module an in-memory WASI file system (`files`); the writer writes there and
  `writeBlend` reads the bytes back.
- **Checked.** `tests/blend-write.test.js` saves a scene and reads it in the reference Blender
  (`tools/blender-reference/blend-check.py`, which can also render it): objects, transforms, parents, geometry,
  material slots and Principled BSDF inputs, modifiers, F-Curve keys, world and camera.
- **Opening** runs Blender's own path: `readfile.cc` with all of versioning reads the file from memory
  (`BLO_read_from_memory`, zstd-compressed too) and `BKE_blendfile_read_setup_readfile` makes it the Main, as
  `wm_file_read_post` does without UI (`main_open`). The file's scene, settings, view layers and collections are then
  Main's. The ID types the module does not build (sounds, the window manager) are read as their ID alone, and sequencer strips are left out.
- **Adopting.** The view's `adopt()` draws what Main holds that Babylon does not, through the same mapping and
  `RELATIONS`: objects of their type (Main keeps their data), materials of Bylonder's kind with their Principled BSDF
  inputs, or, where the node tree is more than a Principled BSDF, as a node material of the blocks for Blender's nodes
  (`nodeMaterialFromTree`, its nodes' properties read through RNA), modifiers into Bylonder's stack, rotation modes in Bylonder's order, the scene camera and the world's color;
  the scene's settings and collections follow once the world's slices exist. Objects Blender's code adds come
  the same way. What Bylonder cannot show is reported to the Info editor as warnings: other object types, Area lights
  (opened as point lights), modifiers and node types Bylonder lacks, keys on other properties, a world's strength,
  several materials on one mesh.
- **In a project**, `openBlend(path, scene)` (`@workbench/sdk`) opens a .blend of the project's files from its code,
  before the world starts, so Bylonder's edits are kept over it as over any project. `tests/blend-read.test.js` opens
  a file Bylonder wrote and a user's file the reference Blender makes (`tools/blender-reference/user-file.py`) and
  checks them against Blender's reading.
- **Bylonder's own modifiers** (Array (Nodes), Babylon Node Geometry) are Babylon-native: a saved file has Blender's
  modifiers only, which are Main's own.

### Import and export

Decided 2026-11-02. File > Import and File > Export are Blender's importers and exporters in the module (`editors/io`,
`io/wavefront_obj`, `io/ply`, `io/stl`, `io/fbx` with ufbx), registered by `ED_operatortypes_io` as Blender registers
them, in Blender's menus (`TOPBAR_MT_file_import`, `TOPBAR_MT_file_export`). A menu entry whose operator the page does not
register is called as Blender's menus call it, through `WM_operator_call_py` in its call context (`tree-menu.js`), so its
invoke runs.

- **The File Browser is the browser's dialog.** `WM_event_add_fileselect` is wrapped (`fileselect.cc`): Blender's
  fileselect handler keeps the operator, and the page (`windowmanager/wm-fileselect.js`) asks the browser for files
  from the app page, which has the click's user activation. An import's files go into the module's file system, the
  operator's options (`fileselect_options`: its `ui`, as the File Browser's sidebar draws it, in the properties dialog)
  are confirmed, and `EVT_FILESELECT_EXEC` runs it. An export's options come first, then the save picker; the file goes
  there, or downloads, and files written beside it download. The scene window makes Main current first (an export
  fills the stand-ins of meshes Babylon built), views what the operator changed after and pushes its undo step.
- **Drawing what an import makes.** The view adopts the new objects. Their normals are Blender's: where Blender draws
  them per face corner (custom normals, sharp edges: `Mesh::normals_domain`), the extraction gives them
  (`extraction_corner_normals`, kept beside the extraction's header).
- **Not built.** Alembic (its reader relies on caught C++ exceptions; the module is built with `-fignore-exceptions`)
  and USD (OpenUSD's threads and run-time plugins). The default add-ons (io_scene_gltf2, io_scene_fbx, io_anim_bvh,
  io_curve_svg) are Python; `editors/io/io-ops.js` lists their entries greyed out until Blender's Python runs them.
- **Checked.** `tests/io-wasm.test.js` imports files Blender 5.2.3 wrote and compares with Blender's own import
  (`tools/blender-reference/io-fixtures.py`), exports Blender's scene and imports it again, and draws an import;
  `tests/e2e/smoke.mjs` runs File > Import > Wavefront (.obj) and File > Export > Wavefront (.obj) in the browser.

### Link and Append

Decided 2026-11-02. File > Link and File > Append are Blender's `wm.link` and `wm.append` (`wm_files_link.cc`,
`blendfile_link_append.cc`, readfile's library linking) in the module, with their options (Localize All, Instance
Collections, Select, Active Collection and the others), as Blender's File Browser shows them.

- **The File Browser is Blender's.** The library is chosen in the browser's dialog (`fileselect.cc` tells the page that
  the operator browses inside a .blend: `filemode` is `FILE_LOADLIB`). The page then opens Blender's own File Browser
  over it, as `wm_handler_fileselect_do` opens its "Blender File View" window: a `SPACE_FILE` area of the page
  (`editors/space_file/file-browser.js`) that `fileselect_area_set` gives the operator, with its parameters from the
  operator (`filepath`, the library, as `wm_link_append_invoke` sets the last one). Blender's filelist reads the
  library's data-block types and names (`filelist_readjob_lib`), `file_draw.cc` draws the list, its regions (bookmarks,
  directory path, the operator's options, file name and execute buttons) are laid out by Blender, and Blender's file
  operators and keymaps run it: a double click opens an ID type or links a data-block, Enter runs the operator, Escape
  cancels. Closing the window frees the area, which cancels the operator (`ED_fileselect_exit`). The scene window makes
  Main current before the File Browser opens, and draws what the operator changed and pushes its undo step after it
  closes, as for an import.
- **Libraries are project files.** The chosen .blend goes to `/libraries/<name>` in the module's file system, so a
  `Library` keeps that absolute path (a project's Main has no file path to be relative to, as an unsaved file in
  Blender). After the operator, the project keeps every library Main lists as a file under `libraries/`
  (`blenkernel/libraries.js`, the scene window's `library` message); when a project runs, its `libraries/*.blend` are
  put back at `/libraries/` before its code and its saved `.blend` are read, so Blender's reader resolves the links.
  The project's code can open a .blend that links them (`openBlend`).
- **Linked and appended data** is Main's like any other: the view adopts the objects, a linked collection is drawn
  through its instancing empty, the Outliner's Blender File view lists the library and its data-blocks, and Object >
  Library Override > Make (`object.make_override_library`) runs Blender's code.
- **Checked.** `tests/link-append-wasm.test.js` runs File > Link and File > Append from Blender's File menu, browses
  Blender's File Browser by double clicks, and compares Main with what Blender 5.2.3 makes
  (`tools/blender-reference/link-append-fixtures.py`) for a collection, an object and a material, a library override,
  and a saved project read back.

### Assets and geometry nodes

Blender's Essentials asset libraries are its datafiles (`tools/blender-port/datafiles.py` copies them from a Blender
install at the manifest's tag into `src/bmesh/datafiles/`; the node groups, the curve and mesh sculpt brushes): the module's realm puts them in its file system at Blender's
system directory (`ghost-paths.cc`), and Blender's asset system reads them as it reads its install: the asset list,
its indexer (index files in the caches directory) and catalogs, then `object.modifier_add_node_group` and
`object.curves_empty_hair_add` append or link the node groups. The Add Modifier menu's asset catalogs are Blender's C
menu (`OBJECT_MT_modifier_add_root_catalogs`). Blender's geometry nodes evaluate the Geometry Nodes modifier in Main:
fields, zones, closures, bundles and simulation zones (Hair Dynamics' XPBD solver). A frame jumped to steps the
simulations from the frame they reached (`view_frame_set`), and playback shows whole frames, as Blender's does. A Curves
object is placed by the view and its evaluated curves drawn (`main-view.js` drawCurves). Checked against Blender 5.2
(`tests/hair-dynamics.test.js`, `tools/blender-reference/hair-dynamics-fixtures.py`): the simulated control points over
20 frames match within the fixture's rounding.

### Building Blender as Blender builds itself

`tools/blender-port/configure_host.sh` configures Blender at the manifest's tag with its own CMake (headless, without the libraries past the seams below) for its compile commands, and `tools/blender-port/blender_build.py` compiles every library they list for wasm32: Blender decides what is in a library, not a list kept here. Blender's build tools run where their output depends on the platform as wasm32 programs under Node's WASI (`makesrna`, and `makesdna` through `wasm_module.sdna`). The seams, left out: the window system (GHOST), the GPU module and draw engines, Python's `gpu` module, Cycles and audio; Python is the manifest's CPython (Python). Blender's movie library is built without FFmpeg, as Blender builds it without a codec library; video is written by the browser (WebCodecs): `movie-api.cc` defines the Video file format and the encoding settings the browser honors over Blender's own DNA (`RenderData.ffcodecdata`), and the render reads them from Main (`src/render/formats.js`). The build reports what does not compile and every symbol nothing defines, by library (`seam-report.json`). Objects are cached by their source and flags without paths, so the CI build (`.github/workflows/blender-wasm.yml`, eight jobs) and a local one share them. `link_module` links Bylonder's API (`tools/blender-port/wasm/*-api.cc`, `rna-runtime.cc` over Blender's own RNA and window manager) before Blender's libraries into the module the app loads; where both define a symbol, the losing definition is made weak (`wasm_weaken.py`; wasm-ld has no `--allow-multiple-definition`), so no Blender object is left out: the API wins in the window manager, UI and font libraries (its seams there), Blender everywhere else. `replaced.json` lists both sides, the API's stand-ins to remove one by one. The configure builds what the shipped module builds (Bullet, OpenSubdiv, OpenVDB on the module's serial tbb headers), and the libraries Blender takes from outside its tree come from the manifest's `dependency` libraries, built as the module build builds them. Undefined functions link as imports that throw when called; undefined data fails the link (it would read as null), except what `wasm/null-data.txt` names with its reason. Headers Blender's build writes as it builds (`buildinfo.h`, the checkout's hash that saved files carry) are made by its own CMake target first. This module is `src/bmesh/bmesh.wasm`. It starts as Blender's main does (`blender_init`: RNA, node types, color management, render engines), run once at build time and kept in its data (`wasm_snapshot.py`). Its other seams: GHOST's paths (`ghost-paths.cc`), the draw module's engines by identity only (`draw-seam.cc`), image formats (the browser decodes), and the Blender functions the API wraps (`--wrap`, each one an API file's `__wrap_` definition: `platform.cc`'s thread pool and queue, `ui-tree.cc`'s layout resolve, `python.cc`'s calls into Python before it starts). The interface is compiled as a Blender with a window compiles it, as its drawing is recorded. Blender's depsgraph evaluates Main: the API's writes into Main tag what they change, as Blender's RNA updates and operators do.

### Adding a subsystem

- Its Blender sources go in the module's `libraries` (`tools/blender-port/manifest.json`); operators defined in a source listed under `operators` are registered by their own functions. A source that needs header directories of its own lists them as the library's `includes`, so the rest of the build stays cached.
- Its IDs go in the same Main: data of its own (an Action, a node tree) with `BKE_*_add(main_bmain(), name)` in an export of its API file, object data through `object_data(ob)`. `ID_code_to_RNA_type` in `operator-properties.cc` names the module's ID types for context pointers; add the new type there.
- Its values cross through the same RNA names: a binding in `rna-bylonder.js` marked `sync` (with its struct in `dna-data.json`, `modifier_dna.py`), which the scene sync writes and reads back; what is not a value goes in the sync's relations. Its operators run through `sync.run` (or `flush` and `view`); it keeps no copy of its own.

### Drawing

Blender's draw engines and GPU module are past the seam; Babylon draws what Blender evaluated. Where Blender draws
something meshes do not cover (instances, particles, hair and Curves), the boundary has four layers, kept apart so each
can be maintained on its own:

- **Extraction in the module**, the analogue of Blender's draw caches: exports that read Blender's evaluated data and
  pack it into one buffer the view copies once, never per element. `main-api.cc` `main_instances` (`object_duplilist`
  results as world matrices in Babylon's axes: instanced objects, geometry nodes' instances of a mesh grouped by that
  mesh (`main_instance_mesh`), a point cloud's points scaled to their radii; and each particle's point as
  `particle_batch_cache_ensure_pos` gives it), `main_curves` (strand points with radii as `CurvesEvalCache::ensure_positions` gives them, and the topology
  indirection), `main_particle_edit` (Particle Edit Mode's strands, inner keys and tips with their selection, as
  `particle_batch_cache_ensure_edit_pos_and_seg` and its key counterparts give them), next to the mesh extraction
  (`extraction.hh`). Where an overlay's sync is Blender code that needs no GPU, it is compiled as it is, with
  stand-ins for the draw manager's buffers: `armature-draw.cc` builds `overlay_armature.cc` (its header an empty one
  in the build, `blender_build.py` `OVERLAY_STAND_INS`) and `armature_draw` gives every buffer it fills.
- **Blender's shaders, reused.** `tools/blender-nodes/gpu.py` fetches Blender's GLSL at the tag into
  `src/nodes/blender/gpu-library.js`: libraries (the nodes', `draw_curves_lib.glsl`), functions of shaders in Blender's
  shader language (`workbench_prepass.bsl.hh`'s hair functions) and whole draw shaders (`draw`: the particle overlay's, Particle Edit Mode's and the armature overlay's).
  `src/nodes/blender/glsl.js` converts them to GLSL ES as Blender's shader preprocessor would: compatibility macros,
  namespaces as prefixes, resource accessors as globals, references as `inout`, buffer reads as data texture reads,
  and named fixes where GLSL ES is stricter (`FIXES`). A prelude in each user stands in for what a shader's create
  info declares.
- **Babylon's own mechanisms** for drawing them: thin instances (instanced objects, particle shapes, their data in the
  instance buffer), `ShaderMaterial` (the overlay, Workbench), `MaterialPluginBase` (`CurvesPlugin` puts the curves
  vertex stage and EEVEE's cylinder normal into a PBR or Standard material, for Material Preview and Rendered), node
  blocks with per-mesh defines (`CurvesGeometryBlock`, `CurvesNormalBlock`: the geometry Blender's nodes read in a
  node material is the mesh's, or with `CURVES` defined the curves' and EEVEE's curves interface, so one material draws
  the emitter and its hair), `RawTexture` data textures
  (Blender's buffers) and materials per render pass (Workbench per view).
  Edit Mode draws its overlay where the edited object is, never at a thin instance: a mesh a script places only through
  thin instance matrices (the island example's Nest, Whale and Lava Point boulders, `setMatrices`) shows Edit Mode at
  its own origin. Blender has no object whose only placement is its instances: an instancer's copies, linked
  duplicates and collection instances show the edited data without the edit overlay, which Blender draws on the object
  in Edit Mode alone, so drawing it at every copy would not be Blender's.
- **The drawing modules** (`src/draw`): `overlay-armature.js` (bones in every display type, custom shapes, names,
  axes and relationship lines, as `docs/armatures.md` says), `overlay-particle.js` (dots, circles, crosses, axes, hair and Particle Edit
  Mode as the overlay draws them), `curves.js` (curves' data and meshes, the one curves vertex stage every engine uses), `workbench.js`
  (Solid, with curves as Workbench's hair), `grease-pencil.js` (Grease Pencil drawings as GreasedLine meshes and fill
  meshes, from `grease-pencil-api.cc` `main_grease_pencil`, which packs a drawing again only when it changed), `volumes.js`
  (EEVEE's object volumes: a material's Volume drawn by Blender's node GLSL into a froxel atlas on slabs of the view's
  slices, then EEVEE's scatter, integration and resolve passes, `volume-shaders.js`, ported from `eevee_volume.bsl.hh`), called
  by the view (`main-view.js` `drawInstances`, `drawCurves`, `drawGreasePencil`, `particleEditOverlay`).
- **Blender's GPU offscreen on Babylon.** Where Blender's code renders into a GPU offscreen and reads the pixels back
  (Grease Pencil's `image_render`, which the Fill tool's Pixel solver renders strokes with), the seam records what it
  draws and the page renders that into a Babylon `RenderTargetTexture` at the requested size and projection, read back
  synchronously into Blender's image (`grease-pencil-render.cc`, `draw/grease-pencil-render.js`). This is where a GPU
  offscreen of Blender's maps to Babylon.
- **Blender's GPU module on a recording backend.** The module's GPU backend (`gpu-record.cc`) is a backend as GL or
  Vulkan are: Blender's GPU front end (`gpu_shader.cc`, `gpu_texture.cc`, `gpu_compute.cc`, the create info registry
  with its infos, written by Blender's shader tool at build time) runs on it, and its textures, shaders, state and
  compute dispatches record what they are asked. The compositor's GPU path runs a node's operation on it
  (`compositor-api.cc` `compositor_record_node`), and the views replay the recording on Babylon's frame graph
  (`src/compositor/compositor-replay.js`): each dispatch as fragment passes of Blender's GLSL for the create info, one
  per image it writes, the invocation of each texel found from how the shader's `imageStore` addresses its image.
  GLSL ES lacks what desktop GLSL gives these shaders, so the replay adds it: implicit int to float conversions
  (`glsl-conversions.js`, by the GLSL spec's rules) and clamp to border sampling. Shaders whose invocations share memory,
  and recordings that read a texture back (Fog Glow's FFT), are not replayed. The mesh draw extraction's vertex
  buffers are Blender's dummy backend's on the same backend.

What could not be reused is copied, and marked `blender-port: <Blender file and function>` where it is
(`grep -rn blender-port src tools/blender-port/wasm`): a few lines each, such as the weight ramp, a hair radius, the
curves topology (a compute shader in Blender; WebGL has none) and the calls `vert_curves` makes. When the tag moves,
those are what to compare with Blender's.

### Known limits

Blender's AgX view transform (its default; views show Standard, so bright surfaces clip where Blender's roll off: it needs each view's scene-linear image, a post process Babylon's image processing has no place for), material textures (Image Texture nodes), an Area light's disk or ellipse shape (drawn as its rectangle), snapping and proportional editing in ToolSettings, and the 3D Viewport's `RegionView3D` are not synced yet; Actions stay Main's, which the animation's own record mirrors. In a saved file, Bylonder's own modifiers are missing, a Node Material is a Principled BSDF
with Blender's defaults (its graph is kept in `bylonder_node_material`), and a Standard material gives only its color,
alpha and emission color.

### Unresolved module imports

Blender functions the module calls but does not define end in `src/port/wasm.js` `gap()`, which throws "Blender's ...
is not in this WebAssembly module" (`BLENDER_WASM_MISSING=log` lists them in Node). Of the about 250 left, the font
API the interface reaches is defined in `region-draw.cc` over the page's text metrics (`BLF_svg_icon_bitmap` with
Blender's nanosvg, `BLF_string_wrap`, the cursor, selection and width-to-length queries). Known gaps no interface path
reaches yet: text drawn into image buffers (`BLF_buffer`, `BLF_draw_buffer`, render stamps), font previews
(`BLF_thumb_preview`, `BLF_display_name_from_file`), GPU draw calls of code drawn elsewhere (`GPU_*`, `imm*`), GPU
selection (`gpu_select_*`), EEVEE light baking, OpenVDB file IO, motion tracking (`libmv_*`), TIFF and OpenEXR
helpers, GHOST's system and process calls (`fork`, `execvp`).

### Animation

Decided 2026-10-28. Animation data is Blender's, in the module's Main: each animated ID has AnimData and a layered Action (`animrig`), whose F-Curves are the truth. Bylonder's channels map onto them (`src/blenkernel/animation/model.js`): an object's position, rotation and scaling (meshes, empties, text, curves, cameras and lights, the Objects Object Mode mirrors) are its Object's `location`, `rotation_euler` and `scale` in Blender's axes; every other channel, a Babylon-native value (a node material's input, a store value, a render effect's setting, what project code binds with `animate`), is a custom property (an ID property, `["path"]`) of the ID that stands for its owner (a node material's Material) or of the Scene (`["<owner> <path>"]`), registered with `animatable(owner, path, { get, set, owner })`. Any RNA path of any ID is keyed by Blender's keying (`animrig::insert_keyframes`, `delete_keyframe`, `clear_keyframe`: `BlenderAnimation.keyInsert`, `keyDelete`, `keyClear`), and a channel's keys go in with `animrig::insert_vert_fcurve` and the Preferences' settings. Once Main is evaluated for a frame (`evaluateMain`), a channel takes its custom property's evaluated value; until then it takes its F-Curve's (`evaluate_fcurve`). Blender's operators that auto key (Object Mode's) add keys the animation takes (`model.keying`), and the 3D View's I and Alt I are Blender's `anim.keyframe_insert` and `anim.keyframe_delete_v3d`.

The button under the pointer is the region's active button, as in Blender (`editors/animation/keyframing-button.js`): the User Interface keymap (I, Alt I, Shift Alt I) runs `keyframing.cc`'s button operators on it. A property button of Blender's layout trees runs them in the module with the button marked active (`ui_button_active_set`), and its right click opens Blender's own button context menu (`ui_popup_context_menu_for_button`, `ui_button_context_menu`); a Babylon-only panel's property row keys its channels through the same operators and lists the same items. The scene's time is in Main through the scene sync (`Scene.frame_current` and the rest); what the animation editors' operators change of it, and of the selection, comes back through its view (`sync.view`).

The Timeline, Dope Sheet, Graph Editor and Drivers editor are Blender's spaces (`SpaceAction` with its `TIMELINE` and `DOPESHEET` modes, `SpaceGraph` with its `FCURVES` and `DRIVERS` modes), each a `ScrArea` in the module made by its space type's own `create` (`tools/blender-port/wasm/anim-api.cc`, JS `editors/animation/anim-area.js`). Their operators, the channel list (`ANIM_animdata_filter`), key columns (`keyframes_keylist.cc`), View2D and transform conversion are Blender's code. Bylonder is the window manager (`editors/animation/anim-editor.js`): it lays out the regions, turns DOM events into `wmEvent`s for the editors' keymaps (`keymapHandler`), runs modal operators with their modal keymaps, draws box, circle and lasso gestures and the popups an invoke asks for (confirmation, enum menus, operator properties), draws the sidebar's panels with the shared panel renderer, and the scene's markers, and draws the main regions as SVG with the theme's colors (`anim-draw.js` on `svg-context.js`, after `action_draw.cc`, `graph_draw.cc`, `keyframes_draw.cc`). The channel region is Blender's own draw (`action_channel_region_draw`, `graph_channel_region_draw`) and the main region's overlay (the current frame, scrollers and the Graph Editor's value scale) its `draw_overlay`, both recorded by `region-draw.cc` (`anim_region_draw`) and replayed by `region-draw.js`: the channels' toggles are its buttons, pressed as Blender's handlers press them, and the block layout of the channel search row (`ED_time_scrub_channel_search_draw`, the DopeSheet's `filter_text` and `use_filter_invert`) is recorded by `panel-layout.cc` and drawn by the shared layout renderer over the region. Each layout runs the region type's `init`, so scrollers, view settings and the regions' keymap handlers are Blender's; the editors' keys still come from Bylonder's keymaps until their areas take Blender's window events (see Window manager). The Graph Editor's sidebar is Blender's C panels: `anim_sidebar_panels` draws each panel type of the region whose poll passes (`graph_buttons.cc`'s Active F-Curve, Active Keyframe, Modifiers, View, Driven Property and Driver panels), header and sub-panels included, and after the Modifiers panel each F-Modifier's instanced panel (`fmodifier_ui.cc`), into `panel-layout.cc`'s recording; `drawSidebarPanels` (`anim-buttons.js`) shows them by category. Raw buttons are recorded where Blender's block puts them (its current layout, `uiItemL_respect_property_split`'s value column): a property's button (`uiDefButR`) is drawn as that property with its unit (`button_unit_type_set`, so a location key's value shows metres and a rotation's degrees) and runs its functions after a set (`panel_button_applied`); the others are pressed (`panel_button_press`: the delete buttons, an Envelope's control points, Add Input Variable). Their properties are read and written through the module's RNA (`makesrna/rna-module.js`, `rna_get` and `rna_set`, a button's clamping to its range): the DNA fields `modifier_dna.py` finds (`dna-fcurve.json` for FCurve, Keyframe, the F-Modifiers, Driver, DriverVariable and DriverTarget, with the struct a modifier's `data` points to and the item tables other RNA files define; `dna-anim.json` for the spaces), and the get, set, range and update functions of `rna_fcurve.cc`'s runtime part, which the module compiles (`wasm/rna-fcurve.cc`) and gives each property by name (`rna_fcurve_funcs.inc`). The spaces' own RNA functions are rna_space.cc's runtime part (`wasm/rna-space.cc`, `rna_space_funcs.inc` from `dna-anim.json`): the Dope Sheet's mode menu sets `ui_mode` with its update. Drivers are made with Blender's `ANIM_add_driver` (`BlenderAnimation.addDriver`); scripted expressions use `expr_pylike_eval.cc`, built without floating point exception flags, which WebAssembly lacks (a division by zero gives infinity rather than an error). Driver values do not reach Babylon's objects yet: that belongs to the one mapping. Headers and menus are the registered classes of Blender's Python tree (`python/bpy_interface.js`): headers drawn by the shared layout renderer (`layout-view.js`), menus through `drawMenu`.

### Outliner

Decided 2026-10-28. The Outliner is Blender's `space_outliner` and `space_outliner/tree` in the module, over the same Main: Blender's code builds the tree (`tree_display_view_layer.cc`, `tree_element_*.cc`), lays it out and draws it (`outliner_draw.cc`), and runs every Outliner operator (`outliner_select.cc`, `outliner_tools.cc`, `outliner_dragdrop.cc`, `outliner_edit.cc`, `outliner_collections.cc`). `tools/blender-port/wasm/outliner-api.cc` makes the area as `ED_area_newspace` does (the space type's own `create`), sets up its main region as `outliner_main_region_init` does, and draws it; JS `editors/space_outliner/outliner-area.js` holds it and `space-outliner.js` is its window manager.

- **Collections are Blender's.** Main holds them (children, objects, exclude and visibility flags, the active layer collection), so the View Layer tree, the exclude checkbox and the restriction toggles are Blender's own `layer.cc` results. The collections slice reads them back after every change (`collections.assign`).
- **Objects come back through the view** after each operator or button (`sync.view`): the selection and active object from the bases, hidden, the synced flags, names, parents, and objects Blender's code deleted (`outliner.delete`), which are deleted in Bylonder and leave the Scene Collection (`main_collection_master_clean`, since the module's scene is not one of Main's).
- **DNA by name.** `tools/blender-port/modifier_dna.py` also writes `src/makesrna/dna-outliner.json` (Object, Base, Collection, LayerCollection and SpaceOutliner fields, with their RNA icons and enum items), read in place by `makesrna/dna-struct.js`. The header's `space_data` is the module's SpaceOutliner through it.
- **Drawing.** `region-draw.cc` stands in for the GPU module, BLF and the button layer: `imm*`, the round box, text and icons are recorded as JSON with Blender's coordinates, text is measured by JS (`region_text_width`), and `editors/interface/region-draw.js` draws the recording as SVG (`editors/interface/svg-context.js`): shapes as paths, text in the theme's font, and Blender's SVG icons, a monochrome one as a luminance mask in its color (its coverage, as `blf_glyph_cache_add_svg` gives it). No region is drawn on a canvas and nothing rasterizes icons: the browser does. Buttons (the toggles, the rename field) are recorded with their rectangles; a press runs `ui_apply_but` as Blender's handlers do (`region_button_press`, `region_button_text`), and dragging over a toggle column sets them alike.
- **Events.** The region makes Blender's event values (PRESS, RELEASE, CLICK, DOUBLE_CLICK within 350 ms, CLICK_DRAG past 3 px) and runs the keymaps of the main region (`Outliner`, `View2D Buttons List`, `Screen`, `Window`) with the Outliner as the context area. Box gestures run through `startGestureBox`; a menu an operator calls (`WM_menu_name_call`, port-override) opens through `drawMenu`.
- **Drag and drop.** `wm_dragdrop.cc` and `object_relations.cc` are compiled; `drag-drop.cc` runs the main region's dropbox handlers as `wm_event_system.cc` does, for the region JS gives (`drag_update`, `drag_drop`). Dropping on an object moves it into that object's collection, Shift parents it, Ctrl links it; dropping on a collection moves it there.
- **Scene sync.** The module's Scene is not in Main's scenes, so `BKE_main_collection_sync` does not resync its view layer after an ID is deleted or remapped: the area resyncs it after every operator (`syncCollections`). Main's ID remapping reaches the area's tree store through `BKE_library_callback_remap_editor_id_reference_set`.
- **Not yet:** the popup menus `outliner_operator_menu` builds (context menus on mesh data, materials and other IDs that are not objects or collections), the edge pan while dragging (`WM_operator_name_call_ptr` runs only an exec), scroll bars, the display modes other than View Layer, and Bylonder's materials as Material IDs under their meshes.

### Window manager

Decided 2026-10-29 (docs/model.md, principle 5). Blender's window manager runs the browser's input:
`tools/blender-port/wasm/wm-api.cc`, JS `windowmanager/wm-window.js`.

- **Main's window manager** is an ID in Main, as `wm_add_default` makes it, so Blender's code finds it (`G_MAIN->wm`);
  it has no `blend_write`, so files have none, and opening a file keeps it (`BlendFileReadWMSetupData`). `wm_init` sets
  it up as `WM_keyconfig_init` does: the default, add-on and user key configurations, the keymaps Blender's C defines
  (`wm_window_keymap`, `ED_spacetypes_keymap`) and the window's handlers (Window, Screen, Screen Editing, drop boxes).
- **GHOST for the browser** (`ghost-window.cc`): the window's GHOST window is GHOST's headless one (`GHOST_WindowNULL`),
  and the browser's keys become GHOST keys from a DOM event's `code` (a letter from its `key`, as X11 and Wayland take
  letters from the layout).
- **Keymaps** are Blender's keyconfig data (`blender_default.py`'s `generate_keymaps`, transpiled) loaded into the
  default configuration as Python's `keyconfig_init_from_data` loads it through `KeyMaps.new` and `KeyMapItems.new`
  (`loadKeyconfig`, `wm_keymap_new`, `wm_keymap_item_new`). Interim: they load through the generic RNA bridge once it
  runs Python's own loader.
- **Areas** are made by their space types in the window's screen (`wm_area_new`, as `ED_area_newspace`). The page lays
  them out; `wm_area_layout` takes the area's and its regions' rectangles in page pixels, initializes the area once as
  `ED_area_init` does (handlers, keymaps) and runs the regions' `init` after each layout. `wm_region_draw` draws any
  area's region by its type (recorded by `region-draw.cc`); `wm_area_context_set` puts the context in one of its
  regions. A 3D View's matrices are Babylon's camera's (`wm_view3d_set`, port-override).
- **Events.** `wm_event` turns one DOM event into a GHOST event (`wm_event_add_ghostevent`) and runs
  `wm_event_do_handlers` and `wm_event_do_notifiers`: modal operators, macros, modal keymaps, clicks, drags and double
  clicks are Blender's. It returns the regions tagged for redrawing, whether an operator runs modally, the operators that
  finished (an undo step each when they are), the popup or menu an operator opened, and the events no handler used,
  which a handler at the end of the window's handlers collects for the page's keymaps (`wm-event-system.js`).
- **Bylonder's operators** (picking, navigation, Bylonder's actions) are not Blender's operator types yet: during an
  event only the operators the page allows run (`wm_operators_allow`, those registered with `blender: true`, whose
  Bylonder registration runs Blender's own), the others fail their poll and pass the event on (port-override, until the
  RNA bridge registers them as operator types).
- **In the app** (`editors/space_view3d/view3d-window.js`), the 3D Views in Object Mode are areas of the window: their
  input goes to Blender first, with the scene flushed into Main before an operator and viewed after, the selected meshes'
  geometry given to it while it runs; a modal handler of the page (a gesture, a tool) takes the events before it. Mesh
  Edit Mode's input goes there too.
- **The main loop** (`wm_window_handle`, as `WM_main` and `wm_window_events_process`): finished jobs end
  (`wm_jobs_handle_finished`), timers run (job timers whatever their window), then events, handlers and notifiers. The
  page ticks the window each animation frame while it has timers or queued notifiers (`wm_pending`), so a job started
  outside an event (a menu loading an asset list) ends. Startup and File > Open queue what `wm_file_read_post` queues
  (`NC_WM | ND_FILEREAD`, `NC_ASSET | ND_ASSET_LIST_READING`), which registers the node tools and so loads the asset
  lists, as Blender does at startup.
- **Preferences** are Blender's `U`, read at startup from Blender's user directory (`/user`, which the page keeps in
  IndexedDB) by `wm.read_userpref` and saved by `wm.save_userpref`; the window takes their resolution when they are read
  (`wm_window_clear_drawable`, port-override). See `docs/blender-coverage.md` PREFERENCES.
- **3D View navigation** is Blender's navigation operators on the area's RegionView3D: the page sets the view from its
  camera before an event (`wm_view3d_set`) and the camera follows what the operators leave (`wm_view3d_get`); the
  navigation gizmo invokes them as a gizmo does (`wm_area_operator_invoke`).
- **Threads.** WASI has none: a thread pool's work runs where it is inserted, to its end, and frees its slot; popping an
  empty queue gives no work instead of waiting for a thread that cannot come (`platform.cc`).
- **Checked.** `tests/wm-wasm.test.js`: G, mouse moves and a click move an object through Blender's transform modal
  handler, Escape cancels, an operator the page runs passes its event on, and Blender makes the click.

### Export for Babylon

Decided 2026-10-28. File > Export (`TOPBAR_MT_file_export`, Blender's menu) gets Babylon (.babylon) and JavaScript (.zip),
operators `bylonder.export_babylon` and `bylonder.export_js` (`workspace/topbar.js`), which the scene window runs
(`src/io_scene_babylon`), and JavaScript with Live Modifiers (below).

- **The evaluated scene, serialized in place.** The modifier stack draws its result into each object's Babylon mesh,
  so that mesh is the evaluated, modifier-applied mesh, as Blender's glTF exporter exports the evaluated depsgraph.
  Babylon's `SceneSerializer` writes it directly; no copy of the geometry is made besides the file's own (the JSON
  arrays of `.babylon`, the base64 typed arrays of `.js`, read with `getVerticesData`). `evaluatedMesh(node)` in
  `babylon-export.js` is where the sync layer's function for an object's evaluated mesh takes over when it lands.
- **What goes in.** Every node except Bylonder's helpers (named `__`, `doNotSerialize`, deleted objects, a Mesh's
  loose-edge line child, which glTF also leaves out by default), and only the materials those meshes use. Flags are
  set for the serializer and restored after; ids are the objects' unique names for the export. Bylonder's metadata
  (`wb*`) stays out. The scene camera is the active camera; a camera aimed with `lockedTarget` keeps the rotation it
  looks with.
- **Rendered state.** The environment is written as a URL the loader reads (public https URLs kept, others embedded as
  data URLs), with `createDefaultSkybox` when the World shows a skybox; a reflection probe's cube is named
  (`environmentProbe`). Textures without a public URL (blob, raw, procedural) are embedded as base64.
- **Animation** is one Babylon AnimationGroup sampled at every frame of the scene range from Blender's F-Curves
  (`animation.sample()`). Channels carry their Babylon target and property (`register({ target, property })`); a
  material's property is animated through a mesh using it (`material.albedoColor`), a rotation on a quaternion node
  as `rotationQuaternion`. Channels without a Babylon target (stores, `depthOfField`, modifier settings unless they are
  live) stay out.
- **Runtimes.** A feature with a runtime (`runtimes.md`) is written through its mapping to Babylon, the view's own in
  Babylon (mapped), else one made for the export (`exportRuntimes`), with its approximations and fallbacks reported to
  the Info editor: an armature as a `Skeleton`, its meshes skinned, its pose sampled from Main as `_matrix` animations
  of the bones in the animation group.
- **Effects.** The scene camera's rendering pipelines (Bylonder's render effects and the project's own) go in
  `renderingPipelines` and the scene's image processing in `imageProcessingConfiguration`, in Babylon's own
  serialization; camera post-processes go in `postProcesses`, which Babylon's loader reads. Babylon's `.babylon`
  loader ignores the first two and does not play animation groups: the `.js` export applies them all.
- **JavaScript.** `createScene(engine, canvas)` builds each mesh and empty as code (geometry, transform, parent,
  material, flags, thin instances), and parses materials, lights, cameras, shadows, effect layers, probes, particles,
  pipelines and animation with Babylon's `Parse` functions, as the loader does. It imports `@babylonjs/core` module by module,
  mapped in a page to `cdn.jsdelivr.net/npm/@babylonjs/core@<the app's version>/` (the header names the URL), so a page
  loads only the modules its scene uses (`controllable-exports.md`, The package). The export
  is a package (`controllable-exports.md`): `scene.js` with its geometry in `scene.bin` and its images as files, and
  `load(engine)`, the scene with its controls by Blender RNA path, from the page runtime in `bylonder/`.
- **Checked.** `tests/export.test.js` (NullEngine: serialize, reload with Babylon's loader and import the module,
  compare geometry, material, camera and animation), `tests/runtimes-armature-wasm.test.js` (the Rigged Character's
  skeleton reloaded and skinned as Main deforms it at each frame) and `tests/e2e/smoke.mjs` (File > Export in the app).

### Modifier kernels polyfill

Decided 2026-10-28. Exports apply modifiers; File > Export > JavaScript, Live Modifiers (.zip),
`bylonder.export_js_live`, keeps them live instead, with a WebAssembly module of only Blender's modifier evaluation.

- **The module.** `modifiers/modifiers.wasm` in `tools/blender-port/manifest.json`: `modifier-api.cc` (mesh arrays in,
  `mesh_create_eval_final` over Blender's ModifierData, results read in place), `modifier-object.cc` and
  `no-depsgraph.cc` (its object outside Main, and the depsgraph stand-in it evaluates with) and `modifiers-only.cc`. Its libraries are `bmesh.wasm`'s minus the editors,
  `animrig`, `windowmanager`, the interface and the Outliner, blenfont and FreeType, and OpenVDB (built without
  `WITH_OPENVDB`, so Remesh's Voxel mode reports that it is unavailable). Modifier types outside `MESH_ONLY`
  (`src/modifiers/blender.js`) are left out of its `modifiers/intern` as stand-ins (`wasm/modifier-standins.hh`, used
  by the kernels module for the types it leaves out): Blender's None type
  under the type's name, a bare ModifierData that is always disabled, which `modifier_add` refuses. Blender's own code
  that makes a left-out type gets a block of the right size. They were empty `ModifierTypeInfo`s, which
  `BKE_modifier_get_info` does not know: `BKE_modifier_init` makes an Armature, Curve and Lattice modifier, read a null
  type, and wrote the name past the end of an empty block (2026-10-28: the module passed or trapped depending on where
  its data landed). Armature, Curve and Lattice stay real, as `BKE_modifier_init` copies them whole. Archives are per
  module in the shared build directory.
- **Layout check.** A module's manifest `check` runs after each link, on the module and on copies linked with 100,
  4000 and 70000 bytes of data ahead of its own, and the build fails (and removes the module) unless all print the
  same: a module whose results depend on where its data lands reads or writes memory it does not own. The modifiers
  module's is `tools/blender-port/check-modifiers.mjs` (every offered modifier on Blender's cube); the scene module's
  is `tools/blender-port/check-bmesh.mjs`, the unit tests that drive it (`editmesh-wasm`, `editmesh-menus`,
  `tools-wasm`, `objects-wasm`, `modifiers-wasm`, `outliner`, `anim-wasm`, `curves-wasm`, `armature-wasm`: startup, primitives,
  Edit Mode and its tools, modifier stacks, Object Mode operators, the Outliner, the animation editors, curves and text,
  armatures),
  run on the given build through `BYLONDER_BMESH_WASM`, about 8 s a run. `tests/export-live.test.js` runs the
  modifiers check on the committed module.
- **Size.** Measured: `modifiers.wasm` is 6.3 MB, 1.6 MB gzipped (`bmesh.wasm`, all of Blender's libraries but those past the seams: 59.2 MB, 16.5 MB gzipped), with
  the worker (13 KB). Built with OpenVDB's headers and every modifier type it was 11.4 MB,
  3.1 MB gzipped: OpenVDB's templates alone were a third of its code. What remains is mostly what `BKE_idtype_init`
  and `BKE_modifier_init` reach (every ID type's code) and RNA's static definitions; narrowing those to Mesh and
  Object is the next cut.
- **Shared code.** The app and the polyfill run the same JS on their modules: `bmesh/module-mesh.js` (memory, the
  extraction header, `evaluateModifiers`), `modifiers/dna-write.js` (settings into ModifierData by their DNA layouts)
  and `draw/mesh-batch-buffers.js` (a Mesh's draw buffers, without Babylon). So a live result is the applied export's
  geometry exactly. Two RNA properties can be one DNA field in two units (Bevel's `width` and `width_pct`): the
  writer writes defaults first, so the setting changed from its default is the field's value.
- **In the page.** The `modifiers` evaluator of the package's dependency table (`docs/controllable-exports.md`):
  `runtime/modifiers-evaluator.js` starts `bylonder-modifiers/modifiers-worker.js` (`polyfill/worker.js` bundled by
  `scripts/modifiers-polyfill.mjs` into `modifiers-worker.bundle.js`, which a test keeps current) with `modifiers.wasm`
  on the first set of a modifier setting; until then the applied geometry shows. Where there are no workers (Node), it
  imports the same module and calls its `handle` in its own thread.
- **What a live object carries.** An object whose shown modifiers are all Blender's (`modifiers.live(node)`) has each
  setting as a control by its RNA path (`objects["Cube"].modifiers["Subdivision"].levels`) and one `modifiers`
  operation reading them, with its base Mesh as the module takes it (positions, edges, face offsets, corner verts and
  edges, UVs) in `scene.bin` and its stack (ModifierType and the DNA layouts of its settings, so the page needs neither
  RNA nor DNA tables) (`io_scene_babylon/modifiers-export.js`). Objects with Bylonder's own modifiers (Array as
  Geometry Nodes), or whose modifiers read another ID (an Array's offset object, a Displace's texture), stay applied.
- **Animation.** A keyed modifier setting is sampled into the scene's animation group at a channel of its node,
  `metadata.bylonderChannels["<modifier index>:<path>"]`, which the page's controller turns into its control: a frame
  that changes it marks the stack's operation, which runs again in the worker, the newest settings winning; integers
  round as Bylonder's channels do. Nothing is compared per frame.
- **Checked.** `tests/export-live.test.js` runs Subdivision Surface, Array, Bevel, Mirror and Solidify set by path, and
  a keyed Solidify thickness at another frame, through the exported package (its worker run in Node), and compares
  them with the applied geometry; `tests/e2e/smoke.mjs` checks the zip.

## Shared foundations

Every subsystem builds on these, one of each:

- Blender's Python: `tools/blender-ui/tree.py` compiles Blender's whole `scripts/startup` and `scripts/modules` into `src/bl_py`, over a boundary of Bylonder's modules (`tools/blender-ui/boundary`: `_bpy` and the C modules, the module registry).
- Blender's C: one WebAssembly module (`tools/blender-port`), with one Blender world in it (Main, Scene, ViewLayer, bContext stand-ins) that every subsystem's data (meshes, curves, text, animation) lives in.
- Data: one RNA layer over Bylonder's data (`src/makesrna/rna-bylonder.js`) and one `bpy.context` (`src/blenkernel/context.js`).
- Operators: one registry by Blender idname (`src/windowmanager/wm-operators.js`); keys only from Blender's keymaps, which Blender's window manager runs where an area is the window's (Window manager) and `src/windowmanager/keyconfig.js` elsewhere; no hand-written keymaps. An editor runs its keymaps inside its context area (`inArea(area, ...)`), so operators act on that editor (`contextArea()`) and `wm.call_menu` opens the area's own menu (`area.menu(idname)`); editors never keep operator tables of their own.
- UI: menus through `src/editors/interface/ui-layout.js`; panels through one layout renderer, with one number field carrying Blender's drag behavior.

## Blender's Python tree

`src/bl_py` is all of Blender's `scripts/startup` and `scripts/modules` (283 modules), loaded whole: `bpy.main()` runs
Blender's startup, which registers its classes (2094: every menu, panel, header and Python operator) in
`_bpy.registered` (`tests/bl-py.test.js`). Decisions:

- Fixes are generic, in the transpiler (`TranscryptFixes` and `Walrus` in `transpile.py`, `runtime.js` for the runtime,
  applied to both pipelines by `finish()`), or in tree.py for what spans modules. Never edit `src/bl_py`.
- Tests take Python's truth (`_truth`): an empty list, set, dict or `bpy_prop_collection` is false, as JS's is not. A
  module's function assigned in a class body (`poll = keyingsets_utils.RKS_POLL_selected_items`) is a method.
- The tree's modules compile with operator overloading and iterable conversion (`opov`, `iconv`) for Python's
  semantics (list `+`, loops over iterators); Transcrypt's own library modules compile without.
- Module semantics: imported names are module attributes (re-exported); assigning a module's attribute
  (`bpy.context = ...`) calls its `__py_setattr__`; cycles become JS namespace imports; `__import__` and `globals()`
  look modules up in the registry.
- `bpy.context` and `bpy.data` are proxies over what Bylonder pushes (`_bpy._context_push(context, data)`), as Blender
  sets the window manager's context. Below them are the module's Context and Main (`setContextPointer` in
  `python/bpy_rna.js`); `inPythonContext(C, fn)` makes an area's context current while Python runs or draws in it
  (registered classes' callbacks, Run Script, the Python Console). `bl_rna` is `blRna(struct)` from the same RNA data.
- Python's library modules Transcrypt lacks are at the boundary (`boundary/`), as small as Blender's scripts need;
  values Blender's C reports (`bpy.app`, handlers, translation contexts, file extensions) are copied from the
  reference binary. `os` is a read-only file system of Blender's scripts in Blender's layout (`_files`).
- Blender's other presets (`scripts/presets/framerate`, `camera`, `cloth`, ...) ship as their sources, not compiled:
  `script.execute_preset` runs one with `bpy.utils.execfile` each time it is chosen, and the boundary's `importlib.util`
  runs its lines (imports and assignments such as `bpy.context.scene.render.fps = 60`) in `_py_eval`.

Consumers and running:

- `src/python/bpy_interface.js` loads the tree and exports `registered`, `menus`, `panels`, `headers`, `module(name)` and
  `setContext`. Menus, the Properties editor's panels, the 3D View's regions, the animation editors' headers, the tool system and the
  keymaps (`presets/keyconfig`) all come from these; the per-class transpile it replaced is gone (2026-10-28).
- Keying sets' types (`KeyingSetInfo`) register as Blender's types with the panels and operators, and a deferred
  property a script assigns to RNA's own type (`bpy.types.Object.selection_sets = CollectionProperty(...)`) is defined
  on it as `pyrna_struct_meta_idprop_setattro` defines one (`defineAssignedProperties`).
- Blender's Python operators register in Bylonder's operator registry by idname unless Bylonder registers its own
  (which then wins); they run as Blender runs one: an instance with its property defaults and the given values,
  `poll`, then `execute` (or `invoke` from an event) in `bpy.context`.
- `bpy.ops` is Blender's `ops.py` over the boundary's `_bpy.ops`, which calls Bylonder's registry; modules with a
  module-level `__getattr__` (PEP 562) are seen through it by their importers, also by `getattr` and `hasattr`
  (`getattr(bpy.types, menu_idname)` finds a registered menu).
- `eval` and `exec` of a snippet run in the boundary's Python interpreter (`_py_eval`), over the calling function's
  names and its module's; RNA's C functions on structs (`WindowManager.draw_cursor_add`) are in
  `tools/blender-ui/rna_functions.py`.

## Workspaces

The app opens in the Layout workspace: the window is Blender's (topbar, editors, status bar). Scripting is a workspace like Blender's, reached from the topbar's workspace tabs.

- The topbar has Blender's eleven default workspace tabs. A tab sets the scene window's screen (`dock.setScreen`, one layout per screen over the same areas): Scripting opens startup.blend's Scripting screen (see Scripting), Shading startup.blend's Shading screen (the File Browser over the Image Editor, the 3D Viewport in Material Preview over the Shader Editor, the Outliner over the Properties editor), UV Editing and Texture Paint the Image Editor (as the UV Editor, or in Paint mode) beside the 3D Viewport, Modeling and Sculpting startup.blend's screen of theirs (the 3D Viewport, the Outliner over the Properties editor), Geometry Nodes startup.blend's Geometry Nodes screen (the Spreadsheet beside the 3D Viewport over the Geometry Node Editor over the Timeline, the Outliner over the Properties editor), every other tab the Layout screen, until Bylonder has their editors (the asset shelf). As `ED_workspace_change` does, a tab whose workspace has another object mode than the last one's (startup.blend's `WorkSpace.object_mode`: Edit Mode for Modeling and UV Editing, Sculpt Mode for Sculpting, Pose Mode for Animation, Texture Paint for Texture Paint) sets it on the active object where the object has that mode and Bylonder has it. Each screen's 3D Viewport keeps its own shading and its Node Editor its own tree type. The project's JavaScript workbench (Monaco, files, the browser console) is Window > Toggle Project Code.
- Each area has Blender's one editor type selector, its header's (`ED_area_header_switchbutton`, Area.ui_type). Its menu is Blender's; an entry shows that editor in the area through the screen's layout (an `editor-type` event to `editors/screen/dock.js`, which swaps the editor in, as an area of Blender's would change its space), and the editors Bylonder does not have yet are greyed. Bylonder's own node editors (the Particle Node Editor and the Logic Editor) are node tree types registered as an add-on registers them (`registerNodeTree`), so Blender's menu lists them with its node editors. Decided 2026-11-01.
- The Layout screen is startup.blend's: its split positions are read from the file's area vertices (1920 x 1080) and kept as fractions, which Blender scales with the window; areas stay at least one header high. The topbar and status bar are fixed heights in pixels at UI scale, as Blender's global areas.
- Area geometry is Blender's (`areaSizes` in `editors/screen/dock.js`): a split's edge is a screen vertex at its fraction of the vertex range, rounded from the left or bottom (`screen_geom_vertices_scale`), and areas sit 2 px inside their vertices, 1 px below the topbar (`area_calc_totrct`), so areas are 3 px apart. At 1600 x 950 every area matches Blender's to the pixel.
- An editor whose header overlaps its main region (the 3D Viewport) is a dock item with `overlap`: its main region spans the area under the header, which takes the theme's translucent header color, so the view's projection is Blender's.
- The scene opens with the object that an add operator made last (`createPrimitive`) selected and active, as startup.blend's cube is, and a primitive's Mesh has all its elements selected, as `EDBM_op_call_and_selectf` leaves it.
- The status bar keeps Bylonder's richer text (run state, save state, type checking, scene statistics) where Blender shows its version only. Decided 2026-10-28.
- The topbar's right region is Blender's: the Scene selector and the View Layer selector (the scene window's view layers, set through `send`).
- Workbench controls sit where an add-on would put them. A project is Bylonder's .blend file: File > Open and Open Recent list projects, the window title names the open one. Running the project's JavaScript is Render > Run (Ctrl Enter). Project actions are File, Edit and Render menu entries.

## Scripting

Decided 2026-10-28. The Scripting screen is startup.blend's: the 3D Viewport over the Python Console and Info, the Text Editor, the Outliner over the Properties editor (Blender's two Outliners are one), split at its area vertices as Layout is; Info has no header there, as in Blender. The three editors are Blender's spaces in the scene window, where `bpy.context` and RNA live.

- The Text Editor is Blender's own `space_text` in the module: an area of Blender's window (`editors/screen/blender-area.js`) whose header Blender's uiLayout lays out and whose main region `text_draw.cc` draws, monospaced through `BLF_draw_mono`. Its input goes to Blender's window (`windowmanager/wm-areas.js`), which runs Blender's text operators with the Text keymaps; Blender's clipboard is the browser's (`clipboard.cc`, `windowmanager/wm-clipboard.js`). The page registers only what reaches outside Blender: `text.open`, `text.save`, `text.save_as`, `text.unlink` (which keeps `index.js`) and `text.run_script`, which starts Python and then runs Blender's own. Any editor that is Blender's own mounts the same way.
- The Python Console and Info are Blender's own spaces too (`space_console`, `space_info`), mounted the same way; the console's Python operators run in CPython (Python, below).
- Texts are Blender's Texts in Main and the project's text files (`blenkernel/text-files.js`): `bpy.data.texts` lists them (`index.js` too), and after edits the files follow Main's Texts (written, renamed, removed), as a .blend holds its texts. All are internal (`filepath` empty): Save needs a file, so it is Save As, which downloads the text; Open reads a local file into a new text.
- Reports: a finished operator with Blender's REGISTER option (`windowmanager/operator-register.json`, from `tools/blender-reference/operator-register.py`) reports its call as Python, Python operators report through `self.report`, and Run Script reports a failed script's traceback and moves the cursor to its line. Info lists them (`windowmanager/wm-reports.js`). `print` goes to the system console, the browser's, which the project's workbench shows.

### Python

Decided 2026-11-01. Two Pythons run Blender's scripts in one Blender. The interface is the transpiled tree (above: fast
to draw, ready at startup). Scripts, the Python Console and user add-ons run in CPython 3.13.13 (Blender's pin), built
for wasm32-wasi into the module itself, in the same linear memory, with Blender's own `bf_python`: `bpy` (`bpy_rna`,
`bpy_props`, `bpy.ops`, `bpy.app` and its handlers and timers), `mathutils`, `bmesh`, `idprop`, `bl_math` and `blf`, and
numpy 2.3.4 statically linked. A script's `bpy.data` and `bpy.context` are Main and the window manager's context, as in
Blender.

- **Built from source** as manifest dependencies (`tools/blender-port/manifest.json`, built by `tools/blender-port/deps/`):
  CPython by its own configure with `Tools/wasm/config.site-wasm32-wasi` on the module's clang and wasi-libc, against the
  module's own zlib and expat (the libraries Blender's image code links, so each is linked once), numpy by its own meson as a cross build. wasm32-wasi has no shared libraries: each numpy extension
  module is linked from its objects as its shared library would be, its definitions made local but its `PyInit` function
  (`wasm_weaken.py`), and they are CPython built-in modules by package name (`numpy._core._multiarray_umath`). Blender
  is configured with `WITH_PYTHON` (`configure_host.sh`), the host's Python headers replaced by the module's CPython's
  (`host_include`). The `gpu` module is left out (the GPU module is past the seam).
- **Its files** ship beside the module, fetched on first use: `python313.zip` (CPython's library and numpy, compiled,
  with their sources), read in place by zipimport at Blender's system Python directory, and `scripts.zip`, Blender's
  `scripts/modules`, `startup`, `addons_core` and `presets`, unpacked at Blender's system scripts directory
  (`/blender/scripts`, `ghost-paths.cc`), as an installed Blender has them.
- **Lazy start.** Python is never started at startup nor in the module's snapshot. `src/python/python.js` starts it when
  a script runs, a Python Console is shown, a Python driver is evaluated, Preferences' Add-ons or Extensions section
  opens, or a file whose drivers or registered texts need it is read (where scripts may run automatically, Blender's
  `G_FLAG_SCRIPT_AUTOEXEC`; otherwise they are blocked as in Blender). Until then Blender's calls into Python act as
  Blender without Python (`python.cc`, `--wrap`): a typed value's expression is evaluated by Blender's
  `expr_pylike_eval.cc`, simple driver expressions too, as in Blender. `python_start` runs what Blender's `WM_init`
  runs: `BPY_python_start`, `BPY_python_reset`, then importing `bpy` loads the startup scripts and
  `bpy.utils.load_scripts_extensions()` the add-ons and extensions Preferences enable. Blender's scripts ship as
  scripts.zip and its core add-ons (glTF 2.0, FBX, Motion Capture, SVG, ...) as addons.zip, both fetched when Python starts. Blender's startup packages
  (`bl_ui`, `bl_operators`) ship as modules there, importable but not registered (the interface they define is the
  tree's); the one startup script is Bylonder's (`tools/blender-port/python/startup/bylonder_cpython.py`).
- **One registry.** Both Pythons register their classes through RNA's register functions (`rna_wm.cc`, `rna_ui.cc`),
  each extension carrying its own Python's call (`bpy_class_call`, or `rna-bridge.cc`'s for the tree). Blender's code
  calls each class back in its own Python; the module's window manager runs every operator and the page draws every
  panel, header and menu through the module's uiLayout (`ui-tree.cc`), so a script's operators, panels, menus, headers,
  UI lists and properties appear and work like Blender's. A type's Python slots (`StructRNA.py_type`, an operator's
  `py_instance`) are CPython's, as in Blender; the tree keeps its classes and instances in JS. An operator class's
  properties are defined by the Python that registered it (`python.cc`, `BPY_RNA_operator_wrapper`).
- **Across the two.** A function a script adds to a type the tree registered (`bpy.types.VIEW3D_MT_add.append(fn)`)
  draws in that type's layout before or after the tree's own draw (`python_draw_added`). Key maps a script adds go into
  the window manager's add-on key configuration, which Blender merges into the user's.
- **What runs Python itself registers in CPython** when it starts (its startup script), replacing the tree's classes of
  the same names: the console's operators (`bl_operators/console.py` with `_console_python`), the operators that
  manage add-ons (`bl_operators/userpref.py`) and Preferences' add-on and extension panels, which list add-ons through
  Blender's `addon_utils`. Then the add-ons and extensions Preferences enable load (`bpy.utils.load_scripts_extensions`),
  among them Blender's `bl_pkg`, whose Install from Disk installs a `.py` add-on or an extension's `.zip` into the user
  directory (`/user/5.2`, kept by the browser). WebAssembly starts no process, so `bl_pkg`'s command line tool
  (`cli/blender_ext.py`) runs in the same interpreter (a `port-override` in the startup script).
- **Editors.** The Text Editor's Run Script and the Python Console are Blender's own spaces (`space_text`,
  `space_console`) and operators in the module.
- **WebAssembly's indirect calls check signatures**: CPython calls a `METH_NOARGS` function with two arguments, so
  Blender's that are defined with one would trap; `wasm/patches/python_noargs.patch` (written by a script from the
  method tables) gives them the unused second one, defaulted so direct calls stay as they are.
- **Start in steps**: Python starts in Blender's order, one step per task, so the page keeps drawing
  (`python.cc` `python_start_step`): `BPY_python_start`, `BPY_python_reset`, then `bl_ui`'s and `bl_operators`' modules
  one each, Bylonder's startup classes, the extension repositories and each enabled add-on (`bylonder_cpython.py`).
- **Open: a trap seen once in mathutils.** With `bl_ui` and `bl_operators` entered as empty package modules (in
  `sys.modules` without their `__init__` ever running, a shortcut the start no longer takes), a script ending with
  `mesh = bpy.data.meshes[0]` and `view = memoryview(mesh.vertices[0].co)` traps when its namespace is freed: the
  memoryview's release frees the Vector, whose `BaseMathObject_dealloc` calls a `tp_free` that is no function. With
  their `__init__` run, as now, it does not happen, and a memoryview of each mathutils type leaves the value's reference
  count as it was (`tests/python-wasm.test.js`). Not yet explained: something a skipped `__init__` would have kept alive
  is freed early.
- **Limits**: one thread (`threading` starts no thread), no `ctypes`, no network (`urllib` and pip do not reach out), no
  `gpu` module (draw handlers that draw with GPU shaders draw nothing).

### File dialogs

Decided 2026-11-02. Blender's File Browser for an operator (`fileselect_add`: Install from Disk, an add-on's ImportHelper
or ExportHelper, Open Image, the importers and exporters) is the browser's own file dialog, one implementation for every
caller (`tools/blender-port/wasm/fileselect.cc`, `src/windowmanager/wm-fileselect.js`). Blender's
`WM_event_add_fileselect` runs and its handler keeps the operator; the event that would open the File Browser area is
taken back and the page shows the dialog, filtered by the operator's `filter_glob` (several files when it has `files`,
a directory picker when it takes a directory). The chosen files go into the module's file system and the operator gets
`filepath`, `directory`, `filename` and `files` as the File Browser sets them, then the File Browser's execute (or
cancel) event, from the operator's area. A saving operator (one with `check_existing`, as ExportHelper's) writes into the
file system and the file goes where the user chose (the File System Access save picker) or downloads. An operator that
browses inside a .blend (Link and Append) gets Blender's own File Browser over the chosen file (Link and Append).

## Menus

Menus drawn from Blender's scripts show every entry Blender's draw makes. An entry whose operator Bylonder does not run yet is greyed out, as Blender shows an operator whose poll fails. Its shortcut is Bylonder's binding if there is one, else Blender's: `windowmanager/keyconfig.js` reads Blender's default keymap (`keymap_data/blender_default.py`, transpiled) in the keymaps the editor's handlers run, in order. A binding gives an operator button its shortcut only when its properties are the ones the button sets, as Blender's buttons compare them (`WM_key_event_operator_string`, strict), then the ones set away from their defaults; an operator's own `keys(props)` binds the properties it reads (`menuUI` in `wm-operators.js`). So File > New's templates, which set `app_template`, show no Ctrl N; File's New entry shows the Ctrl N that opens it.

Context menus are Blender's too, decided 2026-10-28: right click runs the editor's keymaps, whose `wm.call_menu` opens the context menu of the editor and mode (`VIEW3D_MT_object_context_menu`, `VIEW3D_MT_edit_mesh_context_menu`, `OUTLINER_MT_object`, `GRAPH_MT_context_menu`, `TEXT_MT_context_menu` and so on) from the context area's `menu(idname)`. A property button's right click is `ui_popup_context_menu_for_button`'s menu (`propertyMenu` in `layout-view.js`): keyframes, reset to default and copy data path. An area header's is `screen.region_context_menu`'s header tools (`ED_screens_header_tools_menu_create`), whose screen operators act on that area through the dock. Menus and dialogs Blender builds in C are never ported: the module records them and the web draws the recording (`windowmanager/wm-popups.js`). A menu type Blender's C defines (`OBJECT_MT_move_to_collection`) is drawn by `menu_type_draw` when no Python menu has its name; a popup menu an invoke builds (`popup_menu_begin` to `popup_menu_end`, as `parent_set_invoke_menu` does) comes back as the invoke's popup; each records its items through `panel-layout.cc`'s layout, an operator item with the properties Blender's code set on it, and a sub-menu (`menu_fn`, or a C menu type with the layout's context pointers) drawn by `layout_submenu_draw` when it opens. A properties dialog (`WM_operator_props_dialog_popup` and the popups that wrap it) is the operator's properties as its dialog draws them (its type's `ui`, else its visible properties), bound to the running operator in the module (`moduleOperatorProperties`), with Blender's confirm text; confirming runs that operator. Object Mode's operators run this way through `BlenderMain.invoke` with the event that ran them (`editors/object/object-operators.js`), and the animation editors' popups through the same module. Not yet: the Node Editor's `NODE_MT_context_menu`.

## 3D View regions

The toolbar, tool settings, header transform settings and sidebar are Blender's scripts, transpiled whole where they are systems.

- Tool system: `space_toolsystem_common.py` and `space_toolsystem_toolbar.py` are transpiled as whole modules. The tools are Main's workspace's (`WorkSpace.tools`, bToolRef per mode, set up by `wm_toolsystem.cc` in the module) with the scene's `workspace_tool_type`; `windowmanager/wm-toolsystem.js` runs Blender's Python in a 3D View's context (in the mode Bylonder edits in, until Edit Mode is Main's) and reads each tool's keymaps and gizmo group back (`bpy_tool_runtime`): `draw_cls` draws the toolbar, `activate_by_id` sets the tool, `wm.tool_set_by_id` cycles, and the tool header is Blender's `VIEW3D_HT_tool_header` over those tools. The active tool's keymaps run before the mode's, in the order of `wm_event_get_keymap_from_toolsystem_ex`, including the fallback tool's keymap off the gizmo, with the tool's stored operator properties. Blender's keyconfig loads with the preference defaults of `Blender.py` (left click select, fallback tool on).
- Tool icons are Blender's `.dat` triangle files, converted to SVG by `tools/blender-ui/tool_icons.py`.
- The toolbar (`editors/space_view3d/view3d-toolbar.js`) records `draw_cls`'s layout calls and draws Blender's one icon column: groups open their flyout on a 0.2 s hold or a drag, the region snaps to Blender's widths.
- The Transform panel is C (`view3d_buttons.cc`). It is ported as the layout calls it makes (`view3d-buttons.js`), not built to WASM: it only reads and writes RNA, so the layout calls are the whole of it.
- The header (`VIEW3D_HT_header`, with its visibility, gizmo, overlay and shading popovers), the tool settings and the sidebar draw through the shared layout renderer (see Layouts and panels), from `view3d-regions.js`. In Edit Mode the header's menus are Edit Mode's (`editMeshMenus`), its Add menu adds Bylonder's primitives, and `template_header_3D_mode` is the select mode buttons (`uiTemplateEditModeSelection`), a layout the template records. `object.mode_set` runs Object and Edit Mode, and Blender's code on Main runs Particle Edit and Sculpt Mode; a mesh's other modes show greyed.
- Sculpt Mode is Blender's on Main (`editors/object/main-modes.js`): entering it activates Blender's default brush, the Essentials Draw brush linked from `essentials_brushes-mesh_sculpt.blend` (shipped with the datafiles), and the default tool (`builtin.brush`). The tool header is Blender's (`VIEW3D_HT_tool_header`: the brush asset selector `VIEW3D_AST_brush_sculpt`, Size, Strength, Direction and the Brush, Texture, Stroke, Falloff and Cursor popovers), and the toolbar has the sculpt tools. A left drag runs `sculpt.brush_stroke` from Blender's Sculpt keymap in Blender's window, and the view draws the stroke from the object's Mesh as Blender's engines draw its `pbvh::Tree` (`object_mesh_eval`, after `draw_sculpt.cc`). Checked against Blender 5.2 (`tests/sculpt-wasm.test.js`, `tools/blender-reference/sculpt-fixtures.py`): the brush, its settings and a stroke on Suzanne match. Not yet: the asset shelf region at the bottom of the view (the brush is picked from the tool header's selector), the brush cursor, and the face set, mask and dyntopo overlays.
- Transform orientation slots are stored per scene but no transform reads them yet.
- Select Box, Circle and Lasso share `do_mesh_region_select` (`view3d-select.js`) in Edit Mode; in Object Mode box select tests vertices and circle and lasso the object origin, as Blender does. The gestures are `windowmanager/wm-gesture-*.js` with Blender's modal maps.

## 3D View tools

Decided 2026-10-28. A tool is what Blender's is: its keymap, its gizmo group and its stored settings. Its operators are registered by Blender idname; nothing is wired to a tool by name.

- Gizmo map: `windowmanager/wm-gizmo-map.js` shows the active tool's gizmo group, highlights the part under the pointer and runs the group's handler before the region's keymaps, as `wm_gizmo_map.cc` does. Its state (shown, highlighted) feeds the tool system's keymap order. The groups are ports: `VIEW3D_GGT_ruler`, `VIEW3D_GGT_placement`, `VIEW3D_GGT_tool_generic_handle_free` and `_normal` (a handle runs the tool's own keymap, as `gz->keymap` does) and `VIEW3D_GGT_xform_extrude`. Babylon's gizmos stay the transform gizmos. Gizmos, rulers, annotations and the placement grid draw on one 2D canvas per view (`draw/overlay-tool.js`) in the theme's colors.
- Object Mode tools: `editors/space_view3d/view3d-tools.js` registers `view3d.cursor3d` (`view3d-cursor.js`, with Blender's surface depth and orientations), `transform.from_gizmo`, `view3d.ruler_add` and `view3d.ruler_remove` (`view3d-gizmo-ruler.js`), `gpencil.annotate` (`editors/gpencil/annotate.js`, all four modes) and `view3d.interactive_add` (`view3d-placement.js`). The cursor is `scene.cursor` (`View3DCursor`), drawn by `draw/overlay-cursor.js`.
- Annotations are Blender's data model in a document slice (`blenkernel/gpencil/annotations.js`): layers holding frames of strokes. Rulers are strokes of the hidden `RulerData3D` layer, as Blender stores them.
- Gizmo bridge: the module's regions have a stand-in gizmo map with no groups (`editor-context.cc`); the gizmos are Bylonder's (`view3d-gizmo-mesh.js`), each group type's properties a struct named after it (`GIZMO_GROUP_PROPERTIES` in `rna-bylonder.js`), so tool settings draw them. Edit Mode on Main has no preselection gizmo yet, so Poly Build and the Loop Cut preview do not run, and the redo gizmos operators ask for (Spin's, Bisect's) are not shown.
- Straight-line gestures are `wm_gesture_ops.cc`'s (`gesture-api.cc`); in Edit Mode on Main Bylonder does not draw their line, or the mouse line of Inset and Bevel, yet.
- A drag event (CLICK_DRAG) carries the mouse where the drag passed the threshold, as Blender's does; `dragStart(event)` gives the press, for what Blender places at the drag's start (rulers, placement, box gestures, the cursor's transform, gizmo highlighting). An operator returning `FINISHED|PASS_THROUGH` (Set 3D Cursor) handles a press as Blender's `WM_HANDLER_HANDLED` does: no click follows, a drag still can.
- `tests/tools-wasm.test.js` drags the Edit Mode tools on Blender's startup cube as `tools/blender-reference/tool-fixtures.py` drags them in Blender (real input, Drag: Active Tool) and compares the meshes.

## Layouts and panels

One recorder and one renderer draw every layout from Blender's scripts: panels, headers, popovers and the C panels whose layout calls are recorded (modifier panels from `panel-layout.cc`, the 3D View's Transform panel).

- `editors/interface/layout.js`: `UILayout`, Blender's layout API as a recorder. Each call adds a node `{ kind, ...arguments, ...layout settings }`; sub-layouts hold `children`. Unknown `template_*` calls record their name and arguments.
- `editors/interface/panels.js`: `panelTypes(modules, { space, region })` gives a region's panel types in Blender's registration order (bl_parent_id, bl_order, HIDE_HEADER first); `drawPanels(types, context, { contexts, open })` runs poll, draw_header, draw_header_preset and draw into layouts; `headerLayout(context, draw)` lays out a header row.
- `editors/interface/layout-view.js`: the Vue renderer. `h(LayoutView, { layout, ui })`, `h(PanelView, { panel, ui })`, `h(RegionView, { panels, ui })`. `ui` is what the widgets need from the editor (undo push, operators, menus, popovers, panel open state, ID lists, animation); the file's header lists it.
- Header layouts (`headerLayout`, root type HEADER) are of variable size as Blender's: menus are flat pull-downs, properties keep the width `item_rna_size` estimates (scaled by their layouts' `scale_x`), and sub-layouts keep their size; elsewhere sub-layouts in a row share its width.
- Icons draw 1600 units of their SVG at the icon's size, centered (`blf_glyph_cache_add_svg`); `icon-sizes.json` (from `tools/blender-ui/icons.py`) lists the documents of other sizes, and `iconStyle(name)` in `icon.js` sizes the mask.
- Widgets follow `interface_layout.cc` and `interface_widgets.cc`: property split at 0.4 with the row hack that puts later items in the value column, the checkbox exception, decorators, array names above their fields, expanded enums in the layout's direction, and Blender's spacing. Numbers are one component, `components/ui/number-field/NumberField.vue`, with Blender's drag behavior.
- Adjust Last Operation is the HUD region's panel (`editors/interface/hud.js`, after `ED_area_type_hud`): the last operator's properties in RNA's order, hidden ones left out, drawn by the same renderer with property split and re-running the operator on a change. Add's object and Edit Mode's operators use it; Babylon builders' options are a struct of defined properties.
- Property metadata (names, ranges, units, enum items) is Blender's RNA: `rna-ui.json` (from `tools/blender-reference/rna-structs.py`) through `rnaProperty(struct, name)`, and `rna-operators.json` for operator properties. `bl_rna` and `rna_type` give `blRna(struct)` on the same data.

## Properties editor

The Properties editor (`editors/space_buttons/editor.js`) is Blender's `space_properties.py` and every `properties_*.py`, transpiled whole (manifest globs), drawn through the shared renderer.

- Tabs and the shown tab are `buttons_context.cc`'s (`buttons-context.js`): the tabs come from the context per object type, the user's choice is kept as `mainbuser` and the first available tab shows while the data lacks it.
- Bindings are in `rna-bylonder.js` only: Object (with Light, Camera, Empty, Text and Curve data), World and Material node inputs, Scene, render and view layer settings. Unbound properties read greyed at Blender's defaults.
- Lights and cameras are objects as Blender's are: `runtime/object-transform.js` gives them a rotation and scaling, so selection, transform and undo use one path.
- Modifier panels are the module's C layouts (`modifier-panel.js`) in the same node shape. Bylonder's own panels go after Blender's, as add-on panels (`addon-panels.js`).
- Keys run Blender's Property Editor keymap inside the editor's area (`inArea`).

## Node editors

The Shader Editor and Compositor build on the same foundations: Blender's node declarations and GLSL run as runtime-registered Babylon blocks, and the editor's Add menu and keys are Blender's menus and keymaps. See `docs/node-editors.md`.

## Using it

    const host = { world, selection: editor.selection, update: () => { ui.refresh(); views.wake(); }, undoPush: () => history.commit() };
    const r = createRNA(host);
    const ui = menuUI({ menus, context: () => createContext(r, { space: view }), prop: propBinding(host) });

`tests/context.test.js` draws `VIEW3D_MT_editor_menus` and all its submenus in Object and Edit Mode over a NullEngine scene, and checks that bound properties read and write through.

## Next

- The 3D View's Object Mode Select and Object menus are Blender's, over `createContext`, running Bylonder's actions by the operators they name (`editors/object/object-operators.js`). Next: View and Add.
- Properties editor: popovers in panels other than the 3D View's, template_list filtering and sorting, multi-drag of number fields, light type changes (Bylonder replaces the Babylon light), the Collection tab for the master collection.
- The topbar's scene properties across windows (decision 7).
- Mesh element collections.
