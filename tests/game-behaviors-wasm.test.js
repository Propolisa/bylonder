// tags: behaviors
// Behaviours from Blender data to the Game area's run: added to an object as its `behaviors` custom property group
// (blenkernel/behaviors.js, Blender's IDP_* through main-api.cc), exported in the IR and as live controls, read by the
// run's host (runtime/game/blend-host.js), edited in Blender and seen by the run on the next frame with no export, run
// without writing into Main, and kept by a .blend's round trip. On the Default Cube.
import assert from 'node:assert/strict';
import * as core from '@babylonjs/core';
import { blendData } from '../src/python/bpy_rna.js';
import { createPackagePreview } from '../src/editors/space_package/package-preview.js';
import { createGameRun } from '../src/editors/space_game/game-run.js';
import { addBehavior, behaviorNames, removeBehavior, setBehaviorProp } from '../src/blenkernel/behaviors.js';
import { defineBehavior, float, color, enumOf, enumValue, collection } from '../src/io_scene_babylon/runtime/game/define.js';
import { createWorld } from '../src/io_scene_babylon/runtime/game/world.js';
import { blendHost } from '../src/io_scene_babylon/runtime/game/blend-host.js';
import '../src/draw/draw-view.js';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

const appModule = async (source) => (source === '@babylonjs/core' ? core : import(new URL(`../src/${source}`, import.meta.url).href));
const { world, sync } = openExample('lava');
world.mainSync = sync;
const ob = blendData().objects.get('Sphere');
const Spin = defineBehavior({
  name: 'Spin',
  props: { speed: float(2, { min: 0, unit: 's' }), tint: color([0.2, 0.4, 0.8]), mode: enumOf(['steady', 'wobble']), home: collection([...blendData().collections][0]?.name ?? '') },
  create({ entity, props, state }) {
    state.turned ??= 0;
    return {
      update(dt) { state.turned += props.speed * dt; },
      paint() { entity.material().set('baseColor', props.tint); },
    };
  },
});

// Added in Blender: one group per behaviour, its props' defaults, an ID pointer for the collection.
assert.ok(addBehavior(ob, Spin));
assert.ok(!addBehavior(ob, Spin), 'once per object');
sync.view();
assert.deepEqual(behaviorNames(ob), ['Spin']);
const group = ob.get('behaviors').get('Spin');
assert.equal(group.get('speed'), 2);
assert.deepEqual([...group.get('tint')].map((v) => +v.toFixed(3)), [0.2, 0.4, 0.8]);
assert.equal(group.get('mode'), enumValue('steady'), 'an enum by its item value');
const home = [...blendData().collections][0];
if (home) assert.equal(group.get('home').name, home.name, 'an ID pointer');

// Exported and played.
const game = createGameRun({ appModule, exportAgain: () => preview.reload(), engine: () => new core.NullEngine() });
let written, exports = 0, posted = Promise.resolve();
const preview = createPackagePreview({ world, idle: (run) => run(), report: () => {},
  set: (changes) => game.set(changes),
  post: (patch, reload) => { posted = reload ? game.reset(preview.state) : game.patch(patch, preview.state); },
  publish: async (made, tables) => { exports++; written = writePackage(made.files); await game.play(made, tables, new URL('./', written.url).href); return written.url; } });
await preview.reload();
const host = blendHost(game.blend);
assert.deepEqual(host.objects().map(({ name, behaviors }) => [name, behaviors]), [['Sphere', ['Spin']]]);
assert.equal(host.value('OB:Sphere', 'Spin', 'speed'), 2);
if (home) assert.equal(host.value('OB:Sphere', 'Spin', 'home'), home.name, 'an ID pointer by its name');
const run = createWorld({ host, behaviors: [Spin] });
run.start();
const spin = run.instances.get('OB:Sphere/Spin').handlers;
assert.equal(spin.props.mode, 'steady', 'an enum prop by its option name');
await run.step(0.5);
assert.equal(spin.state.turned, 1);

// Edited in Blender: the run reads the new value on the next frame, with no export.
const exported = exports;
setBehaviorProp(ob, 'Spin', 'speed', Spin.props.speed, 6);
sync.view();
assert.equal(spin.props.speed, 6, 'a prop edit reaches the run at once');
assert.equal(exports, exported, 'with no export');
await run.step(0.5);
assert.equal(spin.state.turned, 4);

// Game code writes the run's copy only: Main's material keeps its colour.
const material = ob.material_slots[0].material, before = [...material.diffuse_color];
run.game.emit(spin, 'paint');
assert.deepEqual([...material.diffuse_color], before, 'Main untouched');
assert.notEqual(game.blend.nodeOf('OB:Sphere').material.name, material.name, 'the run painted its own copy');

// A .blend keeps them: written and read back.
const blend = world.mainSync.projectBlend();
assert.ok(blend.length > 0);
removeBehavior(ob, 'Spin');
assert.deepEqual(behaviorNames(ob), []);
sync.blender.readBlend(blend);
assert.deepEqual(behaviorNames(blendData().objects.get('Sphere')), ['Spin'], 'a .blend round trip keeps the behaviours');

await posted;
run.dispose();
game.dispose();
written.remove();
console.log('Behaviours: added as Blender data, exported, edited live on the next frame, run on copies, kept by the .blend');
process.exit(0);
