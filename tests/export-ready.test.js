// A page's load waits for its shaders (runtime/ready.js), but never forever: a material whose shader fails to compile
// falls back to the default material for good, reported; one that is only slow stands in with the default material
// after the patience and gets its own back once it compiles; either way the load resolves.
import assert from 'node:assert/strict';
import { whenDrawable } from '../src/io_scene_babylon/runtime/ready.js';

const errors = [], warnings = [];
const [error, warn] = [console.error, console.warn];
console.error = (message) => errors.push(message);
console.warn = (message) => warnings.push(message);
const settle = (promise) => Promise.race([promise.then(() => 'resolved'), new Promise((done) => setTimeout(() => done('hung'), 3000))]);
// A scene of fake meshes: `state.ready(material)` says whether that material has compiled.
const sceneOf = (meshes) => {
  const observers = new Set();
  return {
    meshes,
    isReady: () => meshes.every((m) => m.isReady()),
    onBeforeRenderObservable: { add: (fn) => (observers.add(fn), fn), remove: (fn) => observers.delete(fn) },
    frame: () => { for (const fn of [...observers]) fn(); },
    observing: () => observers.size,
  };
};
const meshOf = (name, material, state) => {
  const mesh = { name, material, isEnabled: () => true, isVisible: true, isReady: () => !mesh.material || state.ready(mesh.material),
    subMeshes: [{ get effect() { return mesh.material ? { getCompilationError: () => state.error ?? '' } : null; }, getMaterial: () => mesh.material }] };
  material.isReady = () => state.ready(material);
  material.isReadyForSubMesh = () => state.ready(material);
  return mesh;
};

{
  // A compile error: falls back at once, for good.
  const state = { ready: () => false, error: "FRAGMENT SHADER ERROR: 'refractionSampler' : undeclared identifier\nmore" };
  const mesh = meshOf('Body', { name: 'Skin' }, state), scene = sceneOf([mesh]);
  assert.equal(await settle(whenDrawable(scene, { every: 1, patience: 500 })), 'resolved', 'the load resolves');
  assert.equal(mesh.material, null, 'the mesh draws with the default material');
  assert.match(errors.at(-1), /^Skin \(on Body\): its shader failed to compile \(FRAGMENT SHADER ERROR/, 'the failure names the material');
}
{
  // Only slow (parallel compilation reports nothing): stands in after the patience, then gets its own back.
  let compiled = false;
  const cornea = { name: 'Cornea' }, state = { ready: (m) => m !== cornea || compiled };
  const mesh = meshOf('Eye', cornea, state), scene = sceneOf([mesh]);
  const started = Date.now();
  assert.equal(await settle(whenDrawable(scene, { every: 1, patience: 200 })), 'resolved', 'a slow material does not hold the load');
  assert.ok(Date.now() - started >= 200, 'it is given its patience first');
  assert.equal(mesh.material, null, 'meanwhile it draws with the default material');
  assert.match(warnings.at(-1), /Still compiling after 0 s, drawn with the default material until ready: Eye \(Cornea\)/, 'and says so');
  scene.frame();
  assert.equal(mesh.material, null, 'still standing in while it compiles');
  compiled = true;
  scene.frame();
  assert.equal(mesh.material, cornea, 'its own material is back once it compiles');
  assert.equal(scene.observing(), 0, 'and nothing is left checking');
}
console.error = error;
console.warn = warn;
console.log('export ready: a failed material falls back for good, a slow one stands in until it compiles, and the load resolves');
