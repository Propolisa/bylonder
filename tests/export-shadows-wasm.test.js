// A JavaScript export made in Node (the docs demos, the parity matrix) casts shadows as the app's rendered view does:
// the world open-example.js opens has the app's light shadows (runtime/world.js), whose generators the export writes.
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

const { world, sync } = openExample('rigged-character');
sync.view();
const scene = (await exportModule(world))['scene.js'];
const constant = (name) => JSON.parse(new RegExp(`const ${name} = (.*);`).exec(scene)?.[1] ?? '[]');
const key = constant('LIGHTS').find((l) => l.name === 'Key');
const generator = constant('SHADOW_GENERATORS').find((g) => g.lightId === key.id);
assert.ok(generator, 'the Key light, which casts shadows, has a shadow generator');
assert.ok(generator.renderList.length > 0, 'with the casters');
assert.match(scene, /\.receiveShadows = true;/, 'and meshes that receive its shadow');
console.log('Export shadows: a package exported in Node carries its lights\' shadow generators, casters and receivers');
