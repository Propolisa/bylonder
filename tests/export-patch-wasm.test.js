// A patch between two exports (scene-patch.js, docs/data-flow.md): the same scene exported again patches nothing; a moved
// light patches its own entries alone (its node, its ID's data and its location's control); undoing the move patches
// back to the first version; the full export is the patch from the empty package.
import assert from 'node:assert/strict';
import { blendData } from '../src/python/bpy_rna.js';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { packageState, tablesPatch } from '../src/io_scene_babylon/scene-patch.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rigged-character');
sync.view();
const exported = async () => packageState(await exportPackage(world));
const changed = (patch) => Object.entries(patch.tables).flatMap(([table, entries]) => Object.keys(entries).map((key) => `${table} ${key}`)).sort();

const first = await exported(), again = await exported();
assert.equal(again.version, first.version, 'the same scene exports the same version');
assert.deepEqual(changed(tablesPatch(first, again)), [], 'and patches nothing');

const full = tablesPatch(packageState(), first);
assert.equal(full.version, first.version);
assert.deepEqual(Object.keys(full.tables).sort(), Object.keys(first.tables).filter((t) => Object.keys(first.tables[t]).length).sort(), 'the full export is the patch from the empty package');

sync.undoInit();
const before = sync.undoPush('Before');
blendData().objects.get('Key').location[0] += 0.5;
sync.undoPush('Move');
const moved = await exported(), patch = tablesPatch(first, moved);
assert.deepEqual(changed(patch), ['ids OB:Key', 'nodes OB:Key/rig', 'properties objects["Key"].location[0]'], 'only the moved light and its rig');
assert.equal(patch.base, first.version);
assert.deepEqual(Object.keys(patch.buffers), [], 'no new buffers for a moved object');

sync.undoLoad(before);
const undone = await exported();
assert.equal(undone.version, first.version, 'undo exports the first version again');
assert.deepEqual(Object.keys(tablesPatch(moved, undone).tables).sort(), Object.keys(patch.tables).sort(), 'and patches the same entries back');
process.exit(0);
