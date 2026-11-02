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
Status: partial
The Preferences editor is Blender's own `space_userpref` in the module (`editors/space_userpref`), over Blender's `U`:
its header, navigation bar, execute region and every section's panels are Blender's Python UI. Edit > Preferences opens
it in a window of the page, or maximized in the app's area per Temporary Editors > Preferences; Editor Type shows it in
any area. Settings Blender's own code reads work as in Blender; what a browser cannot honor or Bylonder does not yet is
greyed out with its reason (`support.js`), never hidden. Save Preferences, Revert and Load Factory Preferences are
Blender's operators over Blender's user directory (`/user` in the module's file system, `ghost-paths.cc`), which the
page keeps in IndexedDB (`wm-userdef.js`); auto-save runs as WM_exit's when the page is hidden. Bylonder's own settings
are the AddonPreferences of a built-in add-on, `bylonder`, in System > Bylonder. Themes reach the interface through
the design tokens (`theme-tokens.js`); theme colors no token stands for are greyed out.

## PREFERENCES > Add-ons
Status: partial
Blender's own addon_utils lists the add-ons: the tree ships each bundled add-on's `__init__.py` up to its `bl_info`
(what addon_utils reads of an add-on it does not import) and Bylonder's own (`tools/blender-ui/bylonder_addon.py`),
read through the boundary's `open`, `ast` and `_py_eval`. Only the add-ons whose code the tree holds (the Pose
Library, Bylonder) can be enabled; the others are greyed out as not included, and installing from disk or online as
not supported yet (`support.js`).

## PREFERENCES > Keymap
Status: partial
Blender's key configuration is loaded as `bpy.utils.keyconfig_init` loads it: the Blender preset (`Blender.py`, its
KeyConfigPreferences registered) and the active one, generated with the Preferences, into Main's window manager; a
change that alters keymaps (Select With, Spacebar Action, Emulate 3 Button Mouse) loads it again, as
WM_keyconfig_reload does. The page's own keymaps read the user key configuration Blender makes
(`windowmanager/keyconfig.js`), so edits apply everywhere. A compiled preset runs once with the tree, so its
`__main__` block and its keymap data binding are run by `keyconfigSet` (`wm-window.js`).

## PREFERENCES > Input
Status: partial
Emulate 3 Button Mouse, Emulate Numpad, double click, drag thresholds and the touchpad's scroll direction are Blender's
own (`wm_event_add_ghostevent`); the page applies the two emulations to the events it handles itself
(`wm-event-system.js` `emulateInput`). A trackpad's two-finger drag and pinch arrive as GHOST's trackpad events, a
pen's pressure and tilt as GHOST's tablet data. NDOF is built out of the module.

## VIEW_3D > Navigation
Status: partial
The 3D View's navigation is Blender's operators (view3d.rotate, move, zoom, dolly, view_axis, view_persportho,
view_selected, view_all, smooth view) on the area's RegionView3D; the editor camera follows it (`navigation.js`
`follow`), so the Navigation preferences apply. The navigation gizmo invokes them as Blender's gizmo does
(`wm_area_operator_invoke`) and touch gestures map onto trackpad events. Auto Depth has no depth buffer.

## SEQUENCE_EDITOR > *
The Video Sequencer and File Browser are KubeezCut islands. Their Blender identifiers live in the KubeezCut fork, which this scan does not read yet.

## SEQUENCE_EDITOR > Scene Audio
Status: partial
Blender mixes a scene's sound (its speakers and its own sequencer) into a scene strip. Bylonder has no speakers: a
scene's sound is whatever its code plays through Babylon's spatial audio, heard from its camera. Add > Scene Audio puts
that sound in the edit as an audio strip of its own; the scene renders it in a render context, on an offline audio
context, a frame at a time at the scene's frame rate (`src/sequencer/scene-audio.js`, `renderAudio` in
`src/render/context.js`), and again when the scene changes. Each frame of sound advances the scene's logic and
animations without drawing it. While the sequencer follows the scene's time, the active scene plays its sound live,
so its strip is silent in the preview; renders mix it. Render Animation without the sequencer mixes the same sound
into video formats with audio while its frames render in the live scene: frames start at once and the sound is added
to the video at the end (silence for a scene that makes none). Blender's speakers could feed the same source later.

