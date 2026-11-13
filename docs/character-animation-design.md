# Character animation: design notes

The notes behind `docs/character-animation.md`: where its ideas come from, what is left for later or left out, how it
maps onto the code, and how it is tested.

## Where the ideas come from

- Layers with bone masks and additive blending: Unreal's Layered Blend per Bone, Unity's Avatar Masks.
- Inertialized switching: Bollo, Gears of War, GDC 2018; dead blending (Holden, 2023).
- Locomotion's springs and root motion corrections: Holden, "Spring-It-On" and "Code vs Data Driven Displacement".
- Locomotion's sync markers, stride matching and orientation warping: Unreal's Animation Locomotion Library and
  Paragon.
- Actions with sound: dialogue on the audio clock, as story-driven games play it.
- Effects: foot IK, look-at chains, lean and springs, from Unreal's Control Rig and AnimDynamics and Unity's Animation
  Rigging; gaze from attention models in games, where the eyes lead and the head follows.

The order of a frame (the guide's Every frame) comes from current engines: Unreal 5's Mover (intent in, a movement
model owning the root, animation following its prediction) and Motion Matching, which picks clips from predicted
motion rather than the stick; Naughty Dog's split of what a character wants from how its body shows it; and the
motion matching titles that followed (For Honor, The Last of Us Part II), with procedural fixes applied last and never
choosing what plays.

## What fits Bylonder

- Blender owns the rig, clips, markers and bone groups, through the IR.
- Production rigs solve on the native rig runtime: layers pose the controls before the solve, and effects after it
  run on the solved pose (`onSolved`).
- One pose and one solve a frame with no per-frame allocation, so it runs on phones, on Babylon's own API, under
  WebGPU or WebGL 2.

## For the next fold-in

- `new Character(blend, armature)` takes the rig off the page's timeline; its active action becomes an action like any other. Any rig with an
  active action would otherwise fight the controller, and the acting could then be the example's active action, so
  Blender and the app scrub the performance.

## Later, without changing the API

- **Motion matching inside locomotion**: a brute-force search over the project's own clips, by trajectory and foot
  features, under 0.1 ms. It plays once a project has enough locomotion clips.
- **Motion warping**: getting up from a stool and sitting onto it, aligned to the seat (`place` plus a clip until then).
- **Hit reactions** by spring impulses (powered bones on tier A), as a `react` effect.
- **Spring collisions** for hair.
- **Turn actions**: a `turn` action played by the angle left to turn, mirrored for the right, sampled without its
  root motion. No example has one yet; until then the root turns and the feet stay planted until they must step.
- **Havok's character controller**: in a scene with Havok physics, Babylon's `PhysicsCharacterController` taking over
  the collision seam (`collision.js`).
- **Faces from audio, baked at export** when there is no acted action.

## Left out, and why

- **State machines with transition rules.** Code calls `play` and awaits `done`; the JSON graph stays underneath.
- **Learned motion matching, phase networks and physics control policies.** They need trained networks and data a
  Blender project does not have.
- **Runtime generative in-betweening.** It costs too much per frame on a phone.
- **Runtime retargeting.** Clips are made for the rig in Blender.
- **Cloth.** It belongs to a simulation feature, not to characters.
- **Per-bone blend times and 2D strafing.** They can come later as options of `play` and `locomotion`.

## Mapping to the code

In `src/io_scene_babylon/runtime/character/`, shipped in every package:
- `core.js`: the character, its layers and sources (actions, mixes, `defineSource`), dead blending, masks by role,
  bone or collection (`collections.js`), effects by step, `bone()` and `debug`.
- `movement.js`: intent to motion by critically damped springs (velocity and facing), the prediction of the next
  second in closed form, jumps, pivots, `place`, `turnTo`, `steer` and `walkTo`; `input.js` and `camera.js` for pages.
- `collision.js`: the scene's triangles in 1 m cells, shared by its characters and moved with their meshes; the ground
  by a ray down, walls by spheres up a capsule. The body seam (`cast`, `move`) a physics engine's controller can take.
- `contacts.js`: when each foot is down and the ground speed it implies; `../contacts-export.js` runs it at export on
  Blender's evaluation of the deform feet and writes the result per clip into the IR (`ContactsSchema`).
- `locomotion.js`: the `locomotion` source, a `defineSource` like any other: gaits on one cycle, stride matching,
  starts and stops at a mid-stance, turn steps, jump, fall and land, stances.
- `rootmotion.js`, `mirror.js`: an action's root motion and `warpTo`; mirrored poses.
- `roles.js`: bone roles by rig family; `names.d.ts`: the package's typed names, which `scene.d.ts` fills in.
- `effects/`: the built-in effects, each written with `defineEffect`; `pose-api.js` is the pose they write.
- `sound.js`: an action's sound and its clock; `quality.js`: tiers and scheduling.
- `rig.js`, `clip.js`, `pose.js`, `procedural.js`: the rig, clips and poses underneath.

## Tests

- The basic path: a Mixamo-style skeleton (the Quaternius rig of the examples) with Idle, Walk, Run and Jump and no
  root motion, IK controls or drivers, walking, stopping and jumping with defaults, its feet and gaze through the
  built-in solves.
- The same walk-around code on Snow and on the Rigged Character, with roles found by convention.
- A reach beyond full extension stopping at it, and a vault's warp landing its marker on the ledge.
- Each built-in effect in its own test: attach, fade, remove, its tier fallbacks, and the error for a missing role.
- One clock across 10,000 frames of random steps.
- Sound drift under one frame after unlock, after a hidden tab, and after a seek.
- Take-over continuity on solved deform bones, through an IK to FK change.
- Loop continuity.
- `done` resolving `ended` and `interrupted`.
- An AI input walking a character to a node and stopping there.
- Contacts and gait speeds against Blender's own evaluation of Snow's feet; turns in place, pivots and a lift.
- A jump: up, fall and land clips in order, landing on the ground ray.
- Every failure message.
- The same output for the same input.
- The seated feet staying on the stool's rung while the feet effect is at weight 0.
- Locomotion's first frame after a take-over starting where the body is (no jump back).
- Idle life staying off on bones under an action with sound.
- The budget, with zero allocations per frame, including each example effect in the guide.
