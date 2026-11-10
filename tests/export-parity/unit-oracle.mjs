// The GPL unit as the oracle of a user's own (docs/escaping-the-gpl.md): a package's shipped implementation and the
// user's units run on the scene's own inputs, each control an entity reads at its default and a few values in its
// range, and what differs is reported. Entities (a modifier, a driver) run alone on the inputs the shipped units give
// them; a Geometry Nodes node runs inside the modifier whose graph holds it, the modifier's geometry compared; a shader
// node is checked to fit its graphs, its GLSL built (its look is compared on the GPU by look.mjs). Prints one JSON line
// { units, checked, failures } and exits 1 on a failure.
//   node tests/export-parity/unit-oracle.mjs <package dir | example> <units module> [--json]
// The package is exported with its GPL units (no `replace`); with an example's id it is exported first, with Live
// Modifiers, into a temporary folder. The units module's default export maps type keys to units, as `register` takes them.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NullEngine } from '@babylonjs/core';

const TOLERANCE = 1e-4;
const [target, unitsPath] = process.argv.slice(2);
if (!target || !unitsPath) {
  console.error('usage: node tests/export-parity/unit-oracle.mjs <package dir | example> <units module>');
  process.exit(2);
}

/** The package's folder: given, or an example exported into a temporary one. */
async function packageDir() {
  if (existsSync(join(target, 'scene.js'))) return { dir: resolve(target), remove: () => {} };
  const { openExample } = await import('../open-example.js');
  const { exportModule } = await import('../../src/io_scene_babylon/js-export.js');
  const { writePackage } = await import('../export-package.js');
  const { world, sync } = openExample(target);
  sync.view();
  await world.modifiers.settled?.();
  const { dir, remove } = writePackage(await exportModule(world, { live: true }), mkdtempSync(join(tmpdir(), 'bylonder-oracle-')));
  return { dir, remove };
}

/** Values a control is set to: its default and two others within its soft range. */
function valuesOf({ type, default: value, soft_min: min = -Infinity, soft_max: max = Infinity }) {
  const inRange = (v) => v >= min && v <= max;
  if (type === 'BOOLEAN') return [value, !value];
  if (type === 'INT') return [value, ...[value + 1, value - 1].filter(inRange)];
  if (type !== 'FLOAT' || typeof value !== 'number') return [value];
  if (Number.isFinite(min) && Number.isFinite(max) && max - min < 1e6) return [value, min + (max - min) * 0.3, min + (max - min) * 0.7];
  return [value, value * 1.5 + 0.1 * Math.sign(value || 1), value * 0.5];
}

/** What differs between the oracle's value and the unit's, as "<path>: <detail>" lines. */
function differences(oracle, unit, at = '', out = []) {
  if (ArrayBuffer.isView(oracle) || Array.isArray(oracle)) {
    if (!unit || unit.length !== oracle.length) return out.push(`${at || 'value'}: ${unit?.length ?? 'nothing'} items, the oracle ${oracle.length}`), out;
    if (oracle.length && typeof oracle[0] === 'object') { oracle.forEach((v, i) => differences(v, unit[i], `${at}[${i}]`, out)); return out; }
    let worst = 0, where = -1;
    for (let i = 0; i < oracle.length; i++) {
      const d = Math.abs(Number(oracle[i]) - Number(unit[i]));
      if (!(d <= TOLERANCE * Math.max(1, Math.abs(Number(oracle[i])))) && !(d <= worst)) [worst, where] = [Number.isNaN(d) ? Infinity : d, i];
    }
    if (where >= 0) out.push(`${at || 'value'}[${where}]: ${unit[where]}, the oracle ${oracle[where]} (largest difference ${worst.toPrecision(3)})`);
  } else if (oracle && typeof oracle === 'object') {
    // A name starting with a dot is an attribute internal to the kernels (an anonymous one), not the unit's result.
    for (const key of Object.keys(oracle).filter((k) => !k.startsWith('.'))) {
      if (!(key in (unit ?? {}))) out.push(`${at}.${key}: missing`);
      else if (key in oracle) differences(oracle[key], unit[key], `${at}.${key}`, out);
    }
  } else if (typeof oracle === 'number' ? !(Math.abs(oracle - unit) <= TOLERANCE * Math.max(1, Math.abs(oracle))) : oracle !== unit) {
    out.push(`${at || 'value'}: ${JSON.stringify(unit)}, the oracle ${JSON.stringify(oracle)}`);
  }
  return out;
}

const { dir, remove } = await packageDir();
const runtime = (name) => import(pathToFileURL(join(dir, 'bylonder', name)).href);
const [{ load }, { EVALUATORS }, { register, runUnit, unitFor }, { dataAt, isReference, referencesIn }] = await Promise.all([
  import(pathToFileURL(join(dir, 'scene.js')).href), runtime('scheduler.js'), runtime('units.js'), runtime('ir.js')]);
// A package without Geometry Nodes ships no evaluator of them.
const { unitNodes } = existsSync(join(dir, 'bylonder/geometry-nodes/evaluator.js')) ? await runtime('geometry-nodes/evaluator.js') : { unitNodes: () => new Map() };
const units = (await import(pathToFileURL(resolve(unitsPath)).href)).default;
const blend = await load(new NullEngine());
await blend.settled();
const { ir, buffers } = blend;
const page = { scene: blend.scene, root: pathToFileURL(join(dir, '/')).href, ir, buffers, controls: { get: (p) => blend.get(p), write() {}, frame: () => 1 } };
const covers = (type) => Object.keys(units).some((key) => key === type || (key.endsWith('*') && type.startsWith(key.slice(0, -1))));
const loaded = new Map();
const shipped = (name) => loaded.get(name) ?? loaded.set(name, EVALUATORS[name](page)).get(name);

