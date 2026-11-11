// The export parity matrix's Node checks of one example (tests/export-parity/matrix.mjs runs one process per example, as
// Blender's module holds one Main): its package, exported with Live Modifiers, loaded headless, against the app's own
// evaluation in Node. Controls: each suggested control set to a few values in both. Animation: a few frames of the
// scene's range in both. Each compares the world matrices of the objects, the evaluated meshes' positions and the
// materials' uniforms. Prints one JSON line: { id, controls, animation, notes }, each check { checked, failures }.
//   node tests/export-parity/evaluate.mjs <example> [package dir: reused when it holds one, else written there; default a new
//   temporary folder]; EXPORT_OPTIONS: File > Export's options as JSON (export-options.js), default none
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NullEngine } from '@babylonjs/core';
import { openExample } from '../open-example.js';
import { writePackage } from '../export-package.js';
import { exportModule } from '../../src/io_scene_babylon/js-export.js';
import { blendData, idStruct } from '../../src/python/bpy_rna.js';
import { babylonMatrix } from '../../src/blenkernel/main-view.js';
import { rigId } from '../../src/io_scene_babylon/area-lights.js';

const [id, given] = process.argv.slice(2), dir = given ?? mkdtempSync(join(tmpdir(), 'bylonder-parity-'));
const TOLERANCE = 1e-4;
// Controls checked per example at most, and the values each is set to.
const MAX_CONTROLS = 60;

// Sets an RNA path from bpy.data as the page's retired Blender fallback did (blender-fallback.js setPath).
const STEP = /^(.*?)(?:\.(\w+)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\])$/;
function setPath(path, value) {
  const [, owner, name, index, key] = STEP.exec(path) ?? [];
  const target = owner ? blendData().path_resolve(owner) : blendData();
  if (name !== undefined) target[name] = value;
  else target.__setitem__(index !== undefined ? Number(index) : key.replace(/\\(.)/g, '$1'), value);
}

// Values a control is set to: two away from its default, inside its soft range.
function valuesOf({ type, default: value, soft_min: min, soft_max: max, subtype }) {
  if (type === 'BOOLEAN') return [!value];
  if (type === 'INT') return [...new Set([value + 1, Math.max(min ?? -Infinity, value - 1)])].filter((v) => v !== value && v <= (max ?? Infinity));
  if (type !== 'FLOAT') return [];
  if (subtype === 'COLOR') return [0.2, 0.9].filter((v) => Math.abs(v - value) > 0.05);
  if (Number.isFinite(min) && Number.isFinite(max) && max - min < 1e6) return [min + (max - min) * 0.3, min + (max - min) * 0.7];
  if (subtype === 'EULER' || subtype === 'QUATERNION' || subtype === 'TRANSLATION') return [value + 0.7, value - 0.4];
  // Without a range, scaled: a width or a count keeps its sign, as Blender's hard limits would have it.
  return [value * 1.5 + 0.1 * Math.sign(value || 1), value * 0.5];
}

const flat = (v) => (typeof v === 'number' || typeof v === 'boolean' ? [Number(v)] : v?.asArray ? v.asArray() : Array.isArray(v) ? v.flatMap(flat) : null);
const differs = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !(Math.abs(v - b[i]) <= TOLERANCE * Math.max(1, Math.abs(b[i]))));
const PBR = ['albedoColor', 'metallic', 'roughness', 'alpha', 'reflectivityColor', 'indexOfRefraction'];
// A material's uniforms by name: a node material's input blocks, else its PBR or standard properties, emission as the
// color times its intensity (how the two split it is the app's choice).
function uniforms(material) {
  if (material.getClassName() === 'NodeMaterial') return Object.fromEntries(material.getInputBlocks().filter((b) => b.isUniform && !b.isSystemValue).map((b) => [b.name, flat(b.value)]));
  const emission = material.emissiveColor && flat(material.emissiveColor.scale(material.emissiveIntensity ?? 1));
  return Object.fromEntries([...PBR.filter((p) => p in material).map((p) => [p, flat(material[p])]), ['emission', emission]]);
}
// A node's world matrix, its parents' computed first.
const worldOf = (node) => { if (node.parent) worldOf(node.parent); return Array.from(node.computeWorldMatrix(true).m); };
// What the app's world matrix of an object is: Main's (its Babylon nodes in Node miss what the view adds per frame,
// a bone parent's pose). A light or camera is turned to look along Babylon's axes, so only its place compares.
const isEye = (node) => /Light$|Camera$/.test(node.getClassName());
const largest = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i]))).toPrecision(2);

