// Runs every example project (examples/<id>/) headless, as the app runs it: its createScene with the project SDK on
// Babylon's NullEngine, Blender's modifiers evaluated, render settings and world read, and its animation played through
// its frame range.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readdirSync } from 'node:fs';
register('./fixtures/example-loader.mjs', import.meta.url);

const BABYLON = await import('@babylonjs/core');
const { createSDK } = await import('../src/runtime/sdk.js');
const { createModifierSystem } = await import('../src/modifiers/stack.js');
const { registerObjects } = await import('../src/blenkernel/animation/bindings.js');
const { createRenderSettings } = await import('../src/blenkernel/scene/render.js');
const { createWorlds } = await import('../src/blenkernel/scene/world.js');
const { hasMesh, identify } = await import('../src/editors/object/identity.js');

// Examples that need the network.
const SKIPPED = { text: 'loads its font from Google Fonts', materials: 'loads its environment from assets.babylonjs.com' };
const root = new URL('../examples/', import.meta.url);

for (const id of readdirSync(root).filter((id) => !SKIPPED[id]).sort()) {
  const engine = new BABYLON.NullEngine();
  const sdk = createSDK('/', {}, () => {});
  Object.assign(globalThis, { BABYLON: { ...BABYLON }, engine, canvas: null, workbench: sdk });
  const { createScene } = await import(new URL(`${id}/index.js`, root));
  const scene = await createScene();
  assert.ok(scene instanceof BABYLON.Scene, `${id}: createScene returns a Scene`);
  assert.ok(scene.activeCamera, `${id}: has a camera`);
  const objects = [...scene.meshes.filter((m) => hasMesh(m) && m.metadata?.editable !== false)];
  objects.forEach(identify);
  const errors = [];
  const world = { scene, objects, animation: sdk.animation };
  registerObjects(sdk.animation, objects);
  createRenderSettings(world, { authored: sdk.authoredRender });
  createWorlds(world);
  const modifiers = createModifierSystem(world, { notify: (text) => errors.push(text) });
  await modifiers.settled();
  assert.deepEqual(errors, [], `${id}: modifiers evaluate`);
  const { frameStart, frameEnd } = sdk.animation.time.state;
  for (let frame = frameStart; frame <= frameEnd; frame += Math.max(1, Math.floor((frameEnd - frameStart) / 12))) {
    sdk.animation.seek(frame);
    scene.render();
  }
  sdk.dispose();
  scene.dispose();
  engine.dispose();
}
console.log('examples ok');
