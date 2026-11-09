// EEVEE's volume light probes (eevee_lightprobe_volume.cc) in the views: each Irradiance Volume's baked cache, Blender's
// Object.lightprobe_cache (read and written through tools/blender-port/wasm/lightprobe-api.cc), loaded with the world's
// light into the irradiance atlas the materials sample for their diffuse light (volume-probe-atlas.js,
// volume-probe-shader.js, shader-nodes.js BlenderReflectionBlock); and their bake, Object > Light Probe > Bake Light
// Cache (object.lightprobe_cache_bake), which captures the scene at each grid sample on the GPU.
//
// EEVEE bakes with surfels (eevee_lightprobe_volume_bake.bsl.hh), compute shaders WebGL 2 lacks. The page integrates the
// same quantities another way: from each sample the scene is drawn into the six faces of a cube by the materials'
// capture variant (diffuse light alone, the bounce before from the grid itself, and in alpha the visibility of distant
// light that bounce carries), projected onto EEVEE's first-band harmonics, bounce after bounce.
import { BaseTexture, Color4, Constants, CubeMapToSphericalPolynomialTools, EffectRenderer, EffectWrapper, HDRFiltering, Matrix, RawTexture, RawTexture3D, ReflectionProbe, RenderTargetTexture, Texture, Vector3, Viewport } from '@babylonjs/core';
import { ToHalfFloat } from '@babylonjs/core/Misc/textureTools.js';
import { readCache, writeCache } from './light-probe-cache.js';
import { withRendererStates } from '../overrides/babylon/effect-renderer-states.js';
import { contextStruct, pointerOf } from '../python/bpy_rna.js';
import { registerOperator } from '../windowmanager/wm-operators.js';
import { report } from '../windowmanager/wm-reports.js';
import { shNew } from './spherical-harmonics.js';
import { buildAtlas, describeGrid, gridSamplePosition, GRID_TEXELS } from './volume-probe-atlas.js';

const C0 = 0.282094792, C1 = 0.488602512;

// Per scene: the atlas the views sample, and a capture in progress.
const states = new WeakMap();
const stateOf = (scene) => states.get(scene) ?? states.set(scene, { textures: null, capture: null, key: '', grids: [] }).get(scene);

// The capture being drawn when the engine draws into its target, else null.
export function probeCapture(scene) {
  const capture = states.get(scene)?.capture;
  return capture && capture.target.renderPassIds.includes(scene.getEngine().currentRenderPassId) ? capture : null;
}
// The textures materials sample: the capture's while one is drawn, else the scene's (null without volume probes).
export const volumeProbeTextures = (scene, capture = probeCapture(scene)) => (capture ? capture.textures : states.get(scene)?.textures ?? null);

// ---- The world's light in EEVEE's harmonics.

