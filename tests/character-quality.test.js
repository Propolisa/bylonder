// The quality tier follows the page's frame times (docs/character-animation.md Quality): one step down after 1 s with
// the median of the last 2 s of frames over budget, one up after 5 s well under it, not on a single slow frame;
// Character.quality fixes it.
import assert from 'node:assert/strict';
import { createTierPicker } from '../src/io_scene_babylon/runtime/character/quality.js';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';
import { basicBlend } from './fixtures/basic-blend.js';

const run = (pick, tier, ms, seconds) => { for (let t = 0; t < seconds * 1000; t += ms) tier = pick(tier, ms); return tier; };
{
  // The median of the last 2 s turns over budget once slow frames are the most of them (1.2 to 1.3 s of 30 ms frames after
  // steady 16 ms ones), then a second over budget steps down.
  const pick = createTierPicker();
  assert.equal(run(pick, 'A', 16, 10), 'A', 'on budget it stays');
  assert.equal(pick('A', 200), 'A', 'one slow frame does not step down');
  assert.equal(run(pick, 'A', 30, 2), 'A', 'not before a second with the median over budget');
  assert.equal(run(pick, 'A', 30, 0.4), 'B', 'then it steps down');
  assert.equal(run(pick, 'B', 30, 1.05), 'C', 'and down again after another second');
  assert.equal(run(pick, 'C', 30, 3), 'C', 'never below C');
  assert.equal(run(pick, 'C', 8, 5.3), 'C', 'not up before 5 s well under');
  assert.equal(run(pick, 'C', 8, 0.3), 'B', 'up after 5 s well under');
}
{
  const hero = new Character(basicBlend(), 'Armature', { manual: true, idle: false });
  Character.quality = 'C';
  hero.update(1 / 60);
  assert.equal(Character.tier, 'C', 'Character.quality fixes the tier');
  Character.quality = 'auto';
  Character.tier = 'A';
}
console.log('character quality: ok');
process.exit(0);
