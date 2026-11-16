// The view's Quality, a setting of the board's menu: Auto draws a phone (a coarse pointer) as Mobile and anything else
// as Full; Mobile trades detail for speed by Babylon's own means: the shadows' filter at Babylon's low quality and the
// view drawn at two thirds of its resolution (the engine's hardware scaling); Full draws as exported. The shadow maps
// keep their size: a smaller one would take more cascades (cascades.js keeps their texels fine), so more shadow passes.
import { defineSystem, enumOf } from 'bylonder';
import { ShadowGenerator } from '@babylonjs/core';

export const QUALITIES = ['Auto', 'Mobile', 'Full'];
const SCALE = 1.5;

export default defineSystem({
  name: 'Quality',
  props: { quality: enumOf(QUALITIES) },
  create({ props, babylon }) {
    const { scene } = babylon, engine = scene.getEngine(), canvas = engine.getRenderingCanvas();
    const own = canvas?.ownerDocument.defaultView;
    const page = (() => { try { return own?.top?.document ? own.top : own; } catch { return own; } })();
    const phone = !!page?.matchMedia('(pointer: coarse)').matches;
    // As exported: each shadow generator's filter, and the engine's scaling the page chose.
    const generators = scene.lights.map((light) => /** @type {any} */ (light.getShadowGenerator())).filter(Boolean);
    const exported = new Map(generators.map((g) => [g, g.filteringQuality]));
    let quality = props.quality, scaled = engine.getHardwareScalingLevel(), applied = false;
    const mobile = () => quality === 'Mobile' || (quality === 'Auto' && phone);
    const apply = () => {
      const on = mobile();
      if (on === applied) return;
      applied = on;
      for (const [g, filter] of exported) g.filteringQuality = on ? ShadowGenerator.QUALITY_LOW : filter;
      engine.setHardwareScalingLevel(on ? scaled * SCALE : scaled);
    };
    apply();
    return {
      /** Auto, Mobile or Full. */
      get quality() { return quality; },
      set quality(value) { if (QUALITIES.includes(value) && value !== quality) { quality = value; apply(); } },
      /** Whether the view draws at Mobile quality now. */
      get mobile() { return applied; },
      update() {
        // The page may scale the view again (a resize, the display's pixel ratio): Mobile scales from its new level.
        const level = engine.getHardwareScalingLevel();
        if (Math.abs(level - (applied ? scaled * SCALE : scaled)) > 1e-6) { scaled = level; applied = false; apply(); }
      },
      dispose() {
        if (!applied) return;
        for (const [g, filter] of exported) g.filteringQuality = filter;
        engine.setHardwareScalingLevel(scaled);
      },
    };
  },
});