// The diffuse light Babylon's materials take from an environment `texture` toward a direction (Blender's axes), as its
// reflection block computes it (harmonicsFunctions computeEnvironmentIrradiance, times the IBL intensity).
function environmentIrradiance(scene, texture) {
  const harmonics = texture?.sphericalPolynomial?.preScaledHarmonics;
  if (!harmonics) return null;
  const matrix = texture.getReflectionTextureMatrix(), oppositeZ = scene.useRightHandedSystem ? !texture.invertZ : texture.invertZ;
  const intensity = scene.iblIntensity * texture.level, n = new Vector3();
  return ([bx, by, bz]) => {
    Vector3.TransformNormalFromFloatsToRef(bx, bz, by, matrix, n);
    n.normalize();
    if (oppositeZ) n.z *= -1;
    const { x: X, y: Y, z: Z } = n, h = harmonics;
    return ['x', 'y', 'z'].map((c) => intensity * (h.l00[c] + h.l1_1[c] * Y + h.l10[c] * Z + h.l11[c] * X + h.l2_2[c] * Y * X + h.l2_1[c] * Y * Z
      + h.l20[c] * (3 * Z * Z - 1) + h.l21[c] * Z * X + h.l22[c] * (X * X - Y * Y)));
  };
}
// An environment's first band as EEVEE holds a probe's (SphereProbeHarmonic, the radiance's coefficients) such that its
// Lambertian evaluation (evaluate_lambert) is Babylon's irradiance from it: the second band, even, cancels out of the
// six axes.
export function worldHarmonics(scene, texture = scene.environmentTexture) {
  const sh = shNew(), irradiance = environmentIrradiance(scene, texture);
  if (!irradiance) return sh;
  const [px, nx, py, ny, pz, nz] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(irradiance);
  for (let c = 0; c < 3; c++) {
    sh[c] = (px[c] + nx[c] + py[c] + ny[c] + pz[c] + nz[c]) / 6 / C0;
    sh[4 + c] = (-(py[c] - ny[c]) * 3) / (4 * C1);
    sh[8 + c] = ((pz[c] - nz[c]) * 3) / (4 * C1);
    sh[12 + c] = (-(px[c] - nx[c]) * 3) / (4 * C1);
  }
  return sh;
}
// A reflection probe's ambient light, EEVEE's low frequency light of it (extract_low_freq_lighting): the sum of its L0.
const ambients = new WeakMap();
export function probeAmbient(scene, texture) {
  const polynomial = texture?.sphericalPolynomial;
  if (!polynomial) return 1e-6;
  if (ambients.get(polynomial)?.level !== texture.level) {
    const sh = worldHarmonics(scene, texture);
    ambients.set(polynomial, { level: texture.level, ambient: sh[0] + sh[1] + sh[2] + 1e-6 });
  }
  return ambients.get(polynomial).ambient;
}

// The scene's volume probes' caches as the views load them, by object name (for the browser tests: tests/e2e/smoke.mjs).
export const volumeProbeCaches = (scene, name) => states.get(scene)?.grids.filter((grid) => !name || grid.name === name).map((grid) => grid.cache) ?? [];

// ---- The views' atlas.

// A volume probe's settings as the atlas loads them (eevee_lightprobe.cc sync_volume), from its LightProbe's RNA.
const SETTINGS = ['normal_bias', 'view_bias', 'facing_bias', 'validity_threshold', 'dilation_threshold', 'dilation_radius', 'intensity'];
const settingsOf = (data) => Object.fromEntries(SETTINGS.map((name) => [name, data[name]]));

