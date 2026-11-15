// An area's own render loop runs only while the area is shown: one folded into a drawer, hidden by a maximized or
// Focus Mode area, or closed has no size, and its engine draws nothing until it shows again.

/** fn(shown) on each change of whether `element` is laid out with a size. Returns a remover. */
export function watchShown(element, fn, Observer = ResizeObserver) {
  let shown = null;
  const observer = new Observer(([entry]) => {
    const now = entry.contentRect.width > 0 && entry.contentRect.height > 0;
    if (now !== shown) fn((shown = now));
  });
  observer.observe(element);
  return () => observer.disconnect();
}

/**
 * `render` as the render loop of the engine `engine()` gives, run while the area is shown and `wanted()`; `update()`
 * after either changes, `shown(on)` when the area shows or hides.
 */
export function areaRenderLoop(render, { engine, wanted }) {
  let looping = null, visible = true;
  const update = () => {
    const next = visible && wanted() ? engine() ?? null : null;
    if (next === looping) return;
    looping?.stopRenderLoop(render);
    looping = next;
    looping?.runRenderLoop(render);
  };
  return {
    update,
    shown(on) { visible = on; update(); },
    get running() { return !!looping; },
  };
}
