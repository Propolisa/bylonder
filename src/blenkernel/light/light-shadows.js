// Shadows of Blender's lights as Babylon's shadow generators: a light whose Cast Shadow (use_shadow) is on has one, a
// sun's cascaded as EEVEE's sun shadow is (directional clipmaps), and every object whose Visibility > Shadow is on casts
// into it. Materials receive them through Babylon's own light code. Shadow maps are drawn for the views that show the
// scene's lights (Rendered shading, Render Image); other views draw them empty, which changes no material.
import { CascadedShadowGenerator, Constants, LinesMesh, Matrix, RenderTargetTexture, ShadowGenerator, Texture, Vector3 } from '@babylonjs/core';
import { drawAgainUntilComplete } from '../../overrides/babylon/shadow-map-complete.js';
import { influenceRadius, isBlenderLight, lightRecord } from './light-home.js';
import { areaLightShadows } from './area-light.js';
import './clustered-lights.js';
import { createLightReach, lightsMeshes } from '../../overrides/babylon/light-reach.js';
import { filmSample } from '../../render/film.js';
import { halton } from '../../render/sampling.js';
import { BLENDER_FORWARD, evaluatedMatrix, setEvaluatedMatrix } from '../../runtime/object-transform.js';
import { setRenderList } from '../../overrides/babylon/render-list.js';
import { BIAS_PER_METER, SHADOW_MAP } from '../../overrides/babylon/lit-side-normal-bias.js';

const MAP_SIZE = 2048;
// A soft sun's filter samples by the scene's shadow Rays: 1, 2, 3 or more.
const SUN_QUALITY = [ShadowGenerator.QUALITY_LOW, ShadowGenerator.QUALITY_MEDIUM, ShadowGenerator.QUALITY_HIGH];
const CASTS = ['SUN', 'SPOT', 'POINT'];
// How far, in meters, a caster's depth is pushed back from the light: below a brick's bump, past a cube map texel.
const DEPTH_BIAS = 0.005;
// How far, per meter from a point or spot light, a caster moves along its normal: a few texels of its map there, as EEVEE
// offsets by a share of a texel, so that a caster beside the light (a lamp's housing) stays where it is.
const NORMAL_BIAS_PER_METER = 4 * (2 / MAP_SIZE);

// blender-port: eevee_light.cc Light::shape_parameters_set: a local light's shadow spans its influence, its near clip
// 1/4000 of that.
export function shadowRange(record) {
  const far = influenceRadius(record).max;
  return { near: far / 4000, far };
}

// A light's offset within its radius for a film's sample: none for the first (what a moving view shows, one stable
// shadow), then points alternately on its sphere and within it, whose views from any side together spread evenly over
// the disk the sphere shows, so the samples average the soft shadow of EEVEE's sphere light. A spot's (axis: the way it
// shines) lie on the disk facing its cone: EEVEE draws the map from the light's center and traces toward that disk, so
// what lies behind the light (a lamp's housing) casts no shadow.
export function shadowJitter(index, radius, axis = null) {
  if (!index || !(radius > 0)) return null;
  const phi = 2 * Math.PI * halton(index, 7);
  if (axis) {
    const r = radius * Math.sqrt(halton(index, 5)), side = Vector3.Cross(axis, Math.abs(axis.x) < 0.9 ? Vector3.Right() : Vector3.Up()).normalize();
    const up = Vector3.Cross(axis, side).normalize();
    return side.scale(r * Math.cos(phi)).addInPlace(up.scale(r * Math.sin(phi)));
  }
  const z = 2 * halton(index, 5) - 1, s = Math.sqrt(1 - z * z);
  const r = radius * (index % 2 ? 1 : Math.cbrt(halton(index, 11)));
  return new Vector3(r * s * Math.cos(phi), r * s * Math.sin(phi), r * z);
}

