// The scene's annotations (Scene.grease_pencil, a legacy bGPdata named "Annotations", gpencil_legacy.cc): layers of
// frames of strokes, points in Blender world space. The Measure tool keeps its rulers as strokes of a hidden layer
// (GP_LAYER_IS_RULER). Document slice "annotations"; changes are undo steps of the operators that make them.
//
// A layer is { info, color: [r, g, b, a], thickness, hide, ruler, frames: [{ framenum, strokes }] }; a stroke is
// { points: [[x, y, z], ...], thickness }.

// U.gpencil_new_layer_col.
export const GPENCIL_NEW_LAYER_COL = [0.38, 0.61, 0.78, 0.9];
// The annotation tool's new layer (annotation_session_initdata): "Note", 3 pixels thick.
const NOTE = { info: 'Note', thickness: 3 };

export function createAnnotations({ frame = () => 0 } = {}) {
  let layers = [], active = -1;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  const api = {
    get layers() { return layers; },
    get active() { return layers[active] ?? null; },
    // BKE_gpencil_layer_addnew, made active unless it is the ruler's.
    layerAdd({ info, thickness = 3, color = GPENCIL_NEW_LAYER_COL, hide = false, ruler = false }) {
      const layer = { info, color: [...color], thickness, hide, ruler, frames: [] };
      layers = [...layers, layer];
      if (!ruler) active = layers.length - 1;
      return layer;
    },
    // The active layer, a new "Note" layer when there is none (annotation_session_initdata).
    activeEnsure: () => api.active ?? api.layerAdd(NOTE),
    // The ruler's layer (view3d_ruler_layer_get), made on first use.
    rulerLayer: (ensure = false) => layers.find((layer) => layer.ruler) ??
      (ensure ? api.layerAdd({ info: 'RulerData3D', thickness: 1, hide: true, ruler: true }) : null),
    // BKE_gpencil_layer_frame_get: the frame at cfra (ADD_NEW makes one there), or with USE_PREV the last one before.
    frameGet(layer, cfra = frame(), mode = 'USE_PREV') {
      const exact = layer.frames.find((f) => f.framenum === cfra);
      if (exact || mode !== 'ADD_NEW') return exact ?? layer.frames.filter((f) => f.framenum <= cfra).at(-1) ?? null;
      const created = { framenum: cfra, strokes: [] };
      layer.frames = [...layer.frames, created].sort((a, b) => a.framenum - b.framenum);
      return created;
    },
    // The strokes the 3D View draws: visible layers' frames at the current frame.
    visible: () => layers.filter((layer) => !layer.hide).map((layer) => ({ layer, frame: api.frameGet(layer) })).filter(({ frame }) => frame),
    changed: emit,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    capture: () => (layers.length ? JSON.parse(JSON.stringify({ layers, active })) : undefined),
    apply(saved) {
      const next = saved ? JSON.parse(JSON.stringify(saved)) : { layers: [], active: -1 };
      if (JSON.stringify(next) === JSON.stringify({ layers, active })) return;
      ({ layers, active } = next);
      emit();
    },
    dispose() { listeners.clear(); },
  };
  return api;
}
