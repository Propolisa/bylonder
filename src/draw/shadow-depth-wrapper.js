// A material's shadow drawn with its own shader (Babylon's ShadowDepthWrapper), compiled once per shader it draws with.
// Babylon gives each submesh's depth program a token of its own, so submeshes sharing a material each compiled the same
// program (gaku: hundreds, half a minute after a sun appears). Here the token is the material's shader's: submeshes
// that draw with one shader and one set of depth defines share one depth program (Babylon's effect cache counts its
// users).
import { DrawWrapper, ShadowDepthWrapper } from '@babylonjs/core';

export class SharedShadowDepthWrapper extends ShadowDepthWrapper {
  _makeEffect(subMesh, defines, shadowGenerator, passIdForDrawWrapper) {
    const drawn = this._subMeshToEffect.get(subMesh);
    if (drawn && !this._subMeshToDepthWrapper.get(subMesh, shadowGenerator)) {
      const [effect, renderPassId] = drawn, mainDrawWrapper = new DrawWrapper(this._scene.getEngine());
      mainDrawWrapper.defines = subMesh._getDrawWrapper(renderPassId)?.defines ?? null;
      const params = { drawWrapper: [], mainDrawWrapper, depthDefines: '', token: `blenderDepth${effect.uniqueId}` };
      params.drawWrapper[passIdForDrawWrapper] = mainDrawWrapper;
      this._subMeshToDepthWrapper.set(subMesh, shadowGenerator, params);
    }
    const effect = super._makeEffect(subMesh, defines, shadowGenerator, passIdForDrawWrapper);
    // Its material's defines, which binding it reads, as soon as the material has them: a depth program made while the
    // material compiled in a pass without them (a sun added at the switch) would bind with none and throw.
    const params = this._subMeshToDepthWrapper.get(subMesh, shadowGenerator);
    if (params && !params.mainDrawWrapper.defines) {
      const materialDefines = subMesh._getDrawWrapper(drawn?.[1])?.defines ?? subMesh.materialDefines;
      if (materialDefines) for (const wrapper of [params.mainDrawWrapper, ...params.drawWrapper]) if (wrapper) wrapper.defines = materialDefines;
    }
    return effect;
  }

  // A node material binds nothing while it builds (its blocks are the next build's): its casters wait, as its surface
  // does (NodeMaterial.isReadyForSubMesh).
  isReadyForSubMesh(...args) {
    return this.baseMaterial._buildWasSuccessful !== false && super.isReadyForSubMesh(...args);
  }
}
