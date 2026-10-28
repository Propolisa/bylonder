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

`tools/blender-port/wasm/editor-context.cc` builds its own small context around the edit BMesh: a Scene with ToolSettings and one ViewLayer, one Object in Edit Mode with its Mesh, found through the context store. `operator-properties.cc` gives operators and modifier DNA structs RNA by identifier. It should mirror the JS RNA, not hold Bylonder state of its own:

- What it reads from Bylonder are the same properties under the same names, set from the JS structs before an operator runs: `ToolSettings.mesh_select_mode` (`edit_context_selectmode_set`), the object's matrix in Blender's axes (`edit_context_object_matrix_set`, from `location`, `rotation_euler` and `scale`), and a modifier's settings by RNA identifier (as now).
- Next to mirror, as Bylonder gains them: `scene.unit_settings` (operators and `ED_scene_grid_scale` read `scene->unit`), proportional editing and snapping in ToolSettings, `frame_current` for operators that read time, and the 3D Viewport's `RegionView3D` for view-dependent operators.
- One list of RNA paths then names everything that crosses, so a value Blender's C++ reads is the value Blender's scripts show.

## Workspaces

The app opens in the Layout workspace: the window is Blender's (topbar, editors, status bar). Scripting is a workspace like Blender's, reached from the topbar's workspace tabs; its Text Editor, File Browser and Console are to become Blender areas rather than an outer workbench.

- The topbar has Blender's eleven default workspace tabs. A tab opens the screen Bylonder has for it: Scripting opens the code workspace (Text Editor, File Browser, Console beside the scene), every other tab the Layout screen, until Bylonder has their editors (Image Editor, Spreadsheet, sculpt and paint modes).
- The Layout screen is startup.blend's: its split positions are read from the file's area vertices (1920 x 1080) and kept as fractions, which Blender scales with the window; areas stay at least one header high. The topbar and status bar are fixed heights in pixels at UI scale, as Blender's global areas.
- The topbar's right region is Blender's: the Scene selector and the View Layer selector (the scene window's view layers, set through `send`).
- Workbench controls sit where an add-on would put them. A project is Bylonder's .blend file: File > Open and Open Recent list projects, the window title names the open one. Run is the Text Editor header's Run Script (Ctrl Enter, also Render > Run), as Blender runs a script from there. Project actions are File, Edit and Render menu entries.

## Menus

Menus drawn from Blender's scripts show every entry Blender's draw makes. An entry whose operator Bylonder does not run yet is greyed out, as Blender shows an operator whose poll fails. Its shortcut is Bylonder's binding if there is one, else Blender's: `windowmanager/keyconfig.js` reads Blender's default keymap (`keymap_data/blender_default.py`, transpiled) in the keymaps the editor's handlers run, in order.

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
