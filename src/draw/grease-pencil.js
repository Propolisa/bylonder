// Grease Pencil objects drawn by Babylon from what grease-pencil-api.cc packs of them as Blender's draw cache reads them:
// each visible drawing (a layer's frame, or an onion skin of it) as its strokes in GreasedLine meshes, their points'
// radii as widths and their colors (Blender's mix of material, vertex color, opacity and onion tint) in a colors
// texture, and its fills as one mesh of Blender's fill triangles. A drawing's strokes are a base mesh and an active one:
// a change of its last strokes (a stroke being drawn) rebuilds only the active mesh, so drawing stays cheap however many
// strokes the drawing holds. Layers draw in their order over the scene, as Blender's 2D layers do.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { GreasedLineMesh } from '@babylonjs/core/Meshes/GreasedLine/greasedLineMesh.js';
import { CreateGreasedLineMaterial } from '@babylonjs/core/Meshes/Builders/greasedLineBuilder.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import defaultTheme from '../editors/interface/theme-default.json' with { type: 'json' };
import { overlayMaterial } from './overlay-edit-mesh.js';
import { pointSprites, setPoints } from './point-sprites.js';
import { Vector2 } from '@babylonjs/core/Maths/math.vector.js';
import { RenderingGroup } from '@babylonjs/core/Rendering/renderingGroup.js';

// grease-pencil-api.cc's packing: a curve's ints and a point's floats.
export const CURVE_INTS = 5, POINT_FLOATS = 14;
export const CURVE_CYCLIC = 1, CURVE_STROKE = 2, CURVE_FILL = 4;
// A drawing's last strokes that change without the rest (a stroke being drawn) stay in the active mesh up to this many.
const ACTIVE_STROKES = 8;
// GreasePencilLayerBlendMode (DNA_grease_pencil_types.h) as Babylon's alpha modes; Hard Light and Divide blend normally.
const BLEND_MODES = [Constants.ALPHA_COMBINE, Constants.ALPHA_COMBINE, Constants.ALPHA_ADD, Constants.ALPHA_SUBTRACT, Constants.ALPHA_MULTIPLY, Constants.ALPHA_COMBINE];
// GreasedLineMeshColorDistributionType and GreasedLineMeshColorMode.
const COLOR_DISTRIBUTION_SEGMENT = 0, COLOR_MODE_SET = 0;
// The layer order within the transparent pass: onion skins first, then layers bottom to top, each layer's fills under its strokes.
const alphaIndex = (draw, part) => (draw.onion ? -1000 : 0) + draw.layer * 3 + part;