Opening the Video Sequencer on an empty edit offers Blender's video editing setup: FFmpeg output in MPEG-4 (H.264,
AAC) instead of PNG images, the scene as a strip and its Scene Audio. Remember keeps the choice, and Edit >
Preferences asks again.

## mesh.primitive_uv_sphere_add
Blender's operator builds it in the module, with Blender's positions and edges; its face and edge order differs from Blender's after the spin and merge it runs, which the primitive tests note.

## mesh.primitive_torus_add
Blender's own Python operator (`add_mesh_torus.py`, transpiled) builds the torus, and the module derives its edges as `mesh.update()` does.

## object.modifier_add
Blender's modifiers run Blender's own code in the module (`tools/blender-port/wasm/modifier-api.cc`) on the object's Mesh. Settings are stored by RNA identifier (`use_axis[1]`), described by Blender's RNA (`tools/blender-reference/modifiers.py`) and written at the DNA offsets `tools/blender-port/modifier_dna.py` reads from `rna_modifier.cc`. Armature deforms by another object of the scene; the other types that need other objects, vertex groups or binding are not offered yet. Simulation modifiers (Particle System, Cloth, Soft Body, Collision, Dynamic Paint) come from the Particles and Physics tabs and stay Main's. Array (Nodes) stands for Blender's Array node group asset and goes after Blender's modifiers in the stack. The Add Modifier menu is Blender's (`properties_data_modifier.py`, transpiled), and each panel is laid out by its own `panel_draw` in the module (`tools/blender-port/wasm/panel-layout.cc` records the layout; JS draws it). Fields for vertex groups, objects and operators in those panels come later.

Main's depsgraph evaluates the stack, as Blender's does, and the view draws the evaluated Mesh (`src/blenkernel/main-view.js`); a Mesh Babylon built becomes the object's Mesh data once a Blender modifier is on it. Evaluation runs on the main thread, as in Blender. Apply evaluates the modifier on the object's Mesh alone in a Main of its own (`modifier-object-main.cc`). The stack is Main's: Blender's modifiers are the object's own in Main, edited by Blender's operators and by `world.modifiers` through Blender's editor functions (`object_modifier.cc`'s add, remove, move, copy and apply). Bylonder's own modifiers (Array (Nodes), Geometry Nodes) are Babylon-native data on the object, drawn on top of the evaluated Mesh.

## object.particle_system_add
Blender's particle systems run Blender's own code in the module, with Blender's Particles tab (`properties_particle.py`, transpiled) and every operator of theirs (`particle.*`, `boid.*`). Main's depsgraph simulates them on each new frame. The view draws them as Blender's draw engines do (`docs/blender-boundary.md` Drawing): Render As Object or Collection as thin instances of that object's geometry and material; the overlay's Dot, Circle, Cross and Axis by Blender's own overlay shaders, each particle a thin instance carrying its point, colored by velocity or acceleration on Blender's weight ramp as its settings ask; and hair as Blender's curves: strands, strips or cylinders as the scene's Hair shape and subdivision say, placed by Blender's curve shape functions, as Workbench's hair in Solid, in the emitter's material in Material Preview and Rendered, and as the overlay's hair in Wireframe. In Material Preview and Rendered a strand is shaded as EEVEE shades it, as a cylinder, in the emitter's material: Hair Info gives each point's Intercept, its strand's Length, Thickness, Tangent Normal and Random, and the Hair BSDF and Principled Hair BSDF shade as EEVEE's diffuse closure of their Color, as EEVEE does. Not drawn: selection ids, clipping and Blender's line anti-aliasing, as for the other overlays, and hair's UV and color attributes. Bylonder's Babylon particle systems follow Blender's panels in the tab, as an add-on's do.

