import { Viewport } from '@babylonjs/core';

// Renders one scene into several viewport canvases (Babylon engine views) at the cost of one scene render per
// visible view and no per-frame engine resizes:
// - The engine renders into a hidden working canvas. Its size follows an anchor: the view that shows the
//   compositor, or else the largest view. It changes only when the layout does.
// - Every other view renders into the working canvas's top-left corner through its camera viewport, and Babylon
//   copies that corner into the view's canvas. A view larger than the anchor renders at reduced resolution and
//   is scaled up by CSS (the compositor's frame graph ignores camera viewports, so it needs the full canvas).
// - Views stop rendering when nothing is happening: no input, no playback, no animated or loading content.
//
// A view is { canvas, camera, active (bool, renders or not), wantsCompositor (bool), beforeRender(), afterRender() }.
export function createViews({ engine, scene, live = () => false }) {
  const views = new Map(); // canvas -> { view, engineView }
  let anchor = null, workSize = [0, 0], lastWake = 0, inputView = null, focused = null, layoutDirty = true, idle = false;
  const scaling = () => engine.getHardwareScalingLevel();
  const cssSize = view => [view.canvas.clientWidth, view.canvas.clientHeight];
  const pixelSize = view => cssSize(view).map(v => Math.max(1, Math.floor(v / scaling())));
  const visible = view => view.active && view.canvas.isConnected && view.canvas.clientWidth > 0 && view.canvas.clientHeight > 0;

  // Working canvas size and every view's region; runs only when the layout changed.
  const layout = () => {
    layoutDirty = false;
    const shown = [...views.values()].map(v => v.view).filter(visible);
    if (!shown.length) return;
    anchor = shown.find(v => v.wantsCompositor) || null;
    const size = anchor ? pixelSize(anchor) : shown.map(pixelSize).reduce(([w, h], [a, b]) => [Math.max(w, a), Math.max(h, b)], [1, 1]);
    workSize = size;
    if (engine.getRenderWidth() !== size[0] || engine.getRenderHeight() !== size[1]) engine.setSize(size[0], size[1]);
    for (const view of shown) {
      const [w, h] = pixelSize(view);
      const k = Math.min(1, workSize[0] / w, workSize[1] / h);
      const pw = Math.max(1, Math.floor(w * k)), ph = Math.max(1, Math.floor(h * k));
      if (view.canvas.width !== pw || view.canvas.height !== ph) { view.canvas.width = pw; view.canvas.height = ph; }
      view.scale = k;
      view.region = view === anchor ? new Viewport(0, 0, 1, 1) : new Viewport(0, 1 - ph / workSize[1], pw / workSize[0], ph / workSize[1]);
    }
  };
  const observer = new ResizeObserver(() => { layoutDirty = true; api.wake(); });
  // Anything else resizing the engine (hardware scaling, engine.resize() in user code) re-runs the layout.
  const resized = engine.onResizeObservable.add(() => { layoutDirty = true; api.wake(); });

  // Views may share a camera (camera view, compositor backdrop), so each applies its region as it renders.
  const before = engine.onBeforeViewRenderObservable.add(engineView => {
    const view = views.get(engineView.target)?.view;
    if (!view) return;
    if (view.region) view.camera.viewport = view.region;
    view.beforeRender?.();
  });
  const after = engine.onAfterViewRenderObservable.add(engineView => views.get(engineView.target)?.view.afterRender?.());
  // Decide, once per frame, which views render.
  const frame = engine.onBeginFrameObservable.add(() => {
    if (layoutDirty) layout();
    const busy = live() || performance.now() - lastWake < 500 || scene.getWaitingItemsCount() > 0;
    idle = !busy;
    for (const { view, engineView } of views.values()) {
      engineView.enabled = busy && visible(view);
      engineView.camera = view.camera;
    }
  });

  const api = {
    add(view) {
      const engineView = engine.registerView(view.canvas, view.camera);
      // Our layout owns sizes; Babylon must not resize per view.
      engineView.customResize = () => {};
      views.set(view.canvas, { view, engineView });
      observer.observe(view.canvas);
      const enter = () => api.setInput(view);
      const down = () => { api.setInput(view); if (focused !== view) { focused = view; api.onFocus?.(view); } };
      view.canvas.addEventListener('pointerenter', enter);
      view.canvas.addEventListener('pointerdown', down, true);
      view.detach = () => { view.canvas.removeEventListener('pointerenter', enter); view.canvas.removeEventListener('pointerdown', down, true); };
      layoutDirty = true;
      if (!inputView) api.setInput(view);
      api.wake();
      return view;
    },
    remove(view) {
      const entry = views.get(view.canvas); if (!entry) return;
      observer.unobserve(view.canvas);
      view.detach?.();
      engine.unRegisterView(view.canvas);
      views.delete(view.canvas);
      if (focused === view) focused = null;
      if (inputView === view) { inputView = null; const next = views.values().next().value?.view; if (next) api.setInput(next); }
      layoutDirty = true; api.wake();
    },
    // The view under the pointer receives Babylon's scene input (gizmos, camera controls) and defines
    // scene.activeCamera between frames.
    setInput(view) {
      if (inputView === view) return;
      inputView = view;
      engine.inputElement = view.canvas;
      scene.activeCamera = view.camera;
      api.wake();
    },
    get input() { return inputView; },
    // The view last clicked; it keeps the compositor while the pointer moves over other views.
    get focused() { return focused || inputView; },
    get all() { return [...views.values()].map(v => v.view); },
    get anchor() { return anchor; },
    get idle() { return idle; },
    // Keeps views rendering for a short while; call on any change that should show.
    wake() { lastWake = performance.now(); },
    relayout() { layoutDirty = true; api.wake(); },
    // Converts client coordinates to the coordinates scene.pick expects for this view.
    pickPoint(view, clientX, clientY) {
      const rect = view.canvas.getBoundingClientRect(), k = (view.scale ?? 1);
      return { x: (clientX - rect.left) * k, y: (clientY - rect.top) * k };
    },
    dispose() {
      engine.onBeforeViewRenderObservable.remove(before);
      engine.onAfterViewRenderObservable.remove(after);
      engine.onBeginFrameObservable.remove(frame);
      engine.onResizeObservable.remove(resized);
      for (const { view } of [...views.values()]) api.remove(view);
      observer.disconnect();
    },
  };
  return api;
}
