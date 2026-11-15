// The Game area's run (docs/data-flow.md, From .blend to the game views): the live package played
// by the page runtime of the app's own module graph (package-link.js). A full export's scene.js is linked once; its IR
// and arrays are the export's own objects, frozen, handed to the run by reference (shared-resources.js sharedPackage),
// never written as text or read again. An edit's patch reaches the run as the new version's entries. A run in any doubt
// (a patch not applied, or loading the package again) is dropped and loaded fresh at the live version: the export's
// scene.js patched to it, or, where a patch cannot reach, a new full export (`exportAgain`, which plays it). The run has
// an engine of its own, which the app's Babylon-wide extensions leave alone (runtime/app-scene.js), and Babylon's last
// created engine and scene stay the app's, which Babylon's constructors default to.
import { EngineStore } from '@babylonjs/core';
import { sharedPackage, frozen } from '../../io_scene_babylon/runtime/shared-resources.js';
import { gameEngine } from '../../runtime/app-scene.js';
import { tablesPatch } from '../../io_scene_babylon/scene-patch.js';
import { linkPackage } from './package-link.js';

/**
 * `appModule(source)`: the app's module of a src/ path (package-link.js); `engine(createEngine)`: the run's engine, made
 * with scene.js's createEngine.
 */
export function createGameRun({ appModule, exportAgain, engine: makeEngine }) {
  /** The full export the run loads from: exportPackage's, its tables (packageState's) and its linked scene.js. */
  let source = null, blend = null, engine = null;
  const drop = () => { blend?.dispose(); blend = null; };
  /** A run of the export's scene.js at the live tables `state`. */
  const load = async (state) => {
    const run = await keepLastCreated(() => source.module.load(engine));
    return state.version === source.state.version ? run : applied(run, tablesPatch(source.state, state));
  };
  return {
    get blend() { return blend; },
    get engine() { return engine; },
    /** Runs a full export `made` (exportPackage's) whose tables are `state` and whose files are served at `base`. */
    async play(made, state, base) {
      drop();
      const module = await linkPackage(made.files, base, appModule);
      await sharedPackage(new URL(`?v=${made.version}`, base).href, async () => ({ ir: made.ir, buffers: made.buffers }));
      source = { made, state, module };
      engine ??= gameEngine(await keepLastCreated(() => makeEngine(module.createEngine)));
      return (blend = await load(state));
    },
    /** A fresh run at the live tables `state`. */
    async reset(state) {
      drop();
      try {
        blend = await load(state);
      } catch {
        await exportAgain();
      }
      return blend;
    },
    /** A value edit's controls (`[path, value]` pairs) set where they differ, on the run and every copy made of it. */
    set(changes) {
      if (blend) setControls(blend, changes);
    },
    /** An edit's patch to the live tables `state`, its entries by reference: true once applied, false once loaded fresh. */
    async patch(patch, state) {
      const run = blend;
      blend = null;
      try {
        blend = await applied(run, patch);
        return true;
      } catch {
        await this.reset(state);
        return false;
      }
    },
    dispose() {
      drop();
      engine?.dispose();
    },
  };
}

/** The copies made of a run (load({ instance })), and theirs. @returns {any[]} */
const copiesOf = (blend) => [...blend.copies].flatMap((copy) => [copy, ...copiesOf(copy)]);

const has = (run, path) => { try { run.get(path); return true; } catch { return false; } };
/** Controls (`[path, value]` pairs) set where they differ, on a run and every copy made of it. */
export function setControls(blend, changes) {
  for (const run of [blend, ...copiesOf(blend)]) for (const [path, value] of changes) if (has(run, path) && run.get(path) !== value) run.set(path, value);
}

/** What `make` gives, Babylon's last created engine and scene left as they were. @template T @param {() => Promise<T>} make */
async function keepLastCreated(make) {
  const scene = EngineStore._LastCreatedScene, engines = [...EngineStore.Instances];
  try {
    return await make();
  } finally {
    EngineStore._LastCreatedScene = scene;
    EngineStore.Instances.sort((a, b) => (engines.includes(a) ? 1 : 0) - (engines.includes(b) ? 1 : 0));
  }
}

/**
 * `blend` patched; else, a patch it did not apply or one that loaded the package again, what it gave is disposed and
 * this throws.
 */
async function applied(blend, patch) {
  let next = blend;
  try {
    next = await blend.patch(frozen(patch));
  } finally {
    if (next !== blend || next.version !== patch.version) next.dispose();
  }
  if (next !== blend || next.version !== patch.version) throw new Error(`The run did not take the patch to version ${patch.version}`);
  return next;
}