// A mesh of the scene's objects (not an overlay or a helper), and whether it casts.
// The view's own meshes ("__") are not, but for the thin instances it draws objects' instances as (main-view.js
// drawInstances), which cast and receive shadows as the objects would.
const drawnInstances = (mesh) => !!mesh.metadata?.instancers && !!mesh.metadata.workbench;
export const shadedObject = (mesh) => (!mesh.name.startsWith('__') || drawnInstances(mesh)) && !mesh.metadata?.overlay && mesh.getTotalVertices() > 0;
// A material without a surface (a Volume alone) casts no surface shadow; a light that lights no mesh draws no shadow.
// Lines (loose edges) have no surface to cast with.
const casts = (mesh) => shadedObject(mesh) && !(mesh instanceof LinesMesh) && mesh.metadata?.wbVisibleShadow !== false && mesh.isEnabled() && mesh.isVisible && !mesh.material?.blenderNoSurface;

// A sun whose map spans its casters, not the view (light.metadata.shadowFitsCasters: Material Preview's studio sun), so
// that moving the view draws no map: one map, as large as the cascades together.
const fitsCasters = (light) => !!light.metadata?.shadowFitsCasters;
const FITTED_MAP_SIZE = 4096;

function createGenerator(light, type) {
  // A sun's map spans the view's frustum in cascades, fine near the eye, as EEVEE's clipmaps are: one map over the
  // whole scene's bounds is too coarse for what a large scene (a sky dome, a ground plane) holds.
  const cascaded = type === 'SUN' && !fitsCasters(light) && CascadedShadowGenerator.IsSupported;
  if (type === 'SUN' && !cascaded) Object.assign(light, { autoUpdateExtends: true, autoCalcShadowZBounds: true });
  const generator = cascaded ? Object.assign(new CascadedShadowGenerator(MAP_SIZE, light), { numCascades: 4, lambda: 0.9, cascadeBlendPercentage: 0.05 })
    : new ShadowGenerator(type === 'SUN' ? FITTED_MAP_SIZE : MAP_SIZE, light);
  // EEVEE filters its shadows by a pixel or two (shadow_filter_radius); a cube map (a point or area light's) takes
  // Poisson sampling.
  // A cube map's depths are compared point by point, as EEVEE's shadow maps are: Babylon samples it bilinearly, which
  // blends a hashed (Dithered) caster's depths with what lies behind and shadows as if it were nearly opaque.
  if (light.needCube()) {
    generator.usePoissonSampling = true;
    generator.getShadowMap().updateSamplingMode(Texture.NEAREST_SAMPLINGMODE);
  }
  else if (type === 'SUN') softSun(light, generator);
  else Object.assign(generator, { usePercentageCloserFiltering: true, filteringQuality: ShadowGenerator.QUALITY_HIGH });
  // An area light's shadow, drawn from its center without its shape's softness, keeps a fixed normal bias.
  const perMeter = type === 'POINT' || type === 'SPOT';
  Object.assign(generator, { bias: 0.002, normalBias: perMeter ? NORMAL_BIAS_PER_METER : 0.02, customShaderOptions: { shaderName: SHADOW_MAP, defines: perMeter ? [BIAS_PER_METER] : [] } });
  drawAgainUntilComplete(generator);
  return generator;
}

// EEVEE's sun casts the soft shadow of its disk (Angle): Babylon's contact hardening filter (PCSS), whose penumbra widens
// by the sun's radius (light.radius, at unit distance) per meter from the caster. Babylon measures it in the first
// cascade's (or the map's) texels per depth: refitted each time the map is drawn. Its samples follow the scene's shadow
// Rays (setActive).
function softSun(light, generator) {
  Object.assign(generator, { useContactHardeningShadow: true, penumbraDarkness: 0 });
  const halfZ = light.getScene().getEngine().isNDCHalfZRange ? 1 : 2;
  const extent = () => {
    if (generator instanceof CascadedShadowGenerator) {
      const m = generator.getCascadeProjectionMatrix(0).m;
      return { width: 2 / Math.abs(m[0]), depth: halfZ / Math.abs(m[10]) };
    }
    return { width: (light.orthoRight - light.orthoLeft) * (1 + 2 * light.shadowOrthoScale), depth: light.shadowMaxZ - light.shadowMinZ };
  };
  generator.getShadowMap().onAfterRenderObservable.add(() => {
    const { width, depth } = extent();
    if (width > 0 && depth > 0) generator.contactHardeningLightSizeUVRatio = (light.radius * depth) / width;
  });
}

