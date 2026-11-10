// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The page's scheduler over the IR (docs/ir.md): when a property is set, the entities that read it, and those reading
// what they give, run in the IR's order. Each runs through the registry: a registered unit, else the implementation
// the package ships (loaded on first use), else it stays baked. Its inputs are resolved first, an entity it reads that
// has not run yet running before it; a Promise is awaited before what follows. What an entity gives stays live: Babylon's
// animation plays the baked samples, and the scheduler writes the live value after them each frame, running again
// what reads the frame.
import { runUnit, unitFor } from './units.js';
import { dataAt, isReference, referencesIn } from './ir.js';
import { drawGeometry } from './mesh.js';

/**
 * An implementation the package ships: it runs an entity on its resolved inputs; `runChain` runs a chain of entities
 * that each read the one before, in one call, giving the last one's outputs; `draw` gives an IR mesh's draw buffers.
 * @typedef {Record<string, any> | Promise<Record<string, any>>} Outputs
 * @typedef {{ run(inputs: Record<string, any>, context: { frame: number }, entity: import('./ir.js').Entity): Outputs,
 *   runChain?(run: [Record<string, any>, import('./ir.js').Entity][], context: { frame: number }): Outputs,
 *   draw?(mesh: import('./ir.js').Mesh): Promise<import('./mesh.js').DrawBuffers>, settled?(): Promise<void> }} Evaluator
 * @typedef {{ get(path: string): any, write(path: string, value: any): void, frame(): number }} Controls
 * What an implementation loads for: the page's scene, the package's URL, the IR, scene.bin's buffers and the properties.
 * @typedef {{ scene: import('@babylonjs/core').Scene, root: string, ir: import('./ir.js').IR, buffers: ArrayBufferView[], controls: Controls }} Page
 */

/** The implementations a package ships, by name, each loaded on first use. @type {Record<string, (page: Page) => Promise<Evaluator>>} */
export const EVALUATORS = {
  driver: () => import('./driver-evaluator.js'),
  fcurve: () => import('./fcurve-evaluator.js'),
  constraints: (page) => import('./constraints-evaluator.js').then((module) => module.load(page)),
  modifiers: (page) => import('./modifiers-evaluator.js').then((module) => module.load(page)),
  'geometry-nodes': (page) => import('./geometry-nodes-evaluator.js').then((module) => module.load(page)),
  grease_pencil: () => import('./grease-pencil.js').then(({ run }) => ({ run })),
  curves: (page) => import('./curves.js').then((module) => module.load(page)),
};
/** What a package draws only by running it: its export bakes none of it. */
const UNBAKED = ['curves'];
/** What Babylon runs itself (`native`: an F-Curve its AnimationGroup plays), which the scheduler leaves to it unless a unit takes over. */
export const NATIVE = ['native'];

const isTime = (/** @type {string} */ path) => path.endsWith('.frame_current');

/**
 * @param {import('./ir.js').IR} ir
 * @param {Page} page
 */
