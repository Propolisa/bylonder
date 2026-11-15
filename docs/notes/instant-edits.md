# Instant value edits: what landed and what is open

Handover after step 3 of `game-in-process.md` (instant value edits) and the Game header's modifier stack choice.

## What landed

- A value edit reaches every run on the next frame (`package-preview.js`): each ID Blender's depsgraph updates gives its
  controls' values, read by their RNA paths, and every run and every copy made of it (`BlendScene.copies`,
  `game-run.js setControls`) sets those that differ through the binds the package carries. Material copies follow
  their source (`metadata.bylonderCopyOf`). Measured on Rigged Character: 2 to 18 ms from edit to frame on WebGL 2 and
  WebGPU.
- One table, `controls-export.js SYNCED`: every property rna-bylonder keeps in sync with Main (`syncNames`) has a
  kind. Fast (a measured bind, or a named kind: `power`, `spot`, `sensor`, `orthoScale`, `shadow`, `display`), KEPT,
  REBUILD, RELOAD, NONE (pages do not draw it) or APP (the editor's own). `tests/controls-coverage-wasm.test.js` fails
  on a property or a shipped struct without a kind and prints the reload and not-drawn lists.
- The scoped export reconciles behind every fast set; a patch that disagrees with a value set fast loads the run fresh.
  An edit the runs did not show (a type, a mesh, a modifier, an area light's size) starts its export at once, and
  edits made while it runs fold into one more; an edit they showed waits for a 400 ms pause.
- The modifier stack a package evaluates is the scene's setting `scene.bylonder.export_evaluation` (Render by
  default), shown in File > Export > JavaScript and the Game header.
- Fixed on the way: muted drivers were exported; a light's patch dropped its shadow generator (it took the replaced
  light, now `withLight` in scene.js); the scoped export missed a light's casters when an object's Shadow changed.

Coverage on Rigged Character: 55 covered (21 fast, 16 rebuild, 18 reload), 16 not drawn by pages, 9 the editor's.

## Open

- **Reload list** (the scene's own table and clock, which a patch does not reach): `fps`, `fps_base`, `frame_start`,
  `frame_end`, `use_gravity`, `gravity`, `use_motion_blur`, `motion_blur_shutter`, `engine`, SceneEEVEE's
  `taa_samples`, `taa_render_samples`, `shadow_ray_count`, `use_raytracing`, `ray_tracing_method`, `fast_gi_method`,
  `fast_gi_distance`, and RaytraceEEVEE's `screen_trace_quality` and `screen_trace_thickness`. Gravity could be a bind
  on `scene.gravity` (axes swapped).
- **Not drawn by pages** (export gaps, not edit gaps): a light's temperature, transmission, normalize, soft falloff,
  spread, use_square, and Blender's shadow resolution, filter, jitter and cascade settings (Bylonder's shadows use a
  fixed bias, map size and filter per light type); a camera's lens shift.
- **Rebuild without an export** (held for the move that makes scene.js imports plus data): a rebuild today is the scoped
  export plus its patch, about 0.1 s on Rigged Character and Desk Lamp, a light's type about 1 s, with no hitch (the
  longest frame after it 23 to 27 ms). The runtime already remakes one light and its shadow generator from a table
  entry (`scene-tables.js`). What is missing is that entry without a scoped export: the per-light steps of
  `babylon-export.js` (Babylon's serializer for one light, the area-light rig, the evaluated transform, its shadow
  generator) as a function the preview calls, and a one-entry patch versioned from the kept entry hashes. Estimate 100
  to 150 lines, mostly moved, plus a test that the one-entry patch equals the scoped export's; gain about 0.1 s.
- **Snow by hand, not done.** Play on Snow (`character-controller.blend`) runs its first full export in the dev build
  for more than 10 minutes before any edit can be timed; two runs were also cut short by the dev server reloading when
  files under public/ or docs/ were written (a build, `npm run module`). How the other scenes were timed: Play, an edit
  through `__bylonder.modules.bpyRna`, `mainSync.view()`, then the time to the game scene's next
  `onAfterRenderObservable`. Nothing may write into the served tree while it runs.
