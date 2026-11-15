// `bylonder/test`, a game run headless for a test (tests/fixtures/example-loader.mjs maps it): an example's .blend
// exported and loaded as its page loads it, on a NullEngine, its game code from src/ run by the framework with a seed,
// input driven by action, and the clock stepped by the test. One example per process (open-example.js).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@babylonjs/core';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { blendHost } from '../src/io_scene_babylon/runtime/game/blend-host.js';
import { createWorld } from '../src/io_scene_babylon/runtime/game/world.js';
import { createInput } from '../src/io_scene_babylon/runtime/game/input.js';
import { BUILTINS } from '../src/editors/space_game/game-code.js';
import '../src/draw/draw-view.js';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

const STEP = 1 / 60;
// Node has no canvas nor DOM: a game's GUI (a Babylon dynamic texture) draws on a canvas whose 2D context does nothing,
// its fonts measured as nothing (the engine's getFontOffset, below).
const nothing = new Proxy(() => {}, { get: (_, key) => (key === 'measureText' ? () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }) : key === 'canvas' ? undefined : nothing), apply: () => undefined, set: () => true });
globalThis.OffscreenCanvas ??= class { constructor(width, height) { Object.assign(this, { width, height }); } getContext() { return nothing; } };
const files = (dir, base = dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path, base) : [relative(base, path).replaceAll('\\', '/')];
});

/** Runs an example's game (`examples/<id>`) with a seed; gives the run as a test drives it. */
export async function run(example, { seed = 1 } = {}) {
  const root = new URL(`../${example}/`, import.meta.url), id = example.split('/').pop();
  const { world, sync } = openExample(id);
  world.mainSync = sync;
  const written = writePackage((await exportPackage(world, { animations: 'BOTH' })).files);
  const engine = Object.assign(new core.NullEngine(), { getFontOffset: () => ({ ascent: 0, height: 0, descent: 0 }) });
  const blend = await (await import(written.url)).load({ scene: new core.Scene(engine) });
  const behaviors = [...BUILTINS], code = files(fileURLToPath(new URL('src/', root))).filter((path) => /\.m?js$/.test(path));
  let game = {};
  for (const path of code) {
    const made = (await import(new URL(`src/${path}`, root).href)).default;
    if (made?.kind === 'behavior') behaviors.push(made);
    if (made?.kind === 'game') game = made;
  }
  const input = createInput(game.input ?? {});
  const assets = { url: (path) => new URL(path, root).href, text: async (path) => readFileSync(new URL(path, root), 'utf8') };
  const errors = [];
  const run = createWorld({ host: blendHost(blend), behaviors, game, seed, input, assets, report: (error, where) => errors.push(`${where}: ${error?.stack ?? error}`) });
  run.start();
  const step = async (seconds = STEP) => { for (let t = 0; t < seconds - 1e-9; t += STEP) { await run.step(STEP); blend.scene.render?.(); } };
  // An object as a test drives it: its entity, its behaviours' handles, and actions that take the run's time.
  const find = (name) => {
    // The object's behaviours, its own (game code's) first: one handle reads the members of all of them.
    const instances = [...run.instances.values()].filter((i) => i.entity.name === name).sort((a, b) => (BUILTINS.includes(a.definition) ? 1 : 0) - (BUILTINS.includes(b.definition) ? 1 : 0));
    const instance = instances[0];
    const entity = instance?.entity ?? null;
    if (!entity) throw new Error(`No object ${name} with a behaviour in ${example}`);
    let queue = Promise.resolve();
    const then = (fn) => { queue = queue.then(fn); return chain; };
    // The behaviour's handle (its members, state and props), with the test's own on top.
    const extras = {
      material: () => entity.material(), authored: entity.authored,
      // Walks straight to `target` (a handle or an entity) until within reach: a Character by its input, as a player's
      // stick drives it, another object by moving it.
      walkTo: (target) => then(async () => {
        const to = (target.entity ?? target).node.computeWorldMatrix(true).getTranslation(), character = entity.character, own = character?.input;
        let heading = new core.Vector3();
        if (character) character.input = () => ({ ...own?.(), move: heading.scale(2.5) });
        // Until within reach, or until a wall (the counter) stops it for half a second.
        for (let i = 0, best = Infinity, still = 0; i < 1200 && still < 30; i++) {
          // In the scene's space: an exported object sits under the scene's root, which turns Blender's axes into Babylon's.
          const at = entity.node.computeWorldMatrix(true).getTranslation(), dx = to.x - at.x, dz = to.z - at.z, d = Math.hypot(dx, dz);
          if (d < 1.0) break;
          [still, best] = d < best - 1e-3 ? [0, d] : [still + 1, best];
          heading = new core.Vector3(dx / d, 0, dz / d);
          if (!character) entity.node.setAbsolutePosition(at.add(heading.scale(2.5 * STEP)));
          await step();
        }
        if (character) character.input = own;
      }),
      press: (action) => then(async () => { input.press(action); await step(); }),
      then: (resolve, reject) => queue.then(() => resolve?.()).catch(reject),
    };
    const owner = (key) => (instances.find((i) => key in i.handlers) ?? instance).handlers;
    const chain = new Proxy(instance.handlers, { get: (_, key) => (key in extras ? extras[key] : owner(key)[key]), set: (_, key, value) => { owner(key)[key] = value; return true; } });
    return chain;
  };
  return {
    find, errors, world: run, blend,
    step: ({ seconds }) => step(seconds),
    get: (system) => run.game.get(system),
    get ended() { return run.ended; },
    dispose() { run.dispose(); written.remove(); },
  };
}