Particle Edit Mode is Blender's on Main (`src/editors/object/main-modes.js`): the header's mode menu enters it, Blender's Particle keymap and tools run (Comb, Smooth, Add, Length, Puff, Cut and Weight, `particle.brush_edit` by Blender's code from the 3D View's events), and the overlay draws the edit's strands and keys by Blender's edit particle shaders, colored by selection or, with the Weight brush, by weight.

## object.effector_add
Force fields (Wind, Turbulence, Vortex and the rest) are Blender's: an Empty or an object's field, read by particles, cloth, soft bodies and rigid bodies in the module. The field's own shape (wind's arrows, a vortex's spiral) is not drawn; the Empty is.

## rigidbody.object_add
Blender's rigid body world steps Bullet in the module on each new frame, and the view draws each object where it is evaluated. The Physics tab (`properties_physics_*.py`) adds rigid bodies and constraints, cloth, soft body, collision, dynamic paint and force fields; Fluid is past the seam (no Mantaflow).

## ptcache.bake
Point caches are Blender's, kept in memory. Simulations step a frame at a time, so a frame jumped to (scrubbing ahead, or a frame rendered on its own) first steps the frames the caches have not reached, from each cache's last exact frame (`view-api.cc` `view_frame_set`): it shows what playing up to it shows, where Blender would show the outdated state. Bake runs as Blender's job, to its end, as the module has no threads (`platform.cc` `BLI_threadpool_insert`). Disk caches need a saved file, which the module has no place for.

## object.shade_smooth
Status: partial
Project code calls `shadeSmooth(mesh)` (and `shadeSmooth(mesh, false)` for Shade Flat), which clears or sets `sharp_face` on the object's Mesh. The Object menu entry comes later. Mesh data from code is `createMesh`, Blender's `Mesh.from_pydata`.

## Transform Modal Map > *
Typed values, the Global and Local cycling of repeated axis keys and the header text follow transform.cc. The scene orientation is always Global, so the second axis press is Local. Ctrl snaps to 1 unit in every view; Blender's orthographic axis views step the grid with zoom.

## node.add_node
Shift A opens Blender's own Add menu (`node_add_menu*.py`, transpiled), with search as you type. It adds the Blender nodes Bylonder runs (Math, Mix, Color Balance so far); Babylon's blocks are in a Babylon sub-menu of each category. See `docs/node-editors.md`.

## TIMELINE > *
The Timeline and the Dope Sheet run Blender's `space_action` and `editors/animation` code in the module; see `docs/blender-boundary.md` (Animation). Markers are the scene's (Scene.timeline_markers in the module), saved with the animation. The header's mode menu switches between the Dope Sheet, Action Editor, Shape Key Editor, Grease Pencil, Mask and Cache File modes through rna_space.cc's own mode update; The Timeline's summary shows Grease Pencil layers' keys; Bylonder has no shape keys, masks or cache files yet, so those modes list nothing. A Dope Sheet keeps the Timeline's collapsed summary wherever it is opened, as when Blender switches the Timeline's area, so in another area it differs from Blender's new Dope Sheet.

## DOPESHEET > *
As the Timeline: the same space in its Dope Sheet modes.

## FCURVES > *
Blender's `space_graph` code in the module, with the same window manager as the Dope Sheet. Its sidebar is Blender's own C panels (`graph_buttons.cc`, `fmodifier_ui.cc`), drawn in the module and recorded. The Drivers editor is the same space in its Drivers mode (Editor Type > Drivers). Adding a driver from a property's context menu, and driver values reaching Babylon's objects, are not done yet.

## DRIVERS > *
As the Graph Editor: the same space in its Drivers mode.

## OUTLINER > *
Status: partial
Blender's `space_outliner` code in the module, drawn on a canvas from its own draw calls; see `docs/blender-boundary.md` (Outliner). View Layer display mode only; other display modes, context menus on IDs that are not objects or collections, and scroll bars are not shown yet.

