// override(babylon): EffectRenderer.applyEffectWrapper turns the depth test off and leaves it so (only render() restores
// it); can go when applyEffectWrapper restores what it changes. A shadow map drawn after, before a post-process turns the
// depth test on again, keeps only its last caster.

// Runs `draw` (applyEffectWrapper and draw calls on `renderer`) with the engine's depth and stencil states kept.
export function withRendererStates(renderer, draw) {
  renderer.saveStates();
  try { draw(); } finally { renderer.restoreStates(); }
}
