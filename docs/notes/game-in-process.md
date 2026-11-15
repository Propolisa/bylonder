# The Game area in-process, and instant value edits next

Handover for whoever takes step 3 (instant value edits). What landed, how it holds, and the design agreed with the
owner for what comes next.

## What landed

- The Game area plays the scene in the app on an engine of its own (`src/editors/space_game/game-run.js`,
  `game-view.js`), made by the package's own `createEngine`, of the app's engine kind (WebGPU or WebGL 2).
- One Babylon by construction: the package's scene.js is linked to the app's own modules (`package-link.js`), by the
  table packaging copies from (`runtime-files.js` `appSource`); an import it cannot map throws. Runtime files that load
  package folders by path go through `runtime/package-modules.js`.
- The run gets the export's IR and arrays by reference, frozen (`shared-resources.js` `sharedPackage`, `sharedIR`), with
  no JSON, parse or schema. The schema runs only where data comes from outside: a package's files (`readSceneIR`) and
  the Package View's messages (`readPatch`, exported by scene.js).
- An edit reaches the run as a patch of the new version's entries (`createPackagePreview`, `tablesPatch`). A patch the
  run does not take, or one that asks to load the package again, drops the run and loads it fresh; where no patch
  reaches (the scene's own settings), Reset exports again and plays that. Reset never fails short of an export failing.
- The app's Babylon-wide extensions (material plugins, prototype overrides) skip a game's scenes through one predicate,
  `src/runtime/app-scene.js` `isAppScene`. The run keeps Babylon's last created engine and scene the app's.
- Exports no longer carry a view's state: image processing is the scene's (`render-babylon.js` `sceneImageProcessing`),
  and each camera's field of view is its render frame's (`babylon-export.js` `framedCameras`), which a page fits whole
  in any canvas (`runtime/ortho-scale.js` `fitsFrame`).

Tests: `tests/game-run-wasm.test.js` (tagged `live`): one Babylon, the IR by reference and frozen, no IR parse or
schema, edits as patches, Reset fresh, a stale patch and an unreachable table both reloading, no app plugin on game
materials, the app's sync leaving same-named game objects alone. `tests/e2e/smoke.mjs` "the Game area plays the
exported scene in its area, apart from the app's views": own engine, input over the 3D View never reaching the game,
ten Resets with the 3D View pixel-checked.

Measured on Rigged Character, WebGL 2, edit to frame through the scoped export: move 1.7 s, material 1.4 s, mesh 1.1 s.

## Step 3: instant value edits (agreed design)

Any value edit (a transform, a material colour, a light's energy, a camera's lens, visibility, a shape key's value, a
modifier's value, a custom property) reaches every run and every derived copy of the edited datablock on the next
frame, with no export in between. One mechanism:

1. **Dirty signal: the depsgraph's recalc tags.** `mainSync.onEvaluated(updates)` already gives the updated IDs (the
   Package preview keeps only the IDs today). Dependents come from the depsgraph's own propagation.
2. **One controls table.** For each tagged ID, recompute that ID's controls (`controls-export.js` has one function per
   ID kind reading bpy values) and `blend.set` on every run the ones whose value differs. No second mapping:
   rna-bylonder's sync-bearing properties are the single source of which properties are controls; each bind is data
   measured from the app's own setter on the exported object (as a light's power and a camera's lens are today); a
   mapping that is not linear gets a named bind kind in the runtime. Copies made from a value (per-run or per-instance
   material clones) stay linked to their source so one set reaches them all.
3. **Coverage test.** It fails when a sync-bearing property of a shipped struct has neither a measured bind nor a named
   kind, so gaps are listed, not silent; report how many RNA properties of the named scenes are covered.
4. **Export reconciles.** The scoped export still runs behind every fast set and patches as it does now; where its
   result differs from what the fast sets produced, the run reloads fresh and the header says so. Structural edits
   (topology, node links, added modifiers or objects) go through the scoped export only, with progress in the header.

Law test on named scenes (Rigged Character, a small parented scene; never Snow, Gaku or the Bar Scene): for a
transform, a material colour, a light and a shape key, the next frame shows the change in all runs and copies, and
the reconciled state equals a full export. Measure a move on Rigged Character in tests and on Snow once by hand.

## Open

- The Snow move by hand (patched frame against a fresh reload) was not run after the image processing fix, which
  likely explains the wash-out the lighting work saw.
- A WebGL "getProgramParameter: attempt to use a deleted object" warning shows when the Package View reloads; it is
  not the Game's.
