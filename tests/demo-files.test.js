// The live demos of exported pages (docs/demos/, tools/docs/export-demo.mjs) hold no empty file: one written where the
// checkout had not fetched Babylon's assets (scripts/babylon-assets.mjs) left the area lights' LTC table empty, and
// the demo's area lights unlit.
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMOS = fileURLToPath(new URL('../docs/demos/', import.meta.url));
const sizes = readdirSync(DEMOS, { recursive: true }).map((path) => [path.split(/[\\/]/).join('/'), statSync(join(DEMOS, path))])
  .filter(([, stat]) => stat.isFile()).map(([path, stat]) => [path, stat.size]);
assert.ok(sizes.some(([path]) => path.endsWith('babylon-assets/areaLights/areaLightsLTC.bin')), 'a demo ships the LTC table');
assert.deepEqual(sizes.filter(([, size]) => size === 0).map(([path]) => path), [], 'no demo file is empty');
console.log(`Demos: ${sizes.length} files, none empty`);