## VIEW3D_PT_transform
The C panel (`view3d_buttons.cc`) is ported as its layout calls in `editors/space_view3d/view3d-buttons.js`. Edit Mode's Median panel is not ported yet.

## VIEW3D_HT_header > *
The transform settings (`draw_xform_template`) draw from Blender's Python. Transform orientation slots are stored but no transform uses them yet.

## 3D View Tool: Measure > *
Rulers are kept in the scene's annotations (`RulerData3D`) as Blender keeps them, and drawn with Blender's units. Snapping (Ctrl) reaches vertices, edges, edge midpoints, the point of an edge perpendicular to the ruler's other end, and faces of the objects drawn, refined along an edge as `snap_edge_points_impl` does.

## Generic Tool: Annotate > *
Strokes are smoothed and simplified as `annotate_paint.cc` does and drawn in screen space with the layer's color and thickness. Pressure is the pointer's. The stabilizer (`use_stabilizer`, or Shift while drawing) trails the pointer by its factor outside its radius and draws its rings and rope; the onion skin is not drawn yet.

## 3D View Tool: Edit Mesh, Loop Cut > *
The edge ring under the pointer is Blender's preselection (`EDBM_preselect_edgering_update_from_edge` in the module), drawn by Bylonder's `VIEW3D_GGT_mesh_preselect_edgering`. A press runs `mesh.loopcut` at that edge, then Blender's Edge Slide modal.

## 3D View Tool: Edit Mesh, Spin > *
The gizmo (`MESH_GGT_spin`) draws two buttons per enabled axis around the 3D cursor; a click spins about the axis. Spin asks for its redo gizmo (`MESH_GGT_spin_redo`), a dial at the spin's center whose drag adjusts the angle through Adjust Last Operation. The gizmos are Bylonder's drawing; the operator is Blender's.

## 3D View Tool: Edit Mesh, Poly Build > *
Not in Edit Mode on Main yet: its operators read the preselection gizmo's element (`ED_view3d_gizmo_mesh_preselect_get_active`), which Main's stand-in gizmo map does not have.

## 3D View Tool: Edit Mesh, Extrude Manifold > *
Blender's macro runs in the module, its move with `use_automerge_and_split`, so faces the move dissolves into their neighbors are merged and split as in Blender.

## 3D View Tool: Edit Mesh, Bisect > *
The line is Blender's straight-line gesture (`WM_gesture_straightline_invoke` and its modal, `gesture-api.cc`), drawn by Bylonder. Blender then asks for its gizmo (`MESH_GGT_bisect`), which is not drawn: the plane is adjusted from Adjust Last Operation.

## VIEW3D_MT_curve_add
Blender's own primitive operators fill the curve, in the module (`ED_curve_add_nurbs_primitive`). Surfaces (Add > Surface) are not offered yet. See `docs/curves-and-text.md`.

## object.text_add
Text objects are Blender's: its text layout (`BKE_vfont_to_curve`) with its built-in font, FreeType in the module. Fonts other than the built-in one load from their files' bytes; a font file picker is not offered yet.

## object.armature_add
Armatures are Blender's: their bones, Edit Mode, Pose Mode, the evaluated pose and the Armature modifier run in the
module, and so does the overlay's armature drawing (`overlay_armature.cc`, every display type, custom shapes, names,
axes and relationship lines), drawn with Blender's overlay shaders. A click picks the bone part the overlay draws under
the pointer on the CPU (the module has no GPU selection buffer). See `docs/armatures.md`.

## sculpt.brush_stroke
Status: partial
Sculpt Mode is Blender's on Main, with the Essentials brushes, the tool header and the sculpt tools; see `docs/blender-boundary.md` (3D View regions). The asset shelf region, the brush cursor and the mask, face set and dyntopo overlays are not drawn yet.
