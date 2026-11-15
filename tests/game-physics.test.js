// tags: behaviors, physics
// A game's physics (defineGame's `physics: 'havok'`, runtime/game/physics.js) on the café's counter and cup, built
// small here: Havok steps in fixed steps of the run's clock, so the same seconds give the same bodies whatever the frame
// rate; physics steps before the behaviours' update; the bodies game code makes go with its behaviour on a hot swap,
// and a run made again after Reset (twice) simulates as the first did.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, MeshBuilder, FreeCamera, Vector3, PhysicsAggregate, PhysicsShapeType } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { defineBehavior, defineGame } from '../src/io_scene_babylon/runtime/game/define.js';
import { createWorld } from '../src/io_scene_babylon/runtime/game/world.js';
import { PHYSICS_STEP } from '../src/io_scene_babylon/runtime/game/physics.js';

const havok = await HavokPhysics({ wasmBinary: readFileSync(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url)) });
const engine = new NullEngine();
const scene = new Scene(engine);
new FreeCamera('Camera', new Vector3(0, 2, -4), scene);
const counter = MeshBuilder.CreateBox('Counter', { width: 3.2, height: 1, depth: 0.7 }, scene);
const cup = MeshBuilder.CreateCylinder('Cup', { diameter: 0.2, height: 0.14 }, scene);
const placed = () => { counter.position.set(0, 0.5, 0); cup.position.set(0, 1.4, 0); cup.rotationQuaternion = null; cup.rotation.setAll(0); };
const host = {
  scene,
  objects: () => [{ key: 'OB:Counter', name: 'Counter', node: counter, behaviors: ['Body'] }, { key: 'OB:Cup', name: 'Cup', node: cup, behaviors: ['Body', 'Push'] }],
  value: () => undefined,
};
const seen = [];
const Body = defineBehavior({
  name: 'Body',
  create({ entity, babylon }) {
    const cylinder = entity.name === 'Cup';
    new PhysicsAggregate(entity.node, cylinder ? PhysicsShapeType.CYLINDER : PhysicsShapeType.BOX, { mass: cylinder ? 0.25 : 0 }, babylon.scene);
    return {};
  },
});
// A side push at 1.5 s, and what update reads of the cup each frame: this frame's body, stepped before it.
const Push = defineBehavior({
  name: 'Push',
  create({ entity, time }) {
    let pushed = false;
    return {
      update() {
        seen.push(entity.node.position.y);
        if (!pushed && time.now >= 1.5 - 1e-6) { pushed = true; entity.node.physicsBody.applyImpulse(new Vector3(0.08, 0, 0), entity.node.getAbsolutePosition().add(new Vector3(0, -0.05, 0))); }
      },
    };
  },
});
const game = defineGame({ physics: 'havok' });

/** A run from the authored places for `seconds`, in frames of `frames` seconds (cycled), giving where the cup ends. */
async function play(frames, seconds = 3) {
  placed();
  const world = createWorld({ host, behaviors: [Body, Push], game, havok });
  world.start();
  for (let t = 0, i = 0; t < seconds - 1e-9; i++) { const dt = frames[i % frames.length]; t += dt; await world.step(dt); }
  const at = cup.position.clone();
  return { world, at };
}

const first = await play([PHYSICS_STEP]);
assert.ok(Math.abs(seen[80] - 1.07) < 0.01, `the cup settles on the counter's top: ${seen[80]}`);
assert.ok(Math.abs(first.at.y - (1 + 0.07)) < 0.01, `and stands after the push: ${first.at.y}`);
assert.ok(first.at.x > 0.05, `a side impulse pushes it along the counter: ${first.at.x}`);
assert.ok(seen[0] < 1.4, 'update reads the body after this frame\'s physics step');
assert.equal(scene.getPhysicsEngine().getBodies().length, 2);

// Hot swap: the bodies made again with the behaviours, not added to.
first.world.swap([Body, Push], game);
assert.equal(scene.getPhysicsEngine().getBodies().length, 2, 'a hot swap disposes the bodies its behaviours made');
first.world.dispose();
assert.equal(scene.getPhysicsEngine(), null, 'the run takes Havok with it');

// Reset, twice, at other frame rates (frames that meet the push at 1.5 s): the run made again simulates as the first.
for (const frames of [[1 / 30], [1 / 120, 1 / 40]]) {
  const again = await play(frames);
  assert.ok(Vector3.Distance(again.at, first.at) < 1e-4, `after Reset at ${frames.map((f) => Math.round(1 / f))} fps the cup ends where it did: ${again.at} vs ${first.at}`);
  again.world.dispose();
}
console.log('game physics: Havok in fixed steps of the run\'s clock, its bodies gone with their behaviours, the same after Reset at other frame rates');
process.exit(0);
