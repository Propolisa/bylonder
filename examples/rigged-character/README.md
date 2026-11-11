# Rigged character

A figure skinned to a humanoid armature, made in Blender 5.2 by `rigged-character.py`
(`blender -b --factory-startup -P rigged-character.py`) and opened here with Blender's own reader.

- **Body.** A Skin modifier over the skeleton's edges, smoothed by Subdivision Surface and applied.
- **Rig.** The armature Rig: spine, chest, head, arms, legs and tail, drawn In Front. The body is parented to it With
  Automatic Weights, so each bone has its vertex group and the Armature modifier deforms the body.
- **Controls.** IK targets at the hands and feet (hand_ik, foot_ik) and pole targets behind the elbows and in front
  of the knees (elbow_pole, knee_pole) drive the limbs with two-bone IK; the hands copy their IK targets' rotation;
  the head turns toward the empty Look with Damped Track, within a Limit Rotation in local space.
- **Tail.** One B-Bone of eight segments (Bone > Bendy Bones), keyed to swish and curl with its Curve In and Out X.
- **Animation.** Over 72 frames the left hand waves, the hips crouch with the feet planted, the head follows Look and
  the tail swishes.
  File > Export > JavaScript runs the constraints in the page, so moving a target there moves the rig.
- **Rig controls.** The rig's custom properties `ik_fk.L` (the left arm's IK constraint influence, 0 FK, 1 IK) and
  `breathe` (the Breathe shape key) are drivers' inputs; the Elbow.L shape key keeps the left elbow's volume, driven by
  the angle between the upper arm and forearm.
- **Posing.** Select Rig, switch to Pose Mode (the header's Mode menu, or Ctrl Tab), click a bone and press R or G.
  I inserts a keyframe; Alt R and Alt G clear the pose.
