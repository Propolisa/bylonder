// A character in an exported package loaded the way a page loads it: a process that imports only the package (its
// scene.js re-exports the character API) and Babylon's NullEngine module, nothing else of Babylon's, so a module the
// runtime uses without importing it fails here as it would on a page. The Basic Character walks forward and stops.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world } = openExample('basic-character');
const written = writePackage(await exportModule(world, { animations: 'CLIPS' }));
const page = `
  import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
  import { load, Character } from ${JSON.stringify(written.url)};
  const blend = await load(new NullEngine());
  await blend.settled?.();
  const hero = new Character(blend, 'Armature', { manual: true });
  hero.body.play(hero.locomotion, { blend: 0 });
  const move = hero.movement.facing.scale(1.2);
  hero.input = () => ({ move });
  const from = hero.movement.position.clone();
  for (let k = 0; k < 120; k++) hero.update(1 / 60);
  hero.input = null;
  for (let k = 0; k < 120; k++) hero.update(1 / 60);
  console.log(JSON.stringify({ moved: hero.movement.position.subtract(from).length(), speed: hero.movement.velocity.length(), grounded: hero.movement.grounded }));
  process.exit(0);
`;
const output = execFileSync(process.execPath, ['--input-type=module', '-e', page], { encoding: 'utf8' });
const { moved, speed, grounded } = JSON.parse(output.trim().split('\n').at(-1));
assert.ok(moved > 1.5 && moved < 3.5, `walked forward on the package alone: ${moved.toFixed(2)} m`);
assert.ok(speed < 0.01 && grounded, `stopped on the ground: ${speed}`);
written.remove();
console.log(`a package alone: the Basic Character walks ${moved.toFixed(2)} m and stops`);
process.exit(0);
