# Rigged character

A figure skinned to a humanoid armature, made in Blender 5.2 by `rigged-character.py`
(`blender -b --factory-startup -P rigged-character.py`) and opened here with Blender's own reader.

- **Body.** A Skin modifier over the skeleton's edges, smoothed by Subdivision Surface and applied.
- **Rig.** The armature Rig: spine, chest, head, arms and legs, drawn In Front. The body is parented to it With
  Automatic Weights, so each bone has its vertex group and the Armature modifier deforms the body.
- **Controls.** IK targets at the hands and feet (hand_ik, foot_ik) and pole targets behind the elbows and in front
  of the knees (elbow_pole, knee_pole) drive the limbs with two-bone IK; the hands copy their IK targets' rotation;
  the head turns toward the empty Look with Damped Track, within a Limit Rotation in local space.
- **Animation.** Over 72 frames the left hand waves, the hips crouch with the feet planted, and the head follows Look.
  File > Export > JavaScript runs the constraints in the page, so moving a target there moves the rig.
- **Posing.** Select Rig, switch to Pose Mode (the header's Mode menu, or Ctrl Tab), click a bone and press R or G.
  I inserts a keyframe; Alt R and Alt G clear the pose.
