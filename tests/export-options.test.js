// File > Export's options (src/io_scene_babylon/export-options.js): one schema fills their defaults and repairs a value
// that does not parse to its default with a warning, leaving the others as given.
import assert from 'node:assert/strict';
import { chosenState, exportOptions, TARGETS } from '../src/io_scene_babylon/export-options.js';
import { chosenRuntime } from '../src/runtimes/runtimes.js';

const warnings = [];
console.warn = (message) => warnings.push(message);

assert.deepEqual(exportOptions(), { eeveeParity: false, hostCompression: false, bakeAnimation: false, bundle: true, minify: true, controlPanel: true, navigation: 'FIXED', navigationModes: {}, devTools: 'CDN', target: 'BOTH', runtime: null, replace: [], runtimes: {}, branchState: null, branches: {} }, 'defaults');
assert.deepEqual(TARGETS.map(([id]) => id), ['BOTH', 'WEBGPU', 'WEBGL2'], "the targets' identifiers");
for (const [id] of TARGETS) assert.equal(exportOptions({ target: id }).target, id, `${id} is kept`);

const repaired = exportOptions({ eeveeParity: true, hostCompression: 'yes', minify: false, target: 'WEBGL1' });
assert.deepEqual(repaired, { eeveeParity: true, hostCompression: false, bakeAnimation: false, bundle: true, minify: false, controlPanel: true, navigation: 'FIXED', navigationModes: {}, devTools: 'CDN', target: 'BOTH', runtime: null, replace: [], runtimes: {}, branchState: null, branches: {} }, 'bad values repaired, good ones kept');
assert.equal(warnings.length, 2, 'one warning per repaired value');
assert.match(warnings.join('\n'), /target: "WEBGL1" is not valid, "BOTH" used/);

// Runtimes: unset (null) at a level inherits the one above; an instance with nothing set exports with its own (null).
// A bad value is repaired where it is, leaving its siblings.
warnings.length = 0;
const runtimes = exportOptions({ runtime: 'MAPPED', runtimes: { ARMATURE: { instances: { Rig: 'BLENDER', Other: 'LOW' } }, IMAGE: { runtime: 'NATIVE' }, BAD: 4 } });
assert.deepEqual(runtimes.runtimes.ARMATURE, { runtime: null, instances: { Rig: 'BLENDER', Other: null } });
assert.deepEqual(runtimes.runtimes.BAD, { runtime: null, instances: {} });
assert.equal(warnings.length, 2);
assert.equal(chosenRuntime(runtimes, 'ARMATURE', 'Rig'), 'BLENDER', 'set on the instance');
assert.equal(chosenRuntime(runtimes, 'ARMATURE', 'Other'), 'MAPPED', 'inherited from the package');
assert.equal(chosenRuntime(runtimes, 'IMAGE', 'Wood'), 'NATIVE', 'inherited from the feature');
assert.equal(chosenRuntime(exportOptions(), 'IMAGE', 'Wood'), null, 'nothing chosen: its own');
assert.deepEqual(exportOptions({ replace: ['modifier:SIMPLE_DEFORM', 'node:*'] }).replace, ['modifier:SIMPLE_DEFORM', 'node:*'], 'replaced units kept');
// Branches: a state set on an instance, else on its branch, else for every branch; null: the branch's default, also for a
// state the branch does not offer. A bad state is repaired to null.
warnings.length = 0;
const branched = exportOptions({ branchState: 'OFF', branches: { geometryNodes: { state: 'BAKED', instances: { City: 'LIVE', Bar: 'MAYBE' } } } });
assert.deepEqual(branched.branches.geometryNodes, { state: 'BAKED', instances: { City: 'LIVE', Bar: null } });
assert.equal(warnings.length, 1);
assert.equal(chosenState(branched, 'geometryNodes', 'City'), 'LIVE', 'set on the instance');
assert.equal(chosenState(branched, 'geometryNodes', 'Bar'), 'BAKED', 'inherited from the branch');
assert.equal(chosenState(branched, 'compositor'), 'OFF', 'inherited from every branch');
assert.equal(chosenState({ branchState: 'OFF' }, 'geometryNodes', 'City'), null, 'a state the branch does not offer: its default');
assert.equal(chosenState(exportOptions(), 'geometryNodes', 'City'), null, 'nothing chosen: its default');
console.log('export options: defaults, targets, runtimes inherited by level, replaced units, branches, and repair ok');
