# Blender boundary

How Blender's code sees Bylonder's data. Two parts of Bylonder are Blender's own code: the UI scripts in `src/bl_ui` (Blender's Python, compiled by Transcrypt), which read `bpy.context` and RNA, and the C++ in `src/bmesh/bmesh.wasm`, which reads a `bContext` and DNA. Decided 2026-10-27.

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

Bylonder's Babylon scene owns all data; the module holds a mirror for as long as an operator needs it. Decided 2026-10-28.

1. **In, through RNA.** Before an operator polls or runs, each object goes in with the values its RNA struct gives (`rna-bylonder.js`), so a value Blender's C++ reads is the value Blender's scripts show: `location`, `rotation_mode`, `rotation_euler`, `rotation_quaternion`, `scale`, `mode`, its parent, and its base (collection visibility, `hide_get`, `hide_select`, `select_get`, active). Scene values come the same way (`scene.cursor.location`, `tool_settings.transform_pivot_point`). Axes are Blender's: Babylon's (x, y, z) is Blender's (x, z, y).
2. **Object data.** `main_object_add(type, name)` makes an object with new data of its type as `BKE_object_add` does (`BKE_object_obdata_add_from_type`): a Mesh, Curve (text and curves), Light, Camera, or none for an empty. A subsystem then fills that data from Bylonder's: meshes do it with `object_mesh_set` and `object_mesh_attribute_add`, sent again only when the object's Mesh changed (`wbCreation`) and only for selected objects. Data a subsystem does not fill yet stays Blender's default.
3. **Out, by tags.** After an operator, what it tagged comes back: `ID_RECALC_TRANSFORM` as the object's transform through RNA, `ID_RECALC_GEOMETRY` as its data (a Mesh becomes the object's Mesh data). An operator that changed data Bylonder does not take back yet changes nothing and says so.
4. **No parent inverse.** Bylonder's objects have none, so one an operator sets folds into the object's own transform, keeping its world matrix (`object_parent_inverse_fold`). A child left sheared by a parent's uneven scale cannot be held that way; Blender holds it in `matrix_parent_inverse`.
5. **One undo step** per operator, around the write back (`commands.transaction`).

`editors/object/object-blender.js` does this for Object Mode; `editors/object/object-operators.js` registers the operators it runs.

### Adding a subsystem

- Its Blender sources go in the module's `libraries` (`tools/blender-port/manifest.json`); operators defined in a source listed under `operators` are registered by their own functions. A source that needs header directories of its own lists them as the library's `includes`, so the rest of the build stays cached.
- Its IDs go in the same Main: data of its own (an Action, a node tree) with `BKE_*_add(main_bmain(), name)` in an export of its API file, object data through `object_data(ob)`. `ID_code_to_RNA_type` in `operator-properties.cc` names the module's ID types for context pointers; add the new type there.
- Its values cross through the same RNA names: read them from the JS structs before an operator, write them back from what it tagged. Data that has no RNA binding yet gets one in `rna-bylonder.js` first.

### Known limits

Text and curve objects go in without their data, so operators that change it (Apply Scale, Set Origin) do nothing on them yet. Cameras and lights are not mirrored, since their Babylon nodes have no scale for RNA to read. Next to mirror: `scene.unit_settings`, snapping and proportional editing in ToolSettings, `frame_current`, and the 3D Viewport's `RegionView3D` for view-dependent operators.

### Animation

