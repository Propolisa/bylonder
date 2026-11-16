// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Cached static shadows, as game engines cache them (Unreal's cached shadow maps): the casters nothing moves are drawn
// into a cascaded sun's map once and kept in a copy; each frame the copy is put back into the map and only what moves
// is drawn over it. The copy is drawn again when a still caster changes (moves, shows or hides, takes another material)
// or the cascades do (the view or the sun moved). A caster that moves after all draws each frame from then on. The map
// holds exactly what drawing every caster gives. WebGL 2 only (a render pass cannot copy on WebGPU): elsewhere every
// caster draws, as without it.
import { CascadedShadowGenerator, RenderTargetTexture } from '@babylonjs/core';

/** Some casters of a list Babylon gives a shadow map's render function, the same shape. */
const part = () => ({ data: /** @type {any[]} */ ([]), length: 0 });
/** @param {{ data: any[], length: number }} from @param {(subMesh: any) => boolean} keep @param {{ data: any[], length: number }} into */
function take(from, keep, into) {
  into.length = 0;
  for (let i = 0; i < from.length; i++) if (keep(from.data[i])) into.data[into.length++] = from.data[i];
  return into;
}

/**
 * Caches the still casters of each cascaded shadow map of the scene's lights. Returns what turns it off.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {(node: any) => boolean} moves whether something moves a node itself (an animation, a constraint, a moving body)
 */
