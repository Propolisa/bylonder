# Armatures

Blender's Armature objects (`OB_ARMATURE`) in Bylonder: Blender's own C++ for the data, Edit Mode, Pose Mode, the pose
evaluation and the Armature modifier, in the module (`src/bmesh/bmesh.wasm`). Decided 2026-10-29.

## Data

- An armature is an Armature ID in the shared Main (`main_object_add` with `OB_ARMATURE`). Its bones and pose cross
  through `tools/blender-port/wasm/armature-api.cc`: `armature_bones_get` reads the bones (the edit bones in Edit Mode)
  with their pose channels and what Blender draws of each, `armature_bones_set` replaces them, outside Edit Mode as
  leaving Edit Mode makes bones (`ED_armature_from_edit`) with the pose rebuilt.
- The Babylon side holds the same data in RNA's terms in the object's creation recipe (`metadata.wbCreation.armature`),
  as a curve holds its splines, so undo, saving and duplicating carry it: each bone's `name`, `parent`, `head`, `tail`,
  `roll`, envelope settings and EditBone booleans, and its `pose` (`location`, `rotation_mode`, `rotation_quaternion`,
  `rotation_euler`, `scale`, `select`, `hide`). See `src/blenkernel/armature/armature.js`.
- The scene sync (`main-sync.js`) pushes the record when Babylon changes it (an undo step) and reads it back after
  Blender's code ran, with the object's mode (`metadata.wbMode`), which Blender's operators set. Objects Blender's code
  adds (Add > Armature, `object.armature_add`) are adopted as Babylon objects of their kind.
- The module had Armature as an ID type without data: `modifier-api.cc`'s stand-in, whose initializer wrote over
  `armature.cc`'s type though Blender's definition won the link. The stand-in is now only in the modifiers module
  (`modifiers-only.cc`).

## Evaluation and drawing

- `main_evaluate` runs `BKE_pose_where_is` for each armature after its world matrix, as the depsgraph's pose
  evaluation does (constraints and IK included).
- The armature object's Babylon mesh is its bones drawn as Blender's overlay draws Octahedral bones
  (`src/draw/overlay-armature.js`): an octahedron per bone placed by the matrix Blender evaluated (the edit bone's in
  Edit Mode, else the pose's), scaled by the bone's length. Main is authoritative; Babylon draws.
- The Armature modifier (`ARMATURE`, a scene modifier in `src/modifiers/blender.js`) holds its armature by Bylonder id,
  which RNA's `object` reads and writes as the Object (`modifier.object = armature` in a script); the sync points its
  `object` at that armature's Object in Main. A stack with it evaluates in Main (`sync.evaluatedMesh`), not in a
  worker, so the deform reads the evaluated pose; it redraws when the armature's data or either object's placement
  changes. The module's modifiers now get their entry's `showViewport` and `showRender` as their ModifierMode.

## Modes and operators

- `object.mode_set`, `object.editmode_toggle` and `object.posemode_toggle` are Object Mode's operators, Blender's in
  Main (`object-operators.js`), so Tab and Ctrl Tab enter and leave an armature's modes as in Blender; the mesh and
  curve editors leave armatures to them. `src/editors/armature/armature-modes.js` registers every `armature.*` and
  `pose.*` operator the module has by idname, run through `runBlenderOperator`, modally from an event, so the Armature
  and Pose keymaps and menus run Blender's code (E is `armature.extrude_move`, Blender's macro).
  G, R and S are Object Mode's transforms, Blender's in Main, which move edit bones or pose bones by the object's mode.
- The context's mode is `EDIT_ARMATURE` or `POSE`, `edit_object` and `pose_object` are the armature, and the 3D View
  runs the Armature or Pose keymap in place of Object Mode's.
- A click selects with Blender's pick (`ED_armature_edit_select_pick_bone`, `ED_armature_pose_select_pick_bone`) on the
  bone Bylonder's picking finds under the pointer (port-override: the module has no GPU selection buffer).

## Tests

`tools/blender-reference/armature-fixtures.py` runs Blender 5.2.3 on 13 cases (Add with and without location and
radius, entering Edit Mode, extrude once, twice and forked, moving all bones, Pose Mode, rotating and moving a pose bone
and all of them, clearing rotation, and the Armature modifier deforming a box by envelopes) and writes the bones, pose
and deformed positions after each step. `tests/armature-wasm.test.js` replays each case through the module and compares
them, checks the data round trip in Object and Edit Mode, the scene sync (Add, Edit Mode, Pose Mode, a mesh drawn
deformed, an undo step's data going back), the modes' operators, keymaps and context, and bone picking. It is skipped
on a module without `armature-api.cc`.

## Not yet

- Bone drawing: selection and active colors, wire, the other display types (B-Bone, Envelope, Stick), names and axes,
  relationship lines, custom shapes. A bone hidden in Edit Mode (`hide`) or in Pose Mode (`pose.hide`) is hidden in
  every mode; Blender hides each in its own mode.
- Picking a bone's head or tail on its own in Edit Mode, box, circle and lasso select of bones.
- Vertex groups: Bylonder's meshes have none, so the Armature modifier deforms by envelopes only;
  `object.parent_set` with automatic or envelope weights and `object.vertex_group_*` need deform weights on the Babylon
  side.
- An Armature modifier read from a .blend, or added in Main by Blender's operators (`object.parent_set` with
  `ARMATURE`), is not taken into Bylonder's stack; the object field of its panel is not checked yet.
- A stack evaluated in Main applies every Blender modifier of the object there, so a Geometry Nodes Array after the
  Armature modifier that Main holds as Blender's Array applies twice.
- The mode is not part of an undo step: undo restores the bones and pose but leaves the mode as Main has it.
- Edit Mode's modifier preview (`editFinal`) evaluates in a worker without the armature.
- Bone properties panels (`BONE_PT_*`), bone collections, constraints in the UI, the Armature tab's settings
  (`pose_position`, display type), and keying pose bones (the animation channels are the object's).
- Export: `.blend` files carry the armature (Blender reads its bones and pose); the `.babylon` and JavaScript exports
  write the drawn bones as a mesh; a Babylon `Skeleton` from the pose and
  skinned meshes (glTF style) are not made yet.
