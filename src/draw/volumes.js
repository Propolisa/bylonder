// EEVEE's volumes (eevee_volume.cc VolumeModule, eevee_volume.bsl.hh) on Babylon, a render extension (Volumes): a
// material's Volume drawn into a froxel grid of the view (a fraction of its pixels across, the scene's Volumes samples
// deep), lit there, integrated toward the view and resolved over the scene's render, as EEVEE draws object volumes in
// Material Preview, Rendered and renders. Babylon's own mechanisms carry it: the camera's custom render targets (the
// froxel properties, a MultiRenderTarget of the domains' slabs, then the scatter and integration passes) and a
// post-process first in its chain (the resolve, in scene linear before the film). A scene without volumes draws
// none of it. The scene's Volumes settings (Properties > Render > Volumes) drive it.
import { CascadedShadowGenerator, Color4, Constants, EffectRenderer, EffectWrapper, Matrix, Mesh, MultiRenderTarget, PostProcess, ShaderStore, Vector3, VertexData } from '@babylonjs/core';
import { renderExtension } from './render-extension.js';
import { nodeMaterialFromTree, FROXEL_CLIP, FROXEL_CORNER, FROXEL_SLICE, ShaderNodeOutputVolume } from '../nodes/blender/shader-nodes.js';
import { influenceRadius, isBlenderLight, lightRecord } from '../blenkernel/light/light-home.js';
import { filmSample } from '../render/film.js';
import { halton } from '../render/sampling.js';
import { INTEGRATION, MAX_LIGHTS, RESOLVE, scatterShader, shadowSamplers, shadowUniforms } from './volume-shaders.js';

// blender-port: DNA_scene_defaults.h: the scene's default Volumes settings.
export const VOLUME_DEFAULTS = { start: 0.1, end: 100, tileSize: 8, samples: 64, distribution: 0.8, customRange: false, clampDirect: 0, clampIndirect: 0,
  shadows: false, shadowSteps: 16 };
const settings = new WeakMap();
export const volumeSettings = (scene) => settings.get(scene) ?? VOLUME_DEFAULTS;
// The scene's Volumes settings as its RNA reads them (scene.eevee).
export function readVolumeSettings(eevee) {
  const read = (name, fallback) => { try { return eevee?.[name] ?? fallback; } catch { return fallback; } };
  const d = VOLUME_DEFAULTS;
  return {
    start: Number(read('volumetric_start', d.start)), end: Number(read('volumetric_end', d.end)), tileSize: Number(read('volumetric_tile_size', d.tileSize)),
    samples: Number(read('volumetric_samples', d.samples)), distribution: Number(read('volumetric_sample_distribution', d.distribution)),
    customRange: !!read('use_volume_custom_range', d.customRange), clampDirect: Number(read('clamp_volume_direct', d.clampDirect)),
    clampIndirect: Number(read('clamp_volume_indirect', d.clampIndirect)), shadows: !!read('use_volumetric_shadows', d.shadows),
    shadowSteps: Number(read('volumetric_shadow_samples', d.shadowSteps)),
  };
}

export const volumes = renderExtension({
  id: 'bylonder_volumes', label: 'Volumes',
  description: 'Draw object volumes (a material\'s Volume) as EEVEE does, in a froxel grid lit by the scene\'s lights and world. Off, they are not drawn, as in plain Babylon',
  // The presets: the scene's own Volumes settings trade speed for detail, as in EEVEE.
  detail: 'Volumes > Resolution 1:16, Steps 32 for speed; 1:4, 128 for detail (1:8, 64 by default)',
  pull: (scene, struct) => settings.set(scene, readVolumeSettings(struct.eevee)),
});

