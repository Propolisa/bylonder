# Armatures

Blender's Armature objects (`OB_ARMATURE`) in Bylonder: Blender's own C++ for the data, Edit Mode, Pose Mode, the pose
evaluation and the Armature modifier, in the module (`src/bmesh/bmesh.wasm`). Decided 2026-10-29.

## Data

- An armature is an Armature ID in the shared Main (`main_object_add` with `OB_ARMATURE`). Its bones and pose cross
  through `tools/blender-port/wasm/armature-api.cc`: `armature_bones_get` reads the bones (the edit bones in Edit Mode)
  with their pose channels, `armature_bones_set` replaces them, outside Edit Mode as leaving Edit Mode makes bones
  (`ED_armature_from_edit`) with the pose rebuilt. Drawing reads Main directly (Evaluation and drawing).
- Main owns the bones: undo is Blender's (memfile steps) and a project saves them in its `.blend` (`model.md`). The
  view (`main-view.js`) writes what Main holds into the object's record in RNA's terms
  (`metadata.wbCreation.armature`), as it writes a curve's splines, after Blender's code ran, an undo step loaded or a
  frame changed, with the object's mode (`metadata.wbMode`): each bone's `name`, `parent`, `head`, `tail`, `roll`,
  envelope settings and EditBone booleans, and its `pose` (`location`, `rotation_mode`, `rotation_quaternion`,
  `rotation_euler`, `scale`, `select`, `hide`). See `src/blenkernel/armature/armature.js`. The scene sync writes a
  record Bylonder's own code sets into Main. Objects Blender's code adds (Add > Armature, `object.armature_add`) are
  made as Babylon objects of their kind.
- The module had Armature as an ID type without data: `modifier-api.cc`'s stand-in, whose initializer wrote over
  `armature.cc`'s type though Blender's definition won the link. The stand-in is now only in the modifiers module
  (`modifiers-only.cc`).

## Evaluation and drawing

- Blender's depsgraph evaluates each armature's pose after its world matrix (constraints and IK included), when
  `main_evaluate` runs it.
- Bones are drawn as Blender's overlay draws them, by Blender's code. `tools/blender-port/wasm/armature-draw.cc`
  compiles Blender's own `overlay_armature.cc` with stand-ins for the draw manager it syncs into (its
  `overlay_armature.hh` is an empty header in the build, `blender_build.py` `OVERLAY_STAND_INS`): `armature_draw` runs
  its Edit Mode or pose sync on the object in Main, the evaluated pose, B-Bone segments
  (`BKE_pchan_bbone_spline_setup`, or `ebone_spline_preview` in Edit Mode), display type per bone, custom shapes with
  their transform, scale and wire width, bone color palettes and the theme's bone colors per mode, hidden bones per
  mode, names, axes and relationship lines all as Blender decides them, and gives each of the overlay's buffers: what
  its shader reads per instance, a select id each. Theme colors are read as `Resources::update_theme_settings` reads
  them. `armature_shape_mesh` gives a custom shape's mesh as the draw cache's batches the overlay names (surface, edge
  detection, loose and all edges). Empties as custom shapes draw their shape; curve and text custom shapes do not draw.
- `src/draw/overlay-armature.js` draws the buffers with Blender's shaders (`overlay_armature_*`, `overlay_extra_*` for
  axes and the dashed relationship lines, in `gpu-library.js` `draw`): a mesh per buffer of its shape
  (`overlay-shape.js` `BONE_SHAPES`, `overlay_shape.cc`'s), the buffer's data as instance attributes, in the passes'
  order and states (`Armatures::begin_sync`), opaque or transparent per view (Wireframe, X-ray in Solid), In Front over
  the scene. Names are drawn as the overlay's text over each view. Shading, outlines and joints are the shaders' own;
  the colors are written in display space as Blender's sRGB overlay buffer holds them.
- The overlay syncs an armature again when Main evaluated it (`main-view.js` calls `armatureChanged`) or when its
  object's selection changed, which is flushed into Main first. `armature_draw` evaluates the depsgraph's pending
  updates before it syncs, as Blender's window evaluates them before drawing: an operator that tagged the armature
  (Add Bone Constraint in the Properties editor) otherwise leaves its evaluated copy without a pose, and no bones draw.
  Object Mode draws an armature in its object's wire
  color. The armature's Babylon object is an empty mesh, its object's transform.
- View Selected (Numpad .) frames an armature by its posed bones, in Pose Mode by the selected ones, as Blender's does
  (`armature-api.cc` `armature_view_bounds`: `BKE_object_minmax`, `BKE_pose_minmax`).
- The status bar shows Blender's statistics in an armature's Edit and Pose Modes (`main_statistics`,
  `ED_info_statusbar_string_ex`): Joints and Bones.
- The Armature modifier (`ARMATURE`, a scene modifier in `src/modifiers/blender.js`) holds its armature by Bylonder id,
  which RNA's `object` reads and writes as the Object (`modifier.object = armature` in a script); the sync points its
  `object` at that armature's Object in Main. A stack with it evaluates in Main (`sync.evaluatedMesh`), not in a
  worker, so the deform reads the evaluated pose; it redraws when the armature's data or either object's placement
  changes. The module's modifiers now get their entry's `showViewport` and `showRender` as their ModifierMode.

## Modes and operators

- `object.mode_set`, `object.editmode_toggle` and `object.posemode_toggle` are Object Mode's operators, Blender's in
  Main (`object-operators.js`), so Tab and Ctrl Tab enter and leave an armature's modes as in Blender; the mesh and
  curve editors leave armatures to them. `src/editors/object/main-modes.js` registers every `armature.*` and
  `pose.*` operator the module has by idname, run through `runBlenderOperator`, modally from an event, so the Armature
  and Pose keymaps and menus run Blender's code (E is `armature.extrude_move`, Blender's macro).
  G, R and S are Object Mode's transforms, Blender's in Main, which move edit bones or pose bones by the object's mode.
