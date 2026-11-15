// tags: behaviors
// Rock Hard Café (examples/rock-hard-cafe), the test of the game code design: on the café's scene, headless and
// seeded, the barista pours a coffee and serves the waiting rock, which admires it, spills it on itself and leaves; the
// shift counts it, the rock's run material takes the stain, and the .blend's material stays clean.
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./fixtures/example-loader.mjs', import.meta.url);
const { run } = await import('./game-test.js');
const { default: Shift } = await import('../examples/rock-hard-cafe/src/systems/shift.js');

const game = await run('examples/rock-hard-cafe', { seed: 1 }); // a counter, a machine, a barista, one rock
const rock = game.find('Rock'), barista = game.find('Barista');
await barista.walkTo(game.find('Machine')).press('Use');
await game.step({ seconds: 1 });
assert.ok(barista.holding, 'the machine pours a cup into the barista\'s hands');
await barista.walkTo(rock).press('Use');
await game.step({ seconds: 3 });
assert.deepEqual(game.get(Shift).save(), { served: 1, walkouts: 0 });
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
assert.ok(near(rock.material().baseColor, rock.props.stain), 'the rock wears the stain in the run');
assert.ok(!near(rock.authored.material().baseColor, rock.props.stain), 'the .blend keeps a clean rock');
assert.deepEqual(game.errors, []);
game.dispose();
console.log('Rock Hard Café: a served rock admires, spills on itself and leaves; the .blend stays clean');
process.exit(0);
