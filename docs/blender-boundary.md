# Blender boundary

How Blender's code sees Bylonder's data. Two parts of Bylonder are Blender's own code: Blender's Python in `src/bl_py` (all of its scripts, compiled by Transcrypt), which read `bpy.context` and RNA, and the C++ in `src/bmesh/bmesh.wasm`, which reads a `bContext` and DNA. Decided 2026-10-27.

## Decisions

1. **One RNA layer over live data.** `src/makesrna/rna-bylonder.js` binds Blender structs to Bylonder's objects, with no copies. Each struct is a table from Blender's property name to `{ get, set }`, or to a getter for a read-only property, so a new binding is one line. What a table leaves out reads as Blender's default (`src/makesrna/rna.js`, from `rna-structs.json`, dumped from Blender 5.2.3): a pointer as None, or as a struct of defaults where Blender's is never None, a collection as empty, a value as its default.
2. **Blender's values in Blender's axes.** Babylon's (x, y, z) is Blender's (x, z, y), as for Mesh data. A Babylon Euler rotation about x, y, z, applied z first, is a rotation about Blender's -X, -Z, -Y: Blender's YXZ order. So `rotation_mode` reads `YXZ` (or `QUATERNION` for a node with `rotationQuaternion`), `rotation_euler` is (-rx, -rz, -ry) and `rotation_quaternion` is (w, -x, -z, -y). These are exact, so values round trip. Bylonder's own UI keeps Babylon's axes (`babylon-blender.md`).
3. **One struct per owner.** `createRNA(host).pointer(struct, owner)` keeps one struct per owner, so `context.object` is `context.active_object` and `ob.data` is the same each time.
4. **Writes, updates and undo.** A write is RNA's set and update: it goes through the owning slice's method that does not commit (`time.configure(..., { record: false })`, `sceneSettings.set(..., false)`, `modifiers.set(..., { finish: false })`) and then calls `host.update(struct, name, owner)`, Blender's notifier, so the host redraws. Undo steps are pushed by the UI that made the edit (`host.undoPush(name)`), as Blender's buttons push them; a script or operator writing RNA pushes none. `propBinding(host)` gives `layout.prop` the bound booleans, as check items whose edits are undo steps. A read-only property throws on write, as Blender raises. A write to an unbound property stays on that struct and reaches nothing.
5. **A context per editor and region.** `createContext(r, { area, region, space })` (`src/blenkernel/context.js`) builds `bpy.context` for one editor: `window`, `screen`, `area` (type, `show_menus`), `region`, `space_data` (the editor's own data, a 3D Viewport's view for `SpaceView3D`), `region_data` (`RegionView3D` in a 3D Viewport's window region), `scene`, `view_layer`, `tool_settings`, `preferences`, `blend_data`, `mode`, `object`, `active_object`, `edit_object`, `selected_objects`, `selected_editable_objects`, `visible_objects`, `selectable_objects`, `editable_objects`, `objects_in_mode` and `objects_in_mode_unique_data`. Members outside Context's RNA that the editor lacks (`sculpt_object`, `pose_object`) are None, as in Blender. `drawMenu` makes it `bpy.context` while drawing, and `bpy.data` takes its `blend_data` (scenes, objects).
6. **The active object** is the object in Edit Mode, else the last selected. Blender's can be unselected; a `selection.active` would make it exact.
7. **Windows.** A context is built in the window that holds the data it reads: the scene window (3D Viewport, Properties). The app shell (topbar) holds no scene. Its menus read shell state, plus a snapshot of the scene properties they read, posted by the scene window; a write goes back through `send` as an RNA path and value (`scene.render.fps`), applied with the same bindings. Not built yet.

## Mapping

| Struct | Owner | Bound | Blender's defaults |
|---|---|---|---|
| Object | a Babylon node in `world.objects` | `name`, `type` (MESH, EMPTY, CAMERA, LIGHT, FONT, CURVE), `mode`, `data`, `location`, `rotation_mode`, `rotation_euler`, `rotation_quaternion`, `scale`, `parent`, `children`, `modifiers`, `material_slots`, `active_material`, `hide_select`, and the functions `hide_get`, `hide_set`, `visible_get`, `select_get`, `select_set` | vertex groups, constraints, delta transforms, display settings |
| Mesh | the same node, which holds its mesh | `name`, `total_vert_sel`, `total_edge_sel`, `total_face_sel`, `count_selected_items()`, from the edit mesh in Edit Mode | element collections (Babylon's split vertices are not Blender's; later from the object's Mesh data) |
| Modifier | a record of the stack (`metadata.wbModifiers`) | `name`, `type`, `show_viewport`, `show_render`, and a Blender modifier's settings by RNA identifier | Bylonder's own types (Array as Geometry Nodes) are `NODES` |
| Scene | the world | `name`, `frame_current`, `frame_start`, `frame_end`, `frame_step`, `use_preview_range`, `frame_preview_start`, `frame_preview_end`, `sync_mode`, `camera`, `objects`, `use_gravity`, `gravity`, `render`, `unit_settings`, `tool_settings` | keying sets, rigid body world, audio |
| ToolSettings | the world | `mesh_select_mode`, `use_keyframe_insert_auto` | snapping and proportional editing (Bylonder has no toggles; Ctrl snaps during a transform) |
| RenderSettings | the render slice | `fps`, `resolution_x`, `resolution_y`, `resolution_percentage`, `use_motion_blur`, `motion_blur_shutter`, `use_sequencer` | `engine` (Babylon is not one of Blender's engines) |
| UnitSettings | the scene slice's `unitSettings` | `system`, `scale_length`, `use_separate`, `system_rotation`, `length_unit` | mass, time and temperature units |
| SpaceView3D | a 3D Viewport's view | `type`, `shading`, `overlay`, `region_3d` | `show_gizmo` and the rest |
| View3DShading | the view's state | `type` (WIREFRAME, SOLID, RENDERED), `show_xray` | lighting, color, cavity |
| View3DOverlay | the view's state | `show_overlays` | grid, floor and the other overlay toggles |
| RegionView3D | the view | `view_perspective`, `is_perspective` (read only) | matrices |

## The WASM side

The module (`src/bmesh/bmesh.wasm`) runs Blender's C++ in two worlds. Both answer the context as Blender does, run operators by their own exec (`operator_exec` on a `bContext`) and take their properties through `operator-properties.cc`, which gives operators and DNA structs RNA by identifier.

- **Edit Mode** (`editor-context.cc`, JS `EditMesh`): a Scene with one Object in Edit Mode, whose edit mesh (BMesh) lives in the module and is the truth while editing.
- **Blender's data** (`main-api.cc`, JS `BlenderMain`): a `Main` holding objects and their data, one Scene with ToolSettings and one ViewLayer whose Bases hold the selection and the active object, and a window whose screen answers context members through Blender's own `screen_context.cc` (`selected_editable_objects`, `active_object`, ...). Blender's `layer.cc` runs on these Bases. The depsgraph is a stand-in: each ID is its own evaluated copy, `main_evaluate` computes world matrices parents first (`BKE_object_where_is_calc`), and `DEG_id_tag_update` leaves its tags on the ID (`recalc`).

### Who owns what

Decided 2026-10-28 (replaces the mirror made per operator). Bylonder's Babylon scene is the source of truth and
renders; Blender's Main runs in parallel as a second, always accurate model of the same scene, so Blender's code
(operators, editors, depsgraph, `.blend` writing) works on real data at any time. Each model holds what the other has
no counterpart for; the overlap is kept equal both ways.

1. **One mapping, both directions.** Every synced property is declared once, by its RNA name, with its Babylon
   accessor (`rna-bylonder.js` and the subsystem's bindings), in Blender's axes (Babylon's (x, y, z) is Blender's
   (x, z, y)). The same declaration reads and writes in both directions; no subsystem has sync code of its own.
2. **Babylon to Blender, by setter hooks.** A write to a synced Babylon value (an object's transform, a mesh's
   geometry, a light's color) goes to Main at once, through the mapping. Objects and data that come or go in Babylon
   are added to or removed from Main the same way.
3. **Blender to Babylon, by recalc tags.** After Blender's code runs, what it tagged (`ID_RECALC_TRANSFORM`,
   `_GEOMETRY`, `_SHADING`, `_SELECT`, ...) is written to Babylon through the same mapping, inside the operator's
   undo step. Writing back does not echo to Main.
4. **Both models are accurate at every moment.** Everything but large buffers (point 5) is held live on both sides
   and kept equal through the mapping: transforms and settings, curve and text data, modifiers, collections, textures,
   material settings, animation. Babylon's own data (node materials, GPU effects, what project code builds) is in Main
   as custom properties where a round trip needs it; Blender's own data is on the Babylon side in RNA's terms, on the
   object or scene it belongs to, so Bylonder's undo and project save carry it. No state is filled in only on demand
   except large buffers, so neither model is ever stale.
   **Animation is Blender's.** Blender's animation system is the richer one, so Actions (layered, with slots, F-Curves,
   F-Modifiers, drivers) are edited and evaluated by Blender's code in Main (`animrig`, `evaluate_fcurve`); the Babylon
   side mirrors them live as their RNA record (for undo and save) and as Babylon Animations and AnimationGroups made
   from them, so Babylon-native playback and export work without Blender's runtime. The viewport shows Blender's
   evaluation; Babylon's animations are exactly derived from it, never edited on their own.
   Decided 2026-10-28.
5. **Large data has one owner.** Mesh geometry (and other large buffers: attributes, images) lives in the Babylon
   scene only, never as a second copy that is kept in sync. Main's Mesh holds no geometry at rest: when Blender's code
   needs it (an operator, a modifier evaluation, writing a `.blend`) it is filled from Babylon for that use and released
   after, and what the code changed goes back to Babylon. Edit Mode is the exception Blender itself makes: while a mesh
   is edited, its BMEditMesh in the module owns it, Babylon's mesh is only drawn from it, and Babylon owns it again
   on leaving Edit Mode.
6. **Checked.** A test mode compares the overlap of both models after every operator and edit; a difference is a bug.

What this is for:
- **Save a `.blend`** from Main with Blender's own writer, which renders well in desktop Blender.
- **Export for Babylon:** a `.babylon` file, or JS initialization code per object, that runs anywhere Babylon does.
  Modifiers are applied, as Blender's glTF exporter applies them; later, a polyfill of just the modifier kernels
  can evaluate them live without the rest of Blender.

### The scene sync

`src/blenkernel/main-sync.js` (`createMainSync({ rna, ids })`, one per world, `world.mainSync`) is the one sync; Object
Mode's operators, the Outliner, the animation editors and Edit Mode go through it, and nothing else writes Main from
Babylon.

- **The mapping.** A binding in `rna-bylonder.js` with `sync: true` (or a test of its owner, as `rotation_euler` is
  synced unless the node has a quaternion) is written in Main at the DNA field Blender's RNA names for that property
  (`dna-struct.js` over `dna-outliner.json` and `dna-data.json`, from `modifier_dna.py`). `syncBindings(r, struct,
  owner)` lists them. Synced: Object `location`, `rotation_mode`, `rotation_euler`/`rotation_quaternion`, `scale`,
  `hide_select`, `hide_render`, `hide_viewport`; Light `type`, `color`, `energy`, `shadow_soft_size`, `use_shadow`,
  `spot_size`, `spot_blend`; Camera `type`, `sensor_fit`, `lens`, `lens_unit`, `clip_start`, `clip_end`; Material
  `diffuse_color`, `metallic`, `roughness`, `use_backface_culling`, `alpha_threshold`, `surface_render_method`; World
  `color`; Scene `frame_current`, `frame_subframe`, the frame ranges, `use_gravity`, `gravity`; RenderSettings `fps`,
  resolution and motion blur; UnitSettings; ToolSettings `use_keyframe_insert_auto`; Collection and LayerCollection
  flags. An enum whose items Blender makes per call (`length_unit`) stays Main's own.
- **Relations** have no DNA value and are written by the sync under the same RNA names: ID names (Blender's unique
  name, "Cube.001" for a second "Cube", counts as equal), `parent`, `mode`, the object's data of its type, bases
  (selection, active, hidden), material slots, the modifier stack (Blender's modifiers, `dna-modifiers.json`),
  collections and their objects and children, the scene's camera and world, and node trees: a Material is the
  Principled BSDF tree and a World the Background tree its RNA `node_tree` binding describes (`shaderTree`), built by
  idname (`BlenderMain.setNodeTree`); Blender's node types take them over when the file is read.
- **The rule for relations.** An object's RNA pointer or collection property is one entry in `RELATIONS`
  (`main-sync.js`): the IDs Babylon says it should hold (`babylon`), what Main holds (`main`), a `set` that calls the
  BKE function Blender's RNA setter calls (`object_parent_set`, `BKE_object_material_array_assign`), and an `apply`
  when Blender's code may change it. Push, write-back and `check()` go through that table, so a new kind adds no code
  elsewhere. Debt: the modifier stack, bases, collections and node trees still have their own routines, and the module
  has no RNA runtime to call Blender's generated setters by path.
- **Babylon to Main.** `main-sync-hooks.js` wraps the setters an object's synced bindings read (a vector's or
  quaternion's dirty flag, a color's channels, `name`, `parent`, `metadata`, a light's or camera's fields, the enabled
  state): a write marks the object, and a microtask flushes the marked ones (`flush(false)`). `flush()` writes
  everything that differs from what was last synced, and runs before any of Blender's code; slices without hooks
  (collections, materials, worlds, modifiers) call `changed()`.
- **Main to Babylon.** `run(fn, { meshes })` flushes, fills the geometry of `meshes`, runs `fn` (Blender's code), then
  writes back: geometry tagged `ID_RECALC_GEOMETRY`, and every synced value that differs from what was last synced
  (this also catches what Blender's buttons write without a tag), through the bindings' setters, with hooks muted so
  nothing echoes. Editors that run Blender's code over several events call `flush()` before and `writeBack()` after.
  `revert()` makes Main Babylon's again (an operator Bylonder refuses).
  Values Blender evaluates in Main (drivers, later) reach Babylon the same way: `pull(record, owner)` sets each synced
  binding whose Main value changed.
- **Geometry** (point 5): Main's Meshes are empty at rest, the only data Main holds on demand. `run`'s `meshes`,
  `withMeshes(fn)` and `evaluatedMesh(node)` fill them from Babylon's Mesh data (`wbCreation.mesh`, or the edit mesh's
  while in Edit Mode, `editMode.meshOf`) and release them after. A curve's or text's Curve data is live in Main like any
  value (`pushCurve`, from `world.curves`), and comes back when Blender's code tags its geometry.
- **For exporters:** `sync.evaluatedMesh(node)` is an object's Mesh with Blender's modifiers applied (Main's stack,
  `mesh_create_eval_final`), in Blender's axes. Bylonder's Geometry Nodes Array is applied there as Blender's Array
  where its settings map (below); Bylonder's other modifier types are not Blender's and are not applied.
- **Custom properties** keep what only Babylon has: `bylonder_id` on objects, `bylonder_material` (the material's
  kind) and `bylonder_node_material` (a node material's graph, as Babylon serializes it) on materials.
- **Checked.** `check()` lists the differences of the overlap (values, names, parents, bases, slots, node tree inputs,
  collections, curve and text data, and geometry where Main holds it). With `debug` (`?sync-check` in the app) it throws after every full
  flush and run. `tests/main-sync.test.js` runs edits from both sides, undoes and redoes them, and checks each step.

### .blend files

File > Save As runs Blender's `wm.save_as_mainfile` (`wm_files.cc`, `writefile.cc` and the `blend_write` callbacks of
each ID type) on Main, through `sync.writeBlend(path)`, which fills every object's geometry for the write and releases
it after; `src/windowmanager/wm-files.js` downloads the bytes as `<project>.blend`. Bylonder's project is still saved
as its own (File > Save Project As).

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
  Main's. The ID types the module does not build (images, sounds, armatures, the window manager) are read as their ID
  alone, and sequencer strips are left out.
- **Adopting.** `sync.adopt()` makes Babylon's what Main holds and the sync does not, through the same mapping (`pull`
  with nothing synced yet) and `RELATIONS`: objects of their type (a mesh's geometry goes to Babylon once and Main's is
  released; a curve's or text's Curve data is kept on both sides), materials of Bylonder's kind with their Principled
  BSDF inputs, modifiers into Bylonder's stack, rotation modes in Bylonder's order, the scene camera and the world's
  color; the scene's settings and collections follow once the world's slices exist. Objects Blender's code adds come
  the same way. What Bylonder cannot show is reported to the Info editor as warnings: other object types, Area lights
  (opened as point lights), modifiers and node types Bylonder lacks, keys on other properties, a world's strength,
  several materials on one mesh.
- **In a project**, `openBlend(path, scene)` (`@workbench/sdk`) opens a .blend of the project's files from its code,
  before the world starts, so Bylonder's edits are kept over it as over any project. `tests/blend-read.test.js` opens
  a file Bylonder wrote and a user's file the reference Blender makes (`tools/blender-reference/user-file.py`) and
  checks them against Blender's reading.
- **Bylonder's Array** (Geometry Nodes) is saved as Blender's Array modifier when its settings are the Array
  modifier's: a line of copies by relative, constant or endpoint offset, without rotation, scale or randomness.

### Adding a subsystem

- Its Blender sources go in the module's `libraries` (`tools/blender-port/manifest.json`); operators defined in a source listed under `operators` are registered by their own functions. A source that needs header directories of its own lists them as the library's `includes`, so the rest of the build stays cached.
- Its IDs go in the same Main: data of its own (an Action, a node tree) with `BKE_*_add(main_bmain(), name)` in an export of its API file, object data through `object_data(ob)`. `ID_code_to_RNA_type` in `operator-properties.cc` names the module's ID types for context pointers; add the new type there.
- Its values cross through the same RNA names: a binding in `rna-bylonder.js` marked `sync` (with its struct in `dna-data.json`, `modifier_dna.py`), which the scene sync writes and reads back; what is not a value goes in the sync's relations. Its operators run through `sync.run` (or `flush` and `writeBack`); it keeps no copy of its own.

### Known limits

Operators that would change a light's or camera's data change nothing (`revert`). Material textures (Image Texture nodes), Area lights' shape, snapping and proportional editing in ToolSettings, and the 3D Viewport's `RegionView3D` are not synced yet; Actions stay Main's, which the animation's own record mirrors. In a saved file, Bylonder's Geometry Nodes Array is missing unless it is a line of copies, a Node Material is a Principled BSDF
with Blender's defaults (its graph is kept in `bylonder_node_material`), and a Standard material gives only its color,
alpha and emission color.

### Animation

Decided 2026-10-28. Animation data is Blender's, in the module's Main: each animated ID has AnimData and a layered Action (`animrig`), whose F-Curves are the truth. Bylonder's channels map onto them (`src/blenkernel/animation/model.js`): an object's position, rotation and scaling (meshes, empties, text, curves, cameras and lights, the Objects Object Mode mirrors) are its Object's `location`, `rotation_euler` and `scale` in Blender's axes; every other channel is a custom property of the Scene (`["<id, path>"]`). Keys go in with `animrig::insert_vert_fcurve` and the Preferences' settings, values come out with `evaluate_fcurve`, and Blender's operators that auto key (Object Mode's) add keys the animation takes (`model.keying`). The scene's time is in Main through the scene sync (`Scene.frame_current` and the rest); what the animation editors' operators change of it, and of the selection, comes back through its `writeBack`.

The Timeline, Dope Sheet and Graph Editor are Blender's spaces (`SpaceAction` with its `TIMELINE` and `DOPESHEET` modes, `SpaceGraph`), each a `ScrArea` in the module made by its space type's own `create` (`tools/blender-port/wasm/anim-api.cc`, JS `editors/animation/anim-area.js`). Their operators, the channel list (`ANIM_animdata_filter`), key columns (`keyframes_keylist.cc`), View2D and transform conversion are Blender's code. Bylonder is the window manager (`editors/animation/anim-editor.js`): it lays out the regions, turns DOM events into `wmEvent`s for the editors' keymaps (`keymapHandler`), runs modal operators with their modal keymaps, draws box, circle and lasso gestures and the popups an invoke asks for (confirmation, enum menus, operator properties), draws the sidebar's panels with the shared panel renderer (the Graph Editor's from `graph_buttons.cc`, ported in `anim-buttons.js`), and the scene's markers, and draws the regions on canvases with the theme's colors (`anim-draw.js`, after `action_draw.cc`, `graph_draw.cc`, `keyframes_draw.cc`). Headers and menus are the registered classes of Blender's Python tree (`python/bpy_interface.js`): headers drawn by the shared layout renderer (`layout-view.js`), menus through `drawMenu`.

### Outliner

Decided 2026-10-28. The Outliner is Blender's `space_outliner` and `space_outliner/tree` in the module, over the same Main: Blender's code builds the tree (`tree_display_view_layer.cc`, `tree_element_*.cc`), lays it out and draws it (`outliner_draw.cc`), and runs every Outliner operator (`outliner_select.cc`, `outliner_tools.cc`, `outliner_dragdrop.cc`, `outliner_edit.cc`, `outliner_collections.cc`). `tools/blender-port/wasm/outliner-api.cc` makes the area as `ED_area_newspace` does (the space type's own `create`), sets up its main region as `outliner_main_region_init` does, and draws it; JS `editors/space_outliner/outliner-area.js` holds it and `space-outliner.js` is its window manager.

- **Collections are Blender's.** The scene sync keeps Bylonder's collections in Main (children, objects, exclude and visibility flags, the active layer collection), so the View Layer tree, the exclude checkbox and the restriction toggles are Blender's own `layer.cc` results. What an operator changed comes back through `collections.assign`.
- **Objects come back through the sync** after each operator or button (`writeBack`): the selection and active object from the bases, hidden, the synced flags, names, parents, and objects Blender's code deleted (`outliner.delete`), which are deleted in Bylonder and leave the Scene Collection (`main_collection_master_clean`, since the module's scene is not one of Main's).
- **DNA by name.** `tools/blender-port/modifier_dna.py` also writes `src/makesrna/dna-outliner.json` (Object, Base, Collection, LayerCollection and SpaceOutliner fields, with their RNA icons and enum items), read in place by `makesrna/dna-struct.js`. The header's `space_data` is the module's SpaceOutliner through it.
- **Drawing.** `region-draw.cc` stands in for the GPU module, BLF and the button layer: `imm*`, the round box, text and icons are recorded as JSON with Blender's coordinates, text is measured by JS (`region_text_width`), and `editors/interface/region-draw.js` replays the recording on a canvas with Blender's SVG icons, tinted as `blf_glyph_cache_add_svg` does. Buttons (the toggles, the rename field) are recorded with their rectangles; a press runs `ui_apply_but` as Blender's handlers do (`region_button_press`, `region_button_text`), and dragging over a toggle column sets them alike.
- **Events.** The canvas makes Blender's event values (PRESS, RELEASE, CLICK, DOUBLE_CLICK within 350 ms, CLICK_DRAG past 3 px) and runs the keymaps of the main region (`Outliner`, `View2D Buttons List`, `Screen`, `Window`) with the Outliner as the context area. Box gestures run through `startGestureBox`; a menu an operator calls (`WM_menu_name_call`, port-override) opens through `drawMenu`.
- **Drag and drop.** `wm_dragdrop.cc` and `object_relations.cc` are compiled; `drag-drop.cc` runs the main region's dropbox handlers as `wm_event_system.cc` does, for the region JS gives (`drag_update`, `drag_drop`). Dropping on an object moves it into that object's collection, Shift parents it, Ctrl links it; dropping on a collection moves it there.
- **Scene sync.** The module's Scene is not in Main's scenes, so `BKE_main_collection_sync` does not resync its view layer after an ID is deleted or remapped: the area resyncs it after every operator (`syncCollections`). Main's ID remapping reaches the area's tree store through `BKE_library_callback_remap_editor_id_reference_set`.
- **Not yet:** the popup menus `outliner_operator_menu` builds (context menus on mesh data, materials and other IDs that are not objects or collections), the edge pan while dragging (`WM_operator_name_call_ptr` runs only an exec), scroll bars, the display modes other than View Layer, and Bylonder's materials as Material IDs under their meshes.

### Export for Babylon

Decided 2026-10-28. File > Export (`TOPBAR_MT_file_export`, Blender's menu) gets Babylon (.babylon) and JavaScript (.js),
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
- **Effects.** The scene camera's rendering pipelines (Bylonder's render effects and the project's own) go in
  `renderingPipelines` and the scene's image processing in `imageProcessingConfiguration`, in Babylon's own
  serialization; camera post-processes go in `postProcesses`, which Babylon's loader reads. Babylon's `.babylon`
  loader ignores the first two and does not play animation groups: the `.js` export applies them all.
- **JavaScript.** `createScene(engine, canvas)` builds each mesh and empty as code (geometry, transform, parent,
  material, flags, thin instances), and parses materials, lights, cameras, shadows, effect layers, probes, particles,
  pipelines and animation with Babylon's `Parse` functions, as the loader does. It imports `@babylonjs/core`, mapped
  in a page to `cdn.jsdelivr.net/npm/@babylonjs/core@<the app's version>/+esm` (the header names the URL).
- **Checked.** `tests/export.test.js` (NullEngine: serialize, reload with Babylon's loader and import the module,
  compare geometry, material, camera and animation) and `tests/e2e/smoke.mjs` (File > Export in the app).

### Modifier kernels polyfill

Decided 2026-10-28. Exports apply modifiers; File > Export > JavaScript, Live Modifiers (.zip),
`bylonder.export_js_live`, keeps them live instead, with a WebAssembly module of only Blender's modifier evaluation.

- **The module.** `modifiers/modifiers.wasm` in `tools/blender-port/manifest.json`: `modifier-api.cc` (mesh arrays in,
  `mesh_create_eval_final` over Blender's ModifierData, results read in place), `no-depsgraph.cc` (the depsgraph
  stand-in both modules share) and `modifiers-only.cc`. Its libraries are `bmesh.wasm`'s minus the editors,
  `animrig`, `windowmanager`, the interface and the Outliner, blenfont and FreeType, and OpenVDB (built without
  `WITH_OPENVDB`, so Remesh's Voxel mode reports that it is unavailable). Modifier types outside `MESH_ONLY`
  (`src/modifiers/blender.js`) are left out of its `modifiers/intern` as stand-ins (`wasm/modifier-standins.hh`, used
  by both modules for the types they leave out, Geometry Nodes and Line Art in the scene module): Blender's None type
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
  `tools-wasm`, `objects-wasm`, `modifiers-wasm`, `outliner`, `anim-wasm`, `curves-wasm`: startup, primitives, Edit
  Mode and its tools, modifier stacks, Object Mode operators, the Outliner, the animation editors, curves and text),
  run on the given build through `BYLONDER_BMESH_WASM`, about 8 s a run. `tests/export-live.test.js` runs the
  modifiers check on the committed module.
- **Size.** Measured: `modifiers.wasm` is 6.3 MB, 1.6 MB gzipped (`bmesh.wasm`: 15.4 MB, 4.4 MB gzipped), with
  `modifiers.js` (4 KB) and the worker (13 KB). Built with OpenVDB's headers and every modifier type it was 11.4 MB,
  3.1 MB gzipped: OpenVDB's templates alone were a third of its code. What remains is mostly what `BKE_idtype_init`
  and `BKE_modifier_init` reach (every ID type's code) and RNA's static definitions; narrowing those to Mesh and
  Object is the next cut.
- **Shared code.** The app and the polyfill run the same JS on their modules: `bmesh/module-mesh.js` (memory, the
  extraction header, `evaluateModifiers`), `modifiers/dna-write.js` (settings into ModifierData by their DNA layouts)
  and `draw/mesh-batch-buffers.js` (a Mesh's draw buffers, without Babylon). So a live result is the applied export's
  geometry exactly. Two RNA properties can be one DNA field in two units (Bevel's `width` and `width_pct`): the
  writer writes defaults first, so the setting changed from its default is the field's value.
- **The polyfill.** Three files the zip puts in `bylonder-modifiers/` next to the module: `modifiers.js` (no imports:
  `liveModifiers(scene, { url })`), `modifiers-worker.js` (`polyfill/worker.js` bundled by
  `scripts/modifiers-polyfill.mjs` into `modifiers-worker.bundle.js`, which a test keeps current) and `modifiers.wasm`.
  `createScene(engine, canvas, { modifiers })` imports it from that folder, or from the URL given, after building the
  scene; if it cannot load, the applied geometry stays.
- **What a live object carries.** An object whose shown modifiers are all Blender's (`modifiers.live(node)`) gets
  `metadata.bylonderModifiers`: its base Mesh as the module takes it (positions, edges, face offsets, corner verts and
  edges, UVs, base64) and its stack (ModifierType, settings by RNA path, and the DNA layouts of those settings, so the
  polyfill needs neither RNA nor DNA tables). Its applied geometry is written too and shows until the first evaluation.
  Objects with Bylonder's own modifiers (Array as Geometry Nodes) stay applied.
- **Animation.** A keyed modifier setting is sampled into the scene's animation group at
  `metadata.bylonderModifiers.stack.<index>.values.<path>`; booleans hold from key to key. The polyfill compares each
  stack's settings before every frame and evaluates again in its worker when they changed, the newest settings winning;
  integers round as Bylonder's channels do.
- **Checked.** `tests/export-live.test.js` evaluates Subdivision Surface, Array, Bevel, Mirror and Solidify, and a keyed
  Solidify thickness at another frame, through the exported module and the polyfill (its worker run in Node), and
  compares them with the applied geometry; `tests/e2e/smoke.mjs` checks the zip.

## Shared foundations

Every subsystem builds on these, one of each:

- Blender's Python: `tools/blender-ui/tree.py` compiles Blender's whole `scripts/startup` and `scripts/modules` into `src/bl_py`, over a boundary of Bylonder's modules (`tools/blender-ui/boundary`: `_bpy` and the C modules, the module registry).
- Blender's C: one WebAssembly module (`tools/blender-port`), with one Blender world in it (Main, Scene, ViewLayer, bContext stand-ins) that every subsystem's data (meshes, curves, text, animation) lives in.
- Data: one RNA layer over Bylonder's data (`src/makesrna/rna-bylonder.js`) and one `bpy.context` (`src/blenkernel/context.js`).
- Operators: one registry by Blender idname (`src/windowmanager/wm-operators.js`); keys only from Blender's keymaps (`src/windowmanager/keyconfig.js`); no hand-written keymaps. An editor runs its keymaps inside its context area (`inArea(area, ...)`), so operators act on that editor (`contextArea()`) and `wm.call_menu` opens the area's own menu (`area.menu(idname)`); editors never keep operator tables of their own.
- UI: menus through `src/editors/interface/ui-layout.js`; panels through one layout renderer, with one number field carrying Blender's drag behavior.

## Blender's Python tree

`src/bl_py` is all of Blender's `scripts/startup` and `scripts/modules` (283 modules), loaded whole: `bpy.main()` runs
Blender's startup, which registers its classes (2094: every menu, panel, header and Python operator) in
`_bpy.registered` (`tests/bl-py.test.js`). Decisions:

- Fixes are generic, in the transpiler (`TranscryptFixes` and `Walrus` in `transpile.py`, `runtime.js` for the runtime,
  applied to both pipelines by `finish()`), or in tree.py for what spans modules. Never edit `src/bl_py`.
- The tree's modules compile with operator overloading and iterable conversion (`opov`, `iconv`) for Python's
  semantics (list `+`, loops over iterators); Transcrypt's own library modules compile without.
- Module semantics: imported names are module attributes (re-exported); assigning a module's attribute
  (`bpy.context = ...`) calls its `__py_setattr__`; cycles become JS namespace imports; `__import__` and `globals()`
  look modules up in the registry.
- `bpy.context` and `bpy.data` are proxies over what Bylonder pushes (`_bpy._context_push(context, data)`), as Blender
  sets the window manager's context; with none pushed, Blender's RNA defaults (`makesrna/rna.js`). `bl_rna` is
  `blRna(struct)` from the same RNA data.
- Python's library modules Transcrypt lacks are at the boundary (`boundary/`), as small as Blender's scripts need;
  values Blender's C reports (`bpy.app`, handlers, translation contexts, file extensions) are copied from the
  reference binary. `os` is a read-only file system of Blender's scripts in Blender's layout (`_files`).

Consumers and running:

- `src/python/bpy_interface.js` loads the tree and exports `registered`, `menus`, `panels`, `headers`, `module(name)` and
  `setContext`. Menus, the Properties editor's panels, the 3D View's regions, the animation editors' headers, the tool system and the
  keymaps (`presets/keyconfig`) all come from these; the per-class transpile it replaced is gone (2026-10-28).
- Blender's Python operators register in Bylonder's operator registry by idname unless Bylonder registers its own
  (which then wins); they run as Blender runs one: an instance with its property defaults and the given values,
  `poll`, then `execute` (or `invoke` from an event) in `bpy.context`.
- `bpy.ops` is Blender's `ops.py` over the boundary's `_bpy.ops`, which calls Bylonder's registry; modules with a
  module-level `__getattr__` (PEP 562) are seen through it by their importers.
- `eval` and `exec` of a snippet run in the boundary's Python interpreter (`_py_eval`), over the calling function's
  names and its module's; RNA's C functions on structs (`WindowManager.draw_cursor_add`) are in
  `tools/blender-ui/rna_functions.py`.

## Workspaces

The app opens in the Layout workspace: the window is Blender's (topbar, editors, status bar). Scripting is a workspace like Blender's, reached from the topbar's workspace tabs.

- The topbar has Blender's eleven default workspace tabs. A tab sets the scene window's screen (`dock.setScreen`, one layout per screen and profile over the same areas): Scripting opens startup.blend's Scripting screen (see Scripting), every other tab the Layout screen, until Bylonder has their editors (Image Editor, Spreadsheet, sculpt and paint modes). The project's JavaScript workbench (Monaco, files, the browser console) is Window > Toggle Project Code.
- The Layout screen is startup.blend's: its split positions are read from the file's area vertices (1920 x 1080) and kept as fractions, which Blender scales with the window; areas stay at least one header high. The topbar and status bar are fixed heights in pixels at UI scale, as Blender's global areas.
- Area geometry is Blender's (`areaSizes` in `editors/screen/dock.js`): a split's edge is a screen vertex at its fraction of the vertex range, rounded from the left or bottom (`screen_geom_vertices_scale`), and areas sit 2 px inside their vertices, 1 px below the topbar (`area_calc_totrct`), so areas are 3 px apart. At 1600 x 950 every area matches Blender's to the pixel.
- An editor whose header overlaps its main region (the 3D Viewport) is a dock item with `overlap`: its main region spans the area under the header, which takes the theme's translucent header color, so the view's projection is Blender's.
- The scene opens with the object that an add operator made last (`createPrimitive`) selected and active, as startup.blend's cube is, and a primitive's Mesh has all its elements selected, as `EDBM_op_call_and_selectf` leaves it.
- The status bar keeps Bylonder's richer text (run state, save state, type checking, scene statistics) where Blender shows its version only. Decided 2026-10-28.
- The topbar's right region is Blender's: the Scene selector and the View Layer selector (the scene window's view layers, set through `send`).
- Workbench controls sit where an add-on would put them. A project is Bylonder's .blend file: File > Open and Open Recent list projects, the window title names the open one. Running the project's JavaScript is Render > Run (Ctrl Enter). Project actions are File, Edit and Render menu entries.

## Scripting

Decided 2026-10-28. The Scripting screen is startup.blend's: the 3D Viewport over the Python Console and Info, the Text Editor, the Outliner over the Properties editor (Blender's two Outliners are one), split at its area vertices as Layout is; Info has no header there, as in Blender. The three editors are Blender's spaces in the scene window, where `bpy.context` and RNA live.

- Each draws Blender's header, menus and sidebar panels from the tree (`TEXT_HT_header`, `TEXT_HT_footer`, `TEXT_MT_*`, `TEXT_PT_*`, `CONSOLE_HT_header`, `INFO_HT_header`) through `editors/interface/area-ui.js`, and runs Blender's keymaps (Text Generic, Text, Console, Info, then Screen and Window) inside its area. Text input is the keymaps' `TEXTINPUT` items; repeated keys match only items with `repeat`.
- Operators are registered by Blender's idnames (`text.*`, `console.*`, `info.*`); `ed.undo` in a Text Editor undoes the text, as `text_undo.cc` does. Their code is JS after Blender's C: texts follow `text.cc` (`blenkernel/texts.js`), highlighting `text_format_py.cc`, the Console's operators `console_ops.cc`, drawing `text_draw.cc` and `textview.cc`. These are stand-ins for building those sources into the module.
- Texts are the project's text files: `bpy.data.texts` lists them (`index.js` too), a new text is a new file, and every edit is saved with the project, as a .blend holds its texts. All are internal (`filepath` empty): Save needs a file, so it is Save As, which downloads the text; Open reads a local file into a new text.
- Reports: a finished operator with Blender's REGISTER option (`windowmanager/operator-register.json`, from `tools/blender-reference/operator-register.py`) reports its call as Python, Python operators report through `self.report`, and Run Script reports a failed script's traceback and moves the cursor to its line. Info lists them (`windowmanager/wm-reports.js`). `print` goes to the system console, the browser's, which the project's workbench shows.

### Python

CPython runs scripts and the console: Pyodide, CPython in WebAssembly, from cdn.jsdelivr.net at a pinned version (`python/pyodide.js`), loaded when a Python Console opens or a script first runs, never at startup.

- `python/bridge.py` is the one bridge: a module CPython lacks (`bpy`, `mathutils`, `bpy_extras`, `bl_ui`, ...) imports from the tree's module registry as a JS-backed module, and its values are proxies that forward attribute access, calls, items, iteration and operators to the tree's own objects. `bpy.context`, `bpy.data`, `bpy.ops` and `bpy.types` are therefore the objects the interface uses: `bpy.ops.mesh.primitive_cube_add()` runs Bylonder's operator and `bpy.context.object.location.x = 2` writes through RNA. The bridge translates only conventions: Transcrypt's renamed names (`type` is `py_metatype`), keyword arguments (`__kwargtrans__`), None as null, negative indices and collection keys.
- The console's language module and its completion run as Blender's own Python in CPython (`_console_python`, `_bl_console_utils`, copied unchanged into `src/python/scripts` by `tools/blender-ui/python_sources.py`), since they need `code.InteractiveConsole` and the console's live namespace. Bylonder registers `console.execute`, `console.autocomplete`, `console.banner` and `console.copy_as_script` to call it, as `bl_operators/console.py` does by the console's language.
- Writes go through RNA's bindings only (the same mapping the interface writes through), never to Babylon objects from the bridge.
- `foreach_get` and `foreach_set` copy a collection's property in one typed array each way (into NumPy arrays where the script passes one), never element by element. Large data stays with its one owner: `Mesh.vertices` reads and writes the Babylon mesh's position buffer (`co` in Blender's axes; Babylon's split vertices for now).
- A script runs as `__main__` in the Text Editor's context and area.
- Limits: classes defined in CPython cannot subclass `bpy.types` (no `register_class` of a script's operators or panels yet); `mathutils` is the boundary's; JS numbers come back as int or float by value; the Text Editor's own autocomplete and live edit are not there yet.

## Menus

Menus drawn from Blender's scripts show every entry Blender's draw makes. An entry whose operator Bylonder does not run yet is greyed out, as Blender shows an operator whose poll fails. Its shortcut is Bylonder's binding if there is one, else Blender's: `windowmanager/keyconfig.js` reads Blender's default keymap (`keymap_data/blender_default.py`, transpiled) in the keymaps the editor's handlers run, in order. A binding gives an operator button its shortcut only when its properties are the ones the button sets, as Blender's buttons compare them (`WM_key_event_operator_string`, strict), then the ones set away from their defaults; an operator's own `keys(props)` binds the properties it reads (`menuUI` in `wm-operators.js`). So File > New's templates, which set `app_template`, show no Ctrl N; File's New entry shows the Ctrl N that opens it.

Context menus are Blender's too, decided 2026-10-28: right click runs the editor's keymaps, whose `wm.call_menu` opens the context menu of the editor and mode (`VIEW3D_MT_object_context_menu`, `VIEW3D_MT_edit_mesh_context_menu`, `OUTLINER_MT_object`, `GRAPH_MT_context_menu`, `TEXT_MT_context_menu` and so on) from the context area's `menu(idname)`. A property button's right click is `ui_popup_context_menu_for_button`'s menu (`propertyMenu` in `layout-view.js`): keyframes, reset to default and copy data path. Not yet: the Node Editor's `NODE_MT_context_menu` and the area header's menu (`screen.region_context_menu`), which is still Bylonder's.

## 3D View regions

The toolbar, tool settings, header transform settings and sidebar are Blender's scripts, transpiled whole where they are systems.

- Tool system: `space_toolsystem_common.py` and `space_toolsystem_toolbar.py` are transpiled as whole modules. `windowmanager/wm-toolsystem.js` keeps Blender's state (bToolRef per mode, `workspace_tool_type`, the group memory `_tool_group_active`) and runs Blender's Python for everything else: `draw_cls` draws the toolbar, `activate_by_id` sets the tool, `wm.tool_set_by_id` cycles. The active tool's keymaps run before the mode's, in the order of `wm_event_get_keymap_from_toolsystem_ex`, including the fallback tool's keymap off the gizmo, with the tool's stored operator properties. Blender's keyconfig loads with the preference defaults of `Blender.py` (left click select, fallback tool on).
- Tool icons are Blender's `.dat` triangle files, converted to SVG by `tools/blender-ui/tool_icons.py`.
- The toolbar (`editors/space_view3d/view3d-toolbar.js`) records `draw_cls`'s layout calls and draws Blender's one icon column: groups open their flyout on a 0.2 s hold or a drag, the region snaps to Blender's widths.
- The Transform panel is C (`view3d_buttons.cc`). It is ported as the layout calls it makes (`view3d-buttons.js`), not built to WASM: it only reads and writes RNA, so the layout calls are the whole of it.
- The header (`VIEW3D_HT_header`, with its visibility, gizmo, overlay and shading popovers), the tool settings and the sidebar draw through the shared layout renderer (see Layouts and panels), from `view3d-regions.js`. In Edit Mode the header's menus are Edit Mode's (`editMeshMenus`), its Add menu adds Bylonder's primitives, and `template_header_3D_mode` is the select mode buttons (`uiTemplateEditModeSelection`), a layout the template records. `object.mode_set` runs Object and Edit Mode; a mesh's other modes show greyed.
- Transform orientation slots are stored per scene but no transform reads them yet.
- Select Box, Circle and Lasso share `do_mesh_region_select` (`view3d-select.js`) in Edit Mode; in Object Mode box select tests vertices and circle and lasso the object origin, as Blender does. The gestures are `windowmanager/wm-gesture-*.js` with Blender's modal maps.

## 3D View tools

Decided 2026-10-28. A tool is what Blender's is: its keymap, its gizmo group and its stored settings. Its operators are registered by Blender idname; nothing is wired to a tool by name.

- Gizmo map: `windowmanager/wm-gizmo-map.js` shows the active tool's gizmo group, highlights the part under the pointer and runs the group's handler before the region's keymaps, as `wm_gizmo_map.cc` does. Its state (shown, highlighted) feeds the tool system's keymap order. The groups are ports: `VIEW3D_GGT_ruler`, `VIEW3D_GGT_placement`, `VIEW3D_GGT_tool_generic_handle_free` and `_normal` (a handle runs the tool's own keymap, as `gz->keymap` does) and `VIEW3D_GGT_xform_extrude`. Babylon's gizmos stay the transform gizmos. Gizmos, rulers, annotations and the placement grid draw on one 2D canvas per view (`draw/overlay-tool.js`) in the theme's colors.
- Object Mode tools: `editors/space_view3d/view3d-tools.js` registers `view3d.cursor3d` (`view3d-cursor.js`, with Blender's surface depth and orientations), `transform.from_gizmo`, `view3d.ruler_add` and `view3d.ruler_remove` (`view3d-gizmo-ruler.js`), `gpencil.annotate` (`editors/gpencil/annotate.js`, all four modes) and `view3d.interactive_add` (`view3d-placement.js`). The cursor is `scene.cursor` (`View3DCursor`), drawn by `draw/overlay-cursor.js`.
- Annotations are Blender's data model in a document slice (`blenkernel/gpencil/annotations.js`): layers holding frames of strokes. Rulers are strokes of the hidden `RulerData3D` layer, as Blender stores them.
- Edit Mode tools run Blender's modal operators in the module. The edit context has a 3D View (`edit_context_view_set`: window, screen, area, View3D, window region and a RegionView3D from the Babylon camera), so operators project the mouse as in Blender. `EditMesh.invoke` and `modal` give them events, and Bylonder's window manager matches the operator's modal keymap (`object-edit.js` `moduleOperator`). This runs Shrink/Fatten, Push/Pull, To Sphere, Shear, Vertex Slide, Edge Slide, Smooth and Randomize (the generic value modal), Inset, Bevel, Rip, Spin, Bisect, Knife, Extrude to Cursor and Poly Build. Macros (Extrude Region, Extrude Manifold, Loop Cut and Slide, Poly Build's) run as Blender's macro does, each operator invoked with the event and the last one modal (`macro` in `object-edit.js`, steps from `MACROS` in `view3d-menus-edit-mesh.js`). Move, Rotate and Scale stay Bylonder's transform, with G G's Edge Slide its JS port; Ctrl R's Loop Cut preview is a JS port too, as `ringcut_invoke` draws its own preview, which the module does not pass on yet.
- Gizmo bridge: the module's region has a stand-in gizmo map (`editor-context.cc`). `WM_gizmomap_group_find` answers for the group Bylonder shows (`edit_context_gizmo_group_set`, set from the tool's gizmo group on every hover and press), and `ED_view3d_gizmo_mesh_preselect_get_active` gives the element `edit_mesh_preselect_elem` found. Gizmo group types an operator asks for (`WM_gizmo_group_type_ensure`, Spin's and Bisect's redo gizmos) are recorded and read by `EditMesh.gizmoRequested()`, so Bylonder's gizmo map shows them after the operator. The groups' drawing is Bylonder's (`view3d-gizmo-mesh.js`): the edge ring and element preselection, `MESH_GGT_spin` and `MESH_GGT_spin_redo`. Each group type's properties are a struct named after it (`GIZMO_GROUP_PROPERTIES` in `rna-bylonder.js`), so tool settings draw them.
- Straight-line gestures are `wm_gesture_ops.cc`'s (`gesture-api.cc`); Bylonder draws the line from `EditMesh.gesture(op)`, and the mouse line of Inset and Bevel from `ED_region_draw_mouse_line_cb`'s center.
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

- The 3D View's Object Mode Select and Object menus are Blender's, over `createContext`, running Bylonder's actions by the operators they name (`editors/object/object-operators.js`). Next: View and Add, and the Edit Mode menus (`view3d-menus-edit-mesh.js`, which builds its own context).
- Properties editor: popovers in panels other than the 3D View's, template_list filtering and sorting, multi-drag of number fields, light type changes (Bylonder replaces the Babylon light), the Collection tab for the master collection.
- The topbar's scene properties across windows (decision 7).
- Mesh element collections, Preferences.
