// EEVEE's volumes (draw/volumes.js): the froxel grid and its depths from the scene's Volumes settings, a light's
// volume power, a material's Volume built as the froxel pass's material (and left out of its surface's), and a camera
// that draws volumes only while a domain is in view.
import assert from 'node:assert/strict';
import { FreeCamera, Matrix, MeshBuilder, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { createLight } from '../src/blenkernel/light/light-home.js';
import { cameraVolumes, depthParams, historyOpacity, packLights, viewPoint, volumeCoordinate, volumeHistoryUvw, volumeJitterOffset, froxelGrid, readVolumeSettings, viewZToVolumeZ, VOLUME_DEFAULTS, volumeLight, volumeZToViewZ } from '../src/draw/volumes.js';
import { jitterProjection } from '../src/render/sampling.js';
import { nodeMaterialFromTree, ShaderNodeOutputVolume } from '../src/nodes/blender/shader-nodes.js';
import { scatterShader, shadowSamplers } from '../src/draw/volume-shaders.js';

const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${message}: ${a} is not ${b}`);

// The settings as scene.eevee holds them, Blender's defaults where it has none.
{
  const s = readVolumeSettings({ volumetric_tile_size: '4', volumetric_samples: 32, volumetric_sample_distribution: 0.5, volumetric_start: 2, volumetric_end: 40, use_volume_custom_range: true });
  assert.deepEqual(s, { ...VOLUME_DEFAULTS, tileSize: 4, samples: 32, distribution: 0.5, start: 2, end: 40, customRange: true });
  assert.deepEqual(readVolumeSettings(undefined), VOLUME_DEFAULTS, 'without Volumes settings, Blender\'s defaults');
}

// eevee_volume.cc init: a view's grid at 8 pixel tiles, 64 slices deep, laid out 8 by 8; a view not a multiple of the
// tile covers part of its last froxels.
{
  const grid = froxelGrid(1920, 1080, VOLUME_DEFAULTS);
  assert.deepEqual([grid.tile, grid.size, grid.columns, grid.atlas], [8, [240, 135, 64], 8, [1920, 1080]]);
  assert.deepEqual(grid.coordScale, [1, 1]);
  const odd = froxelGrid(1001, 500, VOLUME_DEFAULTS);
  assert.deepEqual(odd.size, [126, 63, 64]);
  close(odd.coordScale[0], 1001 / 1008, 'the view covers its part of the last column');
  assert.equal(froxelGrid(1920, 1080, VOLUME_DEFAULTS, 1024).tile, 16, 'a grid too large for the atlas takes larger tiles');
}

// end_sync: the slices spread over the volumes' depths (the camera's clip range narrowed to them), exponentially in
// perspective: the first at the nearest, the last at the farthest, nearer slices thinner.
{
  for (const perspective of [true, false]) {
    const params = depthParams(VOLUME_DEFAULTS, 0.1, 100, perspective, [4, 9]);
    close(volumeZToViewZ(params, perspective, 0), -4, 'the grid starts at the nearest volume');
    close(volumeZToViewZ(params, perspective, 1), -9, 'and ends at the farthest');
    close(viewZToVolumeZ(params, perspective, volumeZToViewZ(params, perspective, 0.37)), 0.37, 'view z and volume z invert each other');
  }
  const params = depthParams(VOLUME_DEFAULTS, 0.1, 100, true, [4, 9]), thickness = (z) => volumeZToViewZ(params, true, z) - volumeZToViewZ(params, true, z + 0.1);
  assert.ok(thickness(0) < thickness(0.9), 'perspective slices thicken with distance');
  const custom = depthParams({ ...VOLUME_DEFAULTS, customRange: true, start: 5, end: 7 }, 0.1, 100, false, [4, 9]);
  assert.deepEqual([custom[0], custom[1]], [-5, -7], 'a custom range narrows it further');
}

// Camera view's projection (zoomed, its lens shifted): a slab's froxel point and the grid coordinates the resolve finds
// for a world point invert each other, and differ from the pixel the point is drawn at.
{
  const view = Matrix.LookAtLH(new Vector3(1, 2, -6), new Vector3(0, 1, 0), Vector3.Up());
  const projection = Matrix.PerspectiveFovLH(0.4, 1.6, 0.1, 100);
  projection.m[8] = 0.3; // the lens shift, as main-sync.js shiftLens sets it
  projection.m[9] = -0.2;
  const frame = { view, inverseView: view.clone().invert(), projection, inverseProjection: projection.clone().invert(), perspective: true,
    coordScale: [0.98, 0.95], depth: depthParams(VOLUME_DEFAULTS, 0.1, 100, true, [3, 12]) };
  for (const [u, v, z] of [[0.1, 0.2, 0.3], [0.7, 0.9, 0.8], [0.5, 0.5, 0.05]]) {
    const point = Vector3.TransformCoordinates(viewPoint(frame, u, v, volumeZToViewZ(frame.depth, true, z), new Vector3()), frame.inverseView);
    const back = volumeCoordinate(point, frame);
    close(back.x, u, 'u');
    close(back.y, v, 'v');
    close(back.z, z, 'z');
  }
  const zoomed = Matrix.PerspectiveFovLH(0.25, 1.6, 0.1, 100), point = new Vector3(-1.5, 2.6, 3);
  const pixel = Vector3.TransformCoordinates(point, view.multiply(zoomed)), grid = volumeCoordinate(point, frame);
  assert.ok(Math.abs(pixel.x * 0.5 + 0.5 - grid.x) > 0.05, 'a zoomed view draws the point elsewhere than the grid holds it');
}

// volume_history_uvw_get: a froxel's center found in the last frame's grid, through both frames' stable projections and
// depths. A still view finds it where it is; a view moved sideways finds it shifted by the move over its depth; one moved
// ahead finds it deeper; a point the last view did not see has no history.
{
  const projection = Matrix.PerspectiveFovLH(0.6, 1.5, 0.1, 100);
  const frameAt = (eye, depth = [3, 12], coordScale = [0.97, 0.94]) => {
    const view = Matrix.LookAtLH(eye, eye.add(new Vector3(0, 0, 1)), Vector3.Up());
    return { view, inverseView: view.clone().invert(), stableProjection: projection, stableInverseProjection: projection.clone().invert(), perspective: true,
      coordScale, depth: depthParams(VOLUME_DEFAULTS, 0.1, 100, true, depth) };
  };
  const still = frameAt(new Vector3(0, 1, -6));
  for (const uvw of [[0.1, 0.2, 0.3], [0.5, 0.5, 0.5], [0.9, 0.8, 0.95]]) {
    volumeHistoryUvw(uvw, still, still).forEach((c, i) => close(c, uvw[i], 'a still view keeps each froxel where it is'));
  }
  const dx = 0.2, moved = frameAt(new Vector3(dx, 1, -6)), uvw = [0.5, 0.5, 0.5];
  const viewZ = -volumeZToViewZ(still.depth, true, uvw[2]), last = volumeHistoryUvw(uvw, moved, still);
  close(last[0] - uvw[0], (dx * projection.m[0] / viewZ / 2) * still.coordScale[0], 'a move sideways shifts it by the move over its depth');
  close(last[1], uvw[1], 'and not up');
  close(last[2], uvw[2], 'nor in depth');
  const ahead = volumeHistoryUvw(uvw, frameAt(new Vector3(0, 1, -5.5)), still);
  close(volumeZToViewZ(still.depth, true, ahead[2]), -(viewZ + 0.5), 'a move ahead finds it half a unit deeper in the last grid');
  // The grid's depths follow the volumes in view: the last frame's own depths place it.
  const narrowed = { ...still, depth: depthParams(VOLUME_DEFAULTS, 0.1, 100, true, [4, 10]) };
  close(volumeZToViewZ(narrowed.depth, true, volumeHistoryUvw(uvw, still, narrowed)[2]), -viewZ, 'by the last frame\'s depths');
  assert.equal(volumeHistoryUvw([0.02, 0.5, 0.5], frameAt(new Vector3(-3, 1, -6)), still), null, 'a point out of the last view has none');
  // The film's jitter taken back out gives the stable projection the history is found with.
  const jittered = Matrix.FromArray(jitterProjection(Array.from(projection.m), [0.3, -0.2], 800, 600));
  const stable = jitterProjection(Array.from(jittered.m), [-0.3, 0.2], 800, 600);
  stable.forEach((v, i) => close(v, projection.m[i], 'the stable projection'));
  // set_view: an exponential average of at most 16 frames held still, 8 while moving, none once the volumes change.
  const history = { ...still, key: 'k', frames: 40 };
  close(historyOpacity(history, { ...still, key: 'k' }), 16 / 17, 'a still view');
  close(historyOpacity(history, { ...moved, key: 'k' }), 8 / 9, 'a moving view');
  close(historyOpacity({ ...history, frames: 1 }, { ...moved, key: 'k' }), 1 / 2, 'a new history');
  assert.equal(historyOpacity(history, { ...still, key: 'other' }), 0, 'changed volumes');
  assert.equal(historyOpacity(null, still), 0);
  // Sampling::step: the noise's first sample is 0 and the next ones spread over the slice.
  close(volumeJitterOffset(0), 0, 'the first sample');
  assert.equal(new Set(Array.from({ length: 32 }, (_, i) => volumeJitterOffset(i).toFixed(4))).size, 32, '32 distinct offsets');
}

// Light::sync: a point light's radiant intensity (its power over the sphere) times its Volume factor; a spot's cone; a
// sun's irradiance; a light without volume influence none.
{
  const point = volumeLight({ type: 'POINT', color: [1, 0.5, 0.25], energy: 1000, volume_factor: 2, shadow_soft_size: 0.25 });
  close(point.color[0], 2000 / (4 * Math.PI), 'a point light\'s volume power');
  close(point.color[1], 1000 / (4 * Math.PI), 'times its color');
  assert.equal(point.radius, 0.25);
  assert.ok(point.inverseSquareInfluence > 0, 'it reaches a volume up to its influence radius');
  const spot = volumeLight({ type: 'SPOT', color: [1, 1, 1], energy: 100, spot_size: Math.PI / 2, spot_blend: 0.5, shadow_soft_size: 0 });
  const mask = (angle) => Math.min(1, Math.max(0, Math.cos(angle) * spot.spot[0] + spot.spot[1]));
  assert.equal(mask(0), 1, 'a spot lights its axis');
  assert.equal(mask(Math.PI / 4 + 0.01), 0, 'and nothing outside its cone');
  close(volumeLight({ type: 'SUN', color: [1, 1, 1], energy: 3 }).color[0], 3, 'a sun\'s irradiance');
  assert.equal(volumeLight({ type: 'POINT', color: [1, 1, 1], energy: 10, volume_factor: 0 }), null);
}

// The scatter pass of a sun's cascades, a spot's map and a point's cube: each light's slot reads its map's kind.
{
  const code = scatterShader(['SUN', 'SPOT', 'CUBE']);
  assert.match(code, /uniform highp sampler2DArrayShadow volumeShadow0;[\s\S]*uniform highp sampler2DShadow volumeShadow1;[\s\S]*uniform samplerCube volumeShadow2;/);
  assert.match(code, /if \(slot == 0\.0\) return shadow_sun\(volumeShadow0[\s\S]*if \(slot == 2\.0\) return shadow_cube\(volumeShadow2/);
  assert.doesNotMatch(scatterShader([]), /volumeShadow/, 'without shadows, no shadow maps');
  assert.deepEqual(shadowSamplers(['SPOT', 'CUBE']), ['volumeShadow0', 'volumeShadow1']);
}

// A Principled Volume with a Noise Texture's density: its volume material evaluates both for the froxels and writes
// EEVEE's four properties; the surface material of the same tree draws no surface and runs no volume code.
const tree = {
  nodes: [{ idname: 'ShaderNodeTexNoise', name: 'Noise', properties: { noise_dimensions: '3D', noise_type: 'FBM', normalize: true } },
    { idname: 'ShaderNodeVolumePrincipled', name: 'Volume' }, { idname: 'ShaderNodeOutputMaterial', name: 'Output' }],
  links: [['Noise', 'Fac', 'Volume', 'Density'], ['Volume', 'Volume', 'Output', 'Volume']],
};
const scene = new Scene(new NullEngine()), camera = new FreeCamera('Camera', new Vector3(0, 0, -6), scene);
// A null engine makes no depth textures, which the resolve's input has.
scene.getEngine().createDepthStencilTexture = () => ({ dispose() {} });
const fragment = async (material) => {
  for (let i = 0; i < 100 && material._buildIsInProgress; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  return material.compiledShaders.split('// Fragment shader')[1] ?? '';
};
{
  const surface = nodeMaterialFromTree('Steam', scene, tree).material, volume = nodeMaterialFromTree('Steam volume', scene, tree, ShaderNodeOutputVolume).material;
  assert.ok(surface.blenderVolume && surface.blenderNoSurface, 'a volume without a surface draws no surface');
  assert.doesNotMatch(await fragment(surface), /node_volume_principled/, 'the surface runs no volume code');
  const code = await fragment(volume);
  for (const pattern of [/bl_node_volume_principled\(/, /bl_node_noise_tex_\w+\(/, /glFragData\[3\]/, /bl_volume_min/, /bl_froxel_jitter\(/]) assert.match(code, pattern);
}

// A camera draws volumes only while a domain of one is in view: its resolve first in its chain, the froxel properties
// among its render targets; without one, nothing is added.
{
  const passes = () => camera._postProcesses.filter(Boolean).length;
  const drawn = cameraVolumes(scene, camera), before = passes();
  scene.render();
  assert.equal(passes(), before, 'a scene without volumes adds no pass');
  assert.equal(camera.customRenderTargets.length, 0, 'and no render target');
  const box = MeshBuilder.CreateBox('Steam', { size: 2 }, scene);
  box.material = nodeMaterialFromTree('Steam', scene, tree).material;
  scene.render();
  assert.ok(drawn.active && passes() === before + 1 && camera._postProcesses[0].name === '__volumeResolve', 'a volume adds its resolve first');
  assert.equal(camera.customRenderTargets.length, 1, 'and its froxel properties');
  const slab = scene.meshes.find((mesh) => mesh.name === '__volume Steam');
  assert.ok(slab.getTotalVertices() > 0 && slab.getTotalVertices() <= 64 * 4, 'its slab holds the slices over the box');
  // Its geometry is made once: a moving view changes only its material's uniforms, so the material never prepares
  // again (a target skips a mesh whose material is not ready in its pass).
  const buffer = slab.getVertexBuffer('blFroxelClip');
  camera.position.x += 0.5;
  scene.render();
  assert.equal(slab.getVertexBuffer('blFroxelClip'), buffer, 'the slab keeps its geometry as the view moves');
  assert.ok(slab.metadata.blFroxel.toLocal, 'its view state is its material uniforms');
  box.setEnabled(false);
  scene.render();
  assert.ok(!drawn.active && passes() === before && camera.customRenderTargets.length === 0, 'once it is gone, so are its passes');
  // A camera inside a large volume (sea fog over a pier): every slice, each over the whole view.
  box.setEnabled(true);
  box.scaling.set(10, 3, 25);
  box.computeWorldMatrix(true);
  scene.render();
  const inside = scene.meshes.find((mesh) => mesh.name === '__volume Steam');
  assert.equal(inside.getTotalVertices(), 64 * 4, 'every slice of the grid holds fog');
  const clips = inside.getVerticesData('blFroxelClip');
  assert.ok(Math.min(...clips.filter((_, i) => i % 4 === 0)) === -1 && Math.max(...clips.filter((_, i) => i % 4 === 0)) === 1, 'over the whole atlas');
  // A light that overrides/babylon/light-reach.js limits to other meshes' surfaces still lights the volume; one Material Preview leaves
  // out by its layer mask does not.
  const lantern = createLight('Lantern', 'POINT', { energy: 30 }, scene), studio = createLight('Studio', 'POINT', { energy: 30 }, scene);
  lantern.includedOnlyMeshes = [MeshBuilder.CreateBox('Post', {}, scene)];
  studio.includeOnlyWithLayerMask = 0x10000000;
  assert.equal(packLights(scene, camera, [box]).count, 1, 'the lantern lights the fog, the studio-excluded light does not');
  // The world's Volume (a thin haze) fills every froxel of the view, its box's own size aside.
  box.setEnabled(false);
  const haze = { nodes: [{ idname: 'ShaderNodeBackground', name: 'Background' }, { idname: 'ShaderNodeVolumePrincipled', name: 'Haze' },
    { idname: 'ShaderNodeOutputWorld', name: 'World Output' }], links: [['Background', 'Background', 'World Output', 'Surface'], ['Haze', 'Volume', 'World Output', 'Volume']] };
  const sky = MeshBuilder.CreateBox('__worldNodes', { size: 2 }, scene);
  sky.material = nodeMaterialFromTree('__world World', scene, haze).material;
  scene.render();
  const world = scene.meshes.find((mesh) => mesh.name === '__volume __worldNodes');
  assert.ok(world && world.getTotalVertices() === 64 * 4, 'the world volume fills every slice');
  assert.ok(world.metadata.blVolumeBounds[1][0] > 1e29, 'unbounded by its box');
  drawn.dispose();
}
console.log('Volumes: the froxel grid and its depths from the scene\'s Volumes settings, lights\' volume power, the Volume as its own material, passes only with a volume in view');
