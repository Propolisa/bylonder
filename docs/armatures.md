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
  object's selection changed, which is flushed into Main first: Object Mode draws an armature in its object's wire
  color. The armature's Babylon object is an empty mesh, its object's transform.
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
- A click selects with Blender's pick (`ED_armature_edit_select_pick_bone`, `ED_armature_pose_select_pick_bone`) on the
  bone part the overlay draws under the pointer (port-override: the module has no GPU selection buffer).
  `src/draw/overlay-armature-select.js` syncs the overlay for selection and projects each part it draws (bodies,
  heads, tails, with their select ids) into the view: `armatureParts` gives them, for box, circle and lasso selection
  too; `pickBone` takes the hits within 12 pixels, then 5, and prefers joints and unselected bones, then the nearest,
  as `get_nearest_editbonepoint` does. In Object Mode a click on the bones selects the armature when they are nearer
  than the mesh under the pointer.
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

## Animation

Pose bones are keyed as Blender keys them, in Main: I in Pose Mode is `anim.keyframe_insert` on the selected pose
bones (`pose.bones["Bone"].location` and the rest, in a group named after the bone), and the Insert Keyframe menu's
keying sets are Blender's (`keyingsets_builtins.py`, registered as Blender registers a `KeyingSetInfo`: Location,
Rotation, Scaling, Whole Character, Available, ...). A frame change evaluates the action (`frameChanged`) and the view
draws the evaluated pose. The Timeline, Dope Sheet and Graph Editor are Blender's, so they list the F-Curves under each
bone's group and show keys of the selected bones. Alt G, R and S (`pose.loc_clear`, `rot_clear`, `scale_clear`), Copy
and Paste Pose (Ctrl C, Ctrl V, Shift Ctrl V flipped: `pose.copy`, `pose.paste`) and Apply Pose as Rest Pose
(`pose.armature_apply`) are Blender's.

## Tests

`tools/blender-reference/rigging-fixtures.py` runs Blender 5.2.3 on 10 rigging cases in Pose Mode (the clears, copy and
paste and paste flipped, Apply Pose as Rest Pose, bone collections with `collection_remove_unused`, solo and visibility,
bone colors, selection sets, bone and object constraints, keying with I and with keying sets, and the pose a frame
evaluates to). `tests/rigging-wasm.test.js` replays them through the module and compares, checks that the Armature,
Bone and constraint tabs draw Blender's panels with their properties in Pose and Edit Mode, that the Graph Editor lists
a pose bone's F-Curves under its group, and the armature tools and their icons.

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
- Box, circle and lasso select of bones (`armatureParts` gives the parts).
- Framing an armature (View Selected): its Babylon object has no bounds.
- Vertex groups: Bylonder's meshes have none, so the Armature modifier deforms by envelopes only;
  `object.parent_set` with automatic or envelope weights and `object.vertex_group_*` need deform weights on the Babylon
  side.
- An Armature modifier read from a .blend, or added in Main by Blender's operators (`object.parent_set` with
  `ARMATURE`), is not taken into Bylonder's stack; the object field of its panel is not checked yet.
- A stack evaluated in Main applies every Blender modifier of the object there, so a Geometry Nodes Array after the
  Armature modifier that Main holds as Blender's Array applies twice.
- Edit Mode's modifier preview (`editFinal`) evaluates in a worker without the armature.
- A click on a bone collection in the Armature tab's tree view does not make it active, and a double click does not
  rename it: Blender activates a view item through its keymap's `ui.view_item_select` at the pointer, which needs the
  item's place in the region. Module change: `ui_button_press` (`ui-tree.cc`) activating a `ViewItem` button's item
  (`view_item->activate(*C)`, as `force_activate_view_item_but` does). A new collection is the active one.
- `armature.select_linked_pick`, `armature.shortest_path_pick` and `pose.select_linked_pick` (L, Ctrl click) pick by
  the GPU selection buffer, which the module lacks. Module change: a seam for `ED_armature_pick_bone` and
  `ed_armature_pick_ebone` (`armature_select.cc`) that asks Bylonder's picking for the bone under the pointer, as
  `armature_select_pick` does for a click.
- The pose library (`poselib.*`): its operators are the `pose_library` add-on's and the asset shelf's. It needs the
  add-on in the Python tree (`tree.py`), Blender's default add-ons in the module's preferences
  (`BKE_blendfile_userdef_from_defaults` lists them; the module's `U` has none, so `addon_utils.reset_all` enables
  nothing) and the 3D View's asset shelf (`VIEW3D_AST_pose_library`).
- A Dope Sheet made from another editor keeps the Timeline's hidden channel region (View > Channels shows it).
- Export: `.blend` files carry the armature (Blender reads its bones and pose); the `.babylon` and JavaScript exports
  write the armature as an empty mesh; a Babylon `Skeleton` from the pose and skinned meshes (glTF style) are not made
  yet.
