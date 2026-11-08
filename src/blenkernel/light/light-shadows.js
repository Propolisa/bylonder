// Shadows of Blender's lights as Babylon's shadow generators: a light whose Cast Shadow (use_shadow) is on has one, a
// sun's cascaded as EEVEE's sun shadow is (directional clipmaps), and every object whose Visibility > Shadow is on casts
// into it. Materials receive them through Babylon's own light code. Shadow maps are drawn for the views that show the
// scene's lights (Rendered shading, Render Image); other views draw them empty, which changes no material.
import { CascadedShadowGenerator, Matrix, RenderTargetTexture, ShaderStore, ShadowGenerator, Texture, Vector3 } from '@babylonjs/core';
import { shadowMapVertexShader } from '@babylonjs/core/Shaders/shadowMap.vertex.js';
import { shadowMapPixelShader } from '@babylonjs/core/Shaders/shadowMap.fragment.js';
import { influenceRadius, isBlenderLight, lightRecord } from './light-home.js';
import { areaLightShadows } from './area-light.js';
import { filmSample } from '../../render/film.js';
import { halton } from '../../render/sampling.js';
import { evaluatedMatrix, setEvaluatedMatrix } from '../../runtime/object-transform.js';
import { setRenderList } from '../../draw/render-list.js';

const MAP_SIZE = 2048;
const CASTS = ['SUN', 'SPOT', 'POINT'];
// How far, in meters, a caster's depth is pushed back from the light: below a brick's bump, past a cube map texel.
const DEPTH_BIAS = 0.005;

// blender-port: eevee_light.cc Light::shape_parameters_set: a local light's shadow spans its influence, its near clip
// 1/4000 of that.
export function shadowRange(record) {
  const far = influenceRadius(record).max;
  return { near: far / 4000, far };
}

// A light's offset within its radius for a film's sample: none for the first (what a moving view shows, one stable
// shadow), then points alternately on its sphere and within it, whose views from any side together spread evenly over
// the disk the sphere shows, so the samples average the soft shadow of EEVEE's sphere light.
export function shadowJitter(index, radius) {
  if (!index || !(radius > 0)) return null;
  const z = 2 * halton(index, 5) - 1, phi = 2 * Math.PI * halton(index, 7), s = Math.sqrt(1 - z * z);
  const r = radius * (index % 2 ? 1 : Math.cbrt(halton(index, 11)));
  return new Vector3(r * s * Math.cos(phi), r * s * Math.sin(phi), r * z);
}

// A mesh of the scene's objects (not an overlay or a helper), and whether it casts.
export const shadedObject = (mesh) => !mesh.name.startsWith('__') && !mesh.metadata?.overlay && mesh.getTotalVertices() > 0;
// A material without a surface (a Volume alone) casts no surface shadow.
const casts = (mesh) => shadedObject(mesh) && mesh.metadata?.wbVisibleShadow !== false && mesh.isEnabled() && mesh.isVisible && !mesh.material?.blenderNoSurface;

// Babylon's normal bias moves every caster along -N, so a face turned away from the light moves toward it and shadows
// itself, though EEVEE lights it from behind (its offset is the receiver's, along the normal facing the viewer). Babylon's
// include remapping, #include<name>(from,to), moves such a face away from the light instead, by less the more it is
// edge-on to the light so that a closed object's shadow keeps its outline.
const LIT_SIDE_NORMAL_BIAS = ['sinNLSM;worldPos', '(0.0<ndlSM?sinNLSM:ndlSM);worldPos'];
const SHADOW_MAP = 'blenderShadowMap';
ShaderStore.ShadersStore[`${SHADOW_MAP}VertexShader`] ??= shadowMapVertexShader.shader.replace('#include<shadowMapVertexNormalBias>', `#include<shadowMapVertexNormalBias>(${LIT_SIDE_NORMAL_BIAS})`);
ShaderStore.ShadersStore[`${SHADOW_MAP}PixelShader`] ??= shadowMapPixelShader.shader;