export function createScheduler(ir, page) {
  const { scene, controls } = page, { entities } = ir;
  /** @type {Map<string, string[]>} */
  const readers = new Map();
  /** @type {string[]} */
  const timed = [];
  for (const [key, entity] of Object.entries(entities)) for (const [ref] of referencesIn(entity.inputs)) {
    const from = 'property' in ref ? ref.property : 'entity' in ref ? ref.entity : null;
    if (from) readers.set(from, [...(readers.get(from) ?? []), key]);
    if ('property' in ref && isTime(ref.property)) timed.push(key);
  }
  const dirty = new Set(), outputs = new Map(), loaded = new Map();
  /** Meshes drawn with the modifier kernel's draw step where the package ships it. @type {import('./mesh.js').Drawing} */
  const drawing = { nodeOf: (id) => ir.ids[id]?.node };
  // Blender's kernels load only for an entity no registered unit runs.
  if (Object.values(entities).some((e) => e.implementation === 'modifiers' && !unitFor(e.type))) {
    drawing.meshBuffers = async (mesh) => /** @type {any} */ (await evaluator('modifiers')).draw(mesh);
  }
  if (Object.values(entities).some((e) => e.implementation === 'grease_pencil')) {
    drawing.greasePencil = (node, layer) => import('./grease-pencil.js').then((module) => module.drawLayer(scene, node, layer));
  }
  if (Object.values(entities).some((e) => e.implementation === 'curves')) {
    drawing.curves = async (node, curves) => /** @type {any} */ (await evaluator('curves')).drawCurves(node, curves);
  }
  /** @type {Promise<void> | null} */
  let pending = null, frame = NaN;

  /** Marks an entity, what reads what it gives, and what it reads that has given nothing yet. @param {string} key */
  const mark = (key) => {
    if (dirty.has(key)) return;
    dirty.add(key);
    for (const [ref] of referencesIn(entities[key].inputs)) if ('entity' in ref && !outputs.get(ref.entity)) mark(ref.entity);
    for (const output of Object.values(entities[key].outputs)) if (output && 'property' in output) readers.get(output.property)?.forEach(mark);
    readers.get(key)?.forEach(mark);
  };

  /** @param {string} name @returns {Evaluator | Promise<Evaluator>} */
  const evaluator = (name) => {
    if (!loaded.has(name)) loaded.set(name, EVALUATORS[name](page).then((module) => (loaded.set(name, module), module)));
    return loaded.get(name);
  };
  /** The unit or shipped implementation an entity runs with, a Promise while it loads, or null: baked. @param {string} key */
  const implementation = (key) => {
    const { type, implementation: name } = entities[key], unit = unitFor(type);
    if (unit) return { run: (/** @type {any} */ inputs, /** @type {any} */ context) => runUnit(unit, inputs, context, key) };
    return name && EVALUATORS[name] ? evaluator(name) : null;
  };

  /** @param {any} value @returns {any} */
  const resolve = (value) => {
    if (isReference(value)) {
      if ('property' in value) return isTime(value.property) ? controls.frame() : controls.get(value.property);
      if ('entity' in value) return outputs.get(value.entity)?.[value.output];
      if ('buffer' in value) return page.buffers[value.buffer];
      return 'data' in value ? resolve(dataAt(ir, value.data)) : ir.graphs[value.graph];
    }
    if (Array.isArray(value)) return value.map(resolve);
    return value?.constructor === Object ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)])) : value;
  };

  /** What an entity gives, written to its properties and drawn; a Promise while a mesh is drawn. @param {string} key @param {Record<string, any>} result */
  const land = (key, result) => {
    outputs.set(key, result);
    const draws = [];
    for (const [name, target] of Object.entries(entities[key].outputs)) {
      const value = result?.[name];
      if (!target || value === undefined) continue;
      if ('property' in target) controls.write(target.property, value);
      else draws.push(drawGeometry(scene, target.draw, value, drawing));
    }
    return draws.length ? Promise.all(draws) : null;
  };

  /** The one entity that reads an entity's outputs, if one alone does. @param {string} key */
  const soleReader = (key) => (readers.get(key)?.length === 1 ? readers.get(key)?.[0] : undefined);

  /** @param {Promise<any>} promise */
  const wait = (promise) => {
    pending = promise.catch((error) => console.warn(error.message)).then(() => { pending = null; run(); });
  };

  /** Runs the marked entities in order, until one answers later. */
  const run = () => {
    while (dirty.size && !pending) for (const key of ir.order) {
      if (!dirty.has(key)) continue;
      const found = implementation(key);
      if (found instanceof Promise) return wait(found);
      dirty.delete(key);
      if (!found || [...referencesIn(entities[key].inputs)].some(([ref]) => 'entity' in ref && !outputs.get(ref.entity))) continue;
      // What reads it alone and runs on the same implementation runs with it, in one call: nothing passes between them.
      const chain = [key];
      for (let next = soleReader(key); found.runChain && next && dirty.has(next) && implementation(next) === found; next = soleReader(next)) {
        chain.push(next);
        dirty.delete(next);
      }
      const last = /** @type {string} */ (chain.pop());
      chain.forEach((k) => outputs.set(k, null));
      try {
        const context = { frame: controls.frame() }, result = found.runChain && chain.length
          ? found.runChain([...chain, last].map((k) => [resolve(entities[k].inputs), entities[k]]), context) : found.run(resolve(entities[last].inputs), context, entities[last]);
        const after = result instanceof Promise ? result.then((r) => land(last, r)) : land(last, result);
        if (after) return wait(after);
      } catch (error) {
        console.warn(`${last}: ${/** @type {Error} */ (error).message}`);
      }
    }
  };

  /** What reads the frame and is not Babylon's own. */
  const timedLive = () => timed.filter((key) => unitFor(entities[key].type) || !NATIVE.includes(entities[key].implementation ?? ''));

  // After Babylon's animation: what reads the frame runs again when it changed, and live values are written over the baked ones.
  const replay = scene.onAfterAnimationsObservable.add(() => {
    if (controls.frame() !== frame) {
      frame = controls.frame();
      timedLive().forEach(mark);
      run();
    }
    for (const [key, result] of outputs) for (const [name, target] of Object.entries(entities[key].outputs)) {
      if (target && 'property' in target && result?.[name] !== undefined) controls.write(target.property, result[name]);
    }
  });

  // What reads the frame loads its implementation now, so it runs as the first frame draws; a load that fails (the
  // scene disposed and its files gone first) fails again when the entity runs, where it is reported.
  timedLive().forEach((key) => Promise.resolve(implementation(key)).catch(() => {}));
  // What the package bakes none of (curves) and reads no property or entity runs once: nothing runs it later. What the
  // package bakes (a modifier's mesh in scene.bin) stays as baked.
  Object.keys(entities).filter((key) => UNBAKED.includes(entities[key].implementation ?? '')
    && ![...referencesIn(entities[key].inputs)].some(([ref]) => 'property' in ref || 'entity' in ref)).forEach(mark);
  run();

  return {
    /** A property was set. @param {string} path */
    changed(path) {
      readers.get(path)?.forEach(mark);
      run();
    },
    /** Resolves once every entity set going has run. */
    async settled() {
      while (pending) await pending;
      await Promise.all([...loaded.values()].map(async (module) => (await module).settled?.()));
    },
    dispose: () => scene.onAfterAnimationsObservable.remove(replay),
  };
}
