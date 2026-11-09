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
 * An implementation the package ships: it runs an entity on its resolved inputs; `draw` gives an IR mesh's draw buffers.
 * @typedef {{ run(inputs: Record<string, any>, context: { frame: number }, entity: import('./ir.js').Entity): Record<string, any> | Promise<Record<string, any>>,
 *   draw?(mesh: import('./ir.js').Mesh): Promise<import('./mesh.js').DrawBuffers>, settled?(): Promise<void> }} Evaluator
 * @typedef {{ paths: string[], defaults: any[], get(path: string): any, write(path: string, value: any): void, frame(): number }} Controls
 * What an implementation loads for: the page's scene, the package's URL, scene.bin's buffers and the properties.
 * @typedef {{ scene: import('@babylonjs/core').Scene, root: string, buffers: ArrayBufferView[], controls: Controls }} Page
 */

/** The implementations a package ships, by name, each loaded on first use. @type {Record<string, (page: Page) => Promise<Evaluator>>} */
export const EVALUATORS = {
  driver: () => import('./driver-evaluator.js'),
  modifiers: (page) => import('./modifiers-evaluator.js').then((module) => module.load(page)),
  blender: (page) => import('./blender-evaluator.js').then((module) => module.load(page)),
};
/** What Babylon runs itself (`animation`: the AnimationGroup), which the scheduler leaves to it unless a unit takes over. */
export const NATIVE = ['animation'];

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
  if (Object.values(entities).some((e) => e.implementation === 'modifiers')) {
    drawing.meshBuffers = async (mesh) => /** @type {any} */ (await evaluator('modifiers')).draw(mesh);
  }
  /** @type {Promise<void> | null} */
  let pending = null, frame = NaN;

  /** Marks an entity, what reads what it gives, and what it reads that has given nothing yet. @param {string} key */
  const mark = (key) => {
    if (dirty.has(key)) return;
    dirty.add(key);
    for (const [ref] of referencesIn(entities[key].inputs)) if ('entity' in ref && !outputs.has(ref.entity)) mark(ref.entity);
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
      return 'data' in value ? dataAt(ir, value.data) : ir.graphs[value.graph];
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
      const inputs = entities[key].inputs;
      if (!found || [...referencesIn(inputs)].some(([ref]) => 'entity' in ref && !outputs.has(ref.entity))) continue;
      try {
        const result = found.run(resolve(inputs), { frame: controls.frame() }, entities[key]);
        const after = result instanceof Promise ? result.then((r) => land(key, r)) : land(key, result);
        if (after) return wait(after);
      } catch (error) {
        console.warn(`${key}: ${/** @type {Error} */ (error).message}`);
      }
    }
  };

  // After Babylon's animation: what reads the frame runs again when it changed, and live values are written over the baked ones.
  const replay = scene.onAfterAnimationsObservable.add(() => {
    if (controls.frame() !== frame) {
      frame = controls.frame();
      timed.filter((key) => unitFor(entities[key].type) || !NATIVE.includes(entities[key].implementation ?? '')).forEach(mark);
      run();
    }
    for (const [key, result] of outputs) for (const [name, target] of Object.entries(entities[key].outputs)) {
      if (target && 'property' in target && result?.[name] !== undefined) controls.write(target.property, result[name]);
    }
  });

  return {
    /** A property was set. @param {string} path */
    changed(path) {
      readers.get(path)?.forEach(mark);
      run();
    },
    /** Resolves once every entity set going has run. */
    async settled() {
      while (pending) await pending;
      await Promise.all([...loaded.values()].map((module) => module.settled?.()));
    },
    dispose: () => scene.onAfterAnimationsObservable.remove(replay),
  };
}