// What differs between the app's scene and the page's: each object's world matrix, each mesh's positions, each
// material's uniforms, as "<what>: <detail>" lines.
function compare(app, page, sync) {
  const out = [];
  for (const node of app.getNodes()) {
    const ob = sync.objectOf(node);
    if (!ob) continue;
    // An area light is placed by its rig (area-lights.js).
    const drawn = page.getNodeById(node.getClassName() === 'RectAreaLight' ? rigId(node.id) : node.id);
    if (!drawn) { out.push(`missing ${node.name}`); continue; }
    const main = Array.from(babylonMatrix(sync.blender.transform(ob).matrix_world).m), page_ = worldOf(drawn);
    const [a, b] = isEye(node) ? [main.slice(12, 15), page_.slice(12, 15)] : [main, page_];
    if (differs(b, a)) out.push(`transform ${node.name}: page [${page_.slice(12, 15).map((v) => v.toFixed(3))}] app [${main.slice(12, 15).map((v) => v.toFixed(3))}] (off by ${largest(a, b)})`);
    // Positions as drawn: skinned and morphed on the CPU, as Babylon draws them on the GPU.
    const drawnPositions = (mesh) => mesh.getVerticesData?.('position') && mesh.getPositionData(true, true);
    const positions = drawnPositions(node);
    if (positions) {
      const other = drawnPositions(drawn);
      if (!other || other.length !== positions.length) out.push(`mesh ${node.name}: page ${(other?.length ?? 0) / 3} vertices, app ${positions.length / 3}`);
      else if (differs(Array.from(other), Array.from(positions))) out.push(`mesh ${node.name}: positions off by up to ${largest(Array.from(other), Array.from(positions))}`);
    }
  }
  for (const material of app.materials) {
    const drawn = page.getMaterialById(material.id) ?? page.materials.find((m) => m.name === material.name);
    if (!drawn) continue;
    const [a, b] = [uniforms(material), uniforms(drawn)];
    for (const [name, value] of Object.entries(a)) if (name in b && value && differs(b[name], value)) out.push(`material ${material.name}.${name}: page ${b[name]?.map((v) => +v.toFixed(3))} app ${value.map((v) => +v.toFixed(3))}`);
  }
  return out;
}

const { world, scene, sync } = openExample(id);
sync.view();
const settledApp = async () => { sync.view(); await world.modifiers.settled?.(); };
await settledApp();
const scenePath = join(dir, 'scene.js');
if (!existsSync(scenePath)) writePackage(await exportModule(world, { live: true, ...JSON.parse(process.env.EXPORT_OPTIONS || '{}') }), dir);
const blend = await (await import(pathToFileURL(scenePath).href)).load(new NullEngine());
await blend.settled();
const page = blend.scene, notes = [];
// The page held at the scene's frame and drawn: Babylon poses a skeleton's bones only when a frame renders.
const held = idStruct(sync.blender.scene).frame_current;
blend.playhead.pause();
blend.playhead.seek(held);
page.render();
const result = { id, baseline: compare(scene, page, sync), controls: { checked: 0, failures: [] }, animation: { checked: 0, failures: [] }, notes };

// Controls: each suggested one (the frame aside) at its values, then back to its default.
const controls = blend.controls().filter((c) => c.suggested && !c.path.endsWith('.frame_current') && c.type !== 'STRING');
// Too many to check each: an even spread over the list, which groups them by object and kind.
const sample = controls.length > MAX_CONTROLS ? controls.filter((_, i) => Math.floor(i * MAX_CONTROLS / controls.length) !== Math.floor((i - 1) * MAX_CONTROLS / controls.length)) : controls;
if (sample.length < controls.length) notes.push(`${sample.length} of ${controls.length} suggested controls checked`);
for (const control of sample) {
  for (const value of [...valuesOf(control), control.default]) {
    try { setPath(control.path, value); } catch (error) { result.controls.failures.push(`${control.path}: the app cannot set it (${error.message})`); break; }
    blend.set(control.path, value);
    await Promise.all([blend.settled(), settledApp()]);
    page.render();
    if (value === control.default) continue;
    result.controls.checked++;
    const diff = compare(scene, page, sync);
    if (diff.length) result.controls.failures.push(`${control.path} = ${+value.toFixed?.(3) || value}: ${diff.slice(0, 3).join('; ')}${diff.length > 3 ? ` (+${diff.length - 3})` : ''}`);
  }
}

// Animation: the scene's first, middle and last frames and one between, through the frame control.
const frameControl = blend.controls().find((c) => c.path.endsWith('.frame_current'));
const { frameStart, frameEnd } = world.animation.time.state;
if (frameControl && (page.animationGroups.length || Object.values(blend.ir.entities).some((e) => e.inputs?.frame))) {
  for (const frame of [...new Set([frameStart, Math.round(frameStart + (frameEnd - frameStart) * 0.37), Math.round((frameStart + frameEnd) / 2), frameEnd])]) {
    blend.set(frameControl.path, frame);
    // A frame drawn: Babylon's animation sets the channels it plays, which run what reads them.
    page.render();
    // Through another frame: a frame the app is on already evaluates nothing, and the controls left their defaults
    // over what the animation sets.
    sync.frameChanged(frame + 1);
    sync.frameChanged(frame);
    await Promise.all([blend.settled(), settledApp()]);
    result.animation.checked++;
    const diff = compare(scene, page, sync);
    if (diff.length) result.animation.failures.push(`frame ${frame}: ${diff.slice(0, 3).join('; ')}${diff.length > 3 ? ` (+${diff.length - 3})` : ''}`);
  }
} else notes.push('no animation');
blend.dispose();
if (!given) rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(result));
process.exit(0);
