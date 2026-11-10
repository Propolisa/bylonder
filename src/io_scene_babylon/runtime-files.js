// The page runtime's files (runtime/), which every JavaScript package carries in bylonder/.
import { deepImports } from './babylon-modules.js';

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
// The package's manifest of units (unit-manifest.js), beside scene.js.
export const UNITS_FILE = 'units.json';
// Whether a GPL file ships: while a unit the manifest does not replace uses it, or always for a package without one.
const shipping = (files) => {
  const manifest = typeof files === 'object' && files[UNITS_FILE];
  if (!manifest) return () => true;
  const used = new Set(Object.values(JSON.parse(manifest).units).filter((u) => !u.replaced).flatMap((u) => u.files));
  return (path) => used.has(path);
};
const folderPaths = ({ folder, files: own }) => Object.entries(own).map(([name, from]) => [`${folder}/${name}`, from]);
export const gplFolders = (files) => {
  const ships = shipping(files);
  return withFolders(files).filter((e) => e.folder && folderPaths(e).some(([path]) => ships(path))).map((e) => e.folder);
};
export const gplFiles = (files) => {
  const ships = shipping(files);
  const own = withFolders(files).filter((e) => e.folder).flatMap(folderPaths)
    .concat(text(files).includes(AREA_SPECULAR) ? [[AREA_SPECULAR, 'blenkernel/light/area-specular.js']] : []).filter(([path]) => ships(path));
  const kernels = text(files).includes(NODE_KERNELS) && ships(NODE_KERNELS) ? [NODE_KERNELS] : [];
  return [...own, ...[...new Set([...own.map(([path]) => path), ...kernels].map((path) => path.split('/')[0]))].flatMap(noticeFiles)];
};
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
// The scheduler's implementations but those a package does not ship, so that a bundler finds every module it names.
const shippedEvaluators = (text, files) => text.replace(/^ +'?[\w-]+'?: .*import\('\.\/([\w-]+\.js)'\).*\n/gm, (line, file) => (`bylonder/${file}` in files ? line : ''));
// A package's files as it ships them: its modules import @babylonjs/core module by module (babylon-modules.js).
export const packagedModules = (files) => Object.fromEntries(Object.entries(files).map(([path, data]) => {
  if (!path.endsWith('.js')) return [path, data];
  const code = deepImports(String(data));
  return [path, path === 'bylonder/scheduler.js' ? shippedEvaluators(code, files) : code];
}));
// A bundled package's chunks (bundle.js), and Babylon's GLSL to WGSL compilers a bundled WebGPU page carries.
export const CHUNKS = 'bundle', COMPILER_FOLDER = `${CHUNKS}/webgpu`;
// Files the app serves from public/ (scripts/webgpu-compilers.mjs) that a package ships where scene.js names their
// folder: [package path, the app's path].
const APP_FILES = ['glslang.js', 'glslang.wasm', 'twgsl.js', 'twgsl.wasm'].map((name) => [`${COMPILER_FOLDER}/${name}`, `webgpu/${name}`]);
export const appFiles = (files) => APP_FILES.filter(([path]) => String(files['scene.js']).includes(path.slice(0, path.lastIndexOf('/') + 1)));
// The blocks library and Bylonder's extensions of Babylon, by package path: runtime/ files a package ships beside its
// scene.js only when it imports them.
export const BLOCK_FILES = { 'bylonder-blocks.js': 'blocks.js', 'bylonder-view-transform.js': 'view-transform.js', 'bylonder-area-light.js': 'area-light.js' };
// The material builder (runtime/materials.js) and the registry it resolves nodes through, for a scene.js that imports it.
export const MATERIAL_FILES = declared('materials');
// The runtime/ files a package with these files ships: [package path, runtime/ file name].
export const packageRuntime = (files) => [...RUNTIME_FILES, ...evaluatorsOf(files).flatMap((e) => e.runtime),
  ...(text(files).includes("from './bylonder/materials.js'") ? MATERIAL_FILES : [])].map((name) => [`bylonder/${name}`, name])
  .concat(Object.entries(BLOCK_FILES).filter(([path]) => text(files).includes(`from './${path}'`)));
