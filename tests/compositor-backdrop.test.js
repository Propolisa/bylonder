// The Compositor's backdrop frames the render as Blender's backdrop shows the Viewer image: before it draws, the scene
// camera is fitted to the output (main-sync.js fitCamera), whatever a 3D View in camera view (which frames it wider,
// around the passepartout) left it at.
import assert from 'node:assert/strict';

// The page's DOM, as much of it as the backdrop touches without a host.
globalThis.document ??= { createElement: () => ({ setAttribute() {}, style: {} }) };
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
const { createCompositorBackdrop } = await import('../src/editors/space_node/compositor-backdrop.js');

const camera = { name: 'Camera' }, output = { width: 1280, height: 720 }, fitted = [], order = [];
const world = {
  mainSync: { fitCamera: (c, size) => { fitted.push([c, size]); order.push('fit'); } },
  beforeViewRender: () => order.push('render'),
};
const backdrop = createCompositorBackdrop({ world, overlays: { setEnabled() {} }, camera: () => camera, output: () => output, shadingChanged() {} });
backdrop.view.beforeRender();
assert.deepEqual(fitted, [[camera, output]], "the scene camera fitted to the output");
assert.deepEqual(order, ['fit', 'render'], 'before the view renders');
console.log("Compositor backdrop: the camera frames the render's output, as Blender's backdrop shows it");
