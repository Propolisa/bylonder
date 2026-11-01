---
id: rigging
title: Rigging and Posing
summary: Pose an armature's bones in Pose Mode, select them with clicks, boxes, circles, lassos and L, key the pose with I, organize bones with bone collections and constraints, and paint a mesh's weights.
status: partial
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/animation/armatures/posing/index.html
  - https://docs.blender.org/manual/en/5.2/animation/armatures/posing/selecting.html
  - https://docs.blender.org/manual/en/5.2/animation/armatures/properties/bone_collections.html
  - https://docs.blender.org/manual/en/5.2/animation/armatures/posing/bone_constraints/index.html
  - https://docs.blender.org/manual/en/5.2/sculpt_paint/weight_paint/index.html
  - https://docs.blender.org/manual/en/5.2/animation/armatures/posing/editing/pose_library.html
example: rigged-character
thumbnail: rigging/thumbnail.png
media:
  - rigging/pose-mode.gif
  - rigging/select.gif
  - rigging/select-box.gif
  - rigging/rotate.gif
  - rigging/keyframe.gif
  - rigging/bone-collections.gif
  - rigging/constraint.gif
  - rigging/weight-paint.gif
ui:
  - VIEW_3D
  - POSE
  - WEIGHT_PAINT
  - VIEW3D_MT_pose
  - VIEW3D_MT_select_pose
  - PROPERTIES
  - DATA_PT_bone_collections
  - BONE_PT_constraints
  - TIMELINE
operators:
  - object.posemode_toggle
  - view3d.select
  - view3d.select_box
  - view3d.select_circle
  - view3d.select_lasso
  - pose.select_linked_pick
  - armature.select_linked_pick
  - armature.shortest_path_pick
  - transform.rotate
  - pose.rot_clear
  - anim.keyframe_insert
  - screen.animation_play
  - armature.collection_add
  - armature.collection_assign
  - pose.constraint_add
  - paint.weight_paint
  - poselib.create_pose_asset
  - poselib.apply_pose_asset
code:
  - src/blenkernel/armature/armature.js
  - src/draw/overlay-armature.js
  - tools/blender-port/wasm/armature-api.cc
  - tools/blender-port/wasm/armature-draw.cc
  - tools/blender-port/wasm/gpu-select.cc
  - src/editors/object/main-modes.js
  - src/draw/overlay-paint-weight.js
tests:
  - tests/armature-wasm.test.js
  - tests/rigging-wasm.test.js
  - tests/armature-draw-wasm.test.js
  - tests/bone-select-wasm.test.js
  - tests/weight-paint-wasm.test.js
limits:
  - Bone selection does not test depth against the scene's meshes: a box also selects bones behind them, as in X-ray.
  - The pose library's asset shelf is not drawn; Create Pose Asset works from the Pose menu, Apply Pose only with an asset reference (a script or the console).
  - Weight Paint draws at full opacity without contour lines; the Weight Paint tool icons are not shipped.
  - Bylonder's own meshes get vertex groups only from Blender's operators (With Automatic Weights); meshes read from a .blend keep theirs.
  - Selecting the armature in Object Mode outlines its child mesh too.
---
# Rigging and Posing

An armature is a skeleton of bones that deforms a mesh. In Pose Mode each bone is selected, rotated and moved like an
object, and the pose is keyed on the Timeline. Bone collections group bones, and bone constraints limit or drive
them. The armature, its pose evaluation and the Armature modifier run Blender's own code (`docs/armatures.md`).

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=rigged-character)

The demo, Rigged Character, is a figure skinned to an 11 bone rig by automatic weights. It is built by a Blender
script (`rigged-character.py`), so the steps below start from the example and pose it.

## Steps

1. **Enter Pose Mode.** The Rig is selected when the example opens. Hover the 3D Viewport and press Ctrl Tab, or pick
   Pose Mode in the header's mode menu. The bones turn gray and the header shows the Pose menu.

   ![Ctrl Tab switches the Rig to Pose Mode](../media/features/rigging/pose-mode.gif)

2. **Select bones.** Click a bone to select it; Shift click adds a bone to the selection. The last one clicked is the
   active bone, which the Bone tab of the Properties editor shows. Drag a box with the Select Box tool (or press B),
   press C for circle select or Ctrl right drag a lasso; Shift adds and Ctrl subtracts. L over a bone selects the
   bones connected to it.

   ![Click the left forearm, then Shift click the upper arm](../media/features/rigging/select.gif)

   ![A box around the left leg, then L over the right arm](../media/features/rigging/select-box.gif)

3. **Rotate.** Press R, type an angle and press Enter, or move the mouse and click. G moves and S scales the same way.
   Alt R and Alt G clear the rotation and location.

   ![R, 45, Enter rotates the selected bones](../media/features/rigging/rotate.gif)

4. **Key the pose.** Press I to insert a keyframe for the selected bones. Set the current frame on the Timeline,
   change the pose and press I again. Space plays the animation between the two keys.

   ![Keys at frames 1 and 40, then playback](../media/features/rigging/keyframe.gif)

5. **Bone collections.** Open Properties > Armature (the Data tab). In Bone Collections, + adds a collection and
   Assign puts the selected bones in it. The eye hides a collection's bones.

   ![A new collection with the selected arm bones assigned](../media/features/rigging/bone-collections.gif)

6. **Bone constraints.** Open the Bone Constraints tab, then Add Bone Constraint > Limit Rotation. Enable Limit X, Y
   or Z and set the range; the bone cannot be rotated past it.

   ![Add Bone Constraint > Limit Rotation on the active bone](../media/features/rigging/constraint.gif)

7. **Weight Paint.** Back in Object Mode, select the Rig, then Shift click the Body so it is active, and pick Weight
   Paint in the header's mode menu: the Rig goes to Pose Mode with it. Alt click a bone to paint its vertex group,
   then drag over the body. Blue is no weight, red full weight; Ctrl paints the inverse.

   ![Alt click the chest, then a stroke across it](../media/features/rigging/weight-paint.gif)

8. **Pose library.** In Pose Mode, Pose > Create Pose Asset saves the selected bones' pose as an asset in the file.

> **Note** Every step is an undo step: Ctrl Z undoes it as in Blender.

## Project files

- [rigged-character.py](../../examples/rigged-character/rigged-character.py): builds the figure in Blender 5.2: the
  body from a Skin modifier, the rig, and the automatic weights.
- [rigged-character.blend](../../examples/rigged-character/rigged-character.blend): the file the script saves.
- [index.js](../../examples/rigged-character/index.js): opens the .blend with Blender's reader.
- Recorded by [record-rigging.mjs](../../tools/docs/record-rigging.mjs).
