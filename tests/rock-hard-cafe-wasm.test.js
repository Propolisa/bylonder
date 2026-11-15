// tags: behaviors
// Rock Hard Café (examples/rock-hard-cafe), the test of the game code design: on the café's scene, headless and
// seeded, the barista pours a coffee and serves the waiting rock, which admires it, spills it on itself and leaves; the
// shift counts it, the rock's run material takes the stain, and the .blend's material stays clean.
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./fixtures/example-loader.mjs', import.meta.url);
const { run } = await import('./game-test.js');
const { default: Shift } = await import('../examples/rock-hard-cafe/src/systems/shift.js');
const { default: Subtitles } = await import('../examples/rock-hard-cafe/src/systems/subtitles.js');

const game = await run('examples/rock-hard-cafe', { seed: 1 }); // a counter, a machine, a barista, one rock
const rock = game.find('Rock'), barista = game.find('Barista');
await barista.walkTo(game.find('Machine')).press('Use');
await game.step({ seconds: 1 });
assert.ok(barista.holding, 'the machine pours a cup into the barista\'s hands');
assert.ok(barista.holding.node.isVisible, 'the cup shows, though its prefab collection is excluded');
await barista.walkTo(rock).press('Use');
await game.step({ seconds: 1 });
assert.match(game.get(Subtitles).line ?? '', /^[*].+[*]$/, "the rock's noise is subtitled from the Ink story");
assert.deepEqual(game.played.filter((name) => name !== 'Steam').length, 1, `the rock makes one of its noises: ${game.played}`);
assert.ok(['Grind', 'Rumble', 'Clack'].includes(game.played.at(-1)) && game.played[0] === 'Steam', `the machine hissed, then the rock: ${game.played}`);
await game.step({ seconds: 2 });
assert.ok(!barista.holding, 'serving does not pour another cup');
assert.deepEqual(game.get(Shift).save(), { served: 1, walkouts: 0 });
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
assert.ok(near(rock.material().baseColor, rock.props.stain), 'the rock wears the stain in the run');
assert.ok(!near(rock.authored.material().baseColor, rock.props.stain), 'the .blend keeps a clean rock');
// One customer at a time: the served rock rolls back out of sight, and the next comes up the path to the stand.
const atStand = () => game.world.instances && [...game.world.instances.values()].filter((i) => i.definition.name === 'Rock' && ['arriving', 'waiting', 'admiring'].includes(i.state.mood));
for (let t = 0; t < 14; t++) {
  await game.step({ seconds: 1 });
  assert.ok(atStand().length <= 1, `one rock at the stand at a time: ${atStand().map((i) => i.entity.name)}`);
}
assert.equal(rock.state.mood, 'gone', 'the served rock rolled out of sight');
assert.ok(atStand().some((i) => i.state.mood === 'waiting' && i.entity.name !== 'Rock'), 'the next rock waits at the stand');
assert.deepEqual(game.errors, []);
game.dispose();
console.log('Rock Hard Café: a served rock admires with a subtitled noise, spills on itself and leaves; the .blend stays clean');
process.exit(0);
