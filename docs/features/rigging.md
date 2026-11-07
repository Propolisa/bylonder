---
id: rigging
title: Rigging and Posing
summary: Pose an armature's bones in Pose Mode, select them with clicks, boxes, circles, lassos and L, key the pose with I, organize bones with bone collections and constraints, keep poses in the pose library's asset shelf, and paint a mesh's weights.
expect: Posing, selecting, keying, bone collections, constraints, weight paint and the pose library work as in Blender; bone selection ignores depth and pose assets have no preview.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/animation/armatures/posing/index.html
  - https://docs.blender.org/manual/en/5.2/animation/armatures/skinning/parenting.html
  - https://docs.blender.org/manual/en/5.2/animation/armatures/posing/selecting.html
  - https://docs.blender.org/manual/en/5.2/animation/armatures/properties/bone_collections.html
  - https://docs.blender.org/manual/en/5.2/animation/armatures/posing/bone_constraints/index.html
  - https://docs.blender.org/manual/en/5.2/sculpt_paint/weight_paint/index.html
  - https://docs.blender.org/manual/en/5.2/animation/armatures/posing/editing/pose_library.html
  - https://docs.blender.org/manual/en/5.2/editors/3dview/display/overlays.html
example: desk-lamp
thumbnail: rigging/thumbnail.png
media:
  - rigging/build.gif
  - rigging/skin.gif
  - rigging/pose-mode.gif
  - rigging/select.gif
  - rigging/select-box.gif
  - rigging/rotate.gif
  - rigging/keyframe.gif
  - rigging/bone-collections.gif
  - rigging/constraint.gif
  - rigging/pose-library.gif
  - rigging/weight-paint.gif
  - rigging/aim.gif
ui:
  - VIEW_3D
  - POSE
  - WEIGHT_PAINT
  - PROPERTIES
  - TIMELINE
  - VIEW3D_MT_pose*
  - VIEW3D_MT_select_pose*
  - VIEW3D_MT_bone*
  - VIEW3D_MT_view
  - BONE_PT_*
  - DATA_PT_bone_collections
  - DATA_PT_pose
  - DATA_PT_display
  - ARMATURE_MT_collection*
  - POSE_*
  - VIEW3D_MT_paint_weight*
  - VIEW3D_MT_wpaint*
  - VIEW3D_PT_overlay_bones
  - VIEW3D_PT_overlay_weight_paint
  - VIEW3D_PT_slots_vertex_groups
operators:
  - armature.extrude_move
  - object.parent_set
  - object.editmode_toggle
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
  - poselib.blend_pose_asset
  - view3d.view_selected
code:
  - src/blenkernel/armature/armature.js
  - src/draw/overlay-armature.js
  - tools/blender-port/wasm/armature-api.cc
  - tools/blender-port/wasm/armature-draw.cc
  - tools/blender-port/wasm/gpu-select.cc
  - src/editors/object/main-modes.js
  - src/draw/overlay-paint-weight.js
  - src/editors/space_view3d/view3d-regions.js
tests:
  - tests/armature-wasm.test.js
  - tests/rigging-wasm.test.js
  - tests/armature-draw-wasm.test.js
  - tests/bone-select-wasm.test.js
  - tests/weight-paint-wasm.test.js
  - tests/pose-library-wasm.test.js
limits:
  - Bone selection does not test depth against the scene's meshes: a box also selects bones behind them, as in X-ray.
  - Pose assets have no preview image (Blender renders it on the GPU); a tile shows the pose's name.
  - Create Pose Asset saves into the Current File only; there is no User Library on disk.
  - The asset shelf's tiles have no hover highlight or tooltip, and the shelf does not scroll past the rows it shows.
  - Weight Paint's Show Wire is not drawn.
  - Bylonder's own meshes get vertex groups only from Blender's operators (With Automatic Weights); meshes read from a .blend keep theirs.
  - Selecting the armature in Object Mode outlines its child mesh too.
---
# Rigging and Posing

An armature is a skeleton of bones that deforms a mesh. In Pose Mode each bone is selected, rotated and moved like an
object, and the pose is keyed on the Timeline. Bone collections group bones, and bone constraints limit or drive
them. The armature, its pose evaluation and the Armature modifier run Blender's own code (`docs/armatures.md`).

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=desk-lamp)

The demo is a desk lamp at night. The lamp is one mesh in four vertex groups (Base, Lower Arm, Upper Arm, Head), each
weighted fully to the bone of its name, so every part turns rigidly about its joint. Its spot light is parented to the
Head bone: posing the head aims the light, and the shadows of the arm, the mug and the pencil follow. The pose is
keyed to light the notebook, look up and return. A faint blue sun stands for moonlight.

## Steps

