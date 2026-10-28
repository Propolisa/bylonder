// Full-screen passes over one view (a draw engine's draw_procedural(GPU_PRIM_TRIS, 1, 3)). Views render into a region
// of the shared working canvas (views.js), so a pass's targets are the canvas's size, it draws inside the camera's
// viewport, and its shader reads them at gl_FragCoord, clamped to `region` (the viewport in pixels, inclusive).
import { EffectRenderer, EffectWrapper } from '@babylonjs/core/Materials/effectRenderer.js';

const VERTEX = `precision highp float;
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

export function createFullscreenPass(engine) {
  const renderer = new EffectRenderer(engine), size = { width: 1, height: 1 };
  return {
    size,
    // A pass's shader, with the `region` uniform.
    effect: (name, fragmentShader, uniforms, samplers) =>
      new EffectWrapper({ engine, name, vertexShader: VERTEX, fragmentShader, uniforms: ['region', ...uniforms], samplers }),
    // Keeps `targets` (render target textures) at the working canvas's size.
    fit(targets) {
      const width = engine.getRenderWidth(true), height = engine.getRenderHeight(true);
      if (size.width === width && size.height === height) return;
      Object.assign(size, { width, height });
      for (const target of targets) target.resize(size);
    },
    // Draws `effectWrapper` over the camera's viewport of the bound target; bind(effect) sets its inputs.
    draw(effectWrapper, camera, bind, depthTest = false) {
      const { x, y, width, height } = camera.viewport, x0 = Math.round(x * size.width), y0 = Math.round(y * size.height);
      renderer.saveStates();
      renderer.setViewport(camera.viewport);
      renderer.applyEffectWrapper(effectWrapper, depthTest);
      effectWrapper.effect.setFloat4('region', x0, y0, x0 + Math.round(width * size.width) - 1, y0 + Math.round(height * size.height) - 1);
      bind(effectWrapper.effect);
      renderer.draw();
      renderer.restoreStates();
    },
    dispose: () => renderer.dispose(),
  };
}
