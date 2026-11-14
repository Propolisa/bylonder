// A demo game's page bundles with Babylon into a few files: no module imports Babylon by name, each package's scene.js
// stays its own file (it finds its images by its own URL), and every kept import of Blender's code names a file of the page.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { bundleDemo } from '../tools/docs/demo-bundle.mjs';

const files = await bundleDemo(fileURLToPath(new URL('../docs/demos/noodle-shop', import.meta.url)));
const modules = Object.entries(files).filter(([path]) => path.endsWith('.js')).map(([path, code]) => [path, String(code)]);

for (const [path, code] of modules) assert.doesNotMatch(code, /(?:from|import)\s*\(?\s*["']@babylonjs\//, `${path} imports Babylon by name`);
for (const scene of ['street/scene.js', 'girl/scene.js']) assert.match(files[scene], /import\.meta\.url/, `${scene} is its own file`);
assert.match(files['game.js'], /["']\.\/street\/scene\.js["']/);

const resolve = (from, path) => new URL(path, `http://page/${from}`).pathname.slice(1);
for (const [path, code] of modules)
  for (const [, target] of code.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g))
    if (resolve(path, target) !== 'run.js') assert.ok(resolve(path, target) in files, `${path} imports ${target}, which the page lacks`);
console.log(`ok demo bundle: ${modules.length} modules`);