- The context's mode is `EDIT_ARMATURE` or `POSE`, `edit_object` and `pose_object` are the armature, and the 3D View
  runs the Armature or Pose keymap in place of Object Mode's.
- Selection is Blender's view3d operators in Main: a click (`view3d.select`), the Select Box tool and B
  (`view3d.select_box`), C (`view3d.select_circle`) and a Ctrl right drag or the Select Lasso tool
  (`view3d.select_lasso`), with their modes (set, extend, subtract, invert), and L, Shift L and Ctrl click
  (`armature.select_linked_pick`, `pose.select_linked_pick`, `armature.shortest_path_pick`). Circle and lasso project
  the bones as Blender does (`armature_foreachScreenBone`); a click, a box and the picks read Blender's GPU selection
  (`view3d_gpu_select_ex`). `tools/blender-port/wasm/gpu-select.cc` compiles Blender's `gpu_select.cc` and
  `gpu_select_next.cc` and answers the draw loop they run (`DRW_draw_select_loop`, port-override: the module has no
  GPU): `armature-draw.cc` syncs the overlay for selection (its select ids, the object's with the bone's index and
  part) and catches what each instance would draw into the selection rectangle (its shape projected as triangles,
  capsules and discs, in the view's own matrices), with the nearest depth and the distance to the cursor the select
  engine reads back. Only armatures in Edit and Pose Mode draw select ids there; a mesh's or curve's parts would need
  their own. In Object Mode a click on the bones selects the armature when they are nearer than the mesh under the
  pointer (`armature_pick_depth`).
- Ctrl Tab is the Object Non-modal keymap's `view3d.object_mode_pie_or_toggle`, Blender's, which toggles an armature's
  Pose Mode. A browser keeps Ctrl Tab for its own tab switching and never gives it to the page, so there the header's
  Mode menu (`object.mode_set`, its items Blender's `object_mode_set_itemf` gives) enters Pose Mode.
- The toolbar is Blender's in each mode (`VIEW3D_PT_tools_active`): Edit Mode's Roll, Bone Size, Envelope, Extrude and
  Shear, Pose Mode's Breakdowner, Push and Relax, with their icons (`tools/blender-ui/tool_icons.py`).
- The Properties editor is Blender's (`space_buttons`), so its Armature, Bone, Bone Constraints and Constraints tabs are
  Blender's panels over Main (`properties_data_armature.py`, `properties_data_bone.py`, `properties_constraint.py`),
  with `context.bone`, `edit_bone`, `pose_bone` and `active_pose_bone` from `buttons_context.cc`. Their operator
  buttons run in the module: `pose.constraint_add`, `constraint.*`, `armature.collection_*` and Blender's Python
  operators (`armature.collection_remove_unused`, `collection_show_all`, `collection_unsolo_all`,
  `copy_bone_color_to_selected`, the `pose.selection_set_*` of `bone_selection_sets.py`), whose properties on RNA's own
  types (`Object.selection_sets`) are defined as Blender defines a script's (`bpy_rna.js`).

## Weight Paint

Weight Paint Mode is Blender's on Main (`WEIGHT_PAINT`, the Weight Paint keymap): Ctrl P > With Automatic Weights
gives a mesh Blender's vertex groups and Armature modifier, and entering Weight Paint Mode with the armature selected
puts the armature in Pose Mode, as `posemode_set_for_weight_paint` does. A drag paints the active vertex group
(`paint.weight_paint`, Blender's stroke, with the Essentials weight brushes shipped in the datafiles), Ctrl paints the
inverse, and Alt click selects a bone, which makes its group active (`view3d.select` with the Weight Paint keymap's
bone selection, through the GPU selection above). The view draws the mesh's weights as Blender's overlay does
(`src/draw/overlay-paint-weight.js`): `overlay_paint_weight_vert/frag.glsl` with the weight ramp, each vertex's weight
in the active group as `extract_weights` gives the draw cache (`main-api.cc` `mesh_paint_weights`). Each view draws
them with its own Overlays > Weight Paint settings, Blender's `View3DOverlay` (`weight_paint_mode_opacity`,
`show_wpaint_contours`) as its popover sets them: in Solid shading without X-ray over the mesh at the opacity
(`overlay_paint.hh`'s masked transparency pass), else opaque, with the shader's contour lines; Zero Weights is the tool
settings' (`vertex_group_user`). The Weight Paint tools are Blender's, with their icons (`tools/blender-ui/tool_icons.py`).

## Pose library

Blender's `pose_library` add-on and its asset shelf (`VIEW3D_AST_pose_library`). The 3D View's asset shelf regions
(`RGN_TYPE_ASSET_SHELF` and its header) are shown as Blender shows them: `wm-api.cc` `wm_area_regions_shown` runs
Blender's region polls (`area_regions_poll`: a shelf type's poll, the pose library's in Pose Mode) and reads the regions'
flags, so View > Asset Shelf (`show_region_asset_shelf`) shows and hides it, hidden at first as Blender creates the pose
library's shelf; the page lays the regions out along the view's bottom at the heights Blender gives them
(`view3d-regions.js`). The shelf is laid out by Blender (`asset::shelf::region_layout`, `ui-tree.cc` `ui_region_layout`:
its grid view of the asset list Blender reads, a window job) and its header by its header type (catalog tabs, search);
the grid's tiles are drawn by `block-view.js`. A click on a tile activates its item as Blender's handlers do, which runs
the shelf's activate operator (`poselib.apply_pose_asset`); a drag past the threshold starts what the item's drag
controller starts (`view_item_drag_start`), the shelf's drag operator (`poselib.blend_pose_asset`), which
`drag-drop.cc`'s `WM_operator_name_call_ptr` hands to the page (`operator_call_handover`) to invoke from the drag, so the
pointer blends the pose until the release; a right click opens the item's context menu (`build_context_menu`: Apply
Pose, Apply Pose Flipped, Blend Pose, Select Pose Bones, ...). Pose > Create Pose Asset (`poselib.create_pose_asset`)
opens Blender's dialog with the Current File as its library: Bylonder has no User Library on disk, where Blender's
default would save (it finds none and refuses), so pose assets live in the project's file and are saved with it.
Previews are rendered on the GPU (`render_preview.cc`), past the seam: a pose asset's preview stays empty
(`region-draw.cc` `icon_render_id`, `icon_ensure_deferred`) and its tile shows its name.

## Animation

Pose bones are keyed as Blender keys them, in Main: I in Pose Mode is `anim.keyframe_insert` on the selected pose
bones (`pose.bones["Bone"].location` and the rest, in a group named after the bone), and the Insert Keyframe menu's
keying sets are Blender's (`keyingsets_builtins.py`, registered as Blender registers a `KeyingSetInfo`: Location,
Rotation, Scaling, Whole Character, Available, ...). A frame change evaluates the action (`frameChanged`) and the view
draws the evaluated pose. The Timeline, Dope Sheet and Graph Editor are Blender's, so they list the F-Curves under each
bone's group and show keys of the selected bones. Alt G, R and S (`pose.loc_clear`, `rot_clear`, `scale_clear`), Copy
and Paste Pose (Ctrl C, Ctrl V, Shift Ctrl V flipped: `pose.copy`, `pose.paste`) and Apply Pose as Rest Pose
(`pose.armature_apply`) are Blender's.

## Runtime

An armature object's deform can run on Babylon (`docs/runtimes.md`, Armature deform): the Armature tab's Runtime panel
(`DATA_PT_bylonder_armature_runtime`, `object.bylonder.runtime`) switches it between Blender and Babylon (mapped), where Babylon
skins the meshes it deforms on the GPU with a `Skeleton` posed from Main's evaluated pose. Blender is the default.

## Tests

`tools/blender-reference/rigging-fixtures.py` runs Blender 5.2.3 on 10 rigging cases in Pose Mode (the clears, copy and
paste and paste flipped, Apply Pose as Rest Pose, bone collections with `collection_remove_unused`, solo and visibility,
bone colors, selection sets, bone and object constraints, keying with I and with keying sets, and the pose a frame
evaluates to). `tests/rigging-wasm.test.js` replays them through the module and compares, checks that the Armature,
Bone and constraint tabs draw Blender's panels with their properties in Pose and Edit Mode, that the Graph Editor lists
a pose bone's F-Curves under its group, and the armature tools and their icons.

`tools/blender-reference/bone-select-fixtures.py` records Blender 5.2.3 with real input (under X, event simulation)
selecting the bones of a chain and a bone apart in Pose and Edit Mode: clicks, Shift clicks, Select Box tool drags with
Shift and Ctrl, L, Ctrl click, C and Ctrl right drags. `tests/bone-select-wasm.test.js` sends the same events through
Blender's window in the module and compares the selected bones and joints after each.
`tools/blender-reference/weight-paint-fixtures.py` records Weight Paint Mode on a grid skinned With Automatic Weights:
Alt click bone selection, a stroke and a Ctrl click; `tests/weight-paint-wasm.test.js` replays them and compares every
vertex's weights, the active group and the pose selection, and the weights the overlay draws.

`tools/blender-reference/pose-library-fixtures.py` records Blender 5.2.3 with real input on a two bone chain in Pose
Mode with a pose asset: the asset shelf hidden, then shown by View > Asset Shelf (its regions' heights), a click on the
pose's tile and a drag from it. `tests/pose-library-wasm.test.js` shows the shelf through Blender's polls and flags, lays
it out, presses and drags the tile through the same code and compares the poses (the blend's factor), checks the
tile's context menu and Create Pose Asset's dialog, and that a pose asset in the Current File survives a .blend save and
applies after reopening.

`tools/blender-reference/armature-draw-fixtures.py` makes a rig in Blender 5.2.3 (three bones, a curved B-Bone of
four segments, an unconnected child, posed, names and axes shown) and writes its pose matrices, B-Bone segment points,
radii, edit bones and theme colors. `tests/armature-draw-wasm.test.js` makes the same rig in the module and checks what
the overlay draws against them: octahedra, B-Bone boxes (start, direction and width of each segment), wire lines,
sticks and envelopes in Pose Mode, Object Mode and Edit Mode, the theme's colors, names, axes, joints, relationship
lines, hidden bones per mode and the selection ids.

`tools/blender-reference/armature-fixtures.py` runs Blender 5.2.3 on 13 cases (Add with and without location and
radius, entering Edit Mode, extrude once, twice and forked, moving all bones, Pose Mode, rotating and moving a pose bone
and all of them, clearing rotation, and the Armature modifier deforming a box by envelopes) and writes the bones, pose
and deformed positions after each step. `tests/armature-wasm.test.js` replays each case through the module and compares
them (the bones' matrices as the overlay draws them), checks the data round trip in Object and Edit Mode, the scene sync (Add, Edit Mode, Pose Mode, a mesh drawn
deformed, an undo step's data going back), the modes' operators, keymaps and context, and bone picking. It is skipped
on a module without `armature-api.cc`.

## Not yet

- Bone drawing: degrees of freedom draw (the pose's IK limits) but are not checked; bone selection by the overlay's
  depth and cycling through overlapping bones; In Front is drawn over the whole scene, not over Blender's in front
  depth; line anti-aliasing and wider outlines (Blender's line pass); the weight paint pass (locked weights, wire
  alpha); curve and text objects as custom shapes.
- An Armature modifier read from a .blend, or added in Main by Blender's operators (`object.parent_set` with
  `ARMATURE`), is not taken into Bylonder's stack; the object field of its panel is not checked yet.
- A stack evaluated in Main applies every Blender modifier of the object there, so a Geometry Nodes Array after the
  Armature modifier that Main holds as Blender's Array applies twice.
- Edit Mode's modifier preview (`editFinal`) evaluates in a worker without the armature.
- The pose library: pose assets have no preview image (Blender renders it on the GPU); the shelf's tiles are not
  drawn by Blender's widget code (no hover highlight or tooltip), and it does not scroll; pose assets go only to the
  Current File (there is no User Library on disk).
- Selection without occlusion: a box selects bones behind other objects, as in X-ray; the select engine's depth test
  against the scene's meshes is not drawn.
- Weight Paint Mode: Bylonder's own meshes have no vertex groups until Blender's code makes them (`object.parent_set`
  with automatic weights does); Show Wire is not drawn.
- A Dope Sheet made from another editor keeps the Timeline's hidden channel region (View > Channels shows it).
- Export: `.blend` files carry the armature (Blender reads its bones and pose); the `.babylon` and JavaScript exports
  write it as a Babylon `Skeleton` with the meshes it deforms skinned and the pose as bone animations
  (`docs/runtimes.md`, Armature deform); the armature object itself is still an empty mesh in the file.
