// tags: viewport, selection
// A 3D View at a lowered Viewport resolution (hardware scaling above 1) draws fewer pixels than its CSS size, and a
// click still picks what is under the pointer: the views map client coordinates to the view's render pixels.
import assert from 'node:assert/strict';
import { Observable } from '@babylonjs/core';
import { createViews } from '../src/editors/space_view3d/views.js';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
const observables = () => Object.fromEntries(['onBeforeViewRenderObservable', 'onAfterViewRenderObservable', 'onBeginFrameObservable', 'onResizeObservable'].map((n) => [n, new Observable()]));
const at = (level) => {
  let size = [1, 1];
  const engine = {
    ...observables(), getHardwareScalingLevel: () => level, getRenderWidth: () => size[0], getRenderHeight: () => size[1],
    setSize: (w, h) => { size = [w, h]; }, registerView: () => ({}), unRegisterView() {},
  };
  const scene = { onNewLightAddedObservable: new Observable(), isReady: () => true, getWaitingItemsCount: () => 0 };
  const canvas = { width: 0, height: 0, clientWidth: 800, clientHeight: 600, isConnected: true, addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }) };
  const views = createViews({ engine, scene }), view = views.add({ canvas, camera: { getScene: () => ({}) }, active: true, input: false });
  engine.onBeginFrameObservable.notifyObservers();
  return { view, point: views.pickPoint(view, 100 + 400, 50 + 300) };
};
for (const level of [1, 0.5, 4]) {
  const { view, point } = at(level);
  assert.equal(view.canvas.width, 800 / level, `at scaling ${level} the view draws ${800 / level} pixels across`);
  assert.deepEqual(point, { x: view.canvas.width / 2, y: view.canvas.height / 2 }, `at scaling ${level} the view's centre picks its middle render pixel`);
}
console.log('Views at a lowered Viewport resolution: a click maps to the view\'s render pixels, so picking finds what is under the pointer');