// blender-port: eevee_volume.cc VolumeModule::init: the froxel grid of a view `width` by `height` pixels: its tile
// size doubled until the grid fits (here: its atlas fits `maxSize`), its slices the scene's samples, and the part of the
// grid the view covers (coord_scale). The atlas lays the slices side by side, `columns` across.
export function froxelGrid(width, height, { tileSize, samples }, maxSize = 16384) {
  const depth = Math.max(1, Math.round(samples)), columns = Math.ceil(Math.sqrt(depth)), rows = Math.ceil(depth / columns);
  let tile = Math.min(16, Math.max(1, Math.round(tileSize)));
  const size = (t) => [Math.ceil(width / t), Math.ceil(height / t)];
  while (tile < 16 && (size(tile)[0] * columns > maxSize || size(tile)[1] * rows > maxSize)) tile *= 2;
  const [w, h] = size(tile);
  return { tile, size: [w, h, depth], columns, rows, atlas: [w * columns, h * rows], coordScale: [width / (tile * w), height / (tile * h)] };
}

// blender-port: eevee_volume.cc VolumeModule::end_sync: the depths the grid spans (from the camera's clip range, or
// the scene's custom range, narrowed to the volumes' own `bounds` of view depth, nearest and farthest), and
// eevee_volume_lib.bsl.hh's distribution of its slices over them: exponential in perspective (the scene's
// Distribution), linear otherwise. Depths are Babylon's (positive ahead); the result is in Blender's view z.
export function depthParams({ start, end, distribution, customRange }, clipStart, clipEnd, perspective, bounds = null) {
  let integrationStart = customRange ? start : clipStart, integrationEnd = customRange ? end : clipEnd;
  if (bounds) {
    integrationStart = Math.max(integrationStart, bounds[0]);
    integrationEnd = Math.min(integrationEnd, bounds[1]);
  }
  const near = -Math.max(integrationStart, clipStart - 1e-4), far = -Math.min(integrationEnd, clipEnd + 1e-4);
  if (!perspective) return [near, far, 0];
  const d = 4 * Math.max(1 - distribution, 1e-2), depthNear = (far - near * 2 ** (1 / d)) / (far - near);
  return [depthNear, (1 - depthNear) / near, d];
}
// blender-port: eevee_volume_lib.bsl.hh volume_z_to_view_z, view_z_to_volume_z (as volume-shaders.js has them).
export const volumeZToViewZ = ([near, far, d], perspective, z) => (perspective ? (2 ** (z / d) - near) / far : near + (far - near) * z);
export const viewZToVolumeZ = ([near, far, d], perspective, viewZ) => (perspective ? d * Math.log2(Math.max(1e-8, viewZ * far + near)) : (viewZ - near) / (far - near));

// blender-port: eevee_light.cc Light::sync, point_radiance_get, shape_parameters_set: what a Blender light gives a
// volume: its color times its power and Volume factor as a point's radiant intensity (a sun's irradiance), its shape
// radius, the inverse square of its volume influence radius, and a spot's cone (spot_mul, spot_bias).
const POINT_RADIANCE = { POINT: 1 / (4 * Math.PI), SPOT: 1 / (4 * Math.PI), SUN: 1 };
export function volumeLight(record) {
  const factor = record.volume_factor ?? 1, energy = record.energy * 2 ** (record.exposure ?? 0);
  if (!factor || !energy) return null;
  let radiance = POINT_RADIANCE[record.type], radius = Math.max(0.001, record.shadow_soft_size ?? 0);
  if (record.type === 'AREA') {
    const sizeY = ['RECTANGLE', 'ELLIPSE'].includes(record.shape) ? record.size_y : record.size;
    const half = [Math.max(0.003, record.size / 2), Math.max(0.003, sizeY / 2)], area = half[0] * half[1] * 4;
    const tmp = (Math.PI / 2) / (Math.PI / 2 + Math.sqrt(area));
    radiance = (tmp + (1 - tmp) / Math.PI) / Math.PI;
    radius = Math.max(0.001, Math.hypot(...half) / 2);
  }
  const influence = record.type === 'SUN' ? 0 : influenceRadius(record).volume;
  const spotSize = Math.cos((record.spot_size ?? 0) / 2), spotMul = 1 / Math.max(1e-8, (1 - spotSize) * (record.spot_blend ?? 0));
  return {
    type: { POINT: 0, SPOT: 1, SUN: 2, AREA: 3 }[record.type], radius, color: record.color.slice(0, 3).map((c) => c * energy * factor * radiance),
    inverseSquareInfluence: influence > 0 ? 1 / influence ** 2 : 0, spot: record.type === 'SPOT' ? [spotMul, -spotSize * spotMul] : [0, 1],
  };
}