export function cacheStillShadows(scene, moves) {
  const engine = /** @type {any} */ (scene.getEngine()), gl = engine._gl;
  if (!gl || engine.isWebGPU || typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return () => {};
  const generators = /** @type {any[]} */ (scene.lights.map((light) => light.getShadowGenerator()).filter((g) => g instanceof CascadedShadowGenerator));
  // Babylon makes a generator's map again when its cascades change in number (cascades.js fits them): cached again then.
  const caches = new Map(generators.map((g) => [g, cache(scene, gl, g, moves)]));
  const remake = scene.onBeforeRenderObservable.add(() => {
    for (const [generator, current] of caches) if (generator.getShadowMap() !== current.map) { current.dispose(); caches.set(generator, cache(scene, gl, generator, moves)); }
  });
  return () => { scene.onBeforeRenderObservable.remove(remake); caches.forEach((current) => current.dispose()); };
}

/**
 * @param {import('@babylonjs/core').Scene} scene @param {WebGL2RenderingContext} gl @param {any} generator
 * @param {(node: any) => boolean} moves
 */
function cache(scene, gl, generator, moves) {
  const map = generator.getShadowMap(), layers = generator.numCascades, size = map.getRenderSize();
  // Made as Babylon makes the map (CascadedShadowGenerator._createTargetRenderTexture), so the two copy into each other.
  const copy = new RenderTargetTexture(`${map.name} (still casters)`, { width: size, height: size, layers }, scene, false, true, generator._textureType, false, undefined, false, false, undefined, generator._useRedTextureType ? 6 : 5);
  copy.createDepthStencilTexture(scene.getEngine().useReverseDepthBuffer ? 516 : 513, true, undefined, undefined, undefined, `${map.name} (still casters depth)`);
  const hardware = (/** @type {any} */ texture) => texture?._hardwareTexture?.underlyingResource;
  const stencil = !!map.renderTarget._depthStencilTextureWithStencil;
  const depthAttachment = stencil ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT, mask = gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | (stencil ? gl.STENCIL_BUFFER_BIT : 0);
  const framebuffers = Array.from({ length: layers }, (_, layer) => {
    const framebuffer = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer()), bound = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
    gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, hardware(copy.renderTarget?.texture), 0, layer);
    gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, depthAttachment, hardware(copy.renderTarget?._depthStencilTexture), 0, layer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, bound);
    return framebuffer;
  });
  // The map's layer as drawn so far, into the copy (`keep`), or the copy into it: whole layers, unscissored.
  const blit = (/** @type {number} */ layer, /** @type {boolean} */ keep) => {
    const live = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), scissor = gl.isEnabled(gl.SCISSOR_TEST);
    if (scissor) gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, keep ? live : framebuffers[layer]);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, keep ? framebuffers[layer] : live);
    gl.blitFramebuffer(0, 0, size, size, 0, 0, size, size, mask, gl.NEAREST);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, live);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    if (scissor) gl.enable(gl.SCISSOR_TEST);
  };

  // Which casters are still: none that something moves (by itself or a parent), is skinned or morphs, or has moved.
  const moved = new WeakSet(), stillness = new WeakMap();
  const still = (/** @type {any} */ mesh) => {
    if (moved.has(mesh)) return false;
    if (!stillness.has(mesh)) {
      let s = !mesh.skeleton && !mesh.morphTargetManager;
      for (let n = mesh; s && n; n = n.parent) if (moves(n) || n.getClassName?.() === 'Bone' || (n.physicsBody && n.physicsBody.getMotionType?.() !== 0)) s = false;
      stillness.set(mesh, s);
    }
    return stillness.get(mesh);
  };
  const stillSub = (/** @type {any} */ subMesh) => still(subMesh.getRenderingMesh());
  const movingSub = (/** @type {any} */ subMesh) => !still(subMesh.getRenderingMesh());

  // What the copy shows: each still caster's matrix flag, whether it shows, its material and instance counts, and each
  // cascade's matrix. Read once a frame, into one array; a change draws the copy again.
  /** @type {any[]} */ let casters = [];
  let state = new Float64Array(0), filled = false;
  const matrices = Array.from({ length: layers }, () => new Float32Array(16));
  const kept = new Array(layers).fill(false);
  const FIELDS = 5;
  const check = () => {
    const list = map.renderList ?? [];
    let same = list.length === casters.length;
    for (let i = 0; same && i < list.length; i++) same = list[i] === casters[i];
    if (!same) { casters = [...list]; state = new Float64Array(casters.length * FIELDS); filled = false; }
    let changed = !filled;
    for (let i = 0; i < casters.length; i++) {
      const mesh = casters[i];
      if (!still(mesh)) continue;
      const at = i * FIELDS, flag = mesh.getWorldMatrix().updateFlag;
      // A caster whose world matrix changed after it was kept moves: it draws each frame from then on.
      if (filled && flag !== state[at]) { moved.add(mesh); changed = true; continue; }
      const shown = mesh.isEnabled() && mesh.isVisible ? 1 : 0, material = mesh.material?.uniqueId ?? -1, thin = mesh.thinInstanceCount ?? 0, instances = mesh.instances?.length ?? 0;
      if (state[at + 1] !== shown || state[at + 2] !== material || state[at + 3] !== thin || state[at + 4] !== instances) changed = true;
      state[at] = flag; state[at + 1] = shown; state[at + 2] = material; state[at + 3] = thin; state[at + 4] = instances;
    }
    filled = true;
    if (changed) kept.fill(false);
  };
  const before = scene.onBeforeRenderObservable.add(check);

  // What the cascades are fitted from: the view, the sun and the generator's settings. Unchanged while every layer is
  // kept, the map's list holds only the moving casters as it draws, so Babylon prepares none of the still ones either.
  const light = generator.getLight(), view = new Float64Array(16), seen = new Float64Array(16);
  const cascadesFrom = () => {
    const camera = /** @type {any} */ (scene.activeCamera), d = light.direction, p = light.position;
    view.set([camera?.getViewMatrix().updateFlag ?? -1, camera?.getProjectionMatrix().updateFlag ?? -1, d.x, d.y, d.z, p.x, p.y, p.z, generator.lambda, generator.shadowMaxZ,
      generator.minDistance, generator.maxDistance, generator.cascadeBlendPercentage, generator.stabilizeCascades ? 1 : 0, generator.depthClamp ? 1 : 0, generator.numCascades]);
    let same = true;
    for (let i = 0; i < 16; i++) if (view[i] !== seen[i]) { same = false; seen[i] = view[i]; }
    return same;
  };
  const full = /** @type {any[]} */ ([]), moving = /** @type {any[]} */ ([]);
  let narrowed = false;
  const narrow = scene.onBeforeRenderTargetsRenderObservable.add(() => {
    const list = map.renderList;
    if (!cascadesFrom() || !list || kept.some((k) => !k)) return;
    full.length = moving.length = 0;
    for (const mesh of list) { full.push(mesh); if (!still(mesh)) moving.push(mesh); }
    list.splice(0, list.length, ...moving);
    narrowed = true;
  });
  const widen = scene.onAfterRenderTargetsRenderObservable.add(() => {
    if (!narrowed) return;
    map.renderList?.splice(0, map.renderList.length, ...full);
    narrowed = false;
  });

  const opaque = part(), alphaTest = part(), transparent = part(), depthOnly = part();
  const render = map.customRenderFunction;
  map.customRenderFunction = (/** @type {any[]} */ ...lists) => {
    const layer = generator._currentLayer, matrix = generator.getCascadeTransformMatrix(layer).m, was = matrices[layer];
    for (let i = 0; i < 16; i++) if (matrix[i] !== was[i]) { was.set(matrix); kept[layer] = false; break; }
    if (kept[layer]) blit(layer, false);
    else {
      const [o, a, t, d] = lists;
      render(take(o, stillSub, opaque), take(a, stillSub, alphaTest), take(t, stillSub, transparent), take(d, stillSub, depthOnly));
      blit(layer, true);
      // Kept once every still caster drew (a shader still compiling draws nothing yet).
      kept[layer] = [o, a, t, d].every((l, kind) => { for (let i = 0; i < l.length; i++) if (stillSub(l.data[i]) && !generator.isReady(l.data[i], l.data[i].getRenderingMesh().hasThinInstances, kind === 2)) return false; return true; });
    }
    const [o, a, t, d] = lists;
    render(take(o, movingSub, opaque), take(a, movingSub, alphaTest), take(t, movingSub, transparent), take(d, movingSub, depthOnly));
  };

  return {
    map,
    dispose() {
      map.customRenderFunction = render;
      scene.onBeforeRenderObservable.remove(before);
      scene.onBeforeRenderTargetsRenderObservable.remove(narrow);
      scene.onAfterRenderTargetsRenderObservable.remove(widen);
      framebuffers.forEach((framebuffer) => gl.deleteFramebuffer(framebuffer));
      copy.dispose();
    },
  };
}
