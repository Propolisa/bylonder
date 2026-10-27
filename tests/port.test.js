import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// The generated ports load with their shims, and the overlap with Blender that status.json states holds: nothing is
// missing, and a shim whose parameters differ from Blender's says why with a port-override comment.
const status = JSON.parse(await readFile('tools/blender-port/status.json', 'utf8'));
const generated = (await readdir('src', { recursive: true })).filter((f) => f.endsWith('.gen.js'));
for (const file of generated) {
  for (const path of [file, file.replace(/\.gen\.js$/, '.js')]) {
    await import(new URL(`../src/${path}`, import.meta.url)).catch((error) => assert.fail(`${path}: ${error.message}`));
  }
}
for (const [module, { missing, shimmed }] of Object.entries(status)) {
  assert.deepEqual(missing, {}, `${module} is missing ports`);
  for (const [name, detail] of Object.entries(shimmed)) {
    if (detail?.signature) assert.ok(detail.override, `${module} ${name}: ${detail.signature}, without a port-override reason`);
  }
}
console.log(`Blender ports: ${generated.length} generated modules load; ${Object.keys(status).length} modules have nothing missing`);