// A mesh drawn as a volume: its material's tree has a Volume. The world's box (world-babylon.js) is the world's
// volume, which fills the whole grid as EEVEE's world volume does.
export const isVolumeDomain = (mesh, camera) => !!mesh.material?.blenderVolume && mesh.isEnabled() && mesh.isVisible
  && (mesh.layerMask & camera.layerMask) !== 0 && mesh.getTotalVertices() > 0;

const isWorldVolume = (mesh) => !!mesh.material?.blenderWorld;

// A domain's bounds in its own space, from its vertices (its bounding info can lag behind geometry a view draws later),
// made again when its positions change.
const boundsOf = new WeakMap();
function localBounds(mesh) {
  const buffer = mesh.getVertexBuffer('position'), known = boundsOf.get(mesh);
  if (known?.buffer === buffer && known.version === buffer?._buffer?._version) return known.bounds;
  const positions = mesh.getVerticesData('position') ?? [], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
  const bounds = positions.length ? [min, max] : [[0, 0, 0], [0, 0, 0]];
  boundsOf.set(mesh, { buffer, version: buffer?._buffer?._version, bounds });
  return bounds;
}

const HALF = Constants.TEXTURETYPE_HALF_FLOAT, NEAREST = Constants.TEXTURE_NEAREST_SAMPLINGMODE;
const GRID_UNIFORMS = ['volumeSize', 'atlasColumns', 'depthParams', 'perspective', 'coordScale', 'inverseProjection'];
ShaderStore.ShadersStore.blenderVolumeResolveFragmentShader = RESOLVE;

// A domain's box corners in world space, from its vertices' bounds (localBounds).
const corners = (mesh) => {
  const [min, max] = localBounds(mesh), world = mesh.getWorldMatrix();
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => Vector3.TransformCoordinates(new Vector3(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]), world));
};

