// The gates' unit test selection (scripts/unit-select.mjs): what a change reaches, and the license check for any change
// to licensing or to code derived from Blender's.
import assert from 'node:assert/strict';
import { selectUnits } from '../scripts/unit-select.mjs';

const LICENSES = 'tests/licenses.test.js';
assert.equal(selectUnits(['tools/blender-port/wasm/outliner-api.cc']), null, "Blender's module: every test");
for (const file of ['REUSE.toml', 'LICENSES/GPL-3.0-or-later.txt', 'src/draw/workbench.js'])
  assert.ok(selectUnits([file]).includes(LICENSES), `${file}: the license check`);
assert.ok(!selectUnits(['docs/webgpu.md']).includes(LICENSES), 'a doc: no license check');
console.log('Unit selection: a change reaches its tests, and licensing or Blender-derived code adds the license check');
