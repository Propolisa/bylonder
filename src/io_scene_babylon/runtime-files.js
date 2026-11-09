// The page runtime's files (runtime/), which every JavaScript package carries in bylonder/.
const declared = (...names) => names.flatMap((name) => [`${name}.js`, `${name}.d.ts`]);
export const RUNTIME_FILES = [...declared('blend-scene', 'buffers', 'world', 'scheduler', 'ir', 'units', 'mesh', 'zod'), 'ir.schema.json', 'implementations.json', 'LICENSE.md'];
// GPL's notice and text, beside Blender's code in a package (src/ paths).
const NOTICE = { 'LICENSE.md': 'io_scene_babylon/blender-code.LICENSE.md', COPYING: '../LICENSES/GPL-3.0-or-later.txt' };
// Each implementation an IR's entities name: its runtime/ files, in bylonder/ when an entity runs on it, and the folder
// of Blender's code it loads, its files from src/ (GPL-3.0-or-later).
export const EVALUATOR_FILES = {
  driver: { runtime: [...declared('driver-evaluator'), ...['driver', 'expression', 'fcurve', 'float32', 'rotation-reading'].flatMap((n) => declared(`drivers/${n}`))] },
  modifiers: { runtime: declared('modifiers-evaluator'), folder: 'bylonder-modifiers',
    files: { 'modifiers-worker.js': 'io_scene_babylon/polyfill/modifiers-worker.bundle.js', 'modifiers.wasm': 'modifiers/modifiers.wasm' } },
  blender: { runtime: declared('blender-evaluator'), folder: 'bylonder-blender',
    files: { 'blender.js': 'io_scene_babylon/blender-fallback.bundle.js', 'bmesh.wasm': 'bmesh/bmesh.wasm', 'mesh-tessellate.wasm': 'blenkernel/mesh/mesh-tessellate.wasm' } },
};
// GPL's notice and text in a folder of a package: [package path, src/ path].
export const noticeFiles = (folder) => Object.entries(NOTICE).map(([name, from]) => [`${folder}/${name}`, from]);
// The per-node shader kernels made at export from Blender's GLSL (node-material-export.js materialKernels).
export const NODE_KERNELS = 'bylonder-nodes/nodes.js';
// A package's files (scene.js, scene.ir.json) as text, or the IR's alone.
const text = (files) => (typeof files === 'string' ? files : `${files['scene.ir.json'] ?? ''}${files['scene.js'] ?? ''}`);
const evaluatorsOf = (files) => Object.entries(EVALUATOR_FILES).filter(([name]) => text(files).includes(`"implementation":"${name}"`)).map(([, e]) => e);
// The folders of Blender's code a package with these files ships, and their files: [package path, src/ path].
export const gplFolders = (files) => evaluatorsOf(files).filter((e) => e.folder).map((e) => e.folder);
export const gplFiles = (files) => evaluatorsOf(files).filter((e) => e.folder)
  .flatMap(({ folder, files: own }) => [...Object.entries(own).map(([name, from]) => [`${folder}/${name}`, from]), ...noticeFiles(folder)])
  .concat(text(files).includes(NODE_KERNELS) ? noticeFiles(NODE_KERNELS.split('/')[0]) : []);
// Bylonder's overrides of Babylon and WebGPU (src/overrides/), which every package carries in bylonder/overrides/, and
// how a runtime file imports one there.
export const OVERRIDE_FILES = ['webgpu/float-world-cube', 'webgpu/derivative-uniformity', 'webgpu/reserved-names', 'webgpu/samplers'].flatMap((name) => [`${name}.js`, `${name}.d.ts`]);
export const packageOverrides = () => OVERRIDE_FILES.map((name) => [`bylonder/overrides/${name}`, `overrides/${name}`]);
export const packagedRuntime = (text) => text.replaceAll("'../../overrides/", "'./overrides/");
// The blocks library and Bylonder's extensions of Babylon, by package path: runtime/ files a package ships beside its
// scene.js only when it imports them.
export const BLOCK_FILES = { 'bylonder-blocks.js': 'blocks.js', 'bylonder-view-transform.js': 'view-transform.js' };
// The material builder (runtime/materials.js) and the registry it resolves nodes through, for a scene.js that imports it.
export const MATERIAL_FILES = declared('materials');
// The runtime/ files a package with these files ships: [package path, runtime/ file name].
export const packageRuntime = (files) => [...RUNTIME_FILES, ...evaluatorsOf(files).flatMap((e) => e.runtime),
  ...(text(files).includes("from './bylonder/materials.js'") ? MATERIAL_FILES : [])].map((name) => [`bylonder/${name}`, name])
  .concat(Object.entries(BLOCK_FILES).filter(([path]) => text(files).includes(`from './${path}'`)));