// The volumes of `camera`'s views, while it draws through `film` (render-babylon.js), whose samples start again once
// the volumes draw (their shaders compile after the film may have converged without them) and when they go.
export function cameraVolumes(scene, camera, film = null) {
  const engine = scene.getEngine(), renderer = new EffectRenderer(engine);
  const effect = (name, fragmentShader, uniforms, samplers) => new EffectWrapper({ engine, name, fragmentShader, useShaderStore: false, uniforms: [...GRID_UNIFORMS, ...uniforms], samplers });
  // The scatter pass of each layout of shadow maps the lights have.
  const scatters = new Map();
  const scatterOf = (shadows) => {
    const key = shadows.join();
    if (!scatters.has(key)) scatters.set(key, effect(`Volume scatter ${key}`, scatterShader(shadows), ['inverseView', 'cameraPosition', 'jitterOffset', 'lightCount', 'lightPosition',
      'lightAxis', 'lightColor', 'lightSpot', 'worldRadiance', 'volumeClamp', 'viewMatrix', 'projection', 'shadowSteps', 'shadowReach', 'ndcHalfZ',
      'historyOpacity', ...shadowUniforms(shadows)],
    ['scatteringProps', 'extinctionProps', 'emissionProps', 'phaseProps', 'scatteringHistory', 'extinctionHistory', ...shadowSamplers(shadows)]));
    return scatters.get(key);
  };
  const integration = effect('Volume integration', INTEGRATION, [], ['scatteringTexture', 'extinctionTexture']);
  // In 32-bit floats where the GPU renders, filters and blends them: thin fog's extinction over a slice loses its bits in halves.
  const caps = engine.getCaps(), type = caps.textureFloatRender && caps.textureFloatLinearFiltering && caps.blendFloat ? Constants.TEXTURETYPE_FLOAT : HALF;
  const targets = (name, count, size, sampling = NEAREST) => new MultiRenderTarget(name, { width: size[0], height: size[1] }, count, scene, {
    types: Array(count).fill(type), samplingModes: Array(count).fill(sampling), generateMipMaps: false, generateDepthBuffer: false, defaultType: type,
  });
  let props = null, integrated = null, current = null, resolve = null, grid = null, frame = null, drawing = false;
  const slabs = new Map(); // domain mesh -> { slab, source (the surface material), tree, material }

  // The froxel properties (the domains' slabs, their volume materials drawn additively), the scatter's and the
  // integration's, per atlas size: views of different sizes sharing the camera (a file's several 3D Views, camera
  // view beside a compositor backdrop) each keep their own, as each draws and resolves them within its own render.
  const sized = new Map();
  const ensureTargets = () => {
    const key = grid.atlas.join('x');
    if (!sized.has(key)) {
      // Linear, as the volume shadows sample its extinction.
      // The scatter's results alternate: one written, the other the last frame's, its history (linear, as reprojected).
      const entry = { props: targets('__volumeProperties', 4, grid.atlas, Constants.TEXTURE_BILINEAR_SAMPLINGMODE),
        results: [0, 1].map(() => targets('__volumeScatter', 2, grid.atlas, Constants.TEXTURE_BILINEAR_SAMPLINGMODE)),
        integrated: targets('__volumeIntegration', 2, grid.atlas, Constants.TEXTURE_BILINEAR_SAMPLINGMODE), history: null };
      entry.props.clearColor = new Color4(0, 0, 0, 0);
      entry.props.onAfterRenderObservable.add(lightAndIntegrate);
      sized.set(key, entry);
    }
    if (props && props !== sized.get(key).props) camera.customRenderTargets = camera.customRenderTargets.filter((t) => t !== props);
    current = sized.get(key);
    ({ props, integrated } = current);
  };

  const bindGrid = (fx) => {
    fx.setFloat3('volumeSize', ...grid.size);
    fx.setFloat('atlasColumns', grid.columns);
    fx.setFloat3('depthParams', ...frame.depth);
    fx.setFloat('perspective', frame.perspective ? 1 : 0);
    fx.setFloat2('coordScale', ...grid.coordScale);
    fx.setMatrix('inverseProjection', frame.inverseProjection);
  };
  const pass = (wrapper, target, bind) => {
    if (!wrapper.effect.isReady()) return false;
    renderer.saveStates();
    engine.bindFramebuffer(target.renderTarget);
    renderer.setViewport();
    renderer.applyEffectWrapper(wrapper);
    bindGrid(wrapper.effect);
    bind(wrapper.effect);
    renderer.draw();
    engine.unBindFramebuffer(target.renderTarget);
    renderer.restoreStates();
    return true;
  };
  // The scatter pass, then the integration, once the properties are drawn for the camera's render (other renders of
  // the camera's targets in the frame leave them be).
  function lightAndIntegrate() {
    if (!frame.pending) return;
    frame.pending = false;
    const { shadows } = frame.lights, { results, history } = current;
    const scattered = results[0], previous = results[1];
    // blender-port: eevee_volume.cc VolumeModule::draw_compute history_opacity: an exponential average over at most
    // 16 frames while the view and the volumes stay the same; none after they change. port-override: EEVEE reprojects
    // its history as the view moves; here a moving view starts again.
    const opacity = history && history.key === frame.key ? Math.min(history.frames, 15) / (Math.min(history.frames, 15) + 1) : 0;
    const lit = pass(scatterOf(shadows.map((shadow) => shadow.kind)), scattered, (fx) => {
      fx.setTexture('scatteringHistory', previous.textures[0]);
      fx.setTexture('extinctionHistory', previous.textures[1]);
      fx.setFloat('historyOpacity', opacity);
      ['scatteringProps', 'extinctionProps', 'emissionProps', 'phaseProps'].forEach((name, i) => fx.setTexture(name, props.textures[i]));
      fx.setMatrix('inverseView', frame.inverseView);
      fx.setFloat4('cameraPosition', ...frame.eye);
      fx.setFloat('jitterOffset', frame.jitterOffset);
      fx.setFloat('ndcHalfZ', engine.isNDCHalfZRange ? 1 : 0);
      shadows.forEach((shadow, j) => shadow.bind(fx, `volumeShadow${j}`, j));
      fx.setFloat('lightCount', frame.lights.count);
      for (const name of ['lightPosition', 'lightAxis', 'lightColor', 'lightSpot']) fx.setArray4(name, frame.lights[name]);
      fx.setFloat3('worldRadiance', ...frame.world);
      fx.setFloat2('volumeClamp', frame.settings.clampDirect, frame.settings.clampIndirect);
      fx.setMatrix('viewMatrix', frame.view);
      fx.setMatrix('projection', frame.projection);
      fx.setFloat('shadowSteps', frame.settings.shadows ? frame.settings.shadowSteps : 0);
      fx.setFloat('shadowReach', frame.reach);
    });
    frame.integrated = lit && pass(integration, integrated, (fx) => {
      fx.setTexture('scatteringTexture', scattered.textures[0]);
      fx.setTexture('extinctionTexture', scattered.textures[1]);
    });
    if (lit) {
      current.results.reverse();
      current.history = { key: frame.key, frames: opacity ? history.frames + 1 : 1 };
    }
    if (frame.integrated !== drawing) { drawing = frame.integrated; film?.reset(); }
  }

  // The resolve, first in the camera's chain: the scene draws into its input, whose depth it reads (and the overlays,
  // film.js target()).
  const attachResolve = () => {
    if (resolve) return;
    resolve = new PostProcess('__volumeResolve', 'blenderVolumeResolve', [...GRID_UNIFORMS, 'viewport', 'ndcHalfZ', 'integrated', 'renderInverseView', 'renderInverseProjection', 'gridView', 'gridProjection'],
      ['depthSampler', 'scatteringTexture', 'transmittanceTexture'], 1, null, NEAREST, engine, false, null, HALF);
    camera.attachPostProcess(resolve, 0);
    const stencil = engine.isStencilEnable;
    resolve.onSizeChangedObservable.add(() => {
      const target = resolve.inputTexture;
      if (!target.depthStencilTexture) target.createDepthStencilTexture(0, false, stencil, 1, stencil ? Constants.TEXTUREFORMAT_DEPTH24_STENCIL8 : Constants.TEXTUREFORMAT_DEPTH24);
    });
    resolve.onApply = (fx) => {
      bindGrid(fx);
      fx._bindTexture('depthSampler', resolve.inputTexture.depthStencilTexture);
      const [scattering, transmittance] = integrated.textures ?? [];
      fx.setTexture('scatteringTexture', scattering);
      fx.setTexture('transmittanceTexture', transmittance);
      const { x, y, width, height } = camera.viewport;
      fx.setFloat4('viewport', x, y, width, height);
      fx.setFloat('ndcHalfZ', engine.isNDCHalfZRange ? 1 : 0);
      fx.setFloat('integrated', frame.integrated ? 1 : 0);
      // The matrices the camera rendered this view with (its post-processes run before the film restores them).
      fx.setMatrix('renderInverseView', scene.getViewMatrix().clone().invert());
      fx.setMatrix('renderInverseProjection', scene.getProjectionMatrix().clone().invert());
      fx.setMatrix('gridView', frame.view);
      fx.setMatrix('gridProjection', frame.projection);
    };
    resolve.onActivateObservable.add(() => { resolve.enablePixelPerfectMode = false; });
  };
  const detach = () => {
    if (resolve) { resolve.dispose(camera); resolve = null; film?.reset(); }
    drawing = false;
    if (props) camera.customRenderTargets = camera.customRenderTargets.filter((t) => t !== props);
    for (const { slab } of slabs.values()) slab.setEnabled(false);
  };

  // A domain's slab: the slices of the grid over its bounds, each a quad at its froxels' points in the domain's object
  // space, placed at its tile of the atlas; drawn with the volume material of the domain's material.
  const slabOf = (domain) => {
    const source = domain.material;
    let entry = slabs.get(domain);
    if (entry && (entry.source !== source || entry.tree !== source.blenderTree)) { entry.material.dispose(); entry.slab.dispose(); entry = null; }
    if (!entry) {
      const slab = new Mesh(`__volume ${domain.name}`, scene);
      Object.assign(slab, { layerMask: 0, isPickable: false, alwaysSelectAsActiveMesh: true, doNotSerialize: true });
      const { material } = nodeMaterialFromTree(`__volume ${source.name}`, scene, source.blenderTree, ShaderNodeOutputVolume);
      slab.material = material;
      entry = { slab, source, tree: source.blenderTree, material };
      slabs.set(domain, entry);
    }
    // The surface material's values (edited in the node editor) are the volume's.
    const sources = new Map(source.attachedBlocks.filter((b) => b.values).map((b) => [b.name, b]));
    for (const block of entry.material.attachedBlocks) if (block.values && sources.has(block.name)) Object.assign(block.values, sources.get(block.name).values);
    return entry;
  };
  const drawSlab = (domain, entry) => {
    // The world's volume is everywhere, in world space.
    const everywhere = isWorldVolume(domain), world = everywhere ? Matrix.Identity() : domain.getWorldMatrix();
    const { slab } = entry, [w, h, d] = grid.size;
    slab.setEnabled(true);
    slab.freezeWorldMatrix(world);
    // Its geometry, made once per grid layout: every slice a quad over the whole grid at its tile of the atlas.
    const layout = `${d} ${grid.columns} ${grid.rows}`;
    if (entry.layout !== layout) {
      entry.layout = layout;
      const positions = [], normals = [], clips = [], uvs = [], slices = [], indices = [];
      for (let k = 0; k < d; k++) {
        const tile = [k % grid.columns, Math.floor(k / grid.columns)], base = k * 4;
        for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          positions.push(0, 0, 0);
          normals.push(0, 1, 0);
          uvs.push(u * grid.coordScale[0], v * grid.coordScale[1]);
          slices.push(k);
          clips.push(((tile[0] + u) / grid.columns) * 2 - 1, ((tile[1] + v) / grid.rows) * 2 - 1, 0, 1);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      Object.assign(new VertexData(), { positions, normals, indices }).applyToMesh(slab);
      slab.setVerticesData(FROXEL_CLIP, clips, false, 4);
      slab.setVerticesData(FROXEL_CORNER, uvs, false, 2);
      slab.setVerticesData(FROXEL_SLICE, slices, false, 1);
    }
    // The view's state as the material reads it (FroxelPosition): nothing of the mesh changes per frame.
    slab.metadata = {
      blVolumeBounds: everywhere ? [[-1e30, -1e30, -1e30], [1e30, 1e30, 1e30]] : localBounds(domain),
      wbModifierBase: domain.metadata?.wbModifierBase ?? domain,
      blFroxel: { inverseProjection: frame.inverseProjection, toLocal: frame.inverseView.multiply(world.clone().invert()), depth: frame.depth,
        perspective: frame.perspective, grid: [w, h, d, frame.jitterOffset], coordScale: grid.coordScale },
    };
    return true;
  };

  // Each frame of the camera: the domains drawn, the grid over them, the lights and the world.
  const before = scene.onBeforeCameraRenderObservable.add((rendering) => {
    if (rendering !== camera) return;
    const domains = volumes.enabled(scene) ? scene.meshes.filter((mesh) => isVolumeDomain(mesh, camera)) : [];
    for (const [domain, { slab, material }] of slabs) if (!domains.includes(domain) || domain.isDisposed()) { slab.dispose(); material.dispose(); slabs.delete(domain); }
    if (!domains.length) { detach(); return; }
    const width = Math.max(1, Math.round(engine.getRenderWidth() * camera.viewport.width)), height = Math.max(1, Math.round(engine.getRenderHeight() * camera.viewport.height));
    const s = volumeSettings(scene);
    grid = froxelGrid(width, height, s, engine.getCaps().maxTextureSize);
    frame = viewFrame(scene, camera, s, grid, domains);
    ensureTargets();
    attachResolve();
    const drawn = domains.map((domain) => { const entry = slabOf(domain); return drawSlab(domain, entry) ? entry.slab : null; }).filter(Boolean);
    // Set again only when it changed: a new list makes the target prepare its meshes again, which skips them that render.
    if (drawn.length !== props.renderList?.length || drawn.some((slab, i) => props.renderList[i] !== slab)) props.renderList = drawn;
    if (!camera.customRenderTargets.includes(props)) camera.customRenderTargets.push(props);
  });

  return {
    // Whether the camera draws volumes this frame.
    get active() { return !!resolve; },
    dispose() {
      scene.onBeforeCameraRenderObservable.remove(before);
      detach();
      for (const { slab, material } of slabs.values()) { slab.dispose(); material.dispose(); }
      slabs.clear();
      for (const { props: p, results, integrated: i } of sized.values()) for (const target of [p, ...results, i]) target.dispose();
      sized.clear();
      for (const wrapper of [...scatters.values(), integration]) wrapper.dispose();
      renderer.dispose();
    },
  };
}

// blender-port: eevee_volume_lib.bsl.hh volume_view_to_jitter: a world point's coordinates in a frame's grid (volume
// uv, and z in [0, 1] over its depths), as the resolve finds a pixel's (volume-shaders.js RESOLVE).
export function volumeCoordinate(point, { view, projection, coordScale, depth, perspective }) {
  const v = Vector3.TransformCoordinates(point, view), ndc = Vector3.TransformCoordinates(v, projection);
  return { x: (ndc.x * 0.5 + 0.5) * coordScale[0], y: (ndc.y * 0.5 + 0.5) * coordScale[1], z: viewZToVolumeZ(depth, perspective, -v.z) };
}

// The point of Babylon's view space at volume uv (u, v) and Blender's view z, as volume-shaders.js finds it.
export function viewPoint(frame, u, v, viewZ, out) {
  const ndc = [(u / frame.coordScale[0]) * 2 - 1, (v / frame.coordScale[1]) * 2 - 1];
  const a = Vector3.TransformCoordinates(new Vector3(ndc[0], ndc[1], 0), frame.inverseProjection);
  const b = Vector3.TransformCoordinates(new Vector3(ndc[0], ndc[1], 0.5), frame.inverseProjection);
  return Vector3.LerpToRef(a, b, (-viewZ - a.z) / (b.z - a.z), out);
}

// What a frame of the camera draws its volumes with: its matrices (the film's jitter in them), the grid's depths over
// the domains, the slices' jitter for the film's sample, the lights and the world's light.
let frameCount = 0;
function viewFrame(scene, camera, s, grid, domains) {
  const view = scene.getViewMatrix().clone(), projection = scene.getProjectionMatrix().clone(), perspective = camera.mode === 0;
  const depths = domains.flatMap((domain) => corners(domain).map((p) => Vector3.TransformCoordinates(p, view).z));
  const clipStart = camera.minZ, clipEnd = camera.maxZ > 0 ? camera.maxZ : 1e6;
  // eevee_volume.cc end_sync: object volumes alone narrow the grid to their bounds; a world volume fills the clip range.
  const bounds = domains.some(isWorldVolume) ? null : [Math.max(clipStart, Math.min(...depths)), Math.max(clipStart, Math.max(...depths))];
  const sample = filmSample(scene);
  const inverseView = view.clone().invert(), eye = camera.globalPosition, forward = camera.getForwardRay(1).direction;
  const environment = scene.environmentTexture?.sphericalPolynomial, intensity = scene.environmentIntensity ?? 1;
  const world = environment ? ['x', 'y', 'z'].map((c) => Math.max(0, (environment.xx[c] + environment.yy[c] + environment.zz[c]) / 3) * intensity) : [0, 0, 0];
  return {
    view, inverseView, projection, inverseProjection: projection.clone().invert(), perspective, reach: bounds ? reach(domains) : clipEnd - clipStart,
    depth: depthParams(s, clipStart, clipEnd, perspective, bounds), coordScale: grid.coordScale, settings: s,
    // The froxels' noise moves every frame (the film's sample, else the frame's), so the history averages it away.
    jitterOffset: halton((sample ?? (frameCount = (frameCount % 64) + 1)) + 1, 5), pending: true,
    // What the history holds only while it stays: the view, the volumes' materials and objects, and the settings.
    key: JSON.stringify([s, grid.size, Array.from(view.m, (v) => v.toFixed(5)), camera.fov, domains.map((domain) => [domain.uniqueId, domain.material?.uniqueId, domain.getWorldMatrix().updateFlag])]),
    eye: perspective ? [eye.x, eye.y, eye.z, 1] : [forward.x, forward.y, forward.z, 0],
    lights: packLights(scene, camera, domains), world,
  };
}

// The shadow maps a scatter pass samples, besides its own textures, within WebGL's sixteen texture units.
const MAX_SHADOWS = 8;
// A light's shadow map as the scatter pass samples it (scatterShader): its kind and how it binds, from Babylon's
// generator (light-shadows.js): a sun's cascades, a spot's map, a point or area light's cube.
function shadowMap(light, camera) {
  const generator = light.getShadowGenerator(camera) ?? light.getShadowGenerator(), map = generator?.getShadowMap();
  if (!map) return null;
  if (generator instanceof CascadedShadowGenerator) {
    // Its splits in view depth are only its own (viewFrustumZ, which it binds to materials itself).
    const count = generator.numCascades, cascades = new Float32Array(64), splits = [0, 1, 2, 3].map((i) => generator._viewSpaceFrustumsZ?.[i] ?? 1e9);
    for (let i = 0; i < count; i++) generator.getCascadeTransformMatrix(i)?.copyToArray(cascades, i * 16);
    return { kind: 'SUN', bind: (fx, name, j) => {
      fx.setDepthStencilTexture(name, map);
      fx.setMatrices(`volumeShadowCascades${j}`, cascades);
      fx.setFloat4(`volumeShadowSplits${j}`, ...splits);
      fx.setFloat(`volumeShadowCascadeCount${j}`, count);
    } };
  }
  if (light.needCube()) {
    const near = light.getDepthMinZ(camera), depth = [near, near + light.getDepthMaxZ(camera)];
    return { kind: 'CUBE', bind: (fx, name, j) => { fx.setTexture(name, map); fx.setFloat2(`volumeShadowDepth${j}`, ...depth); } };
  }
  const matrix = generator.getTransformMatrix();
  return { kind: 'SPOT', bind: (fx, name, j) => { fx.setDepthStencilTexture(name, map); fx.setMatrix(`volumeShadowMatrix${j}`, matrix); } };
}

// The length of the box around the domains, which a sun's volume shadow crosses.
function reach(domains) {
  const points = domains.flatMap(corners);
  const min = points.reduce((a, p) => Vector3.Minimize(a, p)), max = points.reduce((a, p) => Vector3.Maximize(a, p));
  return Vector3.Distance(min, max);
}

// Whether a light lights a domain's volume: by its layer mask (Material Preview's studio lighting leaves the scene's
// lights out by it), not by the meshes it is limited to, which light-reach.js chooses for surfaces' light budgets.
const lights = (light, domain) => !light.includeOnlyWithLayerMask || !!(light.includeOnlyWithLayerMask & domain.layerMask);
// The lights that light the domains.
export function packLights(scene, camera, domains) {
  const packed = { count: 0, shadows: [], lightPosition: new Float32Array(MAX_LIGHTS * 4), lightAxis: new Float32Array(MAX_LIGHTS * 4), lightColor: new Float32Array(MAX_LIGHTS * 4), lightSpot: new Float32Array(MAX_LIGHTS * 4) };
  for (const light of scene.lights) {
    if (packed.count >= MAX_LIGHTS || !light.isEnabled() || !isBlenderLight(light) || !domains.some((domain) => lights(light, domain))) continue;
    const l = volumeLight(lightRecord(light));
    if (!l) continue;
    const i = packed.count++ * 4, position = light.getAbsolutePosition();
    const direction = light.direction ? (light.computeTransformedInformation?.() ? light.transformedDirection : light.direction).clone().normalize().negate() : Vector3.Zero();
    packed.lightPosition.set([position.x, position.y, position.z, l.type], i);
    packed.lightAxis.set([direction.x, direction.y, direction.z, l.radius], i);
    packed.lightColor.set([...l.color, l.inverseSquareInfluence], i);
    const shadow = lightRecord(light).use_shadow ? shadowMap(light, camera) : null;
    if (shadow && packed.shadows.length < MAX_SHADOWS) packed.shadows.push(shadow);
    packed.lightSpot.set([...l.spot, lightRecord(light).use_shadow ? 1 : 0, shadow && packed.shadows.at(-1) === shadow ? packed.shadows.length - 1 : -1], i);
  }
  return packed;
}
