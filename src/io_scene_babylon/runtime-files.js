// The page runtime's files (runtime/), which every JavaScript package carries in bylonder/.
export const RUNTIME_FILES = ['blend-scene.js', 'blend-scene.d.ts', 'buffers.js', 'buffers.d.ts', 'world.js', 'world.d.ts', 'scheduler.js', 'scheduler.d.ts',
  'implementations.json', 'LICENSE.md'];
// The driver evaluator and the clean-room driver units (drivers/), in bylonder/ when the table has a driver.
export const DRIVER_FILES = ['driver-evaluator.js', 'driver-evaluator.d.ts', ...['driver', 'expression', 'fcurve', 'float32', 'rotation-reading'].flatMap((n) => [`drivers/${n}.js`, `drivers/${n}.d.ts`])];
// The Blender evaluator, in bylonder/ when the table has an operation only Blender evaluates.
export const BLENDER_FILES = ['blender-evaluator.js', 'blender-evaluator.d.ts'];
// The Blender fallback it loads, by package path, from src/: Blender's module and what draws its results, with their
// license (GPL-3.0-or-later), shipped with the package's scene.blend.
export const FALLBACK_FILES = { 'bylonder-blender/blender.js': 'io_scene_babylon/blender-fallback.bundle.js', 'bylonder-blender/bmesh.wasm': 'bmesh/bmesh.wasm',
  'bylonder-blender/mesh-tessellate.wasm': 'blenkernel/mesh/mesh-tessellate.wasm', 'bylonder-blender/LICENSE.md': 'io_scene_babylon/blender-fallback.LICENSE.md',
  'bylonder-blender/COPYING': '../LICENSES/GPL-3.0-or-later.txt' };
export const usesBlender = (sceneSource) => sceneSource.includes('"evaluator":"blender"');
// The blocks library and Bylonder's extensions of Babylon, by package path: runtime/ files a package ships beside its
// scene.js only when it imports them.
export const BLOCK_FILES = { 'bylonder-blocks.js': 'blocks.js', 'bylonder-view-transform.js': 'view-transform.js' };
// The runtime/ files a package with this scene.js ships: [package path, runtime/ file name].
export const packageRuntime = (sceneSource) => [...RUNTIME_FILES.map((name) => [`bylonder/${name}`, name]),
  ...(sceneSource.includes('"evaluator":"driver"') ? DRIVER_FILES.map((name) => [`bylonder/${name}`, name]) : []),
  ...(usesBlender(sceneSource) ? BLENDER_FILES.map((name) => [`bylonder/${name}`, name]) : []),
  ...Object.entries(BLOCK_FILES).filter(([path]) => sceneSource.includes(`from './${path}'`))];
