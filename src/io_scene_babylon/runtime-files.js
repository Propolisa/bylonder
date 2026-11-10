// The page runtime's files (runtime/), which every JavaScript package carries in bylonder/.
const declared = (...names) => names.flatMap((name) => [`${name}.js`, `${name}.d.ts`]);
export const RUNTIME_FILES = [...declared('blend-scene', 'buffers', 'world', 'scheduler', 'ir', 'units', 'mesh', 'ortho-scale', 'zod'), 'ir.schema.json', 'implementations.json', 'LICENSE.md'];
// GPL's notice and text, beside Blender's code in a package (src/ paths).
const NOTICE = { 'LICENSE.md': 'io_scene_babylon/blender-code.LICENSE.md', COPYING: '../LICENSES/GPL-3.0-or-later.txt' };
// Stopgap: the scene module stands in as a package's Geometry Nodes kernels (its gn_* entry points, one node a call)
// until a module of their own is built; point this at it to swap.
export const GEOMETRY_NODES_KERNELS = 'bmesh/bmesh.wasm';
// Each implementation an IR's entities name: its runtime/ files, in bylonder/ when an entity runs on it, and the folder
// of Blender's code it loads, its files from src/ (GPL-3.0-or-later).
export const EVALUATOR_FILES = {
  driver: { runtime: [...declared('driver-evaluator'), ...['driver', 'expression', 'fcurve', 'float32', 'rotation-reading'].flatMap((n) => declared(`drivers/${n}`))] },
  fcurve: { runtime: [...declared('fcurve-evaluator'), ...declared('drivers/fcurve')] },
  constraints: { runtime: declared('constraints-evaluator') },
  modifiers: { runtime: declared('modifiers-evaluator'), folder: 'bylonder-modifiers',
    files: { 'modifiers-worker.js': 'io_scene_babylon/polyfill/modifiers-worker.bundle.js', 'modifiers.wasm': 'modifiers/modifiers.wasm' } },
  'geometry-nodes': { runtime: [...declared('geometry-nodes-evaluator'), ...['index', 'evaluator', 'geometry', 'convert', 'kernels'].flatMap((n) => declared(`geometry-nodes/${n}`))],
    folder: 'bylonder-geometry-nodes',
    files: { 'kernels.js': 'io_scene_babylon/polyfill/geometry-nodes-kernels.bundle.js', 'geometry-nodes.wasm': GEOMETRY_NODES_KERNELS } },
  grease_pencil: { runtime: declared('grease-pencil') },
  curves: { runtime: declared('curves'), folder: 'bylonder-curves', files: { 'curves.js': 'draw/curves-blocks.js' } },
};
// GPL's notice and text in a folder of a package: [package path, src/ path].
export const noticeFiles = (folder) => Object.entries(NOTICE).map(([name, from]) => [`${folder}/${name}`, from]);
// The per-node shader kernels made at export from Blender's GLSL (node-material-export.js materialKernels).
export const NODE_KERNELS = 'bylonder-nodes/nodes.js';
// EEVEE's volume passes and blocks, the app's (polyfill/volumes.js), for a package that draws volumes (volumes-export.js).
const VOLUMES = { folder: 'bylonder-volumes', files: { 'volumes.js': 'io_scene_babylon/polyfill/volumes.bundle.js' } };
// EEVEE's light specular for the page's PBR materials, as the app gives its own (blenkernel/light/area-specular.js).
export const AREA_SPECULAR = 'bylonder-area-specular/area-specular.js';
// A package's files (scene.js, scene.ir.json) as text, or the IR's alone.
const text = (files) => (typeof files === 'string' ? files : `${files['scene.ir.json'] ?? ''}${files['scene.js'] ?? ''}`);
const evaluatorsOf = (files) => Object.entries(EVALUATOR_FILES).filter(([name]) => text(files).includes(`"implementation":"${name}"`)).map(([, e]) => e);
// The folders of Blender's code a package with these files ships, and their files: [package path, src/ path].
const withFolders = (files) => [...evaluatorsOf(files), ...(text(files).includes(`${VOLUMES.folder}/`) ? [VOLUMES] : [])];
export const gplFolders = (files) => withFolders(files).filter((e) => e.folder).map((e) => e.folder);
export const gplFiles = (files) => withFolders(files).filter((e) => e.folder)
  .flatMap(({ folder, files: own }) => [...Object.entries(own).map(([name, from]) => [`${folder}/${name}`, from]), ...noticeFiles(folder)])
  .concat(text(files).includes(NODE_KERNELS) ? noticeFiles(NODE_KERNELS.split('/')[0]) : [])
  .concat(text(files).includes(AREA_SPECULAR) ? [[AREA_SPECULAR, 'blenkernel/light/area-specular.js'], ...noticeFiles(AREA_SPECULAR.split('/')[0])] : []);
// Bylonder's overrides of Babylon and WebGPU (src/overrides/), which a package carries in bylonder/overrides/ when its
// scene.js or runtime files import them, and how a runtime file imports one there.
const OVERRIDES = ['webgpu/float-world-cube', 'webgpu/derivative-uniformity', 'webgpu/reserved-names', 'webgpu/samplers', 'webgpu/maximum-limits', 'webgpu/missing-attributes', 'webgpu/depth-metric-varyings', 'webgpu/vertex-light-blocks', 'webgpu/pbr-from-glsl', 'babylon/area-light-parse', 'babylon/camera-quaternion', 'babylon/god-rays-parse', 'babylon/pipeline-effects', 'babylon/linear-image-processing', 'babylon/chromatic-aberration-size', 'babylon/geometry-gamma-albedo', 'babylon/environment-probe', 'babylon/srgb-texture-parse'];
const declaredOverrides = (names) => names.flatMap((name) => [`${name}.js`, `${name}.d.ts`]);
export const OVERRIDE_FILES = declaredOverrides(OVERRIDES);
// The overrides a package's files (scene.js and its runtime files) import: [package path, src/ path].
export const packageOverrides = (files) => {
  const code = Object.values(files).filter((data) => typeof data === 'string').join('\n');
  return declaredOverrides(OVERRIDES.filter((name) => code.includes(`overrides/${name}.js'`))).map((name) => [`bylonder/overrides/${name}`, `overrides/${name}`]);
};
export const packagedRuntime = (text) => text.replaceAll("'../../overrides/", "'./overrides/");
// The blocks library and Bylonder's extensions of Babylon, by package path: runtime/ files a package ships beside its
// scene.js only when it imports them.
export const BLOCK_FILES = { 'bylonder-blocks.js': 'blocks.js', 'bylonder-view-transform.js': 'view-transform.js', 'bylonder-area-light.js': 'area-light.js' };
// The material builder (runtime/materials.js) and the registry it resolves nodes through, for a scene.js that imports it.
export const MATERIAL_FILES = declared('materials');
// The runtime/ files a package with these files ships: [package path, runtime/ file name].
export const packageRuntime = (files) => [...RUNTIME_FILES, ...evaluatorsOf(files).flatMap((e) => e.runtime),
  ...(text(files).includes("from './bylonder/materials.js'") ? MATERIAL_FILES : [])].map((name) => [`bylonder/${name}`, name])
  .concat(Object.entries(BLOCK_FILES).filter(([path]) => text(files).includes(`from './${path}'`)));
