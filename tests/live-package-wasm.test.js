// The live package (the Package View's and play mode's, package-preview.js) is what File > Export > JavaScript ships:
// after each of a sequence of edits, undo and redo, its tables equal a whole export's, made by the same code.
import assert from 'node:assert/strict';
import { blendData } from '../src/python/bpy_rna.js';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { packageState } from '../src/io_scene_babylon/scene-patch.js';
import { createPackagePreview } from '../src/editors/space_package/package-preview.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rigged-character');
world.mainSync = sync;
sync.view();
const preview = createPackagePreview({ world, idle: (run) => run(), publish: async () => 'memory', post: () => {} });
await preview.reload();
const whole = async () => packageState(await exportPackage(world)).version;
const step = async (what, edit) => {
  edit();
  sync.view();
  preview.changed();
  await preview.settled();
  assert.equal(preview.state.version, await whole(), `${what}: the live package is a whole export's`);
};

sync.undoInit();
const steps = [sync.undoPush('Start')];
const objects = blendData().objects;
const edit = (name, change) => () => { change(); steps.push(sync.undoPush(name)); };
await step('a moved light', edit('Move', () => { objects.get('Key').location[0] += 0.5; }));
await step("a light's energy", edit('Energy', () => { objects.get('Key').data.energy *= 2; }));
const ik = [...objects.get('Rig').pose.bones].flatMap((bone) => [...bone.constraints]).find((c) => c.type === 'IK');
await step("a constraint's influence", edit('Influence', () => { ik.influence = 0.25; }));
await step('undo', () => sync.undoLoad(steps[2]));
await step('undo again', () => sync.undoLoad(steps[1]));
await step('redo', () => sync.undoLoad(steps[2]));
console.log('Live package: after each edit, undo and redo, the same tables as a whole export');
process.exit(0);
