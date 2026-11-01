---
id: rigging
title: Rigging and Posing
summary: Pose an armature's bones in Pose Mode, key the pose with I, and organize bones with bone collections and constraints.
status: partial
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/animation/armatures/posing/index.html
  - https://docs.blender.org/manual/en/5.2/animation/armatures/posing/selecting.html
  - https://docs.blender.org/manual/en/5.2/animation/armatures/properties/bone_collections.html
  - https://docs.blender.org/manual/en/5.2/animation/armatures/posing/bone_constraints/index.html
example: rigged-character
thumbnail: rigging/thumbnail.png
media:
  - rigging/pose-mode.gif
  - rigging/select.gif
  - rigging/rotate.gif
  - rigging/keyframe.gif
  - rigging/bone-collections.gif
  - rigging/constraint.gif
ui:
  - VIEW_3D
  - POSE
  - VIEW3D_MT_pose
  - VIEW3D_MT_select_pose
  - PROPERTIES
  - DATA_PT_bone_collections
  - BONE_PT_constraints
  - TIMELINE
operators:
  - object.posemode_toggle
  - view3d.select
  - transform.rotate
  - pose.rot_clear
  - anim.keyframe_insert
  - screen.animation_play
  - armature.collection_add
  - armature.collection_assign
  - pose.constraint_add
code:
  - src/blenkernel/armature/armature.js
  - src/draw/overlay-armature.js
  - tools/blender-port/wasm/armature-api.cc
  - tools/blender-port/wasm/armature-draw.cc
tests:
  - tests/armature-wasm.test.js
  - tests/rigging-wasm.test.js
  - tests/armature-draw-wasm.test.js
limits:
  - Box, circle and lasso select of bones are not done; click and Shift click select.
  - Bylonder's own meshes have no vertex groups, so an armature deforms them by envelopes only; meshes read from a .blend keep their groups.
  - Selecting the armature in Object Mode outlines its child mesh too.
  - Bones are picked from the overlay without Blender's depth cycling through overlapping bones.
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
   active bone, which the Bone tab of the Properties editor shows.

   ![Click the left forearm, then Shift click the upper arm](../media/features/rigging/select.gif)

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

> **Note** Every step is an undo step: Ctrl Z undoes it as in Blender.

## Project files

- [rigged-character.py](../../examples/rigged-character/rigged-character.py): builds the figure in Blender 5.2: the
  body from a Skin modifier, the rig, and the automatic weights.
- [rigged-character.blend](../../examples/rigged-character/rigged-character.blend): the file the script saves.
- [index.js](../../examples/rigged-character/index.js): opens the .blend with Blender's reader.
- Recorded by [record-rigging.mjs](../../tools/docs/record-rigging.mjs).
