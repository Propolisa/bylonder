// tags: behaviors, physics
// Rock Hard Café (examples/rock-hard-cafe), the test of the game code design: on the café's scene, headless and
// seeded, the machine brews a cup onto its tray; the barista's hand (the pointer, over the counter) goes to it, grabs it
// from above, is drawn back around the sugar jar and sets the cup down on the waiting rock. The rock shivers, spills it
// off (Havok), takes the stain on its run material while the .blend's stays clean, and leaves; the next rock comes up.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { Matrix, Vector3 } from '@babylonjs/core';

register('./fixtures/example-loader.mjs', import.meta.url);
const { run } = await import('./game-test.js');
const { default: Shift } = await import('../examples/rock-hard-cafe/src/systems/shift.js');
const { default: Subtitles } = await import('../examples/rock-hard-cafe/src/systems/subtitles.js');

const game = await run('examples/rock-hard-cafe', { seed: 1 }); // a counter, a machine, a barista, one rock
const scene = game.blend.scene, rock = game.find('Rock'), barista = game.find('Barista');
const at = (name) => scene.getNodeByName(name).getAbsolutePosition().clone();
const palm = () => scene.getMeshByName('Palm').getAbsolutePosition();
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const reachTo = async (to, seconds = 0.8) => { game.point(new Vector3(to.x, 1.08, to.z)); await game.step({ seconds }); };

await game.step({ seconds: 1 });
const cups = () => [...game.world.instances.values()].filter((i) => i.definition.name === 'Cup').map((i) => i.handlers);
assert.equal(cups().length, 1, 'the machine brews a cup onto its tray');
const cup = cups()[0], jar = at('Sugar Jar');
assert.ok(flat(cup.entity.node.getAbsolutePosition(), at('Tray Spot')) < 0.02, 'the cup stands on the tray');

// The hand goes over the cup, the barista stepping after it, and closes on it from above.
await reachTo(cup.top(), 2.5);
assert.ok(flat(palm(), cup.top()) < cup.radius, `the palm is over the cup: ${palm()} and ${cup.top()}`);
game.input.hold('Grab');
await game.step({ seconds: 0.2 });
assert.equal(barista.holding, cup, 'Grab closes the hand on the cup');
// Drawn back toward the barista and round the sugar jar, the cup keeps to the hand and the jar stays put.
for (const to of [new Vector3(0.35, 0, -0.85), new Vector3(0.05, 0, -0.6)]) await reachTo(to);
assert.ok(flat(cup.entity.node.getAbsolutePosition(), palm()) < 0.08, 'the cup goes where the hand goes');
assert.ok(Vector3.Distance(at('Sugar Jar'), jar) < 0.01, 'routed around, the sugar jar stays where it was');
const { min, max } = rock.entity.node.getHierarchyBoundingVectors(true);
// The near side of the rock's top, which the hand reaches leaning across the counter.
const middle = new Vector3((min.x + max.x) / 2, 0, (min.z + max.z) / 2), toward = barista.entity.node.getAbsolutePosition().subtract(middle);
toward.y = 0;
await reachTo(middle.add(toward.normalize().scale(0.2)), 2);
game.input.hold('Grab', false);
await game.step({ seconds: 0.5 });
assert.equal(barista.holding, null, 'letting go of Grab opens the hand');
assert.ok(cup.served && rock.state.mood === 'admiring', `set down on the rock, the cup is served: ${rock.state.mood}`);
assert.match(game.get(Subtitles).line ?? '', /^[*].+[*]$/, "the rock's noise is subtitled from the Ink story");
assert.ok(game.played.includes('Served') && ['Wood Clack', 'Plank Clack', 'Clack'].some((n) => game.played.includes(n)), `the rock is delighted, with a clack of its own: ${game.played}`);
await game.step({ seconds: 3 });
assert.deepEqual(game.get(Shift).save(), { served: 1, walkouts: 0 });
assert.ok(cup.entity.node.getAbsolutePosition().y < 0.5, 'the rock spilled the cup off its top, onto the ground');
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
assert.ok(near(rock.material().baseColor, rock.props.stain), 'the rock wears the stain in the run');
assert.ok(!near(rock.authored.material().baseColor, rock.props.stain), 'the .blend keeps a clean rock');
// One customer at a time: the served rock rolls back out of sight, and the next comes up the path to the stand.
const atStand = () => [...game.world.instances.values()].filter((i) => i.definition.name === 'Rock' && ['arriving', 'waiting', 'admiring'].includes(i.state.mood));
for (let t = 0; t < 14; t++) {
  await game.step({ seconds: 1 });
  assert.ok(atStand().length <= 1, `one rock at the stand at a time: ${atStand().map((i) => i.entity.name)}`);
}
assert.equal(rock.state.mood, 'gone', 'the served rock rolled out of sight');
assert.ok(atStand().some((i) => i.state.mood === 'waiting' && i.entity.name !== 'Rock'), 'the next rock waits at the stand');
// WASD walks the barista as the game camera shows it: D toward the screen's right, S down it, W back up.
const onScreen = () => {
  const engine = scene.getEngine(), camera = scene.activeCamera;
  return Vector3.Project(barista.entity.node.getAbsolutePosition(), Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
};
const walk = async (key, seconds = 0.6) => { const from = onScreen(); game.input.key(key); await game.step({ seconds }); game.input.key(key, false); await game.step({ seconds: 0.3 }); return onScreen().subtract(from); };
const right = await walk('KeyD'), down = await walk('KeyS'), up = await walk('KeyW');
assert.ok(right.x > 20 && Math.abs(right.y) < right.x / 2, `D walks toward the screen's right: ${right}`);
assert.ok(down.y > 20 && up.y < -20, `S walks down the screen and W up it: ${down}, ${up}`);
assert.deepEqual(game.errors, []);
game.dispose();
console.log('Rock Hard Café: the hand grabs a brewed cup, is routed round a jar and sets it on the rock, which spills it and leaves stained; the .blend stays clean');
process.exit(0);