function upload(scene, atlas, old) {
  const half = Uint16Array.from(atlas.data, ToHalfFloat);
  const texture = new RawTexture3D(half, atlas.width, atlas.height, atlas.depth, Constants.TEXTUREFORMAT_RGBA, scene, false, false,
    Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
  texture.wrapU = texture.wrapV = texture.wrapR = Texture.CLAMP_ADDRESSMODE;
  const grids = new RawTexture(atlas.gridTexels, GRID_TEXELS, atlas.count, Constants.TEXTUREFORMAT_RGBA, scene, false, false,
    Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
  Object.assign(texture, { name: '__volumeProbeAtlas' });
  Object.assign(grids, { name: '__volumeProbeGrids' });
  old?.atlas.dispose();
  old?.grids.dispose();
  return { atlas: texture, grids };
}

// The scene's volume probes from Main: `probes` lists { ob, matrix (matrix_world), data (its LightProbe's RNA) } of
// every Light Probe object drawn. The atlas is made again when a grid, its cache or the world's light changed.
export function syncVolumeProbes(scene, probes) {
  const state = stateOf(scene);
  state.probes = probes;
  syncSpheres(scene, probes);
  state.grids = probes.filter((probe) => probe.data.type === 'VOLUME').map(({ ob, matrix, data, name }) => ({ ob, name, matrix: Array.from(matrix), settings: settingsOf(data), cache: readCache(ob) }));
  watch(scene, probes.length > 0);
  refresh(scene);
}
// The world's light and the sphere probes followed before each frame, only while the scene has light probes (and not as
// a render observer, which main.js counts as a project's own and keeps the views drawing for).
function watch(scene, on) {
  const state = stateOf(scene);
  if (on && !state.watching) {
    state.watching = scene.onBeforeActiveMeshesEvaluationObservable.add(() => { refresh(scene); updateSpheres(scene); });
    state.disposing ??= scene.onDisposeObservable.addOnce(() => { state.textures?.atlas.dispose(); state.textures?.grids.dispose(); });
  }
  if (!on && state.watching) {
    scene.onBeforeActiveMeshesEvaluationObservable.remove(state.watching);
    state.watching = null;
  }
}
function refresh(scene) {
  const state = stateOf(scene), baked = state.grids.filter((grid) => grid.cache);
  const environment = scene.environmentTexture, polynomial = environment?.sphericalPolynomial;
  const key = JSON.stringify(baked.map(({ matrix, settings, cache }) => [matrix, settings, cache.key, cache.size]))
    + `|${environment?.uniqueId}|${scene.iblIntensity * (environment?.level ?? 1)}|${polynomial ? polynomialKey(polynomial) : ''}`;
  if (key === state.key) return;
  state.key = key;
  const had = !!state.textures;
  if (!baked.length) { state.textures?.atlas.dispose(); state.textures?.grids.dispose(); state.textures = null; }
  else {
    const atlas = buildAtlas(baked.map(({ matrix, settings, cache }) => ({ ...describeGrid({ matrix, size: cache.size, settings }), cache })), worldHarmonics(scene));
    state.textures = upload(scene, atlas, state.textures);
  }
  // Materials gain or lose the probes' code (BL_VOLUME_PROBES); the samplers' textures are bound per draw.
  if (had !== !!state.textures) scene.markAllMaterialsAsDirty(Constants.MATERIAL_TextureDirtyFlag);
}
const polynomials = new WeakMap();
let polynomialIds = 0;
const polynomialKey = (polynomial) => polynomials.get(polynomial) ?? polynomials.set(polynomial, ++polynomialIds).get(polynomial);

// ---- The bake.

// Babylon's axes (x, y, z) are Blender's (x, z, y).
const babylon = ([x, y, z]) => new Vector3(x, z, y);
// Texels a side of a sample's cube is drawn at, and the bounces of light each bake gathers (EEVEE's surfels propagate
// light until its samples run out; three bounces bring most of it).
export const FACE_SIZE = 32, BOUNCES = 3;
// Each sample gives five rows of the harmonics target: the four coefficients and the valid part. A last row marks which
// way the target reads back.
const ROWS = 5, HEIGHT = ROWS + 1, MARK = -12345;
// A capture's clear alpha: a direction that meets nothing, the sky.
const SKY = 2;

// blender-port: eevee_lightprobe_volume_bake.bsl.hh ray_capture, irradiance_capture, irradiance_capture_world,
// validity_capture_surfel and validity_capture_world: a sample's cube (drawn by Babylon's ReflectionProbe, read in its
// world directions as Babylon's materials read a reflection cube) projected on the harmonics, each texel of each side
// weighted by its solid angle, its direction turned into Blender's axes and then the grid's; row 4 the valid part.
const PROJECT = `precision highp float;
uniform samplerCube cube;
uniform mat3 worldToGrid;
uniform vec4 world0, world1, world2, world3;
uniform vec2 capture;
uniform float row;
const float SIZE = ${FACE_SIZE}.0;
vec3 sideDirection(int side, vec2 st) {
  if (side == 0) return vec3(1.0, st.y, st.x);
  if (side == 1) return vec3(-1.0, st.y, st.x);
  if (side == 2) return vec3(st.x, 1.0, st.y);
  if (side == 3) return vec3(st.x, -1.0, st.y);
  if (side == 4) return vec3(st.x, st.y, 1.0);
  return vec3(st.x, st.y, -1.0);
}
void main() {
  if (row > 4.5) { gl_FragColor = vec4(${MARK}.0); return; }
  int k = int(row);
  vec4 sum = vec4(0.0);
  for (int side = 0; side < 6; side++) for (int y = 0; y < ${FACE_SIZE}; y++) for (int x = 0; x < ${FACE_SIZE}; x++) {
    vec2 st = (vec2(x, y) + 0.5) / SIZE * 2.0 - 1.0;
    vec3 direction = sideDirection(side, st);
    float solidAngle = 4.0 / (SIZE * SIZE) / pow(dot(direction, direction), 1.5);
    direction = normalize(direction);
    vec4 texel = textureLod(cube, direction, 0.0);
    // Babylon's world axes as Blender's.
    vec3 L = direction.xzy;
    vec4 radiance;
    float valid = 1.0;
    if (texel.a >= ${SKY - 0.5}) {
      // capture.x: Capture World, the world's light (its first band) where the ray escapes; else its visibility.
      vec4 basis = vec4(0.282094792, -0.488602512 * L.y, 0.488602512 * L.z, -0.488602512 * L.x);
      vec3 world = max(vec3(0.0), basis.x * world0.rgb + basis.y * world1.rgb + basis.z * world2.rgb + basis.w * world3.rgb);
      float luma = max(1e-8, max(world.r, max(world.g, world.b)));
      world *= 1.0 - max(0.0, luma - capture.y) / luma;
      radiance = capture.x > 0.5 ? vec4(world, 0.0) : vec4(0.0, 0.0, 0.0, 1.0);
    } else {
      valid = texel.a >= 0.0 ? 1.0 : 0.0;
      radiance = vec4(texel.rgb, max(texel.a, 0.0));
    }
    vec3 lL = worldToGrid * L;
    vec4 coefficients = vec4(0.282094792, -0.488602512 * lL.y, 0.488602512 * lL.z, -0.488602512 * lL.x);
    sum += k == 4 ? vec4(valid * solidAngle) : coefficients[k] * radiance * solidAngle;
  }
  gl_FragColor = k == 4 ? sum / (4.0 * 3.14159265) : sum;
}`;

const VERTEX = `precision highp float;
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

// The meshes a capture draws: the scene's objects with Blender's materials, not the view's helpers or its world box.
const captured = (mesh) => mesh.material && !mesh.name.startsWith('__') && mesh.isEnabled() && mesh.isVisible && mesh.getTotalVertices() > 0;

const readyIn = (target, meshes) => {
  const engine = target.getScene().getEngine(), current = engine.currentRenderPassId;
  try {
    return target.renderPassIds.every((pass) => {
      engine.currentRenderPassId = pass;
      return meshes.every((mesh) => mesh.subMeshes?.every((subMesh) => mesh.material.isReadyForSubMesh(mesh, subMesh, false)) ?? true);
    });
  } finally { engine.currentRenderPassId = current; }
};
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

// A cube drawn at a point by Babylon's ReflectionProbe, in scene linear colors, between `near` and `far`, cleared to
// `clear`, with mip levels for filtering when `mipmaps`.
function captureCube(scene, size, near, far, meshes, { mipmaps = false, clear } = {}) {
  const probe = new ReflectionProbe('__lightProbeCapture', size, scene, mipmaps, true, true);
  const cube = probe.cubeTexture;
  Object.assign(cube, { gammaSpace: false, refreshRate: RenderTargetTexture.REFRESHRATE_RENDER_ONCE }, clear && { clearColor: clear });
  probe.renderList.push(...meshes);
  // Drawn only when asked (cube.render()), not by the scene's frames, which would draw it again with their own view.
  scene.reflectionProbes.splice(scene.reflectionProbes.indexOf(probe), 1);
  cube.onBeforeRenderObservable.add(() => {
    // The probe's own clip distances, which Babylon's probe takes from the active camera.
    scene.setTransformMatrix(scene.getViewMatrix(), Matrix.PerspectiveFovLH(Math.PI / 2, 1, near, far, scene.getEngine().isNDCHalfZRange));
    // The probe's eye in each side's scene uniforms, and every material bound again: Babylon's materials bind the eye
    // once a frame, so a second cube drawn in the same frame would shade from the first one's place.
    scene.finalizeSceneUbo();
    scene.resetCachedMaterial();
  });
  return probe;
}

// Draws `wrapper` into `width` texels of row `row` of `output` (a target HEIGHT texels high); bind(effect) sets its inputs.
export function drawRow(renderer, wrapper, output, column, row, width, bind) {
  const { engine } = renderer, count = output.getSize().width;
  withRendererStates(renderer, () => {
    engine.bindFramebuffer(output.renderTarget);
    renderer.setViewport(new Viewport(column / count, row / HEIGHT, width / count, 1 / HEIGHT));
    renderer.applyEffectWrapper(wrapper);
    bind(wrapper.effect);
    renderer.draw();
    engine.unBindFramebuffer(output.renderTarget);
  });
}

// Bakes a volume probe: `probe` { ob, matrix, data } as syncVolumeProbes takes it. `progress(fraction)` is told as it
// goes. Resolves once Blender's cache holds the result.
export async function bakeVolumeProbe(scene, { ob, matrix, data }, progress = () => {}) {
  const engine = scene.getEngine(), size = [data.resolution_x, data.resolution_y, data.resolution_z], count = size[0] * size[1] * size[2];
  const objectToWorld = describeGrid({ matrix: Array.from(matrix), size, settings: {} }).objectToWorld;
  const columns = [0, 1, 2].map((c) => Math.hypot(objectToWorld[0][c], objectToWorld[1][c], objectToWorld[2][c]) || 1);
  // The grid's rotation, transposed: world to grid. Rows of the transposed are the rotation's columns.
  const worldToGrid = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => objectToWorld[c][r] / columns[r]));
  const positions = [];
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) positions.push(gridSamplePosition(objectToWorld, size, [x, y, z]));
  const clampDirect = data.clamp_direct > 0 ? data.clamp_direct : 1e20, clampIndirect = data.clamp_indirect > 0 ? data.clamp_indirect : 1e20;
  const world = worldHarmonics(scene);

  const meshes = scene.meshes.filter(captured);
  const probe = captureCube(scene, FACE_SIZE, 0.01, data.capture_distance, meshes, { clear: new Color4(0, 0, 0, SKY) }), target = probe.cubeTexture;
  const output = new RenderTargetTexture('__volumeProbeHarmonics', { width: count, height: HEIGHT }, scene,
    { type: Constants.TEXTURETYPE_FLOAT, generateMipMaps: false, generateDepthBuffer: false, samplingMode: Texture.NEAREST_SAMPLINGMODE });
  const renderer = new EffectRenderer(engine);
  const project = new EffectWrapper({ engine, name: 'volumeProbeProject', vertexShader: VERTEX, fragmentShader: PROJECT,
    uniforms: ['worldToGrid', 'world0', 'world1', 'world2', 'world3', 'capture', 'row'], samplers: ['cube'] });
  const projectRow = (column, row, width = 1) => drawRow(renderer, project, output, column, row, width, (effect) => {
    effect.setTexture('cube', target);
    effect.setMatrix3x3('worldToGrid', Float32Array.from(worldToGrid));
    [0, 1, 2, 3].forEach((k) => effect.setFloat4(`world${k}`, world[k * 4], world[k * 4 + 1], world[k * 4 + 2], 0));
    effect.setFloat2('capture', data.capture_world ? 1 : 0, clampDirect);
    effect.setFloat('row', row);
  });
  // blender-port: eevee_surf_capture.bsl.hh: EEVEE makes surfels of both sides of every surface, a single sided one's back
  // dark and invalid; Babylon culls its back faces, so a capture draws them (the culling of Babylon's draw state, set
  // before each draw, its front face kept: Blender's meshes are mirrored into Babylon's axes).
  const unculled = meshes.map((mesh) => [mesh, mesh.onBeforeDrawObservable.add(() => { if (probeCapture(scene)) engine.depthCullingState.cull = false; })]);
  const state = stateOf(scene), cache = emptyCache(size);
  try {
    for (let bounce = 0; bounce < BOUNCES; bounce++) {
      const atlas = buildAtlas([{ ...describeGrid({ matrix: Array.from(matrix), size, settings: { intensity: 1 } }), cache }], captureWorld(world, data.capture_world), { compose: false });
      const textures = upload(scene, atlas, null);
      state.capture = { target, textures, clampDirect, clampIndirect, eye: probe.position };
      try {
        while (!project.isReady()) await frame();
        for (let i = 0; i < count; i++) {
          probe.position.copyFrom(babylon(positions[i]));
          // A render target skips a mesh whose capture variant is not ready (a material made dirty since, compiling).
          while (!readyIn(target, meshes)) await frame();
          target.render();
          for (let row = 0; row < ROWS; row++) projectRow(i, row);
          // One sample a frame: a second cube drawn in the same frame comes out seen from elsewhere (its surfaces face
          // away from the sample), the first after a frame is always right.
          progress((bounce + (i + 1) / count) / BOUNCES);
          await frame();
        }
        projectRow(0, ROWS, count);
        fillCache(cache, await output.readPixels(), count);
      } finally {
        state.capture = null;
        textures.atlas.dispose();
        textures.grids.dispose();
      }
    }
  } finally {
    for (const [mesh, observer] of unculled) mesh.onBeforeDrawObservable.remove(observer);
    project.dispose();
    renderer.dispose();
    output.dispose();
    probe.dispose();
  }
  // The materials' defines prepared again: a capture's (BL_PROBE_CAPTURE) must not stay with the views'.
  scene.markAllMaterialsAsDirty(Constants.MATERIAL_MiscDirtyFlag);
  writeCache(ob, cache);
  progress(1);
  return cache;
}

function emptyCache(size) {
  const n = size[0] * size[1] * size[2];
  return { size, irradiance: [0, 1, 2, 3].map(() => new Float32Array(n * 3)), visibility: [0, 1, 2, 3].map(() => new Float32Array(n)), validity: new Uint8Array(n) };
}
// Each sample's rows into the cache's harmonics (RGB light, A visibility) and validity, as
// IrradianceBake::read_result_packed packs them.
function fillCache(cache, pixels, count) {
  // The marked row first: read back top row first.
  const flipped = pixels[0] === MARK, at = (sample, row) => ((flipped ? HEIGHT - 1 - row : row) * count + sample) * 4;
  if (!flipped && pixels[at(0, HEIGHT - 1)] !== MARK) throw Error('Light probe capture read back unmarked');
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 4; k++) {
      cache.irradiance[k].set([0, 1, 2].map((c) => pixels[at(i, k) + c]), i * 3);
      cache.visibility[k][i] = pixels[at(i, k) + 3];
    }
    cache.validity[i] = Math.round(Math.min(Math.max(pixels[at(i, 4)], 0), 1) * 255);
  }
}
// The world brick of a capture's atlas, what surfaces outside the grid take for the bounce before: no light unless the
// probe captures the world, and no visibility of it (EEVEE's surfels there see what is around them, which the capture
// does not know; full visibility would leak the sky into closed rooms through their walls).
function captureWorld(world, captures) {
  const sh = captures ? Float32Array.from(world) : shNew();
  for (const k of [0, 1, 2, 3]) sh[k * 4 + 3] = 0;
  return sh;
}

// ---- Light Probe > Bake Light Cache and Delete Light Cache (render_shading.cc OBJECT_OT_lightprobe_cache_bake, _free).

// The volume probes of a subset (LIGHTCACHE_SUBSET_*), as lightprobe_cache_irradiance_volume_subset_get picks them.
function subsetOf(scene, subset) {
  const context = contextStruct(), volumes = (stateOf(scene).probes ?? []).filter((probe) => probe.data.type === 'VOLUME');
  if (subset === 'ACTIVE') { const active = context.view_layer?.objects?.active; return volumes.filter((probe) => active && pointerOf(active)[2] === probe.ob); }
  if (subset === 'SELECTED') { const selected = new Set([...(context.selected_objects ?? [])].map((ob) => pointerOf(ob)[2])); return volumes.filter((probe) => selected.has(probe.ob)); }
  return volumes;
}
// Caches read again after a bake or a delete, which the page made without an evaluation.
function reread(scene) {
  const state = stateOf(scene);
  for (const grid of state.grids) grid.cache = readCache(grid.ob);
  refresh(scene);
}

// `world.scene` is the scene whose probes bake; `onChanged` runs after a bake changed Main (an undo step).
let baking = null;
// Resolves once a bake started is done (main.js settled).
export const lightProbesSettled = () => baking ?? Promise.resolve();
export function registerLightProbeOperators(world, onChanged = () => {}) {
  // The views show their last image while captures draw (their frames would shade as captures), and start again on the
  // baked light.
  const holdViews = (on) => { world.views?.freeze(on); if (!on) world.renderSettings?.resetFilms?.(); };
  registerOperator('object.lightprobe_cache_bake', {
    poll: () => !baking && subsetOf(world.scene, 'ALL').length > 0,
    run: ({ subset = 'ALL' } = {}) => {
      const scene = world.scene, probes = subsetOf(scene, subset);
      if (!probes.length) return 'CANCELLED';
      baking = (async () => {
        holdViews(true);
        try {
          for (const [i, probe] of probes.entries()) {
            let shown = -1;
            await bakeVolumeProbe(scene, probe, (fraction) => {
              const percent = Math.floor(((i + fraction) / probes.length) * 100);
              if (percent >= shown + 10) { shown = percent; report('INFO', `Baking light cache: ${percent}%`); }
            });
          }
          reread(scene);
          onChanged();
          report('INFO', 'Light cache baked');
        } catch (error) {
          report('ERROR', `Light cache bake failed: ${error.message}`);
        } finally { holdViews(false); baking = null; }
      })();
      return 'FINISHED';
    },
  });
}

// ---- Sphere probes (eevee_lightprobe_sphere.cc): the scene drawn into a cube at each Sphere probe and filtered by
// roughness as the world's probe is (world-babylon.js), which surfaces in the probe's influence reflect, parallax
// corrected, as EEVEE's spherical_sample_normalized_with_parallax.

const SPHERE_SIZE = 256;
// blender-port: eevee_lightprobe.cc LightProbeModule::sync_sphere: the influence and parallax of a Sphere probe, its
// matrix scaled by its Distance; in Babylon's axes (a linear map of Blender's, so shapes and distances are kept).
function describeSphere({ ob, matrix, data }) {
  const scale = data.influence_distance, m = Matrix.FromArray(matrix);
  const toWorld = Matrix.Scaling(scale, scale, scale).multiply(m), swap = Matrix.FromValues(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  const babylonToWorld = swap.multiply(toWorld).multiply(swap), toProbe = babylonToWorld.clone().invert();
  const customParallax = data.use_custom_parallax;
  return {
    ob, data, key: JSON.stringify([Array.from(matrix), SPHERE_SETTINGS.map((name) => data[name])]),
    location: babylonToWorld.getTranslation(), toProbe, volume: Math.abs(babylonToWorld.determinant()),
    influenceBox: data.influence_type === 'BOX', influenceScale: 1 / Math.max(1e-8, data.falloff),
    parallaxBox: (customParallax ? data.parallax_type : data.influence_type) === 'BOX',
    parallaxDistance: (customParallax ? Math.max(data.parallax_distance, scale) : scale) / scale,
  };
}
const SPHERE_SETTINGS = ['influence_type', 'influence_distance', 'falloff', 'clip_start', 'clip_end', 'use_custom_parallax', 'parallax_type', 'parallax_distance'];

// blender-port: eevee_lightprobe_sphere.bsl.hh LightprobeSphereRenderData::select_probe: the first probe (smallest
// first) whose influence at P scores above the dither, here at a mesh's centre with the dither's mean, 0.5.
export function sphereProbeAt(scene, P) {
  for (const sphere of states.get(scene)?.spheres ?? []) {
    if (!sphere.texture.getInternalTexture()) continue;
    const local = Vector3.TransformCoordinates(P, sphere.toProbe);
    const gradient = sphere.influenceBox ? Math.max(Math.abs(local.x), Math.abs(local.y), Math.abs(local.z)) : local.length();
    if (Math.min(Math.max(sphere.influenceScale - gradient * sphere.influenceScale, 0), 1) > 0.5) return sphere;
  }
  return null;
}

// Draws a sphere probe's cube and filters it into its texture, as world-babylon.js worldNodesView bakes the world's.
async function captureSphere(scene, sphere) {
  const meshes = scene.meshes.filter((mesh) => captured(mesh) || mesh.name === '__worldNodes');
  // The probe's Clip Start and End.
  const probe = captureCube(scene, SPHERE_SIZE, sphere.data.clip_start, sphere.data.clip_end, meshes, { mipmaps: true }), cube = probe.cubeTexture;
  probe.position.copyFrom(sphere.location);
  try {
    while (!readyIn(cube, probe.renderList)) await frame();
    cube.render();
    const polynomial = await CubeMapToSphericalPolynomialTools.ConvertCubeMapTextureToSphericalPolynomial(cube);
    await new HDRFiltering(scene.getEngine()).prefilter(cube);
    const filtered = cube.getInternalTexture();
    filtered.incrementReferences();
    sphere.texture._texture?.dispose();
    Object.assign(sphere.texture, { _texture: filtered, lodGenerationScale: cube.lodGenerationScale, lodGenerationOffset: cube.lodGenerationOffset, _prefiltered: true });
    sphere.texture.sphericalPolynomial = polynomial;
    scene.markAllMaterialsAsDirty(Constants.MATERIAL_TextureDirtyFlag);
  } finally { probe.dispose(); }
}

// The scene's sphere probes from Main, drawn again when they or the scene changed (EEVEE updates them in the viewport
// as the scene changes), one at a time once the views have drawn.
function syncSpheres(scene, probes) {
  const state = stateOf(scene), old = new Map((state.spheres ?? []).map((sphere) => [sphere.ob, sphere]));
  state.spheres = probes.filter((probe) => probe.data.type === 'SPHERE').map((probe) => {
    const sphere = describeSphere(probe), previous = old.get(probe.ob);
    old.delete(probe.ob);
    sphere.texture = previous?.texture ?? Object.assign(new BaseTexture(scene), { name: '__sphereProbeTexture', isCube: true, gammaSpace: false, coordinatesMode: Texture.CUBIC_MODE });
    return sphere;
  }).sort((a, b) => a.volume - b.volume);
  for (const sphere of old.values()) sphere.texture.dispose();
  state.spheresDirty = true;
  if (old.size) scene.markAllMaterialsAsDirty(Constants.MATERIAL_TextureDirtyFlag);
}
async function updateSpheres(scene) {
  const state = stateOf(scene);
  // Babylon's prefiltering needs WebGL 2 or WebGPU (not a NullEngine's).
  const engine = scene.getEngine();
  if (!state.spheresDirty || state.capturingSpheres || !state.spheres?.length || !(engine.isWebGPU || engine.webGLVersion >= 2)) return;
  state.spheresDirty = false;
  state.capturingSpheres = true;
  try { for (const sphere of state.spheres) await captureSphere(scene, sphere); }
  finally { state.capturingSpheres = false; }
}
