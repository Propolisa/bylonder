// Snow walks, runs and sprints on uneven ground (docs/character-animation.md): its input moves it, locomotion picks
// its actions from how it moves, and the scene's camera follows it (snow.js). With ?act it plays its Bar Scene
// performance and the first move after it takes over. The package is examples/character-controller exported by
// tools/docs/export-demo.mjs character-controller.
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { createEngine, load } from './world/scene.js';
import { followCamera } from './world/bylonder/character/api.js';
import { createSnow } from './snow.js';
import { createChecks } from './checks.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const engine = await createEngine($('c'));
const blend = await load(engine);
// A failure reported while loading (a material that fell back) stays on screen.
if ($('status').className !== 'failed') $('status').hidden = true;
const scene = blend.scene;

// ?step: a recording's clock, not the screen's: the recorder steps Snow frame by frame (window.demo.step).
const stepped = params.has('step');
// ?script: a scripted stick for recordings, [[seconds, x, z, run], ...], each held until the next; x and z relative to
// the camera's view of the ground.
const script = params.has('script') ? JSON.parse(params.get('script')) : null;
let clock = 0;
const scripted = () => {
  const [, x, z, run] = script.filter(([at]) => at <= clock).at(-1) ?? [0, 0, 0, 0];
  const camera = scene.activeCamera, forward = camera.getDirection(Vector3.Forward()), right = camera.getDirection(Vector3.Right());
  forward.y = 0; right.y = 0;
  const speed = run ? hero.locomotion.speeds.run : hero.locomotion.speeds.walk;
  return { move: forward.normalize().scale(z * speed).add(right.normalize().scale(x * speed)) };
};
// ?debug records the run (Ctrl+S saves it, M marks a moment); ?replay=<run.json> plays one back (../run.js).
const replaying = params.get('replay');
const { hero, act } = createSnow(blend, { manual: stepped || !!replaying, input: script ? scripted : 'default' });
// ?still=<name> holds one of the scene's cameras where Blender put it, to compare with Blender's render.
const still = params.get('still') && scene.getCameraByName(params.get('still'));
if (still) scene.activeCamera = still;
const orbit = still ? null : followCamera(hero);

// ?act=<seconds>: Snow plays its Bar Scene performance (the Acting action) with its dialogue from then; after the first
// tap, any key or tap hands Snow back to its input.
let actAt = params.has('act') ? Number(params.get('act')) : null;
let run = null;
let startedActing = false;
const startActing = () => {
  startedActing = true;
  run?.event('act');
  const acted = act(), takeOver = () => { run?.event('takeOver'); acted(); };
  // After the first tap (which also lets the dialogue play), any input hands Snow to the player.
  if (!stepped) addEventListener('pointerdown', () => {
    for (const type of ['keydown', 'pointerdown']) addEventListener(type, takeOver, { once: true });
  }, { once: true });
  return takeOver;
};
if (actAt !== null && !stepped) setTimeout(startActing, actAt * 1000);

const checks = params.has('measure') ? createChecks(hero) : null;
if (checks && !stepped) scene.onAfterRenderObservable.add(() => checks.take());

/**
 * Puts the scene's camera where Blender's is for a comparison: `position`, `target` and `up` in its armature's space
 * (Blender's axes), `fov` vertical in radians.
 * @param {{ position: number[], target: number[], up: number[], fov: number }} at
 */
function placeCamera({ position, target, up, fov }) {
  const armature = hero.node.getWorldMatrix(), camera = scene.activeCamera;
  const point = (p) => Vector3.TransformCoordinates(new Vector3(p[0], p[2], p[1]), armature);
  camera.parent = null;
  camera.position.copyFrom(point(position));
  camera.upVector = Vector3.TransformNormal(new Vector3(up[0], up[2], up[1]), armature).normalize();
  camera.setTarget(point(target));
  camera.fovMode = Camera.FOVMODE_VERTICAL_FIXED;
  camera.fov = fov;
}

let takeOver = null;
/**
 * One recorded frame of `dt` seconds. `view`: the camera's yaw from behind Snow, pitch and distance, eased there, or a
 * Blender camera to stand in; `takeOver` hands Snow from its acting to its input.
 * @param {number} dt @param {{ yaw?: number, pitch?: number, distance?: number, ease?: number, camera?: object, takeOver?: boolean }} [view]
 */
function step(dt, view = {}) {
  clock += dt;
  if (actAt !== null && clock >= actAt) { takeOver = startActing(); actAt = null; }
  if (view.takeOver && takeOver) { takeOver(); takeOver = null; }
  if (orbit && !view.camera) {
    const k = Math.min(1, (view.ease ?? 2) * dt), toward = (from, to) => (to === undefined ? from : from + (to - from) * k);
    if (view.yaw !== undefined) {
      const facing = hero.movement.facing, goal = Math.atan2(-facing.x, -facing.z) + view.yaw;
      orbit.yaw += Math.atan2(Math.sin(goal - orbit.yaw), Math.cos(goal - orbit.yaw)) * k;
    }
    orbit.pitch = toward(orbit.pitch, view.pitch);
    orbit.distance = toward(orbit.distance, view.distance);
  }
  hero.update(dt);
  if (view.camera) placeCamera(view.camera);
  scene.render();
  checks?.take();
}

const { recordRun, replayRun } = params.has('debug') || replaying ? await import('../run.js').catch(() => import('./run.js')) : {};
let replayTakeOver = null;
const replay = replaying && replayRun(hero, await (await fetch(replaying)).json(), {
  act: () => { replayTakeOver = act(); },
  takeOver: () => replayTakeOver?.(),
});
if (params.has('debug') && !replaying) {
  run = recordRun(hero, 'character-controller');
  // ?act=0 starts acting before the recorder loads.
  if (startedActing) run.event('act');
  $('help').querySelector('.keys')?.append(' Ctrl+S saves the run, M marks a moment.');
}

window.demo = { blend, hero, checks, step, get clock() { return clock; }, get metrics() { return checks?.checks; }, summary: () => checks?.summary() };
addEventListener('resize', () => engine.resize());
if (!stepped) engine.runRenderLoop(() => { if (replay) replay.step(); scene.render(); });