Decided 2026-10-28. Animation data is Blender's, in the module's Main: each animated ID has AnimData and a layered Action (`animrig`), whose F-Curves are the truth. Bylonder's channels map onto them (`src/blenkernel/animation/model.js`): an object's position, rotation and scaling are its Object's `location`, `rotation_euler` and `scale` in Blender's axes; every other channel is a custom property of the Scene (`["<id, path>"]`). Keys go in with `animrig::insert_vert_fcurve` and the Preferences' settings, values come out with `evaluate_fcurve`, and Blender's operators that auto key (Object Mode's) add keys the animation takes (`model.keying`).

The Timeline, Dope Sheet and Graph Editor are Blender's spaces (`SpaceAction` with its `TIMELINE` and `DOPESHEET` modes, `SpaceGraph`), each a `ScrArea` in the module made by its space type's own `create` (`tools/blender-port/wasm/anim-api.cc`, JS `editors/animation/anim-area.js`). Their operators, the channel list (`ANIM_animdata_filter`), key columns (`keyframes_keylist.cc`), View2D and transform conversion are Blender's code. Bylonder is the window manager (`editors/animation/anim-editor.js`): it lays out the regions, turns DOM events into `wmEvent`s for the editors' keymaps (`keymapHandler`), runs modal operators with their modal keymaps, draws box, circle and lasso gestures and the popups an invoke asks for (confirmation, enum menus), and draws the regions on canvases with the theme's colors (`anim-draw.js`, after `action_draw.cc`, `graph_draw.cc`, `keyframes_draw.cc`). Headers and menus are Blender's scripts (`space_time.py`, `space_dopesheet.py`, `space_graph.py`) through `drawMenu`.

## Shared foundations

Every subsystem builds on these, one of each:

- Blender's Python: `tools/blender-ui/tree.py` compiles Blender's whole `scripts/startup` and `scripts/modules` into `src/bl_py`, over a boundary of Bylonder's modules (`tools/blender-ui/boundary`: `_bpy` and the C modules, the module registry). `transpile.py`'s per-class manifest is the interim path until `src/bl_py` replaces `src/bl_ui`.
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

## Workspaces

The app opens in the Layout workspace: the window is Blender's (topbar, editors, status bar). Scripting is a workspace like Blender's, reached from the topbar's workspace tabs; its Text Editor, File Browser and Console are to become Blender areas rather than an outer workbench.

- The topbar has Blender's eleven default workspace tabs. A tab opens the screen Bylonder has for it: Scripting opens the code workspace (Text Editor, File Browser, Console beside the scene), every other tab the Layout screen, until Bylonder has their editors (Image Editor, Spreadsheet, sculpt and paint modes).
- The Layout screen is startup.blend's: its split positions are read from the file's area vertices (1920 x 1080) and kept as fractions, which Blender scales with the window; areas stay at least one header high. The topbar and status bar are fixed heights in pixels at UI scale, as Blender's global areas.
- The topbar's right region is Blender's: the Scene selector and the View Layer selector (the scene window's view layers, set through `send`).
- Workbench controls sit where an add-on would put them. A project is Bylonder's .blend file: File > Open and Open Recent list projects, the window title names the open one. Run is the Text Editor header's Run Script (Ctrl Enter, also Render > Run), as Blender runs a script from there. Project actions are File, Edit and Render menu entries.

## Menus

Menus drawn from Blender's scripts show every entry Blender's draw makes. An entry whose operator Bylonder does not run yet is greyed out, as Blender shows an operator whose poll fails. Its shortcut is Bylonder's binding if there is one, else Blender's: `windowmanager/keyconfig.js` reads Blender's default keymap (`keymap_data/blender_default.py`, transpiled) in the keymaps the editor's handlers run, in order.

## 3D View regions

The toolbar, tool settings, header transform settings and sidebar are Blender's scripts, transpiled whole where they are systems.

- Tool system: `space_toolsystem_common.py` and `space_toolsystem_toolbar.py` are transpiled as whole modules. `windowmanager/wm-toolsystem.js` keeps Blender's state (bToolRef per mode, `workspace_tool_type`, the group memory `_tool_group_active`) and runs Blender's Python for everything else: `draw_cls` draws the toolbar, `activate_by_id` sets the tool, `wm.tool_set_by_id` cycles. The active tool's keymaps run before the mode's, in the order of `wm_event_get_keymap_from_toolsystem_ex`, including the fallback tool's keymap off the gizmo, with the tool's stored operator properties. Blender's keyconfig loads with the preference defaults of `Blender.py` (left click select, fallback tool on).
- Tool icons are Blender's `.dat` triangle files, converted to SVG by `tools/blender-ui/tool_icons.py`.
- The toolbar (`editors/space_view3d/view3d-toolbar.js`) records `draw_cls`'s layout calls and draws Blender's one icon column: groups open their flyout on a 0.2 s hold or a drag, the region snaps to Blender's widths.
- The Transform panel is C (`view3d_buttons.cc`). It is ported as the layout calls it makes (`view3d-buttons.js`), not built to WASM: it only reads and writes RNA, so the layout calls are the whole of it.
- Panels and headers draw through `editors/space_view3d/region-layout.js` and `.css`, an interim renderer used only by `view3d-regions.js`. It is to be replaced by the shared layout renderer (Properties editor), with no other caller to change.
- Transform orientation slots are stored per scene but no transform reads them yet.
- Select Box, Circle and Lasso share `do_mesh_region_select` (`view3d-select.js`) in Edit Mode; in Object Mode box select tests vertices and circle and lasso the object origin, as Blender does. The gestures are `windowmanager/wm-gesture-*.js` with Blender's modal maps.

## Node editors

The Shader Editor and Compositor build on the same foundations: Blender's node declarations and GLSL run as runtime-registered Babylon blocks, and the editor's Add menu and keys are Blender's menus and keymaps. See `docs/node-editors.md`.

## Using it

    const host = { world, selection: editor.selection, update: () => { ui.refresh(); views.wake(); }, undoPush: () => history.commit() };
    const r = createRNA(host);
    const ui = menuUI({ menus, context: () => createContext(r, { space: view }), prop: propBinding(host) });

`tests/context.test.js` draws `VIEW3D_MT_editor_menus` and all its submenus in Object and Edit Mode over a NullEngine scene, and checks that bound properties read and write through.

## Next

- The 3D View's Object Mode Select and Object menus are Blender's, over `createContext`, running Bylonder's actions by the operators they name (`editors/object/object-operators.js`). Next: View and Add, and the Edit Mode menus (`view3d-menus-edit-mesh.js`, which builds its own context).
- Properties editor contexts: `SpaceProperties`, `context.modifier`, `context.material`.
- The topbar's scene properties across windows (decision 7).
- Camera and Light data, Mesh element collections, collections and view layers from the collections slice, Preferences.
