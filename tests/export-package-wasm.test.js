// File > Export > JavaScript's package on the Steam Engine example (docs/features/drivers-and-graph-editor.md): its
// geometry loads from scene.bin bit for bit as the app draws it, and a control set by its Blender path moves, turns,
// scales, hides, lights and frames the page's Babylon objects as Main's evaluation of the same value does.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Camera, Matrix, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { idStruct, setContextPointer } from '../src/python/bpy_rna.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { setCustomProperty } from '../src/blenkernel/animation/anim-blender.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createWorlds } from '../src/blenkernel/scene/world.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createCurveObjects } from '../src/editors/curve/curve-objects.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { nodeId } from '../src/editors/object/identity.js';
import { packageFiles, writePackage } from './export-package.js';

// The example opened as a project opens it, in a world with the slices the view reads.
const scene = new Scene(new NullEngine());
const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(blenderMain()) });
const objects = Object.assign([], { scene });
const world = { scene, objects, animation };
const opening = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids: animation.ids });
objects.push(...opening.readBlend(readFileSync(new URL('../examples/drivers-and-graph-editor/drivers-and-graph-editor.blend', import.meta.url)), scene).nodes);
let camera = scene.activeCamera;
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => scene.cameras, get: () => camera, set: (c) => { camera = c; } } });
world.renderSettings = createRenderSettings(world);
world.collections = createCollections(world);
world.materials = createMaterialLibrary(world);
world.worlds = createWorlds(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
world.curves = createCurveObjects(world);
registerObjects(animation, objects);
const sync = createMainSync({ rna: createRNA({ world, selection: createSelection(scene, objects) }), ids: animation.ids });
setContextPointer(sync.blender.C);
sync.view();

// A custom property, as the Custom Properties panel adds one.
setCustomProperty(sync.objectOf(objects.find((n) => n.name === 'Flywheel')), 'speed', 2.5);
// The Key Light (an area light) keyed to slide along X: its rig carries the motion.
const keyLight = objects.find((n) => n.name === 'Key Light'), slide = animation.ref('object:' + nodeId(keyLight), 'position.x');
animation.insert([slide], 1, keyLight.position.x);
animation.insert([slide], 30, keyLight.position.x + 2);
const files = await exportModule(world);
assert.doesNotMatch(files['scene.js'], /bylonder-blocks/, 'a scene without a compositor ships no blocks library');
assert.ok(files['scene.d.ts'].includes(`'objects["Flywheel"].location[0]': number;`), 'scene.d.ts types the controls');
// Babylon module by module (babylon-modules.js), so a page loads only what its scene uses: the classes its data names
// registered before they parse, and no module of the package importing the whole of @babylonjs/core.
for (const [path, code] of Object.entries(packageFiles(files)).filter(([path]) => path.endsWith('.js'))) {
  assert.doesNotMatch(String(code), /from '@babylonjs\/core'|import \* as \w+ from '@babylonjs\/core/, `${path} imports Babylon module by module`);
}
assert.match(packageFiles(files)['scene.js'], /^import '@babylonjs\/core\/Materials\/PBR\/pbrMaterial\.js';$/m, 'the materials\' class registered');
assert.match(packageFiles(files)['scene.js'], /^import '@babylonjs\/core\/Lights\/\w+Light\.js';$/m, 'the lights\' constructors');
// The GPU engine target (export-options.js TARGETS): scene.js makes that engine, and the package ships the WebGPU
// overrides only for a target with WebGPU. A WebGL 2 package still loads.
const shipped = (files) => Object.keys(packageFiles(files)).filter((path) => path.startsWith('bylonder/overrides/webgpu/') && path.endsWith('.js'));
const webgpuOverrides = shipped(files);
assert.match(files['scene.js'], /IsSupportedAsync\)\) return webgpu\.CreateAsync[^\n]*\n[^\n]*new \(await import\('@babylonjs\/core\/Engines\/engine\.js'\)\)\.Engine\(/, 'by default the page makes WebGPU where it can, else WebGL 2');
assert.doesNotMatch(packageFiles(files)['scene.js'], /^import .*\b(Engine|WebGPUEngine)\b.*from/m, 'and loads only the engine it makes');
assert.ok(webgpuOverrides.includes('bylonder/overrides/webgpu/maximum-limits.js'), 'by default the WebGPU overrides ship');
const webgl2 = await exportModule(world, { target: 'WEBGL2' });
assert.doesNotMatch(webgl2['scene.js'], /WebGPU|overrides\/webgpu\/(?!float-world-cube|samplers|missing-attributes)/, 'a WebGL 2 page imports no WebGPU code');
assert.match(webgl2['scene.js'], /createEngine = async \(canvas, options = \{\}\) => new Engine\(canvas, true, options\)/);
assert.deepEqual(shipped(webgl2).filter((path) => !/float-world-cube|samplers|missing-attributes/.test(path)), [], 'a WebGL 2 package ships only the WebGPU overrides its runtime files import');
const webgpu = await exportModule(world, { target: 'WEBGPU' });
assert.match(webgpu['scene.js'], /createEngine = \(canvas, options = \{\}\) => WebGPUEngine\.CreateAsync\(canvas, \{ \.\.\.WEBGPU_OPTIONS, \.\.\.options \}\)/);
assert.doesNotMatch(webgpu['scene.js'], /new Engine\(/, 'a WebGPU page makes no WebGL engine');
assert.deepEqual(shipped(webgpu), webgpuOverrides, 'a WebGPU package ships the WebGPU overrides');
// The control panel (runtime/control-panel.js): scene.js adds it to the page with the editors' source and navigation
// chosen, and each control carries what Blender's UI shows of it; with Control Panel off the package ships none of it.
assert.match(files['scene.js'], /controlPanel\(blend, \{"tools":"CDN","navigation":"FIXED","offer":\["FIXED","ORBIT","FLY","WALK","JOYSTICKS"\], root: ROOT \}\)/);
assert.ok('bylonder/control-panel-ui.js' in packageFiles(files), 'the panel ships');
const { name, blender_default, subtype, unit } = JSON.parse(files['scene.ir.json']).properties['objects["Flywheel"].location[0]'];
assert.deepEqual({ name, blender_default, subtype, unit }, { name: 'Location', blender_default: 0, subtype: 'TRANSLATION', unit: 'LENGTH' }, "a control's UI name and Blender's default");
const panelless = await exportModule(world, { controlPanel: false, navigationModes: { WALK: false } });
assert.doesNotMatch(panelless['scene.js'], /control-panel|controlPanel/, 'Control Panel off: no panel');
assert.ok(!Object.keys(packageFiles(panelless)).some((path) => path.includes('control-panel')), 'and none of its files');
const webgl2Package = writePackage(webgl2);
assert.ok((await (await import(webgl2Package.url)).load(new NullEngine())).scene.meshes.length, 'a WebGL 2 package loads');
webgl2Package.remove();

const written = writePackage(files);
// The package alone, in a process that imports nothing else of Babylon's: its own imports register what it parses.
const alone = `const { NullEngine } = await import(${JSON.stringify(import.meta.resolve('@babylonjs/core/Engines/nullEngine.js'))});
const { scene } = await (await import(${JSON.stringify(written.url)})).load(new NullEngine());
console.log(scene.meshes.length, scene.lights.length, scene.cameras.length);`;
const [aloneMeshes, aloneLights, aloneCameras] = execFileSync(process.execPath, ['--input-type=module', '-e', alone], { encoding: 'utf8' }).trim().split('\n').at(-1).split(' ').map(Number);
assert.ok(aloneMeshes && aloneLights && aloneCameras, 'the package loads with only the Babylon modules it imports');
const blend = await (await import(written.url)).load(new NullEngine());
const page = blend.scene;

// Geometry: every vertex buffer and index of each exported mesh, bit for bit.
const bits = (array) => Buffer.from(new Uint8Array(Float32Array.from(array).buffer)).toString('base64');
let meshes = 0;
for (const mesh of scene.meshes.filter((m) => m.geometry && page.getMeshByName(m.name) && !m.name.startsWith('__'))) {
  const loaded = page.getMeshByName(mesh.name);
  for (const kind of mesh.getVerticesDataKinds().filter((k) => !mesh.getVertexBuffer(k).getIsInstanced())) {
    assert.equal(bits(loaded.getVerticesData(kind)), bits(mesh.getVerticesData(kind)), `${mesh.name} ${kind}`);
  }
  assert.deepEqual(Array.from(loaded.getIndices()), Array.from(mesh.getIndices()), `${mesh.name} indices`);
  meshes++;
}
assert.ok(meshes > 20, `${meshes} meshes compared`);

// Controls: a node set by path against Main with the same RNA value set and evaluated.
const paths = new Set(blend.controls().map((c) => c.path));
const node = (name) => objects.find((n) => n.name === name);
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
// A light: an area light's rectangle as the app draws it from Main (its point, width and height), another's position
// and direction (Blender's -Z).
function lit(name) {
  const m = babylonMatrix(sync.blender.transform(sync.objectOf(node(name))).matrix_world), light = page.getLightById(name);
  if (light.getClassName() === 'RectAreaLight') {
    const app = scene.lights.find((l) => l.name === name);
    light.parent.computeWorldMatrix(true);
    light._computeTransformedInformation();
    app._computeTransformedInformation();
    for (const field of ['_pointTransformedPosition', '_pointTransformedWidth', '_pointTransformedHeight']) {
      assert.ok(near(light[field].asArray(), app[field].asArray()), `${name} ${field}: ${light[field].asArray()}, app ${app[field].asArray()}`);
    }
    return;
  }
  const position = light.position.asArray(), main = m.getTranslation().asArray();
  assert.ok(near(position, main), `${name}: at ${position}, Main ${main}`);
  if (!light.direction) return;
  const forward = Vector3.TransformNormal(new Vector3(0, -1, 0), m).normalize().asArray(), direction = light.direction.normalizeToNew().asArray();
  assert.ok(near(direction, forward), `${name}: along ${direction}, Main ${forward}`);
}
function placed(name, when = 'after set') {
  if (page.getLightById(name)) return lit(name);
  const ob = idStruct(sync.objectOf(node(name)));
  // A camera or light looks along Babylon's +Z, Blender's along its -Z: Bylonder turns it a quarter about X.
  const looks = ['CAMERA', 'LIGHT'].includes(ob.type), evaluated = babylonMatrix(sync.blender.transform(sync.objectOf(node(name))).matrix_world);
  const main = looks ? Matrix.RotationX(Math.PI / 2).multiply(evaluated) : evaluated;
  const pageNode = page.getNodeById(name), drawn = pageNode instanceof Camera ? pageNode.getViewMatrix(true).clone().invert() : pageNode.computeWorldMatrix(true);
  return near(Array.from(drawn.m), Array.from(main.m)) || assert.fail(`${name} ${when} (${ob.rotation_mode}): ${Array.from(drawn.m).map((v) => v.toFixed(3))} drawn, Main ${Array.from(main.m).map((v) => v.toFixed(3))}`);
}
function setBoth(name, property, index, value) {
  const ob = idStruct(sync.objectOf(node(name)));
  const path = `objects["${name}"].${property}[${index}]`;
  assert.ok(paths.has(path), `${path} is a control`);
  blend.set(path, value);
  ob[property][index] = value;
  sync.view();
}
// The area light's rectangle at frames of its slide, as the app draws it from Main.
const group = page.animationGroups[0], current = animation.time.frame;
assert.ok(group.targetedAnimations.some((t) => t.target.name === 'Key Light rig'), 'the rig is animated');
for (const frame of [1, 15, 30, current]) {
  group.start(false, 1, frame, frame);
  group.goToFrame(frame);
  sync.frameChanged(frame);
  lit('Key Light');
  group.stop();
}
for (const name of ['Steam Cylinder', 'Governor Cap', 'Camera', 'Key Light', 'Rim Light', 'Governor Ball']) {
  if (!node(name)) continue;
  placed(name, 'as exported');
  setBoth(name, 'location', 2, 0.7);
  setBoth(name, 'rotation_euler', 0, 0.4);
  setBoth(name, 'rotation_euler', 2, -1.1);
  if (!page.getCameraById(name)) setBoth(name, 'scale', 1, 1.5);
  placed(name);
}
// A light's power and color, a camera's lens and clipping: the page's Babylon values against the app's for the same RNA
// values in Main.
const data = (name) => idStruct(sync.objectOf(node(name))).data;
function setData(name, collection, property, index, value) {
  const path = `${collection}["${name}"].${property}${index === undefined ? '' : `[${index}]`}`;
  assert.ok(paths.has(path), `${path} is a control`);
  blend.set(path, value);
  if (index === undefined) data(name)[property] = value; else data(name)[property][index] = value;
  sync.view();
}
const appLight = (name) => scene.lights.find((l) => l.name === name);
for (const name of ['Key Light', 'Rim Light']) {
  setData(name, 'lights', 'energy', undefined, 123);
  setData(name, 'lights', 'color', 1, 0.25);
  assert.ok(Math.abs(page.getLightById(name).intensity - appLight(name).intensity) < 1e-4 * appLight(name).intensity, `${name} intensity`);
  assert.ok(near(page.getLightById(name).diffuse.asArray(), appLight(name).diffuse.asArray()), `${name} color`);
}
setData('Camera', 'cameras', 'lens', undefined, 85);
setData('Camera', 'cameras', 'clip_end', undefined, 250);
const appCamera = scene.cameras.find((c) => c.name === 'Camera'), pageCamera = page.getCameraById('Camera');
assert.ok(Math.abs(pageCamera.fov - appCamera.fov) < 1e-5, `lens: fov ${pageCamera.fov}, app ${appCamera.fov}`);
assert.equal(pageCamera.maxZ, appCamera.maxZ, 'clip_end');

// Visibility: hidden in renders or the viewport, a mesh is not drawn.
blend.set('objects["Steam Cylinder"].hide_render', true);
assert.equal(page.getMeshById('Steam Cylinder').isVisible, false);
blend.set('objects["Steam Cylinder"].hide_render', false);
assert.equal(page.getMeshById('Steam Cylinder').isVisible, true);
assert.throws(() => blend.set('objects["Steam Cylinder"].hide_render', 1), TypeError, 'a value of the wrong type');
const changes = [];
blend.onChanged.add((change) => changes.push(change));
blend.set('objects["Steam Cylinder"].location[0]', 3);
assert.deepEqual(changes, [{ path: 'objects["Steam Cylinder"].location[0]', value: 3 }]);
assert.equal(blend.get('objects["Steam Cylinder"].location[0]'), 3);
assert.ok(blend.controls().every((c) => !('bind' in c)), 'controls() describes, without bindings');
assert.deepEqual(blend.controls().find((c) => c.path === 'objects["Flywheel"]["speed"]'), { name: 'speed', path: 'objects["Flywheel"]["speed"]', type: 'FLOAT', default: 2.5, suggested: true }, 'a custom property is a suggested control');
blend.dispose();
written.remove();
console.log(`Export package: ${meshes} meshes load bit for bit from scene.bin; transforms, lights, the camera, visibility and custom properties set by path as Main evaluates them`);
