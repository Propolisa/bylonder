// File > Export's options (src/io_scene_babylon/export-options.js): one schema fills their defaults and repairs a value
// that does not parse to its default with a warning, leaving the others as given.
import assert from 'node:assert/strict';
import { exportOptions, TARGETS } from '../src/io_scene_babylon/export-options.js';

const warnings = [];
console.warn = (message) => warnings.push(message);

assert.deepEqual(exportOptions(), { eeveeParity: false, hostCompression: false, bakeAnimation: false, target: 'BOTH' }, 'defaults');
assert.deepEqual(TARGETS.map(([id]) => id), ['BOTH', 'WEBGPU', 'WEBGL2'], "the targets' identifiers");
for (const [id] of TARGETS) assert.equal(exportOptions({ target: id }).target, id, `${id} is kept`);

const repaired = exportOptions({ eeveeParity: true, hostCompression: 'yes', target: 'WEBGL1' });
assert.deepEqual(repaired, { eeveeParity: true, hostCompression: false, bakeAnimation: false, target: 'BOTH' }, 'bad values repaired, good ones kept');
assert.equal(warnings.length, 2, 'one warning per repaired value');
assert.match(warnings.join('\n'), /target: "WEBGL1" is not valid, "BOTH" used/);
console.log('export options: defaults, targets and repair ok');
