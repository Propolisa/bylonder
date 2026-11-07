// The overlay engine's pass in Rendered shading, in the order of Blender's draw manager: the render engine draws the
// scene without overlays through its film and view transform, the overlays then draw into a target of their own that
// shares the scene's depth (overlay_engine's framebuffers over the render engine's depth), and the viewport puts that
// target over the color-managed result (GPU_viewport's display shader with its overlay texture). Other shadings draw
// overlays in the scene's own pass, which is already in display space.
// Overlay meshes are the scene's meshes tagged metadata.overlay; they move to a camera layer of their own, which a view
// includes in its camera's layers unless its overlays draw in this pass.
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { createFullscreenPass } from './fullscreen-pass.js';

const SCENE_LAYERS = 0x0fffffff;
export const OVERLAY_LAYER = 0x20000000;

// blender-port: intern/opencolorio/gpu_shader_display_fragment.glsl OCIO_main: the overlay is premultiplied, so the
// display-transformed render keeps 1 - its alpha.
const MERGE_FRAGMENT = `precision highp float;
uniform sampler2D overlay_tx;
uniform vec4 region;
void main() {
  gl_FragColor = texelFetch(overlay_tx, clamp(ivec2(gl_FragCoord.xy), ivec2(region.xy), ivec2(region.zw)), 0);
}`;

export function createOverlayPass(scene) {
  const engine = scene.getEngine(), pass = createFullscreenPass(engine);
  const target = new RenderTargetTexture('__overlays', pass.size, scene, {
    generateMipMaps: false, type: Constants.TEXTURETYPE_UNSIGNED_BYTE, samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
    generateDepthBuffer: false, doNotChangeAspectRatio: true,
  });
  Object.assign(target, { renderParticles: false, renderSprites: false, renderListPredicate: (mesh) => mesh.layerMask === OVERLAY_LAYER });
  // The scene's depth stays: the overlays test against it.
  target.onClearObservable.add(() => engine.clear(new Color4(0, 0, 0, 0), true, false, false));
  const merge = pass.effect('overlayMerge', MERGE_FRAGMENT, [], ['overlay_tx']);
  let camera = null, film = null;

  // Overlays draw in the film's display space, as they do in a view without a film.
  const drawOverlays = scene.onAfterDrawPhaseObservable.add(() => {
    if (!film || scene.activeCamera !== camera) return;
    const sceneTarget = film.target(), depth = sceneTarget?.depthStencilTexture;
    if (!depth || sceneTarget.width !== pass.size.width || sceneTarget.height !== pass.size.height) return;
    if (target.renderTarget.depthStencilTexture !== depth) sceneTarget.shareDepth(target.renderTarget);
    const ip = scene.imageProcessingConfiguration, sceneLinear = ip.applyByPostProcess;
    ip.applyByPostProcess = false;
    target.render();
    ip.applyByPostProcess = sceneLinear;
  });
  const mergeOverlays = scene.onAfterCameraRenderObservable.add((rendered) => {
    if (!film || rendered !== camera || !merge.effect.isReady()) return;
    engine.setAlphaMode(Constants.ALPHA_PREMULTIPLIED);
    pass.draw(merge, camera, (effect) => effect.setTexture('overlay_tx', target));
    engine.setAlphaMode(Constants.ALPHA_DISABLE);
  });

  return {
    // Per view, right before it renders: its camera, and the film of its render engine when its overlays draw in this
    // pass (null: in the scene's pass). Returns what to call once the view has rendered.
    use(viewCamera, viewFilm) {
      for (const mesh of scene.meshes) if (mesh.metadata?.overlay && mesh.layerMask === SCENE_LAYERS) mesh.layerMask = OVERLAY_LAYER;
      const layers = viewCamera.layerMask;
      viewCamera.layerMask = viewFilm ? layers & ~OVERLAY_LAYER : layers | OVERLAY_LAYER;
      camera = viewCamera;
      film = viewFilm;
      if (film) pass.fit([target]);
      return () => { viewCamera.layerMask = layers; camera = film = null; };
    },
    // Whether the pass drawing now draws `viewCamera`'s overlays.
    drawsOverlays: (viewCamera) => engine.currentRenderPassId === (film && viewCamera === camera ? target.renderPassId : viewCamera.renderPassId),
    dispose() {
      scene.onAfterDrawPhaseObservable.remove(drawOverlays);
      scene.onAfterCameraRenderObservable.remove(mergeOverlays);
      target.dispose();
      pass.dispose();
    },
  };
}
