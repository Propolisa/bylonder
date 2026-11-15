// tags: behaviors, physics
// Rock Hard Café (examples/rock-hard-cafe), the test of the game code design: on the café's scene, headless and
// seeded, the barista's hand (the pointer, over the counter) slaps the machine's button, which brews a mug onto its
// tray; the hand grabs it from above, is drawn back around the sugar jar and sets it down on the waiting rock. The rock
// shivers, spills it off (Havok), and the mug breaks on the ground into its pieces; the rock takes the stain on its run
// material while the .blend's stays clean, and leaves; the next rock comes up. A swipe knocks a jar off the counter:
// that rock gets angry and in the end leaves angry. WASD walks the barista as the camera shows it, and every body the
// hand can hit sounds as it is hit.
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
const reachTo = async (to, seconds = 0.8) => { game.point(new Vector3(to.x, 1.12, to.z)); await game.step({ seconds }); };

const machine = game.find('Machine'), button = at('Machine Button');
await game.step({ seconds: 1 });
const cups = () => [...game.world.instances.values()].filter((i) => i.definition.name === 'Cup').map((i) => i.handlers);
assert.equal(cups().length, 0, 'the machine waits to be asked');
assert.equal(machine.doing, 'idle', 'its button glows ready');
// A slap on the button: the hand swung in from the button's side onto its face.
await reachTo(button.add(new Vector3(0.25, 0, 0)), 4);
await reachTo(button.add(new Vector3(-0.05, 0, 0)), 0.4);
assert.equal(machine.doing, 'grinding', 'a slap on the button starts a brew');
await reachTo(new Vector3(0.3, 0, -0.85), 0.5);
await game.step({ seconds: 9 });
assert.equal(machine.doing, 'done', 'it grinds, pours, steams and rings, done');
assert.equal(cups().length, 1, 'the machine brews a mug onto its tray');
const cup = cups()[0], jar = at('Sugar Jar');
assert.ok(flat(cup.entity.node.getAbsolutePosition(), at('Tray Spot')) < 0.02, 'the cup stands on the tray');

// The hand goes over the cup, the barista stepping after it, and closes on it from above.
await reachTo(cup.top(), 2.5);
assert.ok(flat(palm(), cup.top()) < cup.radius, `the palm is over the cup: ${palm()} and ${cup.top()}`);
game.input.hold('Grab');
await game.step({ seconds: 0.2 });
assert.equal(barista.holding, cup, 'Grab closes the hand on the cup');
// Drawn back toward the barista and round the sugar jar, the cup keeps to the hand and the jar stays put.
for (const to of [new Vector3(0.4, 0, -0.98), new Vector3(-0.05, 0, -0.85)]) await reachTo(to);
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
assert.ok(game.played.includes('Served') && game.played.some((n) => n.startsWith('Voice ')), `the rock is delighted, in a voice of its own: ${game.played}`);
await game.step({ seconds: 3 });
assert.deepEqual(game.get(Shift).save(), { served: 1, walkouts: 0, angry: 0 });
const shards = () => [...game.world.instances.values()].filter((i) => i.definition.name === 'Impact' && i.entity.name.includes('Mug Shard'));
assert.ok(!cup.entity.visible && shards().length === 12, `the rock spilled the mug off its top, and it broke on the ground into its pieces: ${shards().length}`);
assert.ok(shards().every((i) => i.entity.node.getAbsolutePosition().y < 0.5), 'the pieces lie on the ground');
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
// A straight swipe through the biscotti jar knocks it off the counter: the waiting rock is angered (an angry line, a
// red tint, its patience cut), and in the end leaves angry.
const next = atStand().find((i) => i.state.mood === 'waiting'), biscotti = at('Biscotti Jar');
await walk('KeyA', 0.5);
await reachTo(biscotti.add(new Vector3(0.3, 0, -0.25)), 1.5);
await reachTo(biscotti.add(new Vector3(0, 0, -0.22)), 1);
await reachTo(biscotti.add(new Vector3(0, 0, 0.7)), 1.5);
assert.ok(at('Biscotti Jar').y < 0.8, `the swipe knocked the jar off the counter: ${at('Biscotti Jar')}`);
assert.ok(next.state.angry && next.state.waited >= next.handlers.props.patience * 0.4, 'the waiting rock is angry, its patience cut by 40%');
assert.ok(near(next.entity.material().baseColor, next.handlers.props.rage), 'it turns red');
assert.ok(game.played.includes('Angry'), `it says so, angrily: ${game.played}`);
await game.step({ seconds: next.handlers.props.patience });
assert.deepEqual(game.get(Shift).save(), { served: 1, walkouts: 1, angry: 1 }, 'it leaves angry');
// Everything the hand can hit sounds as it is hit: every body but the palm has an Impact, with a material.
const sounding = new Set([...game.world.instances.values()].filter((i) => i.definition.name === 'Impact').map((i) => i.entity.node));
const silent = scene.getPhysicsEngine().getBodies().map((b) => b.transformNode).filter((n) => n.name !== 'Palm' && !sounding.has(n)).map((n) => n.name);
assert.deepEqual(silent, [], 'no hittable body without a sound');
assert.deepEqual(game.errors, []);
game.dispose();
console.log('Rock Hard Café: a slap brews a mug, the hand routes it round a jar onto the rock, which spills it (it breaks) and leaves stained; a knocked-off jar angers the next; the .blend stays clean');
process.exit(0);
