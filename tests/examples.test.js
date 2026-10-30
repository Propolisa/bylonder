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
// The island's cuts: each changes the camera's direction by 30 degrees or its distance by half, so no cut jumps.
{
  const { SHOTS, framing, LENGTH } = await import(new URL('island/story.js', root));
  const view = ([c, angle, distance, height, look]) => ({ yaw: Math.atan2(-Math.sin(angle), -Math.cos(angle)), reach: Math.hypot(distance, height - look), c });
  for (let i = 0; i + 1 < SHOTS.length; i++) {
    const cut = SHOTS[i + 1][0], a = view(framing(SHOTS[i], cut - SHOTS[i][0], cut)), b = view(framing(SHOTS[i + 1], 0, SHOTS[i + 2]?.[0] ?? LENGTH));
    const turn = Math.abs(Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw))), size = Math.max(a.reach, b.reach) / Math.min(a.reach, b.reach);
    assert.ok(turn >= 0.5 || size >= 1.5, `island: the cut at ${cut} s jumps (${Math.round(turn * 57.3)} degrees, x${size.toFixed(2)})`);
  }
}
console.log('examples ok');
