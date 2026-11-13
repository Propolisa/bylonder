// Replays a run saved from a demo page (?debug, Ctrl+S; docs/demos/run.js) in Node on the demo's package: the
// character made as the page makes it, fed the run's intents and time steps. Prints where it is at each marker and at
// the end, to compare with the page.
//   usage: node tools/replay-run.mjs <run.json> [package folder]  (default docs/demos/<page>/world)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { NullEngine } from '@babylonjs/core';
import { replayRun } from '../docs/demos/run.js';

const run = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const dir = process.argv[3] ?? `docs/demos/${run.page}/world`;
const { load, Character, feet, gaze } = await import(pathToFileURL(`${dir}/scene.js`).href);
const blend = await load(new NullEngine());
await blend.settled();

// The character as each page makes it (docs/demos/<page>/game.js), updated by hand.
const pages = {
  'character-controller': async () => {
    const { createSnow } = await import(pathToFileURL('docs/demos/character-controller/snow.js').href);
    const { hero, act } = createSnow(blend, { manual: true, input: null });
    let takeOver = null;
    return { hero, events: { act: () => { takeOver = act(); }, takeOver: () => takeOver?.() } };
  },
  'basic-character': async () => {
    const hero = new Character(blend, 'Armature', { manual: true });
    hero.body.play(hero.locomotion);
    hero.add(feet());
    hero.add(gaze({ targets: [blend.scene.activeCamera] }));
    return { hero, events: {} };
  },
};
if (!pages[run.page]) throw Error(`No replay for the page "${run.page}": it knows ${Object.keys(pages).join(', ')}`);
const { hero, events } = await pages[run.page]();
const replay = replayRun(hero, run, events);
const at = () => { const p = hero.movement.position; return `(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`; };
let t = run.from;
const marks = [...run.marks];
while (replay.step()) {
  // Babylon tells of new meshes (props a page adds) a tick after they are made.
  await new Promise((resolve) => setTimeout(resolve, 0));
  t += run.frames[replay.frame - 1]?.dt ?? 0;
  while (marks.length && marks[0] <= t) console.log(`marker at ${marks.shift().toFixed(2)} s: ${at()}`);
}
console.log(`end at ${t.toFixed(2)} s after ${run.frames.length} frames: ${at()}`);
process.exit(0);
