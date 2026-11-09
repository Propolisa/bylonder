// Live Modifiers keep a stack applied when one of its modifiers reads another ID: the Arrays example's stair and
// handrail are offset by the Turn empty, which the page's modifier module, given the mesh alone, does not have.
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

const { world, sync } = openExample('arrays');
sync.view();
const files = await exportModule(world, { live: true });
const controls = JSON.parse(/const CONTROLS = (.*);/.exec(files['scene.js'])[1]);
assert.deepEqual(controls.filter((c) => /^objects\["(Step|Handrail)"\]\.modifiers/.test(c.path)), [], "the stair's modifiers are applied, not controls");
console.log('Live modifiers: a stack offset by another object stays applied');
process.exit(0);
