// Every example's exported package loads on its own, as a page loads it: a process that imports only the package's
// scene.js (its ES modules as shipped, @babylonjs/core resolvable) and Babylon's NullEngine, then the same package
// bundled. A Babylon module the package uses without importing it (a "needs to be imported" side effect: the collision
// coordinator, ColorCurves' parser) throws there, as on a page. Each example exports in a process of its own (one Main).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SIDE_EFFECT = /needs to be imported/;
// A page of the package: loaded, settled and drawn a few frames; `NullEngine` from the package itself when bundled.
const page = (url, bundled) => `${bundled ? '' : "import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';\n"}
const { load${bundled ? ', NullEngine' : ''} } = await import(${JSON.stringify(url)});
const blend = await load(new NullEngine());
await blend.settled?.();
for (let i = 0; i < 3; i++) blend.scene.render();
console.log('LOADED');
process.exit(0);`;
const run = (source) => {
  try { return execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { return `${error.stdout}\n${error.stderr}`; }
};
const verdict = (output) => output.split('\n').find((line) => SIDE_EFFECT.test(line)) ?? (/^LOADED$/m.test(output) ? null : output.split('\n').filter((l) => /Error/.test(l)).slice(0, 2).join(' | ') || 'did not load');

const id = process.argv[2];
if (id) {
  const [{ exportModule }, { openExample, openCodeExample, exampleBlend }, { writePackage, bundledFiles }] = await Promise.all([
    import('../src/io_scene_babylon/js-export.js'), import('./open-example.js'), import('./export-package.js')]);
  const { world, sync } = exampleBlend(id) ? openExample(id) : await openCodeExample(id);
  sync.view();
  const written = writePackage(await exportModule(world));
  const shipped = verdict(run(page(written.url, false)));
  written.remove();
  const exported = await exportModule(world, { bundle: true });
  exported['scene.js'] += "\nexport { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';\n";
  const dir = mkdtempSync(join(tmpdir(), 'bylonder-bundle-'));
  for (const [path, data] of Object.entries(await bundledFiles(exported))) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), data); }
  const bundled = verdict(run(page(pathToFileURL(join(dir, 'scene.js')).href, true)));
  rmSync(dir, { recursive: true, force: true });
  console.log(JSON.stringify({ shipped, bundled }));
  process.exit(0);
}

// Examples whose scene loads files from the network as Node runs it (as examples.test.js skips them).
const SKIPPED = { text: 'loads its font from Google Fonts', materials: 'loads its environment from assets.babylonjs.com' };
const examples = readdirSync(new URL('../examples/', import.meta.url)).filter((name) => !name.includes('.') && !SKIPPED[name]).sort();
const failures = [];
for (const example of examples) {
  const output = execFileSync(process.execPath, [fileURLToPath(import.meta.url), example], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const { shipped, bundled } = JSON.parse(output.trim().split('\n').at(-1));
  if (shipped) failures.push(`${example} as shipped: ${shipped}`);
  if (bundled) failures.push(`${example} bundled: ${bundled}`);
}
assert.deepEqual(failures, [], 'every example package loads alone');
console.log(`Export side effects: ${examples.length} examples' packages load alone, as shipped and bundled`);
