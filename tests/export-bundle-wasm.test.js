// File > Export > JavaScript's Bundle (io_scene_babylon/bundle.js): a package's modules as one minified bundle with the
// Babylon.js modules its scene uses, so a page needs no import map or CDN; Blender's code (GPL) in its own files beside
// their notices, no other file holding any of it; a unit the page replaces absent from the bundle (units.json).
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { bundledFiles } from './export-package.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { AREA_SPECULAR, CHUNKS, COMPILER_FOLDER, UNITS_FILE } from '../src/io_scene_babylon/runtime-files.js';
import { AREA_SPECULAR_UNIT } from '../src/io_scene_babylon/unit-manifest.js';

// Steam Engine's brass under its area Key Light: the page ships Blender's light specular (GPL).
const { world, sync } = openExample('drivers-and-graph-editor');
sync.view();
const modules = (files) => Object.entries(files).filter(([path]) => path.endsWith('.js') && !path.startsWith(`${COMPILER_FOLDER}/`));
const holding = (files, text) => modules(files).filter(([, code]) => code.includes(text)).map(([path]) => path);
const SPECULAR = "'BlenderAreaSpecular'".replaceAll("'", '"');

const bundled = await bundledFiles(await exportModule(world, { bundle: true }));
for (const [path, code] of modules(bundled)) {
  assert.ok(path === 'scene.js' || path.startsWith(`${CHUNKS}/`) || path.startsWith('bylonder-'), `${path}: scene.js, a chunk, or Blender's code`);
  assert.doesNotMatch(code, /(?:from|import)\s*\(?\s*["']@babylonjs\//, `${path} imports Babylon from the bundle, not by name`);
}
assert.deepEqual(holding(bundled, SPECULAR), [AREA_SPECULAR], "Blender's light specular is in its own file alone");
assert.ok(bundled[AREA_SPECULAR].startsWith('// override(babylon)'), 'which keeps its leading comments');
assert.ok(['LICENSE.md', 'COPYING'].every((name) => bundled[`bylonder-area-specular/${name}`]), 'beside its notice');
assert.match(bundled['scene.js'], /^\/\/ .*exported from Bylonder[^]*Bundled with the Babylon.js modules[^]*Includes GPL code: bylonder-area-specular\/area-specular.js/,
  "scene.js keeps its header, naming the GPL code it imports");
assert.ok(!Object.keys(bundled).some((path) => path.startsWith('bylonder/') && path.endsWith('.js')), 'the runtime is in the bundle');
assert.match(bundled[`${CHUNKS}/LICENSE.md`], /Apache License/, "Babylon's licence beside its code");
assert.ok(bundled[`${COMPILER_FOLDER}/glslang.wasm`] && bundled[`${COMPILER_FOLDER}/twgsl.js`], 'a WebGPU page carries its GLSL to WGSL compilers');
assert.match(bundled['scene.js'], /bundle\/webgpu\//, 'and creates its engine with them');

const readable = await bundledFiles(await exportModule(world, { bundle: true, target: 'WEBGL2', replace: [AREA_SPECULAR_UNIT] }), { minify: false });
assert.ok(JSON.parse(readable[UNITS_FILE]).units[AREA_SPECULAR_UNIT].replaced, 'the unit is replaced');
assert.deepEqual(holding(readable, SPECULAR), [], 'and none of its code is in the bundle');
assert.ok(!Object.keys(readable).some((path) => path.startsWith('bylonder-area-specular/') || path.startsWith(`${COMPILER_FOLDER}/`)), 'nor its folder, nor WebGPU compilers on WebGL 2');
assert.ok(readable['scene.js'].split('\n').length > 10 * bundled['scene.js'].split('\n').length, 'Minify off writes the bundle readable');
console.log("Export: a package bundled with Babylon's modules, Blender's code in its own files, a replaced unit absent");
process.exit(0);
