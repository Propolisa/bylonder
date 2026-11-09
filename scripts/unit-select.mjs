// The unit tests a change needs (node scripts/gates.mjs): changed tests, those whose imports reach a changed file and
// those whose source names it (fixtures, examples); null for all. A change to licensing or to code derived from
// Blender's adds the license check, which reaches no file by import.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { reachable } from './import-graph.mjs';

// Changes every unit test may depend on without importing them: the module, the test runner, the app's packages.
const ALL_UNITS = /^(tools\/blender-port\/|src\/bmesh\/.*\.(wasm|zip)$|scripts\/run-tests\.mjs$|package(-lock)?\.json$)/;
const LICENSES = 'tests/licenses.test.js';
const LICENSING = /^(REUSE\.toml$|LICENSES\/|LICENSE)/;
const blenderDerived = (file) => existsSync(file) && /blender-port:/.test(readFileSync(file, 'utf8'));

export function selectUnits(files) {
  if (files.some((f) => ALL_UNITS.test(f))) return null;
  const changed = new Set(files);
  const named = files.map((f) => f.replace(/^(examples|tests\/fixtures)\/([^/]+).*/, '$1/$2'));
  const reached = readdirSync('tests').filter((f) => f.endsWith('.test.js')).map((f) => `tests/${f}`).filter((test) =>
    changed.has(test) || named.some((n) => readFileSync(test, 'utf8').includes(n))
    || [...reachable([test])].some((m) => changed.has(m.replaceAll('\\', '/'))));
  const licensing = files.some((f) => LICENSING.test(f) || blenderDerived(f));
  return licensing && !reached.includes(LICENSES) ? [...reached, LICENSES] : reached;
}
