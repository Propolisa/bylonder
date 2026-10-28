// What the 3D View's tools and their gizmos draw over the scene in pixel space (ED_region_draw_cb_activate with
// REGION_DRAW_POST_PIXEL, and the gizmo map's draw): one 2D canvas over each view, redrawn when a draw callback asks
// (ED_region_tag_redraw) or the view moved. A callback draws with draw(ctx, region): `ctx` is the canvas's 2D
// context in CSS pixels of the view, `region` the view's projection (view3d-project.js) and toRegion(clientPoint).
import { viewProjection } from '../editors/space_view3d/view3d-project.js';
import theme from '../editors/interface/theme-default.json' with { type: 'json' };

const callbacks = new Set();
let revision = 0;

// ED_region_tag_redraw for every 3D View.
export const tagRedraw = () => { revision++; };

// Adds a draw callback; returns the function that removes it.
export function drawCallbackAdd(draw) {
  callbacks.add(draw);
  tagRedraw();
  return () => { callbacks.delete(draw); tagRedraw(); };
}

// A theme color (0..1) with an alpha, as CSS.
export const css = ([r, g, b, a = 1], alpha = a) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${alpha})`;
export const THEME = { ...theme.user_interface, text: theme.view_3d.space.text, wire: theme.view_3d.wire, view_overlay: theme.view_3d.view_overlay };

export function createToolOverlay(view) {
  const canvas = Object.assign(document.createElement('canvas'), { className: 'tool-overlay' });
  canvas.setAttribute('aria-hidden', 'true');
  view.section.append(canvas);
  let drawn = '';
  const redraw = () => {
    const rect = view.canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
    Object.assign(canvas.style, { width: rect.width + 'px', height: rect.height + 'px' });
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!callbacks.size || view.state.cameraView || !view.state.overlays) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const region = viewProjection(view);
    for (const draw of callbacks) {
      ctx.save();
      draw(ctx, region);
      ctx.restore();
    }
  };
  return {
    // Once per frame: redraws when asked or when the view changed.
    tick() {
      const key = [revision, view.camera.getViewMatrix().m.join(), view.canvas.clientWidth, view.canvas.clientHeight, view.state.overlays, view.state.cameraView].join();
      if (key === drawn) return;
      drawn = key;
      redraw();
    },
    dispose() { canvas.remove(); },
  };
}
