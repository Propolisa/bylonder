// The page runtime's files (runtime/), which every JavaScript package carries in bylonder/.
export const RUNTIME_FILES = ['blend-scene.js', 'blend-scene.d.ts', 'buffers.js', 'buffers.d.ts', 'world.js', 'world.d.ts', 'implementations.json', 'LICENSE.md'];
// The blocks library and Bylonder's extensions of Babylon, by package path: runtime/ files a package ships beside its
// scene.js only when it imports them.
export const BLOCK_FILES = { 'bylonder-blocks.js': 'blocks.js', 'bylonder-view-transform.js': 'view-transform.js' };
// The runtime/ files a package with this scene.js ships: [package path, runtime/ file name].
export const packageRuntime = (sceneSource) => [...RUNTIME_FILES.map((name) => [`bylonder/${name}`, name]),
  ...Object.entries(BLOCK_FILES).filter(([path]) => sceneSource.includes(`from './${path}'`))];
