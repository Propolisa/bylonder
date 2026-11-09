// Babylon's WebGPU engine makes a draw's pipeline the first time it draws it, compiling it there and then, so an object
// first coming into view (an orbit) stalls the frame. Once the views settle with shaders new since the last time, one
// more frame draws every object with culling off, and the views settle once the GPU has compiled what it drew, so the
// pipelines exist before the objects show. Preferences > System > Bylonder > Prepare Shaders Ahead turns it off.
export function createPipelineWarmup(scene, enabled) {
  const engine = scene.getEngine();
  let warmed = -1, culled = null, compiling = false;
  // Whether the views draw one more frame, now that they would go idle.
  return function settle() {
    if (culled !== null) {
      scene.skipFrustumClipping = culled;
      culled = null;
      compiling = true;
      engine._device.queue.onSubmittedWorkDone().then(() => { compiling = false; });
    }
    if (compiling) return true;
    const shaders = Object.keys(engine._compiledEffects).length;
    if (!engine.isWebGPU || !enabled() || shaders === warmed) return false;
    warmed = shaders;
    culled = scene.skipFrustumClipping;
    scene.skipFrustumClipping = true;
    return true;
  };
}