1. **Build a rig.** In a new file, hover the 3D Viewport and press Delete. Shift A > Armature adds one bone. Press Tab
   for Edit Mode, then E Z 1 Enter twice extrudes two more bones, each from the tip of the last; Tab returns.

   ![An armature extruded to three bones](../media/features/rigging/build.gif)

2. **Skin a mesh to it.** Shift A > Mesh > Cylinder, then S .3 Enter, S Z 5 Enter and G Z 1.5 Enter fit it around the
   bones. Ctrl click Armature in the Outliner so it is active, then Ctrl P > With Automatic Weights. Ctrl Tab, A and
   R X 30 Enter bend all three bones: the cylinder bends with them.

   ![Parent With Automatic Weights, then a pose](../media/features/rigging/skin.gif)

3. **Enter Pose Mode.** Open the Desk Lamp example; its Rig is selected. Hover the 3D Viewport and press Ctrl Tab, or
   pick Pose Mode in the header's mode menu. The bones turn gray and the header shows the Pose menu.

   ![Ctrl Tab switches the Rig to Pose Mode](../media/features/rigging/pose-mode.gif)

4. **Select bones.** Click a bone to select it; Shift click adds a bone to the selection. The last one clicked is the
   active bone, which the Bone tab of the Properties editor shows. Drag a box with the Select Box tool (or press B),
   press C for circle select or Ctrl right drag a lasso; Shift adds and Ctrl subtracts. L over a bone selects the
   bones connected to it.

   ![Click the Upper Arm, then Shift click the Lower Arm](../media/features/rigging/select.gif)

   ![A box around the Upper Arm and Head, then L over the Base](../media/features/rigging/select-box.gif)

5. **Rotate.** Press R, type an angle and press Enter, or move the mouse and click. G moves and S scales the same way.
   Alt R and Alt G clear the rotation and location.

   ![R, 45, Enter rotates the selected bones](../media/features/rigging/rotate.gif)

6. **Key the pose.** Press I to insert a keyframe for the selected bones. Set the current frame on the Timeline,
   change the pose and press I again. Space plays the animation between the two keys.

   ![Keys at frames 1 and 40, then playback](../media/features/rigging/keyframe.gif)

7. **Bone collections.** Open Properties > Armature (the Data tab). In Bone Collections, + adds a collection and
   Assign puts the selected bones in it. The eye hides a collection's bones.

   ![A new collection with the selected arm bones assigned](../media/features/rigging/bone-collections.gif)

8. **Bone constraints.** Open the Bone Constraints tab, then Add Bone Constraint > Limit Rotation. Enable Limit X, Y
   or Z and set the range; the bone cannot be rotated past it.

   ![Add Bone Constraint > Limit Rotation on the active bone](../media/features/rigging/constraint.gif)

9. **Weight Paint.** Back in Object Mode, select the Rig, then Shift click the Lamp so it is active, and pick Weight
   Paint in the header's mode menu: the Rig goes to Pose Mode with it. Alt click a bone to paint its vertex group,
   then drag over the lamp. Blue is no weight, red full weight; Ctrl paints the inverse. The Overlays popover's Weight
   Paint panel sets the weights' Opacity, Zero Weights and Show Weight Contours.

   ![Alt click the Lower Arm, then a stroke across it](../media/features/rigging/weight-paint.gif)

10. **Pose library.** In Pose Mode, select the bones (A) and pick Pose > Create Pose Asset: name the pose and press
   Create; it is saved in the Current File. View > Asset Shelf shows the pose library along the bottom of the 3D
   Viewport. Click a pose to apply it; drag from a pose to the right to blend it in by how far you drag, then release.
   Right click a pose for Apply Pose Flipped, Blend Pose and Select Pose Bones.

   ![Create Pose Asset, the asset shelf, a click on the pose and a drag that blends it](../media/features/rigging/pose-library.gif)

11. **Aim the light.** In Rendered shading through the camera, click the Head bone in Pose Mode and press R X -40
   Enter: the light parented to the bone turns with it, and its pool of light and the shadows move across the desk.

   ![Rotating the Head bone aims the lamp's light](../media/features/rigging/aim.gif)

> **Note** Every step is an undo step: Ctrl Z undoes it as in Blender.

## Project files

- [desk-lamp.py](../../examples/desk-lamp/desk-lamp.py): builds the lamp mesh and its vertex groups, the rig, the
  light parented to the Head bone, the keyed poses, the desk and the lights, in Blender 5.2.
- [desk-lamp.blend](../../examples/desk-lamp/desk-lamp.blend): the file the script saves.
- [index.js](../../examples/desk-lamp/index.js): opens the .blend with Blender's reader.
- Recorded by [record-rigging.mjs](../../tools/docs/record-rigging.mjs).