// Babylon's depth of a local light's shadow spans the camera's clip range unless the light has its own, and its bias is
// a share of that range.
function fitRange(light, generator) {
  const { near, far } = shadowRange(lightRecord(light));
  Object.assign(light, { shadowMinZ: near, shadowMaxZ: far });
  generator.bias = DEPTH_BIAS / (near + far);
}

// Moves a point or spot light within its radius for the film's sample while its shadow map and the view draw, and back
// after: a Blender light's evaluated world matrix, another light's position.
function jitterPerSample(scene) {
  const moved = new Map(); // light -> what it was
  const before = (light) => {
    if (moved.has(light)) return;
    const matrix = evaluatedMatrix(light), record = lightRecord(light);
    const axis = record.type !== 'SPOT' ? null : matrix ? Vector3.TransformNormal(BLENDER_FORWARD, matrix).normalize() : light.direction;
    const offset = shadowJitter(filmSample(scene), record.shadow_soft_size, axis);
    if (!offset) return;
    if (matrix) {
      moved.set(light, () => setEvaluatedMatrix(light, matrix));
      setEvaluatedMatrix(light, matrix.clone().addTranslationFromFloats(offset.x, offset.y, offset.z));
    } else {
      const position = light.position.clone();
      moved.set(light, () => light.position.copyFrom(position));
      light.position.addInPlace(light.parent ? Vector3.TransformNormal(offset, Matrix.Invert(light.parent.getWorldMatrix())) : offset);
    }
  };
  const restore = () => {
    for (const back of moved.values()) back();
    moved.clear();
  };
  // After the camera's draw, or after the frame where a frame graph draws it (no camera observables fire then).
  const afterCamera = scene.onAfterCameraRenderObservable.add(restore), afterFrame = scene.getEngine().onEndFrameObservable.add(restore);
  return {
    add: (light, generator) => generator.getShadowMap().onBeforeBindObservable.add(() => before(light), undefined, true),
    dispose: () => { scene.onAfterCameraRenderObservable.remove(afterCamera); scene.getEngine().onEndFrameObservable.remove(afterFrame); },
  };
}

// What a light's map shows, which no camera changes: the light where it draws (a film sample's jitter included), its
// casters, where they are and how their bones and shape keys pose them; a baked vertex animation changes always.
const ids = new WeakMap();
let nextId = 0;
const idOf = (object) => (object ? ids.get(object) ?? ids.set(object, ++nextId).get(object) : 0);
// A skeleton's pose: its bones' world matrices' update flags, which Babylon raises whenever one changes.
const poseOf = (skeleton) => skeleton?.bones.reduce((sum, bone) => sum + bone.getWorldMatrix().updateFlag, 0);
function shadowState(light, casters, sample) {
  const parts = [evaluatedMatrix(light)?.m.join() ?? light.position.asArray().join(), light.direction?.asArray().join(), light.shadowMinZ, light.shadowMaxZ, sample];
  for (const mesh of casters) {
    if (mesh.bakedVertexAnimationManager) return ++nextId;
    parts.push(mesh.uniqueId, mesh.getWorldMatrix().updateFlag, idOf(mesh.getVertexBuffer('position')), mesh.thinInstanceCount, mesh.metadata?.instancesVersion,
      poseOf(mesh.skeleton), mesh.morphTargetManager?.influences.join(' '));
  }
  return parts.join();
}

// What a sun's cascades are fitted to: the camera's view, its film's jitter left out, and the casters' bounds.
function cascadeState(scene, generator) {
  const camera = scene.activeCamera, engine = scene.getEngine();
  if (!camera || !(generator instanceof CascadedShadowGenerator)) return '';
  const { fov, minZ, maxZ, mode, orthoLeft, orthoRight, orthoTop, orthoBottom, viewport } = camera, box = generator.shadowCastersBoundingInfo.boundingBox;
  return [camera.uniqueId, camera.getViewMatrix().m.join(), fov, minZ, maxZ, mode, orthoLeft, orthoRight, orthoTop, orthoBottom, viewport.width, viewport.height,
    engine.getRenderWidth(), engine.getRenderHeight(), box.minimumWorld.asArray().join(), box.maximumWorld.asArray().join()].join();
}

