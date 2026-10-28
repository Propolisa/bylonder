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
4. **Data only one side has.** Babylon's (node materials, GPU effects, what project code builds) stays Babylon's,
   and is kept in Main as custom properties where a round trip needs it. Blender's (Actions, curves, text, modifiers,
   collections) lives in Main, and Babylon holds its evaluated result.
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

Today `editors/object/object-blender.js` mirrors objects per operator (Object Mode), and the Outliner, animation, Edit Mode and curves each sync their own way; they move onto the one mapping above.

### Adding a subsystem

- Its Blender sources go in the module's `libraries` (`tools/blender-port/manifest.json`); operators defined in a source listed under `operators` are registered by their own functions. A source that needs header directories of its own lists them as the library's `includes`, so the rest of the build stays cached.
- Its IDs go in the same Main: data of its own (an Action, a node tree) with `BKE_*_add(main_bmain(), name)` in an export of its API file, object data through `object_data(ob)`. `ID_code_to_RNA_type` in `operator-properties.cc` names the module's ID types for context pointers; add the new type there.
- Its values cross through the same RNA names: read them from the JS structs before an operator, write them back from what it tagged. Data that has no RNA binding yet gets one in `rna-bylonder.js` first.

### Known limits

Text and curve objects go in with their Curve data and come back with it when an operator tags their geometry (`docs/curves-and-text.md`). Lights and cameras go in without their data. Next to mirror: `scene.unit_settings`, snapping and proportional editing in ToolSettings, `frame_current`, and the 3D Viewport's `RegionView3D` for view-dependent operators.

### Animation

