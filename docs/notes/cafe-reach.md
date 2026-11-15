# Rock Hard Café: the reach mechanic (handover)

The approved design for the café's next mechanic, for whoever builds it. It replaces "press E to pour and serve" with
the barista's right hand, reaching across the counter. It shows "take from both": Blender's rig and IK solved in the
page, and Babylon's Havok for the objects on the counter. Nothing of it is built yet.

## Where things are

- Game code: `examples/rock-hard-cafe/src/` (behaviours Rock, Barista, Machine, Spawner; systems Shift, Subtitles,
  Hud; `game.js`). The scene: `examples/rock-hard-cafe/cafe.py` (run with the reference Blender, `blender -b
  --factory-startup -P cafe.py`; it uses `../character-controller/environment.py` for the forest).
- Framework: `src/io_scene_babylon/runtime/game/` (`define.js`, `world.js`, `run.js`, `blend-host.js`). Exported
  pages run game code through `run.js` (`docs/sdk-model.md`, Packaging, Game code).
- Tests: `tests/rock-hard-cafe-wasm.test.js` runs the exported `game.js` headless through `tests/game-test.js`;
  `tests/e2e/prod.mjs` step "an exported page plays the project's game" drives the café's Package View page with keys.
- Variety rule, already in force: every serve plays out differently from the run's seed (`time.random()`,
  `time.pick()`), never from `Math.random`, so tests and replays reproduce a run exactly.

## The mechanic

1. **Near top-down, in the counter's plane.** The camera looks almost straight down over the counter. The mouse moves
   the hand target in the plane of the counter top (a ray from the camera through the cursor, met with that plane,
   clamped to the arm's reach around the shoulder). There is no height control and no wheel. WASD still walks the
   barista. On a gamepad the right stick moves the target.
2. **The body follows the hand.** The right arm reaches by Blender's IK; when the target goes past a comfortable
   reach, the spine bends toward it and the root yaws (and steps a little), as a person would, keeping the arm within
   its limits.
3. **Routing is the challenge.** The counter holds objects (the machine, jars, other cups). The hand pushes what it
   meets: moving straight through them knocks them off the counter under Havok, so the player draws the hand back and
   around.
4. **The grasp is held.** Holding Space (or the left mouse button) closes the hand on the cup and keeps it; releasing
   lets go. A grab needs the palm over the cup (from above), close to its rim.
5. **Serve onto the rock.** The cup is set down on the waiting rock's top. The rock shivers with delight (its seeded
   shiver, as now) and spills it anyway: the mug tips and falls under Havok. Better still, it swaps to pre-broken
   pieces authored in Blender: a "Mug Broken" collection made in `cafe.py`, shards that fit the mug, which fly under
   Havok. Then the next rock comes.
6. **Knocking a cup or a jar off angers the waiting rock:** an angry wobble (faster, seeded), a red tint on the run's
   material copy, an angry Ink line (a `rock_angry` knot, an Ink shuffle), and its patience cut by 40%. It waits for a
   retry, or leaves angry as a walkout when patience runs out.
7. **Nothing canned.** Each rock's size and shape (the MegaKit rocks), its path, its shiver and its noise come from the
   seed; the spill and the break come from Havok; the reach and the body turn come from the live IK.

## IK: Blender's own

- The mannequin (`../basic-character/basic-character.blend`, appended as the Barista) has no IK today. Its right arm is
  `DEF-shoulder.R` > `DEF-upper_arm.R` > `DEF-forearm.R` > `DEF-hand.R`, under `DEF-spine.003` > `.002` > `.001` >
  `DEF-hips` > `root`.
- `cafe.py` adds a non-deforming `Hand Target` bone (child of `root`) and a pole bone; an IK constraint on
  `DEF-forearm.R` (chain 2, the pole) and a second IK on `DEF-spine.003` (chain 3) at a low influence, so the core leans
  toward the hand, both aimed at `Hand Target`.
- The game moves only the `Hand Target` bone, through the runtime layer, as the movement code moves the root; the page
  solves Blender's IK. The runtime solves IK constraints live today: `src/io_scene_babylon/runtime/pose-constraints.js`
  handles type `IK` with chains, targets and poles.
- To check while building, each with a test on the mannequin that compares against Blender's own evaluated pose for a
  few `Hand Target` positions: (a) the native rig runtime (bylonder-native-rig, which the mannequin runs on) keeps the IK
  constraints, or the export falls back to the pose stack for it; (b) the spine chain's influence matches Blender's.

## Physics: Havok

- New dependency `@babylonjs/havok` (approved). Its package licence is MIT (not Apache-2.0); list it in
  `THIRD-PARTY.md` as `game-export.js` lists bundled libraries. Keep `HavokPhysics.wasm` as its own file in the
  package, fetched only when a game enables physics (about 2 MB).
- API: `physics: 'havok'` in `defineGame`. Babylon's scene is game code's own (`babylon.scene`), unwrapped.
- Bodies: the cup dynamic (a cylinder, about 0.25 kg); the counter, the machine and the ground static; jars and other
  cups dynamic; the palm a kinematic sphere following the hand bone. A grab parents the cup to the hand bone (its body
  kinematic while held); a release makes it dynamic again. A side hit pushes. Below the counter top's height a cup or a
  jar counts as knocked off.
- **Fixed timestep everywhere:** step Havok in fixed sub-steps from the run's clock (an accumulator), in the page, the
  Game area, tests and replays alike, so the seed fully reproduces a run.
- **Havok in Node works** (checked): `@babylonjs/havok` 1.3.10, its wasm read from the package and passed as
  `wasmBinary`, `HavokPlugin` on a `NullEngine` scene (with a camera, which `scene.render()` needs); a dynamic cylinder
  settles on a static box and a side impulse pushes it. On a NullEngine the engine's delta is tiny, which is one more
  reason for the fixed sub-steps.

## Framing (the coordinator's notes, from the played session)

- The forest should read: pines and bushes around the clearing in view, and the brook crossing a corner of the frame
  visibly (now it is a strip at the top edge).
- The parasol: smaller, a calmer colour, off to the side (now large and pink, a third of the frame).
- The waiting rock sits right across the counter from the barista, large in frame: it is the customer.
- The machine reads as a coffee machine: a body, a spout, a cup tray (now a plain box).
- The stand stays open to the sky (the awning roof was dropped: a roof is always in the way of a top-down view).

## Tests to write

- Route around an obstacle and serve onto the rock: the hand target is driven around a jar, grasps the cup from above,
  sets it on the rock; served 1, the mug in Mug Broken pieces under Havok, a stained rock.
- A straight swipe knocks a jar off the counter and angers the rock: mood angry, red tint, an angry line, patience cut;
  after it runs out, a walkout.
- The mug breaks into its pieces after a serve, and two runs with the same seed end with the same piece positions.
- The IK tests above, against Blender's evaluated pose.
- Keep `tests/rock-hard-cafe-wasm.test.js` and the prod step working (the prod step drives keys; it will need the
  hand: mouse moves and a held button).
