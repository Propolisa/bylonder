# Handoff

State of the work on `claude/focused-cerf-i614w8`. This file stays on this branch; do not merge it to `main`.

## On main (5a5acc8, live)

Feature pages with new scenes: rendering, mesh-modeling, vertex-and-weight-paint, drivers-and-graph-editor, nla,
particle-hair, shape-keys, preferences. Fixes: AgX view transform, curve and text materials, temporary Chromium
profiles, dev server watching in worktrees.

## On this branch, not on main

- 8fb4f79: objects with a parent inverse in a .blend open at the origin; fixed in
  `tools/blender-port/wasm/main-api.cc` (`object_parent_inverse_fold`). CI published module-1296a66 for it; not checked
  in the app yet. Check a bone-parented object from a .blend, then ship.
- `docs/stress-tests/rigify-face/`: the Rigify face rig test (file, script, screenshot, findings).

## Unfinished feature pages (pushed WIP branches)

Each branch is one commit on top of the agent's work, based on main before 5a5acc8: scenes, scripts, docs and recorders
are written; media is missing unless noted. To finish a page: run its recorder (`DOCS_PORT=<port> node
tools/docs/record-<id>.mjs`, with a dev server on that port), run `node scripts/feature-docs.mjs` and `npm test`, then
cherry-pick one commit per page onto main.

| Branch | Pages |
|---|---|
| `wip/docs-animation` | keyframe-animation (Newton's Cradle; cradle.gif and thumbnail missing), rigging (Desk Lamp; only build.gif) |
| `wip/docs-procedural` | geometry-nodes (planet), spreadsheet, geometry-node-editor (sunflowers), hair-dynamics (anemone) |
| `wip/docs-surface` | shader-nodes (blue-planet), curves-and-text (neon-sign), texture-paint (vase), uv-editing (tin-cans), image-textures (framed-print) |
| `wip/docs-pipeline` | modifiers (spiral stair; thumbnail done), grease-pencil (Dusk Lake), python (seashell), import-export (bust), link-append (street), mobile (robot-arm) |
| `wip/docs-new-pages` | sculpting (Ceramic Owl; strokes do not redraw in the recording) |

Skipped: video-sequencer (scene strips render blank).

## Older unshipped branches still worth finishing

- `binary-storage`: project files kept as bytes so large .blend files (Wasp Bot, Mr. Elephant, the 5.1 splash) open;
  float images as half float. Not checked in a browser or gated.
- `eevee-parity-3-next`: EEVEE view transforms and shadow cascades, with its own HANDOFF.

## Bugs found, not fixed

- Rendered camera view frames tighter than Render Image.
- Shadows do not soften with sun Angle or light Radius.
- Object rotation from a .blend forced to YXZ Euler.
- Geometry Nodes: objects sharing one group draw instances on one of them only; Object Info instances lose their
  material; instances from a nested collection do not draw.
- Point clouds lit from the mirrored side (`src/draw/pointcloud.js`).
- Grease Pencil strokes do not draw (fills do).
- A .blend with a library override on an instanced linked collection crashes the module on read.
- Rendered view goes black: Principled Alpha linked from nodes; `scene.isReady()` polled during Rendered; near-vertical
  sun or a 4000 W area light.
- Video Sequencer scene strips render blank; MPEG-4/AAC output fails in headless Chromium.
- NLA: no Push Down button, no sidebar on N, Track > Add shows nothing.
- A driver using `**` reads 0 until Python loads.
- Rigify rig: control shapes draw black, 4 to 5 FPS (see `docs/stress-tests/rigify-face/`).

## Machine notes

Heavy jobs (Blender runs, browser recordings, `npm test`, builds) ran through a two-slot lock to avoid running out of
memory; temporary Chromium profiles are now deleted after each run.