/** An entity's inputs with `values` (controls by path) over the defaults, other entities run on what the package ships. */
async function inputsOf(key, values, memo = new Map()) {
  const resolveValue = async (value) => {
    if (isReference(value)) {
      if ('property' in value) return values.has(value.property) ? values.get(value.property) : value.property.endsWith('.frame_current') ? 1 : blend.get(value.property);
      if ('entity' in value) return (await outputsOf(value.entity, values, memo))?.[value.output];
      if ('buffer' in value) return buffers[value.buffer];
      return 'data' in value ? resolveValue(dataAt(ir, value.data)) : ir.graphs[value.graph];
    }
    if (Array.isArray(value)) return Promise.all(value.map(resolveValue));
    return value?.constructor === Object ? Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await resolveValue(v)]))) : value;
  };
  return resolveValue(ir.entities[key].inputs);
}
/** An entity's outputs on its inputs as the package's own implementation gives them, an IR mesh where it would draw. */
async function oracleOf(key, inputs) {
  const entity = ir.entities[key], evaluator = await shipped(entity.implementation);
  return evaluator.run(inputs, { frame: 1 }, { ...entity, outputs: Object.fromEntries(Object.keys(entity.outputs).map((name) => [name, null])) });
}
/** @param {string} key @param {Map<string, any>} values @param {Map<string, Promise<any>>} memo */
async function outputsOf(key, values, memo) {
  if (!memo.has(key)) memo.set(key, inputsOf(key, values, memo).then((inputs) => oracleOf(key, inputs)));
  return memo.get(key);
}

// The cases: each entity a unit covers (an entity unit) or whose graph holds a node one covers, at each value of each
// control it reads.
const nodeTypes = [...unitNodes(ir.graphs).keys()].filter(covers);
const cases = [];
for (const [key, entity] of Object.entries(ir.entities)) {
  if (!entity.implementation || !(covers(entity.type) || (entity.type === 'modifier:NODES' && nodeTypes.length))) continue;
  const controls = [...new Set([...referencesIn(entity.inputs)].filter(([ref]) => 'property' in ref).map(([ref]) => ref.property))]
    .filter((path) => ir.properties[path] && !path.endsWith('.frame_current'));
  cases.push({ key, values: new Map() });
  for (const path of controls) for (const value of valuesOf(ir.properties[path]).slice(1)) cases.push({ key, values: new Map([[path, value]]) });
}

// The oracle first, with no unit registered; then the user's units, on the same inputs.
for (const each of cases) {
  // Resolved twice: what one run does to its inputs does not reach the other's.
  each.oracle = await oracleOf(each.key, await inputsOf(each.key, each.values));
  each.inputs = await inputsOf(each.key, each.values);
}
for (const [type, unit] of Object.entries(units)) register(type, unit);
const geometryNodes = nodeTypes.length && (await runtime('geometry-nodes-evaluator.js')).load(page);
const result = { units: Object.keys(units), checked: 0, failures: /** @type {string[]} */ ([]) };
for (const { key, values, inputs, oracle } of cases) {
  const entity = ir.entities[key], label = `${key}${[...values].map(([p, v]) => ` with ${p} = ${+v.toFixed?.(4) || v}`).join('')}`;
  try {
    const got = unitFor(entity.type) ? await runUnit(unitFor(entity.type), inputs, { frame: 1 }, key) : await (await geometryNodes).run(inputs, { frame: 1 }, entity);
    const found = differences(oracle, got);
    result.checked++;
    if (found.length) result.failures.push(`${label}: ${found.slice(0, 3).join('; ')}${found.length > 3 ? ` (+${found.length - 3})` : ''}`);
  } catch (error) {
    result.failures.push(`${label}: ${error.message}`);
  }
}

// Shader nodes: each graph holding one builds with the unit's piece.
const shaderTypes = Object.keys(units).filter((type) => units[type].shader);
if (shaderTypes.length && existsSync(join(dir, 'bylonder-nodes/nodes.js'))) {
  const [{ fuse }, { default: kernels }] = await Promise.all([runtime('materials.js'), import(pathToFileURL(join(dir, 'bylonder-nodes/nodes.js')).href)]);
  for (const kernel of Object.keys(kernels.graphs)) {
    const graph = kernel.replace(/\/volume$/, ''), held = ir.graphs[graph]?.nodes.filter((n) => shaderTypes.some((t) => covers(t) && n.type === t)) ?? [];
    if (!held.length) continue;
    try {
      fuse(ir, graph, { kernels, kernel, sources: (source) => `bl_in_${source.replace(/\W/g, '_')}` }).code([]);
      result.checked++;
    } catch (error) {
      result.failures.push(`${graph} (${held.map((n) => n.name).join(', ')}): ${error.message}`);
    }
  }
}

blend.dispose();
remove();
console.log(JSON.stringify(result));
process.exit(result.failures.length || !result.checked ? 1 : 0);