const FILL_VERTEX = `precision highp float;
attribute vec3 position;
attribute vec4 color;
uniform mat4 worldViewProjection;
varying vec4 vColor;
void main() { vColor = color; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
// Colors come as Blender's draw gives them, in display sRGB (grease-pencil-api.cc color_output): a view that draws in
// scene linear (Rendered, its post-process displaying it) takes them back to linear, as Blender's render draws them.
const FILL_FRAGMENT = `precision highp float;
varying vec4 vColor;
uniform float sceneLinear;
vec3 linear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void main() { if (vColor.a <= 0.0) discard; gl_FragColor = vec4(sceneLinear > 0.5 ? linear(vColor.rgb) : vColor.rgb, vColor.a); }`;
// GreasedLine sets a stroke's color after Babylon's material takes its color to scene linear: this does it after.
class SceneLinearStrokePlugin extends MaterialPluginBase {
  constructor(material) { super(material, 'BlenderSceneLinearStroke', 300, {}, true, true); }
  getClassName() { return 'BlenderSceneLinearStrokePlugin'; }
  getCustomCode(shaderType) {
    return shaderType === 'fragment' ? { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: '#ifdef IMAGEPROCESSINGPOSTPROCESS\ncolor.rgb = toLinearSpace(color.rgb);\n#endif\n' } : null;
  }
}

// The mean scale of a matrix's axes, by which Blender scales a stroke's radius.
const meanScale = (m) => [0, 4, 8].reduce((sum, i) => sum + Math.hypot(m[i], m[i + 1], m[i + 2]), 0) / 3;

// A drawing's strokes from `first` to `last` curve as GreasedLine points, widths (two per point) and their colors.
function strokeArrays(draw, first, last, scale) {
  const { curves, points } = draw, lines = [], widths = [], colors = [];
  for (let c = first; c < last; c++) {
    const at = c * CURVE_INTS, flags = curves[at + 2];
    if (!(flags & CURVE_STROKE)) continue;
    const start = curves[at], count = curves[at + 1], cyclic = flags & CURVE_CYCLIC;
    if (!count) continue;
    const order = Array.from({ length: count + (cyclic ? 1 : 0) }, (_, i) => start + (i % count));
    if (count === 1) order.push(start);
    const line = new Float32Array(order.length * 3);
    order.forEach((p, i) => {
      const o = p * POINT_FLOATS;
      const width = 2 * points[o + 3] * scale;
      line.set(points.subarray(o, o + 3), i * 3);
      // A dot: a line as long as it is wide (GreasedLine has no caps).
      if (count === 1) line[i * 3] += (i ? 0.5 : -0.5) * width / scale;
      widths.push(width, width);
      colors.push(...points.subarray(o + 4, o + 8));
    });
    lines.push(line);
  }
  return { lines, widths, colors: Float32Array.from(colors) };
}

// A colors texture the size of `count` colors (RGBA floats), laid out as GreasedLine looks them up.
export function colorsTexture(scene, colors, kept) {
  const count = colors.length / 4, max = scene.getEngine().getCaps().maxTextureSize;
  const width = Math.max(1, Math.min(count, max)), height = Math.max(1, Math.ceil(count / max));
  const data = new Float32Array(width * height * 4);
  data.set(colors);
  const size = kept?.getSize();
  if (kept && size.width === width && size.height === height) {
    kept.update(data);
    return kept;
  }
  kept?.dispose();
  return new RawTexture(data, width, height, Constants.TEXTUREFORMAT_RGBA, scene, false, true, RawTexture.NEAREST_NEAREST, Constants.TEXTURETYPE_FLOAT);
}

// GreasedLine widens strokes by the aspect of the view it draws in: each view (and a render) sets it before drawing.
const plugins = new Set();
function trackAspect(scene) {
  if (scene.metadata?.greasedLineAspect) return;
  scene.metadata = { ...scene.metadata, greasedLineAspect: true };
  const resolution = new Vector2();
  scene.onBeforeCameraRenderObservable.add(() => {
    const engine = scene.getEngine();
    resolution.set(engine.getRenderWidth(), engine.getRenderHeight());
    for (const plugin of plugins) plugin.resolution = resolution;
  });
}

// GreasedLine's settings for a drawing's object (runtimes/grease-pencil.js): Blender's look (world widths, no dashes)
// unless its object's Babylon settings ask otherwise.
export const BLENDER_LOOK = { sizeAttenuation: false, screenScale: 1, useDash: false, dashCount: 1, dashRatio: 0.5, dashOffset: 0 };
export function greasedLineMaterial(scene, name, sizeAttenuation) {
  const material = CreateGreasedLineMaterial(name, { useColors: true, width: 1, sizeAttenuation, colorMode: COLOR_MODE_SET,
    colorDistributionType: COLOR_DISTRIBUTION_SEGMENT, cameraFacing: true }, scene);
  Object.assign(material, { transparencyMode: Material.MATERIAL_ALPHABLEND, disableDepthWrite: true, backFaceCulling: false, disableLighting: true });
  new SceneLinearStrokePlugin(material);
  return material;
}

// One GreasedLine mesh of strokes, rebuilt with set(); empty, it has no mesh. Its material is made again only when size
// attenuation (a define of GreasedLine's) changes.
function strokeBatch(scene, name, owner) {
  trackAspect(scene);
  const batch = { mesh: null, material: null, plugin: null, texture: null, look: null };
  batch.configure = (look, blend) => {
    if (batch.look?.sizeAttenuation !== look.sizeAttenuation) {
      if (batch.plugin) plugins.delete(batch.plugin);
      batch.material?.dispose();
      batch.material = greasedLineMaterial(scene, name, look.sizeAttenuation);
      batch.plugin = batch.material.pluginManager.getPlugin('GreasedLinePluginMaterial');
      plugins.add(batch.plugin);
      if (batch.texture) batch.plugin.colorsTexture = batch.texture;
      if (batch.mesh) batch.mesh.material = batch.material;
    }
    batch.look = look;
    const { screenScale, useDash, dashCount, dashRatio, dashOffset } = look;
    // Attenuated, a stroke's width is in pixels: its diameter in metres times the screen scale.
    Object.assign(batch.plugin, { width: look.sizeAttenuation ? screenScale : 1, useDash, dashCount, dashRatio, dashOffset });
    batch.material.alphaMode = blend;
  };
  batch.set = ({ lines, widths, colors }, matrix, order) => {
    batch.mesh?.dispose();
    batch.mesh = null;
    if (!lines.length) return;
    let pointer = 0;
    const colorPointers = lines.flatMap((line) => Array.from({ length: line.length / 3 }, () => [pointer, pointer++]).flat());
    batch.texture = colorsTexture(scene, colors, batch.texture);
    batch.plugin.colorsTexture = batch.texture;
    const mesh = new GreasedLineMesh(name, scene, { points: lines, widths, colorPointers });
    Object.assign(mesh, { material: batch.material, alphaIndex: order, isPickable: true, metadata: { drawOwner: owner, greasePencil: true } });
    mesh.freezeWorldMatrix(matrix);
    batch.mesh = mesh;
  };
  batch.place = (matrix) => batch.mesh?.freezeWorldMatrix(matrix);
  batch.dispose = () => { batch.mesh?.dispose(); batch.texture?.dispose(); batch.material?.dispose(); plugins.delete(batch.plugin); };
  return batch;
}

export function fillMaterial(scene, name) {
  const material = Object.assign(new ShaderMaterial(name, scene, { vertexSource: FILL_VERTEX, fragmentSource: FILL_FRAGMENT },
    { attributes: ['position', 'color'], uniforms: ['worldViewProjection', 'sceneLinear'], needAlphaBlending: true }), { backFaceCulling: false, disableDepthWrite: true });
  material.onBindObservable.add(() => material.getEffect().setFloat('sceneLinear', +scene.imageProcessingConfiguration.applyByPostProcess));
  return material;
}

// A drawing's fills: its points' positions and fill colors, Blender's triangles.
function fillMesh(scene, name, owner, draw, matrix, kept) {
  if (!draw.triangles.length) { kept?.dispose(); return null; }
  const mesh = kept ?? new Mesh(name, scene);
  const count = draw.points.length / POINT_FLOATS, positions = new Float32Array(count * 3), colors = new Float32Array(count * 4);
  for (let p = 0; p < count; p++) {
    positions.set(draw.points.subarray(p * POINT_FLOATS, p * POINT_FLOATS + 3), p * 3);
    colors.set(draw.points.subarray(p * POINT_FLOATS + 8, p * POINT_FLOATS + 12), p * 4);
  }
  Object.assign(new VertexData(), { positions, colors, indices: Uint32Array.from(draw.triangles) }).applyToMesh(mesh, false);
  mesh.material ??= fillMaterial(scene, name);
  mesh.material.alphaMode = BLEND_MODES[draw.blend] ?? Constants.ALPHA_COMBINE;
  Object.assign(mesh, { alphaIndex: alphaIndex(draw, 0), isPickable: true, metadata: { drawOwner: owner, greasePencil: true } });
  mesh.freezeWorldMatrix(matrix);
  return mesh;
}

const theme = defaultTheme.view_3d;

// Edit Mode's points of a drawing (overlay_grease_pencil.hh edit points), in the theme's colors by their selection.
function editPoints(scene, name, draw, matrix, kept) {
  if (!draw.pointsShown || !draw.points.length) { kept?.dispose(); return null; }
  const mesh = kept ?? Object.assign(new Mesh(name, scene), { isPickable: false, alwaysSelectAsActiveMesh: true, doNotSerialize: true, renderingGroupId: 1 });
  mesh._getRenderingFillMode = (fillMode) => fillMode;
  if (!mesh.material) pointSprites(Object.assign(mesh, { material: overlayMaterial(scene, name, { fillMode: Material.PointListDrawMode, pointSize: theme.gp_vertex_size * 2 }) }));
  const count = draw.points.length / POINT_FLOATS, positions = new Float32Array(count * 3), colors = new Float32Array(count * 4);
  for (let p = 0; p < count; p++) {
    const o = p * POINT_FLOATS;
    positions.set(draw.points.subarray(o, o + 3), p * 3);
    colors.set([...(draw.points[o + 12] > 0 ? theme.gp_vertex_select : theme.gp_vertex), 1], p * 4);
  }
  setPoints(mesh, { point: [positions, 3], color: [colors, 4] }, count);
  mesh.freezeWorldMatrix(matrix);
  return mesh;
}

// The view's Grease Pencil drawings. `matrix(layerToWorld)`: Blender's matrix as Babylon's; `look(ob)`: GreasedLine's
// settings for an object (BLENDER_LOOK's keys).
// A mesh's origin's depth in the view (its frozen world matrix is its object's).
const viewDepth = (view, mesh) => { const w = mesh.getWorldMatrix().m, v = view.m; return v[2] * w[12] + v[6] * w[13] + v[10] * w[14] + v[14]; };
// blender-port: gpencil_cache_utils.cc gpencil_object_cache_sort (gpencil_tobject_dist_sort): Grease Pencil objects drawn
// back to front by their origin's depth in the view, objects at one depth in the order they were made (Blender keeps
// its object order there), each one's drawings in its layer order (their alphaIndex). Each object's drawings stay
// together, so overlapping objects never trade places. Other transparent meshes sort as Babylon sorts them, and against
// the Grease Pencil drawings as one block at alphaIndex 0, so the order stays total.
export function greasePencilSortCompare(scene) {
  const ownerOf = (subMesh) => subMesh.getMesh().metadata?.greasePencil && subMesh.getMesh().metadata.drawOwner;
  return (a, b) => {
    const oa = ownerOf(a), ob = ownerOf(b);
    if (oa && ob && oa !== ob) {
      const view = scene.getViewMatrix();
      return viewDepth(view, b.getMesh()) - viewDepth(view, a.getMesh()) || oa.uniqueId - ob.uniqueId;
    }
    if (oa && !ob) return b._alphaIndex < 0 ? 1 : -1;
    if (ob && !oa) return a._alphaIndex < 0 ? -1 : 1;
    return RenderingGroup.defaultTransparentSortCompare(a, b);
  };
}

export function createGreasePencilDraw(scene, { matrix: babylonMatrix, look = () => BLENDER_LOOK }) {
  const drawings = new Map();
  scene.setRenderingOrder(0, null, null, greasePencilSortCompare(scene));
  // Draws `draws` (BlenderMain.greasePencil) for the objects `nodeOf` gives; returns whether a drawing packed anew had no
  // object to draw it for yet, so the next update repacks.
  function update(draws, nodeOf) {
    const seen = new Set();
    let missed = false;
    for (const draw of draws) {
      const owner = nodeOf(draw.ob);
      if (!owner) { missed ||= draw.changed; continue; }
      const key = `${draw.ob}:${draw.layer}:${draw.onion}`, name = `__grease_pencil ${owner.name} ${draw.layer} ${draw.onion}`;
      seen.add(key);
      const matrix = babylonMatrix(draw.layerToWorld), scale = meanScale(draw.layerToWorld);
      let drawn = drawings.get(key);
      if (!drawn) drawings.set(key, drawn = { base: strokeBatch(scene, name, owner), active: strokeBatch(scene, name + ' active', owner), hashes: [], split: 0, fill: null });
      const blend = BLEND_MODES[draw.blend] ?? Constants.ALPHA_COMBINE, settings = look(draw.ob);
      drawn.base.configure(settings, blend);
      drawn.active.configure(settings, blend);
      if (drawn.fill) drawn.fill.material.alphaMode = blend;
      if (!draw.changed) {
        drawn.base.place(matrix);
        drawn.active.place(matrix);
        drawn.fill?.freezeWorldMatrix(matrix);
        drawn.points?.freezeWorldMatrix(matrix);
        continue;
      }
      const hashes = Array.from({ length: draw.curves.length / CURVE_INTS }, (_, c) => draw.curves[c * CURVE_INTS + 4]);
      let changed = 0;
      while (changed < hashes.length && hashes[changed] === drawn.hashes[changed]) changed++;
      const total = hashes.length;
      if (changed < drawn.split || total - drawn.split > ACTIVE_STROKES) {
        drawn.split = total - changed <= ACTIVE_STROKES ? changed : total;
        drawn.base.set(strokeArrays(draw, 0, drawn.split, scale), matrix, alphaIndex(draw, 1));
      }
      drawn.active.set(strokeArrays(draw, drawn.split, total, scale), matrix, alphaIndex(draw, 2));
      drawn.hashes = hashes;
      drawn.fill = fillMesh(scene, name + ' fill', owner, draw, matrix, drawn.fill);
      drawn.points = editPoints(scene, name + ' points', draw, matrix, drawn.points);
    }
    for (const [key, drawn] of drawings) if (!seen.has(key)) dispose(key, drawn);
    return missed;
  }
  function dispose(key, drawn) {
    drawn.base.dispose();
    drawn.active.dispose();
    drawn.fill?.dispose();
    drawn.points?.dispose();
    drawings.delete(key);
  }
  return {
    update,
    meshes: () => [...drawings.values()].flatMap((d) => [d.base.mesh, d.active.mesh, d.fill]).filter(Boolean),
  };
}
