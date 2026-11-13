// The character controller's checks in Node, without a browser: Snow (docs/demos/character-controller) driven by the
// recordings' scripted stick at 60 frames a second, with the slide, jump and cost checks (checks.js) per run, all
// layers on, and with each layer off to see what it changes.
//   usage: node tools/docs/character-checks.mjs
import { NullEngine } from '@babylonjs/core';
import { load } from '../../docs/demos/character-controller/world/scene.js';
import { createSnow } from '../../docs/demos/character-controller/snow.js';
import { createChecks } from '../../docs/demos/character-controller/checks.js';

// Seconds, then the stick (x right, z forward) and whether to run: the recordings' script (record-character-controller.mjs).
const SCRIPT = [[0, 0, 0, 0], [1, 0, 1, 0], [3.5, 0, 1, 1], [6, 0.8, 0.6, 1], [7.5, -0.6, 0.8, 0], [9.5, 0, 0, 0]];
const SECONDS = 11.5, DT = 1 / 60;

async function run(off) {
  const blend = await load(new NullEngine()), scene = blend.scene;
  // The rig's runtime attaches as the page settles.
  await blend.settled();
  const snow = createSnow(blend, { manual: true, look: () => [0, 1.6, -6], off: new Set(off) }), checks = createChecks(snow);
  const axes = { forward: { x: 0, z: 1 }, right: scene.useRightHandedSystem ? { x: -1, z: 0 } : { x: 1, z: 0 } };
  for (let t = 0; t < SECONDS; t += DT) {
    const step = SCRIPT.filter(([at]) => at <= t).at(-1);
    snow.loco.update({ x: step[1], z: step[2], run: !!step[3] }, axes, DT);
    snow.hero.update(DT);
    // The page's pass: a natively posed rig is solved and deformed as the scene draws.
    scene.render();
    checks.take();
  }
  blend.dispose?.();
  return checks.summary();
}

for (const off of (process.env.RUNS ? JSON.parse(process.env.RUNS) : [[], ['feet'], ['warp'], ['lean'], ['springs']])) {
  const r = await run(off);
  console.log(`${off.length ? `without ${off}` : 'all layers'}: cost ${r.costMs.toFixed(2)} ms, slide mean ${r.slideMeanMm.toFixed(1)} mm p95 ${r.slideP95Mm.toFixed(1)} mm, jump at transitions ${r.jumpAtTransitionsMm.toFixed(0)} mm, steady p99 ${r.jumpSteadyP99Mm.toFixed(0)} mm, ${r.transitions.join(' ')}`);
}
process.exit(0);