Decided 2026-10-28. Animation data is Blender's, in the module's Main: each animated ID has AnimData and a layered Action (`animrig`), whose F-Curves are the truth. Bylonder's channels map onto them (`src/blenkernel/animation/model.js`): an object's position, rotation and scaling (meshes, empties, text, curves, cameras and lights, the Objects Object Mode mirrors) are its Object's `location`, `rotation_euler` and `scale` in Blender's axes; every other channel is a custom property of the Scene (`["<id, path>"]`). Keys go in with `animrig::insert_vert_fcurve` and the Preferences' settings, values come out with `evaluate_fcurve`, and Blender's operators that auto key (Object Mode's) add keys the animation takes (`model.keying`).

The Timeline, Dope Sheet, Graph Editor and Drivers editor are Blender's spaces (`SpaceAction` with its `TIMELINE` and `DOPESHEET` modes, `SpaceGraph` with its `FCURVES` and `DRIVERS` modes), each a `ScrArea` in the module made by its space type's own `create` (`tools/blender-port/wasm/anim-api.cc`, JS `editors/animation/anim-area.js`). Their operators, the channel list (`ANIM_animdata_filter`), key columns (`keyframes_keylist.cc`), View2D and transform conversion are Blender's code. Bylonder is the window manager (`editors/animation/anim-editor.js`): it lays out the regions, turns DOM events into `wmEvent`s for the editors' keymaps (`keymapHandler`), runs modal operators with their modal keymaps, draws box, circle and lasso gestures and the popups an invoke asks for (confirmation, enum menus, operator properties), draws the sidebar's panels with the shared panel renderer, and the scene's markers, and draws the main regions on canvases with the theme's colors (`anim-draw.js`, after `action_draw.cc`, `graph_draw.cc`, `keyframes_draw.cc`). The channel region is Blender's own draw (`action_channel_region_draw`, `graph_channel_region_draw`) and the main region's overlay (the current frame, scrollers and the Graph Editor's value scale) its `draw_overlay`, both recorded by `region-draw.cc` (`anim_region_draw`) and replayed by `region-draw.js`: the channels' toggles are its buttons, pressed as Blender's handlers press them, and the block layout of the channel search row (`ED_time_scrub_channel_search_draw`, the DopeSheet's `filter_text` and `use_filter_invert`) is recorded by `panel-layout.cc` and drawn by the shared layout renderer over the canvas. Each layout runs the region type's `init`, so scrollers and view settings are Blender's; keymap handlers are left out (port-override) because keys come from Bylonder's keymaps. The Graph Editor's sidebar is Blender's C panels: `anim_sidebar_panels` draws each panel type of the region whose poll passes (`graph_buttons.cc`'s Active F-Curve, Active Keyframe, Modifiers, View, Driven Property and Driver panels), header and sub-panels included, and after the Modifiers panel each F-Modifier's instanced panel (`fmodifier_ui.cc`), into `panel-layout.cc`'s recording; `drawSidebarPanels` (`anim-buttons.js`) shows them by category. Raw buttons are recorded where Blender's block puts them (its current layout, `uiItemL_respect_property_split`'s value column): a property's button (`uiDefButR`) is drawn as that property with its unit (`button_unit_type_set`, so a location key's value shows metres and a rotation's degrees) and runs its functions after a set (`panel_button_applied`); the others are pressed (`panel_button_press`: the delete buttons, an Envelope's control points, Add Input Variable). Their properties are read and written through the module's RNA (`makesrna/rna-module.js`, `rna_get` and `rna_set`, a button's clamping to its range): the DNA fields `modifier_dna.py` finds (`dna-fcurve.json` for FCurve, Keyframe, the F-Modifiers, Driver, DriverVariable and DriverTarget, with the struct a modifier's `data` points to and the item tables other RNA files define; `dna-anim.json` for the spaces), and the get, set, range and update functions of `rna_fcurve.cc`'s runtime part, which the module compiles (`wasm/rna-fcurve.cc`) and gives each property by name (`rna_fcurve_funcs.inc`). The spaces' own RNA functions are rna_space.cc's runtime part (`wasm/rna-space.cc`, `rna_space_funcs.inc` from `dna-anim.json`): the Dope Sheet's mode menu sets `ui_mode` with its update. Drivers are made with Blender's `ANIM_add_driver` (`BlenderAnimation.addDriver`); scripted expressions use `expr_pylike_eval.cc`, built without floating point exception flags, which WebAssembly lacks (a division by zero gives infinity rather than an error). Driver values do not reach Babylon's objects yet: that belongs to the one mapping. Headers and menus are the registered classes of Blender's Python tree (`python/bpy_interface.js`): headers drawn by the shared layout renderer (`layout-view.js`), menus through `drawMenu`.

### Outliner

Decided 2026-10-28. The Outliner is Blender's `space_outliner` and `space_outliner/tree` in the module, over the same Main: Blender's code builds the tree (`tree_display_view_layer.cc`, `tree_element_*.cc`), lays it out and draws it (`outliner_draw.cc`), and runs every Outliner operator (`outliner_select.cc`, `outliner_tools.cc`, `outliner_dragdrop.cc`, `outliner_edit.cc`, `outliner_collections.cc`). `tools/blender-port/wasm/outliner-api.cc` makes the area as `ED_area_newspace` does (the space type's own `create`), sets up its main region as `outliner_main_region_init` does, and draws it; JS `editors/space_outliner/outliner-area.js` holds it and `space-outliner.js` is its window manager.

- **Collections are Blender's.** `collections-blender.js` mirrors Bylonder's collections into Main (children, objects, exclude and visibility flags, the active layer collection), so the View Layer tree, the exclude checkbox and the restriction toggles are Blender's own `layer.cc` results. What an operator changed comes back through `collections.assign`.
- **Objects come back by name, base and parent.** After each operator or button: the selection and active object from the bases, hidden, `hide_select`, `hide_render` and `hide_viewport` from Object DNA, names, parents, and objects Blender's code deleted (`outliner.delete`), which leave the mirror (`forget`).
- **DNA by name.** `tools/blender-port/modifier_dna.py` also writes `src/makesrna/dna-outliner.json` (Object, Base, Collection, LayerCollection and SpaceOutliner fields, with their RNA icons and enum items), read in place by `makesrna/dna-struct.js`. The header's `space_data` is the module's SpaceOutliner through it.
- **Drawing.** `region-draw.cc` stands in for the GPU module, BLF and the button layer: `imm*`, the round box, text and icons are recorded as JSON with Blender's coordinates, text is measured by JS (`region_text_width`), and `editors/interface/region-draw.js` replays the recording on a canvas with Blender's SVG icons, tinted as `blf_glyph_cache_add_svg` does. Buttons (the toggles, the rename field) are recorded with their rectangles; a press runs `ui_apply_but` as Blender's handlers do (`region_button_press`, `region_button_text`), and dragging over a toggle column sets them alike.
- **Events.** The canvas makes Blender's event values (PRESS, RELEASE, CLICK, DOUBLE_CLICK within 350 ms, CLICK_DRAG past 3 px) and runs the keymaps of the main region (`Outliner`, `View2D Buttons List`, `Screen`, `Window`) with the Outliner as the context area. Box gestures run through `startGestureBox`; a menu an operator calls (`WM_menu_name_call`, port-override) opens through `drawMenu`.
- **Drag and drop.** `wm_dragdrop.cc` and `object_relations.cc` are compiled; `drag-drop.cc` runs the main region's dropbox handlers as `wm_event_system.cc` does, for the region JS gives (`drag_update`, `drag_drop`). Dropping on an object moves it into that object's collection, Shift parents it, Ctrl links it; dropping on a collection moves it there.
- **Scene sync.** The module's Scene is not in Main's scenes, so `BKE_main_collection_sync` does not resync its view layer after an ID is deleted or remapped: the area resyncs it after every operator (`syncCollections`). Main's ID remapping reaches the area's tree store through `BKE_library_callback_remap_editor_id_reference_set`.
- **Not yet:** the popup menus `outliner_operator_menu` builds (context menus on mesh data, materials and other IDs that are not objects or collections), the edge pan while dragging (`WM_operator_name_call_ptr` runs only an exec), scroll bars, the display modes other than View Layer, and Bylonder's materials as Material IDs under their meshes.

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

Menus drawn from Blender's scripts show every entry Blender's draw makes. An entry whose operator Bylonder does not run yet is greyed out, as Blender shows an operator whose poll fails. Its shortcut is Bylonder's binding if there is one, else Blender's: `windowmanager/keyconfig.js` reads Blender's default keymap (`keymap_data/blender_default.py`, transpiled) in the keymaps the editor's handlers run, in order.

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
- Edit Mode tools run Blender's modal operators in the module. The edit context has a 3D View (`edit_context_view_set`: window, screen, area, View3D, window region and a RegionView3D from the Babylon camera), so operators project the mouse as in Blender. `EditMesh.invoke` and `modal` give them events, and Bylonder's window manager matches the operator's modal keymap (`object-edit.js` `moduleOperator`). This runs Shrink/Fatten, Push/Pull, To Sphere, Shear, Vertex Slide, Smooth and Randomize (the generic value modal), Rip, Spin, Knife and Extrude to Cursor. Move, Rotate, Scale, Edge Slide, Inset, Bevel and Loop Cut stay Bylonder's JS ports. The module's own gizmos are off (`V3D_GIZMO_HIDE`): the gizmo map draws the view's.
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
