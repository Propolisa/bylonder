// Rock Hard Café by touch (examples/rock-hard-cafe/src/systems/touch.js): a finger dragging on the right half moves the
// hand as a trackpad moves a cursor, and dragged past its reach the barista walks after it, never out of the Play Area.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { Matrix, Vector3 } from '@babylonjs/core';

register('./fixtures/example-loader.mjs', import.meta.url);
const { run } = await import('./game-test.js');

const game = await run('examples/rock-hard-cafe', { seed: 1 });
const scene = game.blend.scene, barista = game.find('Barista'), engine = scene.getEngine();
const screen = (at) => {
  const viewport = scene.activeCamera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  const p = Vector3.Project(at, Matrix.Identity(), scene.getTransformMatrix(), viewport);
  return { x: p.x, y: p.y };
};
const palm = () => scene.getMeshByName('Palm').getAbsolutePosition().clone();
const body = () => barista.entity.node.getAbsolutePosition().clone();
await game.step({ seconds: 1 });

// A short drag: the hand follows by as much over the counter, the barista stays.
const start = palm(), stood = body();
const from = screen(new Vector3(start.x, 1.12, start.z)), to = screen(new Vector3(start.x - 0.2, 1.12, start.z));
for (let i = 1; i <= 5; i++) barista.drag({ x: from.x + ((to.x - from.x) * (i - 1)) / 5, y: from.y + ((to.y - from.y) * (i - 1)) / 5 }, { x: from.x + ((to.x - from.x) * i) / 5, y: from.y + ((to.y - from.y) * i) / 5 });
await game.step({ seconds: 1 });
assert.ok(Math.abs(palm().x - (start.x - 0.2)) < 0.06, `the hand moved with the finger: ${start.x.toFixed(2)} to ${palm().x.toFixed(2)}`);
assert.ok(Vector3.Distance(body(), stood) < 0.15, 'within reach the barista stays');

// Dragged far past reach and let go: he walks after it, and stops at the Play Area's edge.
const far = screen(new Vector3(start.x - 6, 1.12, start.z)), near = screen(new Vector3(start.x - 0.2, 1.12, start.z));
barista.drag(near, far);
await game.step({ seconds: 6 });
assert.ok(stood.x - body().x > 0.5, `past its reach the barista walks after the hand: ${stood.x.toFixed(2)} to ${body().x.toFixed(2)}`);
const area = scene.getTransformNodeByName('Play Area'), local = Vector3.TransformCoordinates(palm(), area.computeWorldMatrix(true).clone().invert());
assert.ok(Math.abs(local.x) <= 1.05 && Math.abs(local.z) <= 1.05, 'the hand stays in the Play Area');
assert.deepEqual(game.errors, []);
game.dispose();
console.log('Rock Hard Café by touch: a drag moves the hand like a trackpad, and past its reach the barista walks after it');
process.exit(0);
