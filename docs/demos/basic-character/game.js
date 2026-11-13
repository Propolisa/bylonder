// The character animation guide's basic path (docs/character-animation.md, example 1): Quaternius' mannequin with its
// own Idle, Walk, Run and Jump, moved by the default input, its actions chosen by locomotion, its feet on the ground,
// its eyes on the camera, and the camera following it. The package is examples/basic-character exported by
// tools/docs/export-demo.mjs basic-character.
import { createEngine, load, Character, followCamera, feet, gaze } from './world/scene.js';

const engine = await createEngine(document.getElementById('c'));
const blend = await load(engine);
document.getElementById('status').hidden = true;

// ?debug records the run (Ctrl+S saves it, M marks a moment); ?replay=<run.json> plays one back (../run.js).
const params = new URLSearchParams(location.search), replaying = params.get('replay');
const hero = new Character(blend, 'Armature', { input: 'default', manual: !!replaying });
hero.body.play(hero.locomotion);
hero.add(feet());
hero.add(gaze({ targets: [blend.scene.activeCamera] }));
followCamera(hero);

const { recordRun, replayRun } = params.has('debug') || replaying ? await import('../run.js').catch(() => import('./run.js')) : {};
const replay = replaying && replayRun(hero, await (await fetch(replaying)).json());
if (params.has('debug') && !replaying) {
  recordRun(hero, 'basic-character');
  document.querySelector('#help .keys')?.append(' Ctrl+S saves the run, M marks a moment.');
}

addEventListener('resize', () => engine.resize());
engine.runRenderLoop(() => { replay?.step(); blend.scene.render(); });
// For recordings and checks (tools/docs/record-character-animation.mjs): the scene and the character, once made.
window.demo = { blend, hero };
