// override(babylon): a render-once shadow map skips casters whose shadow shader is still compiling and is not drawn again
// (ShadowGenerator's customIsReadyFunction passes them while it draws); can go when Babylon redraws such a map itself.

// Draws `generator`'s map again until every caster was in it; a caster whose shader failed (a compile error, rejected by
// WebGPU) counts as drawn.
export function drawAgainUntilComplete(generator) {
  const map = generator.getShadowMap(), engine = map.getScene().getEngine();
  const failed = (effect) => !!effect?.getCompilationError?.();
  const failedIn = (subMesh) => failed(subMesh.effect) ||
    failed(subMesh.getMaterial()?.shadowDepthWrapper?._subMeshToDepthWrapper.get(subMesh, generator)?.mainDrawWrapper.effect) ||
    map.renderPassIds.some((pass) => failed(subMesh._getDrawWrapper(pass)?.effect));
  // Checked in each of the map's render passes, as Babylon checks while it draws them: elsewhere the check writes the
  // shadow effect into the mesh's draw wrapper of that pass.
  const readyIn = (pass, mesh) => {
    const current = engine.currentRenderPassId;
    engine.currentRenderPassId = pass;
    try { return map.customIsReadyFunction(mesh, map.refreshRate, true); } finally { engine.currentRenderPassId = current; }
  };
  const pending = (mesh) => !map.renderPassIds.every((pass) => readyIn(pass, mesh)) && !mesh.subMeshes.some(failedIn);
  map.onAfterRenderObservable.add(() => { if (map.renderList?.some(pending)) map.resetRefreshCounter(); });
}
