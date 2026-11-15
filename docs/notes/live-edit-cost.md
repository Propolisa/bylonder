# Live edit cost

A live edit on Snow's scene (`character-controller.blend`, 84 objects, a 1494-bone rig) reaches the Package View and
the Game in about 47 s for a widened shirt (it was 145 s). That is a scoped export (`scoped-export.js exportChanged`)
of the 28 objects the edit reaches. What remains, and where to look:

- **serializeScene, about 16 s** (`babylon-export.js`): the Babylon serialization of the 28 reached objects, mostly
  Snow's meshes and skins. Most of it re-serializes data the edit did not change: reuse each object's last entries when
  none of its own keys (OB:, ME:, KE:, MA:) is in `changed`, as the rig's samples do (`armature.js rigSamples`).
- **exportIR, about 18 s** (`ir-export.js exportIR`): the IR walk of the reached objects, RIG-Snow's pose bones above
  all (A1 measured 5 to 7 s for the rig alone). Reuse the last `ids` entries of the IDs not in `changed`, by their keys.
- **exportRuntimes, about 8 s**: the rig's description, now kept per mesh and object (native-deform, `rigMemo`).
- Measure with `node --max-old-space-size=8192 tools/perf/live-edit-cost.mjs <blend> mesh move` (edits: material, move,
  mesh; add timers locally; it needs about 8 GB, so watch memory).

## The first export (Play)

Play on Snow runs a full export before the game starts. Measured in Node (`tools/perf/live-edit-cost.mjs <blend>` with
no edits, or `--cpu-prof`), on an idle machine:

- 205 s at first: 110 s of it the rig judgement (`pose-export.js livePoseConstraints` check), which deformed every
  checked mesh with the allocating reference deform (`deformMesh`) and redrew the view at every clip frame.
- 102 s once the judgement runs the deform the page runs (`CpuStack`, allocation-free, only the bones a mesh uses) and
  judges clip frames without drawing. That also found a page bug: a B-Bone keyed only by its B-Bone values kept its
  shape (`joints.js bboneSegments`, fixed with `program.js bboneValueWritten`).
- About 60 s when the rig's verdict is kept (`rig-verdicts.js`): verdicts are derived data in the browser's OPFS
  (`derived/rig-verdicts.json`), keyed by the content the judgement read (the native rig description, its arrays and
  Mesh datablocks by `contentKey`, the frames, the tolerance) and `JUDGE_VERSION` (`pose-export.js`), which
  `tests/rig-judge-version.test.js` makes you bump when the judge's files change. Blender's module version is not in
  the key; a module change that alters Blender's evaluated meshes should bump it too.
- What remains of a kept-verdict export: timeline sampling (about 16 s, `sampling.js evaluate`), the IR walk (about
  14 s, `ir-export.js exportIDs`, most of it RNA struct proxies and string decoding in `bpy_rna.js`), the rig
  description and live curves (about 11 s), gzip of scene.bin at level 9 (about 4 s), and garbage collection.
- The export reports its steps (`exportPackage` `progress`) and yields between them and between judged clips, so the
  Game header shows "Checking RIG-Snow: frame 40 of 289". Main is restored at each yield; an edit made during the first
  export makes one whole export after it.
- Limit: export work runs on the main thread, where Blender's Main lives, so a long export stalls a playing game, live
  edits on heavy scenes included. An early run on an unjudged package was dropped for that reason (its judged export
  would stall the game for about 100 s).

## In the browser

`tools/perf/play-cost.mjs character-controller RIG-Snow [out.cpuprofile]` times Play in the dev server to the run's
first frame, then the game's frame rate (`STACK=VIEWPORT` for the Viewport stack, `E2E_ENGINE=webgpu` for WebGPU, `CAP`
minutes). Snow's .blend must be in `examples/character-controller/` while it runs and out before npm test; it needs
about 12 GB, so run it alone.

- The Game area bundled the package with Babylon's sources (esbuild-wasm) at every Play, which the run never used (it
  links scene.js to the app's own modules). With that gone, Snow plays 100 s after Play on WebGL 2 (Render stack, 35
  fps after) and 112 s with the Viewport stack (52 fps), a fresh browser profile, so the rig judged. The export in the
  browser takes what it takes in Node.
- Live edits never bundled (scoped exports patch the run); the Package View bundles in its own publish, on Reload.
- WebGPU: the Game area draws with the app's engine kind and resizes its engine at the start of a frame (a resize
  between encode and submit gave "Destroyed texture [...SwapBufferProvider] used in a submit"). Snow plays 124 s after
  Play, as on WebGL 2 (120 s), then at 48 to 54 fps against WebGL 2's 27 to 30 (same run, Chrome on Windows), after
  about 10 s of first-frame pipeline compiles. It ran at 0.1 fps for 190 to 300 s before: not the compute deform (all
  of Snow's deform dispatches take about 1 ms a frame, `tools/perf/gpu-profile.mjs`) but DXC compiling six node
  materials' shaders for 18 to 142 s each, which inverted a product of matrices (docs/notes/babylon-inverse-matrices.md).
- Not tested: a mesh whose GPU deformer throws while being made falls back to the CPU deformer (`native-solve.js
  deformer`); faking WebGPU on Node's Null engine breaks the page's WebGPU overrides first.
- The test runner once ended without a summary while export-side-effects-3 ran: a test that exhausts memory should fail
  by name with the memory it reached, never end the runner silently.
