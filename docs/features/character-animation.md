---
id: character-animation
title: Character Animation
summary: Make a rigged character with a few baked actions walk, run, turn and jump in an exported page, its actions chosen from how it moves, its feet planted on uneven ground and its head turned toward what is near.
expect: A skeleton with only Idle, Walk, Run and Jump walks, runs, stops, turns and jumps without pops, its foot contacts and gait speeds found from the actions themselves, and a production rig plays through its own constraints as in Blender; planted feet hold within about 3 cm through curves and pivots (rare contacts at a curve's edge up to 9 cm), a turn in place steps the feet round without a Turn action, and Turn actions, Havok physics and an editor for layers and effects are not there yet.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/animation/actions.html
  - https://docs.blender.org/manual/en/5.2/animation/markers.html
  - https://docs.blender.org/manual/en/5.2/editors/nla/index.html
  - https://docs.blender.org/manual/en/5.2/animation/armatures/bones/bone_collections.html
example: basic-character
thumbnail: character-animation/thumbnail.png
media:
  - character-animation/actions.png
  - character-animation/export.png
  - character-animation/walk.gif
  - character-animation/ground.gif
ui:
  - NLA_EDITOR
  - NLA_HT_header
  - NLA_MT_tracks
  - DOPESHEET_MT_marker
  - DATA_PT_bone_collections
  - TOPBAR_MT_file_export
  - POSE
operators:
  - marker.add
  - marker.rename
  - nla.bake
  - nla.mute_toggle
code:
  - src/io_scene_babylon/runtime/character/api.js
  - src/io_scene_babylon/runtime/character/core.js
  - src/io_scene_babylon/runtime/character/roles.js
  - src/io_scene_babylon/runtime/character/input.js
  - src/io_scene_babylon/runtime/character/movement.js
  - src/io_scene_babylon/runtime/character/contacts.js
  - src/io_scene_babylon/runtime/character/locomotion.js
  - src/io_scene_babylon/runtime/character/rootmotion.js
  - src/io_scene_babylon/runtime/character/camera.js
  - src/io_scene_babylon/runtime/character/effects/feet.js
  - src/io_scene_babylon/runtime/character/effects/gaze.js
  - src/io_scene_babylon/runtime/character/effects/lean.js
  - src/io_scene_babylon/runtime/character/effects/reach.js
  - src/io_scene_babylon/runtime/character/effects/impact.js
  - src/io_scene_babylon/runtime/character/effects/springs.js
  - src/io_scene_babylon/runtime/character/effects/breathe.js
  - src/io_scene_babylon/runtime/character/effects/eyes.js
  - src/io_scene_babylon/runtime/character/effects/limbs.js
  - src/io_scene_babylon/runtime/character/quality.js
  - src/io_scene_babylon/clip-export.js
tests:
  - tests/character-core.test.js
  - tests/character-movement.test.js
  - tests/character-steer.test.js
  - tests/character-contacts.test.js
  - tests/character-locomotion.test.js
  - tests/character-rootmotion.test.js
  - tests/character-camera.test.js
  - tests/character-effects-feet.test.js
  - tests/character-effects-gaze.test.js
  - tests/character-effects-reach.test.js
  - tests/character-effects-impact.test.js
  - tests/character-effects-lean.test.js
  - tests/character-effects-springs.test.js
  - tests/character-effects-idle.test.js
  - tests/character-effects-limbs.test.js
  - tests/character-quality.test.js
  - tests/character-schedule.test.js
  - tests/character-basic-wasm.test.js
  - tests/export-clips-wasm.test.js
limits:
  - Planted feet hold within about 3 cm through curves and pivots; a rare contact at a curve's edge slides up to 9 cm
  - A turn in place is stepped procedurally; Turn actions (an animator's own turning clips) come later
  - Walls are a capsule against the scene's meshes; Babylon's PhysicsCharacterController with Havok comes later
  - Layers, sources and effects are written in code (or a JSON preset); Bylonder has no editor for them
  - Saving the .blend does not yet reload its actions in a running page
  - The Character Controller example's retargeted Sprint plants its left ball 0.8 cm off where the source mannequin's lands (the cause is not yet found; the leg's solve is the first suspect)
  - In the Character Controller example's retarget check, the first frame of Walk's and Jog's loops differs from Blender's (a longer stride, straight knees); the cause, the feet effect or the check's capture, is not yet confirmed
  - Without L and R markers, foot contacts are found where a foot is low and still, which noisy motion capture can misplace
  - On a rig whose constraints move its feet after the pose (Snow's CloudRig legs), a planted foot holds within about 3 cm on most contacts through curves and pivots; a few contacts at a pivot's first step or a sharp jogging turn slide 6 to 9 cm
---

# Character Animation

A character is an armature of an exported scene that moves in the page. The animator makes its actions in Blender;
input says what the character wants (a velocity, a facing, a jump); locomotion picks and blends its actions from how
it moves; effects fit the pose to the world, the feet planted on the ground and the head turned toward what is near;
the rig's own constraints solve the result as in Blender. A basic character needs only a skeleton and a few baked
actions named Idle, Walk, Run and Jump: their foot contacts, gait speeds and the jump's flight are found from the
actions when the page loads. The guide, with the whole API, is [Character animation](../character-animation.md).

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=basic-character)

The same system on a production rig: [Open Snow in Bylonder](https://propolisa.github.io/bylonder/#example=character-controller),
Blender Studio's character walking, running and acting through its rig's own constraints, built by
`examples/character-controller/character-controller.py`.

## Steps

1. Build the example: `blender -b --factory-startup -P examples/basic-character/basic-character.py`. It downloads
   Quaternius' Universal Animation Library (CC0), keeps its mannequin as an armature named Armature with four baked
   actions (Idle, Walk, Run, and Jump joined from the library's start, airborne loop and landing), each on a muted
   track of the Nonlinear Animation editor, and puts it in the character examples' environment
   (`environment.build()` from `examples/character-controller/environment.py`): a 60 m field of rolling turf ringed
   by a rim of hills, with steps, a slope, sparse grass and a few rocks, bushes and pines. No markers, root motion or
   IK are needed.

   ![The Armature's four actions on muted tracks in the Nonlinear Animation editor](../media/features/character-animation/actions.png)

2. Export it with File > Export > JavaScript, Animations set to Clips, so each action becomes a clip the page plays by
   its name.

   ![File > Export > JavaScript with Animations set to Clips](../media/features/character-animation/export.png)

3. In the page, make the character from its armature, give it the default input (arrows or WASD, Shift to run, Space
   to jump, a stick on touch screens) and let locomotion play its body; the scene's camera follows it, drag to orbit:

   ```js
   import { createEngine, load, Character, followCamera } from './basic-character/scene.js';

   const engine = await createEngine(canvas);
   const blend = await load(engine);
   const hero = new Character(blend, 'Armature', { input: 'default' });
   hero.body.play(hero.locomotion);
   followCamera(hero);
   engine.runRenderLoop(() => blend.scene.render());
   ```

   Locomotion blends Walk and Run by speed on one shared cycle, played at the rate that keeps a planted foot still; a
   stop finishes its step where the movement comes to rest, a turn in place steps the feet round, and Space plays the
   jump from its takeoff.

   ![The mannequin walking, running, turning and jumping](../media/features/character-animation/walk.gif)

4. Fit it to the world: `feet()` sets each foot on the ground's height and slope under it, locks it where it lands
   while its action has contact and lowers the hips when a foot must reach down, eased so steps do not pop; `gaze()`
   turns the eyes, then the head, toward the most interesting target near it.

   ```js
   import { feet, gaze } from './basic-character/scene.js';

   hero.add(feet());
   hero.add(gaze({ targets: [blend.scene.activeCamera] }));
   ```

   ![Walking up the steps with the feet planted and the head turned toward the camera](../media/features/character-animation/ground.gif)

## Project files

- [basic-character.py](../../examples/basic-character/basic-character.py): builds the character, its four actions and
  their tracks, and the environment, in Blender 5.2.
- [environment.py](../../examples/character-controller/environment.py): the demo environment the character examples
  share.
- `docs/demos/basic-character/`: the exported page, step 3 and 4's code as it runs.
- Recorded by [record-character-animation.mjs](../../tools/docs/record-character-animation.mjs).
