// Render Image and Render Animation in the live scene, as Blender renders from its own Main: the viewport's world
// draws its frames on the engine's canvas at the output size, through the scene camera in Rendered shading and with
// render visibility, on the virtual clock, while the views and the render loop wait and the gizmos and overlays draw
// nothing (Blender locks its interface the same way). What a render changes is put back when it is disposed.
//   world(): the built world; engine; views(): the 3D Viewports' views (editors/space_view3d/views.js); overlays (viewport-ui.js);
//   gizmos(on): whether the editor's gizmos draw; loop(): the render loop's function; restored(): the views' shading, applied again
import { installVirtualClock } from './clock.js';
import { createFrameRenderer } from './frames.js';

export function createLiveRender({ world: built, engine, views: viewsOf, overlays, gizmos, loop, restored }) {
  return async function open(size) {
    const { world, scene, animation } = built(), views = viewsOf();
    const kept = { frame: animation.time.state.frameCurrent, camera: scene.activeCamera };
    engine.stopRenderLoop(loop());
    views.hold(true);
    gizmos(false);
    overlays.setEnabled(false, { overlays: false });
    world.collections.useRenderVisibility(true);
    const clock = installVirtualClock(window, { frames: false });
    const resize = (width, height) => { if (engine.getRenderWidth() !== width || engine.getRenderHeight() !== height) engine.setSize(width, height); };
    const frames = createFrameRenderer({ world: built, engine: () => engine, canvas: engine.getRenderingCanvas(), resize, clock });
    const restore = () => {
      clock.uninstall();
      world.collections.useRenderVisibility(false);
      animation.time.configure({ frameCurrent: kept.frame }, { record: false });
      scene.activeCamera = kept.camera;
      gizmos(true);
      views.hold(false);
      restored();
      engine.runRenderLoop(loop());
    };
    try {
      resize(size.width, size.height);
      const camera = await frames.useCamera();
      world.workbench.setShading(camera, null);
      // A file's compositor composites final frames on the CPU (frames.js), its views on the GPU.
      world.beforeViewRender({ rendered: true, compositor: world.compositor.finalOnGPU });
      return { label: 'Camera ' + camera.name, warnings: [], dispose: restore,
        renderFrame: (frame, progress) => frames.renderFrame({ frame, ...size, quality: 'final', progress }) };
    } catch (error) {
      restore();
      throw error;
    }
  };
}