function createGenerator(light, type) {
  // A sun's map spans the view's frustum in cascades, fine near the eye, as EEVEE's clipmaps are: one map over the
  // whole scene's bounds is too coarse for what a large scene (a sky dome, a ground plane) holds.
  const generator = type === 'SUN' && CascadedShadowGenerator.IsSupported ? Object.assign(new CascadedShadowGenerator(MAP_SIZE, light), { numCascades: 4, lambda: 0.9, cascadeBlendPercentage: 0.05 })
    : new ShadowGenerator(MAP_SIZE, light);
  // EEVEE filters its shadows by a pixel or two (shadow_filter_radius); a cube map (a point or area light's) takes
  // Poisson sampling.
  // A cube map's depths are compared point by point, as EEVEE's shadow maps are: Babylon samples it bilinearly, which
  // blends a hashed (Dithered) caster's depths with what lies behind and shadows as if it were nearly opaque.
  if (light.needCube()) {
    generator.usePoissonSampling = true;
    generator.getShadowMap().updateSamplingMode(Texture.NEAREST_SAMPLINGMODE);
  }
  else Object.assign(generator, { usePercentageCloserFiltering: true, filteringQuality: ShadowGenerator.QUALITY_HIGH });
  Object.assign(generator, { bias: 0.002, normalBias: 0.02, customShaderOptions: { shaderName: SHADOW_MAP } });
  return generator;
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
    const offset = shadowJitter(filmSample(scene), lightRecord(light).shadow_soft_size);
    if (!offset || moved.has(light)) return;
    const matrix = evaluatedMatrix(light);
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

// What a point, spot or area light's map shows, which no camera changes: the light where it draws (a film sample's
// jitter included), its casters and where they are. A caster that deforms on its own (bones, shape keys) changes always.
const ids = new WeakMap();
let nextId = 0;
const idOf = (object) => (object ? ids.get(object) ?? ids.set(object, ++nextId).get(object) : 0);
function shadowState(light, casters, sample) {
  const parts = [evaluatedMatrix(light)?.m.join() ?? light.position.asArray().join(), light.direction?.asArray().join(), light.shadowMinZ, light.shadowMaxZ, sample];
  for (const mesh of casters) {
    if (mesh.skeleton || mesh.morphTargetManager || mesh.bakedVertexAnimationManager) return ++nextId;
    parts.push(mesh.uniqueId, mesh.getWorldMatrix().updateFlag, idOf(mesh.getVertexBuffer('position')), mesh.thinInstanceCount, mesh.metadata?.instancesVersion);
  }
  return parts.join();
}

export function createLightShadows(scene) {
  const generators = new Map(); // light -> { generator, type }
  const jitter = jitterPerSample(scene);
  let counted = '', drawn = false, evaluated = 0;
  // Every light lights every material, as in Blender (Babylon's materials take 4 unless told more), up to what a vertex
  // shader holds: a uniform block per light besides the scene's, mesh's and material's (and one spare).
  const gl = scene.getEngine()._gl, blocks = gl?.getParameter?.(gl.MAX_VERTEX_UNIFORM_BLOCKS) ?? 12;
  const lightAll = () => {
    const count = Math.min(scene.lights.length, blocks - 4), key = `${count}:${scene.materials.length}`;
    if (key === counted) return;
    counted = key;
    for (const material of scene.materials) if (material.maxSimultaneousLights < count) material.maxSimultaneousLights = count;
  };
  const casting = (record) => record?.use_shadow && (CASTS.includes(record.type) || (record.type === 'AREA' && areaLightShadows.enabled(scene)));
  const sync = () => {
    lightAll();
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
  // After the film chose its sample (onBeforeCameraRender), before the camera draws its render targets.
  const refresh = scene.onBeforeActiveMeshesEvaluationObservable.add(() => {
    if (!drawn) return;
    for (const [light, entry] of generators) {
      if (entry.type === 'SUN') continue;
      const map = entry.generator.getShadowMap(), state = `${evaluated}:${shadowState(light, map.renderList, filmSample(scene))}`;
      if (state !== entry.state) { entry.state = state; map.resetRefreshCounter(); }
    }
  });
  return {
    // Per view, before it renders: whether it shows the scene's lights.
    // Views that show no lights draw the maps empty, once (Babylon's render-once refresh rate): nothing reads them there.
    // A sun's cascades follow the view, drawn every frame; other lights' maps only when what they show changed.
    setActive(value) {
      drawn = value;
      sync();
      const casters = value ? scene.meshes.filter(casts) : [];
      for (const { generator, type } of generators.values()) {
        const map = generator.getShadowMap(), rate = value && type === 'SUN' ? 1 : RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
        if (setRenderList(map, casters)) map.resetRefreshCounter();
        if (map.refreshRate !== rate) map.refreshRate = rate;
      }
    },
    // Main evaluated something (main-view.js): what the maps show may have changed in ways no state here sees.
    changed() { evaluated++; },
    get generators() { return [...generators.values()].map((entry) => entry.generator); },
    dispose() { scene.onBeforeActiveMeshesEvaluationObservable.remove(refresh); for (const { generator } of generators.values()) generator.dispose(); generators.clear(); jitter.dispose(); },
  };
}
