// File > Export's options (src/io_scene_babylon/export-options.js): one schema fills their defaults and repairs a value
// that does not parse to its default with a warning, leaving the others as given.
import assert from 'node:assert/strict';
import { chosenState, exportOptions, TARGETS } from '../src/io_scene_babylon/export-options.js';
import { chosenRuntime } from '../src/runtimes/runtimes.js';
import { exportSampling } from '../src/io_scene_babylon/sampling.js';

const warnings = [];
console.warn = (message) => warnings.push(message);

assert.deepEqual(exportOptions(), { scope: 'SCENE', eeveeParity: false, hostCompression: false, bakeAnimation: false, sampleRate: { rate: null, instances: {} }, bundle: true, minify: true, controlPanel: true, navigation: 'FIXED', navigationModes: {}, devTools: 'CDN', target: 'BOTH', runtime: null, replace: [], runtimes: {}, branchState: null, branches: {} }, 'defaults');
assert.deepEqual(TARGETS.map(([id]) => id), ['BOTH', 'WEBGPU', 'WEBGL2'], "the targets' identifiers");
for (const [id] of TARGETS) assert.equal(exportOptions({ target: id }).target, id, `${id} is kept`);

const repaired = exportOptions({ eeveeParity: true, hostCompression: 'yes', minify: false, target: 'WEBGL1' });
assert.deepEqual(repaired, { scope: 'SCENE', eeveeParity: true, hostCompression: false, bakeAnimation: false, sampleRate: { rate: null, instances: {} }, bundle: true, minify: false, controlPanel: true, navigation: 'FIXED', navigationModes: {}, devTools: 'CDN', target: 'BOTH', runtime: null, replace: [], runtimes: {}, branchState: null, branches: {} }, 'bad values repaired, good ones kept');
assert.equal(warnings.length, 2, 'one warning per repaired value');
assert.match(warnings.join('\n'), /target: "WEBGL1" is not valid, "BOTH" used/);
assert.equal(exportOptions({ scope: 'SELECTED' }).bundle, false, "Selected Objects default to modules, loading with the page's own Babylon.js");
assert.equal(exportOptions({ scope: 'SELECTED', bundle: true }).bundle, true, 'unless bundled on purpose');

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
// Sample rate: a rate for every object, else the scene's frame rate; one set on an object wins. A rate that is not a
// positive number is repaired to null. Keys lie on Blender's frame grid from the range's start, its end keyed too.
warnings.length = 0;
const rates = exportOptions({ sampleRate: { rate: 12, instances: { Lamp: 48, Box: 0 } } }).sampleRate;
assert.deepEqual(rates, { rate: 12, instances: { Lamp: 48, Box: null } });
assert.equal(warnings.length, 1);
const sampling = exportSampling({ frameStart: 1, frameEnd: 10, fps: 24 }, rates);
assert.deepEqual(sampling.frames.filter(sampling.keeps('Box')), [1, 3, 5, 7, 9, 10], 'every second frame, then the last');
assert.equal(sampling.frames.filter(sampling.keeps('Lamp')).length, 19, 'two keys per frame');
assert.ok(sampling.frames.every((f, i) => !i || f > sampling.frames[i - 1]) && [1, 2, 9.5, 10].every((f) => sampling.frames.includes(f)), 'Main evaluated at each whole frame and each grid frame');
assert.deepEqual(sampling.rates(), { Box: 12, Lamp: 48 }, 'the rates of the objects keyed');
assert.deepEqual(exportSampling({ frameStart: 1, frameEnd: 4, fps: 24 }).frames, [1, 2, 3, 4], 'unset: a key per frame');
console.log('export options: defaults, targets, runtimes inherited by level, replaced units, branches, sample rates, and repair ok');