// warn(message): a Warning report, for a mesh more lights reach than its material takes (overrides/babylon/light-reach.js).
export function createLightShadows(scene, { warn } = {}) {
  const generators = new Map(); // light -> { generator, type }
  const jitter = jitterPerSample(scene);
  let drawn = false, evaluated = 0;
  // Every material takes as many lights as its shader holds, each mesh the Blender lights that reach it, the strongest
  // first, as EEVEE culls lights by their reach (overrides/babylon/light-reach.js, as exported pages do).
  const reach = createLightReach(scene, { owns: isBlenderLight, warn });
  const casting = (record) => record?.use_shadow && (CASTS.includes(record.type) || (record.type === 'AREA' && areaLightShadows.enabled(scene)));
  const sync = () => {
    reach.update();
    for (const [light, entry] of generators) {
      const record = lightRecord(light);
      if (light.isDisposed() || !casting(record) || record.type !== entry.type) { entry.generator.dispose(); generators.delete(light); }
    }
    for (const light of scene.lights) {
      const record = isBlenderLight(light) && lightRecord(light);
      if (!casting(record) || generators.has(light)) continue;
      const generator = createGenerator(light, record.type);
      generators.set(light, { generator, type: record.type });
      if (record.type === 'POINT' || record.type === 'SPOT') jitter.add(light, generator);
    }
    for (const [light, { generator, type }] of generators) if (type !== 'SUN') fitRange(light, generator);
    for (const mesh of scene.meshes) if (shadedObject(mesh)) mesh.receiveShadows = true;
  };
  // After the film chose its sample (onBeforeCameraRender), before the camera draws its render targets. A sun takes no
  // sample's offset; its cascades follow the camera's view, not the film's jitter.
  const refresh = scene.onBeforeActiveMeshesEvaluationObservable.add(() => {
    if (!drawn) return;
    for (const [light, entry] of generators) {
      const map = entry.generator.getShadowMap(), sun = entry.type === 'SUN';
      // A map without casters is drawn empty once.
      const state = !map.renderList?.length ? 'empty' : `${evaluated}:${cascadeState(scene, entry.generator)}:${shadowState(light, map.renderList, sun ? 0 : filmSample(scene))}`;
      if (state !== entry.state) { entry.state = state; map.resetRefreshCounter(); }
    }
  });
  return {
    // Per view, before it renders: whether it shows the scene's lights.
    // Views that show no lights draw the maps empty, once (Babylon's render-once refresh rate): nothing reads them there.
    // Maps draw only when what they show changed: a sun's cascades also when the view moved.
    setActive(value, rays = 1) {
      drawn = value;
      sync();
      let relit = false;
      const casters = value ? scene.meshes.filter(casts) : [];
      const quality = SUN_QUALITY[Math.min(rays, SUN_QUALITY.length) - 1] ?? SUN_QUALITY[0];
      for (const [light, { generator }] of generators) {
        if (generator.useContactHardeningShadow && generator.filteringQuality !== quality) generator.filteringQuality = quality;
        const map = generator.getShadowMap(), shows = value && lightsMeshes(light), rate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
        const had = !!map.renderList?.length;
        if (setRenderList(map, shows ? casters : [])) map.resetRefreshCounter();
        // Babylon's materials take a light's shadow only while its map holds a caster: they take it again when that changes.
        if (had !== !!map.renderList?.length) relit = true;
        if (map.refreshRate !== rate) map.refreshRate = rate;
      }
      if (relit) scene.markAllMaterialsAsDirty(Constants.MATERIAL_LightDirtyFlag);
    },
    // Main evaluated something (main-view.js): what the maps show may have changed in ways no state here sees.
    changed() { evaluated++; },
    get generators() { return [...generators.values()].map((entry) => entry.generator); },
    dispose() { scene.onBeforeActiveMeshesEvaluationObservable.remove(refresh); for (const { generator } of generators.values()) generator.dispose(); generators.clear(); jitter.dispose(); },
  };
}
