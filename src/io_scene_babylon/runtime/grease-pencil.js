// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Grease Pencil drawings in Babylon, for the app's view (draw/grease-pencil.js) and for exported pages: a drawing's strokes
// as GreasedLine meshes, its points' radii as widths and their colors in a colors texture, and its fills as one mesh of
// their triangles. A drawing is `{ curves, points, triangles }`: CURVE_INTS per curve (first point, points, flags,
// material index, hash), POINT_FLOATS per point (position in Babylon's axes, radius, stroke color, fill color,
// selection, weight), colors in display sRGB, and the fills' triangles by point. In a page it is also the `grease_pencil`
// implementation of `grease_pencil:LAYER` entities: a layer shows the drawing of its last key at or before the frame.
import { Constants, CreateGreasedLineMaterial, GreasedLineMesh, Material, MaterialPluginBase, Matrix, Mesh, RawTexture, ShaderMaterial, TransformNode, Vector2, VertexData } from '@babylonjs/core';

export const CURVE_INTS = 5, POINT_FLOATS = 14;
export const CURVE_CYCLIC = 1, CURVE_STROKE = 2, CURVE_FILL = 4;
// A layer's blend mode (Regular, Hard Light, Add, Subtract, Multiply, Divide) as Babylon's alpha modes; Hard Light and
// Divide blend normally.
export const BLEND_MODES = [Constants.ALPHA_COMBINE, Constants.ALPHA_COMBINE, Constants.ALPHA_ADD, Constants.ALPHA_SUBTRACT, Constants.ALPHA_MULTIPLY, Constants.ALPHA_COMBINE];
// GreasedLineMeshColorDistributionType and GreasedLineMeshColorMode.
const COLOR_DISTRIBUTION_SEGMENT = 0, COLOR_MODE_SET = 0;

/** @typedef {{ curves: Int32Array, points: Float32Array, triangles: Uint32Array }} Drawing */
/** @typedef {{ lines: Float32Array[], widths: number[], colors: Float32Array }} Strokes */

/**
 * The layer order within the transparent pass: onion skins first, then layers bottom to top, each layer's fills under
 * its strokes (`part` 0, then 1 and 2).
 * @param {{ onion: number, layer: number }} draw
 * @param {number} part
 */
export const alphaIndex = (draw, part) => (draw.onion ? -1000 : 0) + draw.layer * 3 + part;

/**
 * The mean scale of a matrix's axes, by which a stroke's radius scales.
 * @param {ArrayLike<number>} m
 */
export const meanScale = (m) => [0, 4, 8].reduce((sum, i) => sum + Math.hypot(m[i], m[i + 1], m[i + 2]), 0) / 3;

const FILL_VERTEX = `precision highp float;
attribute vec3 position;
attribute vec4 color;
uniform mat4 worldViewProjection;
varying vec4 vColor;
void main() { vColor = color; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
// Colors come in display sRGB: a view that draws in scene linear (its post-process displaying it) takes them back to linear.
const FILL_FRAGMENT = `precision highp float;
varying vec4 vColor;
uniform float sceneLinear;
uniform vec3 gpLight;
vec3 linear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void main() { if (vColor.a <= 0.0) discard; gl_FragColor = vec4(sceneLinear > 0.5 ? linear(vColor.rgb) * gpLight : vColor.rgb, vColor.a); }`;

// GreasedLine sets a stroke's color after Babylon's material takes its color to scene linear: this does it after, and
// lights it as Blender's Grease Pencil engine lights a layer (gpencil_frag.glsl: fragColor.rgb *= gpencil_lighting()):
// a layer that uses lights by its scene's world color (gpencil_engine_c.cc, the ambient light), another unlit.
class SceneLinearStrokePlugin extends MaterialPluginBase {
  /** @param {Material} material */
  constructor(material) {
    super(material, 'BlenderSceneLinearStroke', 300, {}, true, true);
    this.light = [1, 1, 1];
  }
  getClassName() { return 'BlenderSceneLinearStrokePlugin'; }
  isCompatible() { return true; }
  getUniforms() { return { ubo: [{ name: 'gpLight', size: 3, type: 'vec3' }] }; }
  /** @param {any} uniformBuffer */
  bindForSubMesh(uniformBuffer) { uniformBuffer.updateFloat3('gpLight', this.light[0], this.light[1], this.light[2]); }
  /** @param {string} shaderType @param {number} [shaderLanguage] */
  getCustomCode(shaderType, shaderLanguage = 0) {
    const linear = shaderLanguage === 0 ? 'color.rgb = toLinearSpace(color.rgb) * gpLight;' : 'color = vec4f(toLinearSpaceVec3(color.rgb) * uniforms.gpLight, color.a);';
    return shaderType === 'fragment' ? { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `#ifdef IMAGEPROCESSINGPOSTPROCESS\n${linear}\n#endif\n` } : null;
  }
}

/**
 * A layer's lighting on its stroke and fill materials: the ambient light Blender gives it (its world's color when it
 * uses lights), white (unlit) for null.
 * @param {(Material | null | undefined)[]} materials
 * @param {ArrayLike<number> | null} light
 */
export function lightLayer(materials, light) {
  const rgb = light ? Array.from(light) : [1, 1, 1];
  for (const material of materials) {
    const plugin = /** @type {any} */ (material?.pluginManager?.getPlugin('BlenderSceneLinearStroke'));
    if (plugin) plugin.light = rgb;
    else if (material) material.metadata = { ...material.metadata, gpLight: rgb };
  }
}

/**
 * A drawing's strokes from `first` to `last` curve as GreasedLine points, widths (two per point) and their colors.
 * @param {Drawing} draw
 * @param {number} first
 * @param {number} last
 * @param {number} scale the layer's, by which radii scale
 * @returns {Strokes}
 */
export function strokeArrays(draw, first, last, scale) {
  const { curves, points } = draw, lines = [];
  /** @type {number[]} */
  const widths = [];
  /** @type {number[]} */
  const colors = [];
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

/**
 * A colors texture the size of `count` colors (RGBA floats), laid out as GreasedLine looks them up; `kept` is updated
 * when it has that size.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {Float32Array} colors
 * @param {RawTexture | null} [kept]
 */
export function colorsTexture(scene, colors, kept) {
  const count = colors.length / 4, max = scene.getEngine().getCaps().maxTextureSize;
  const width = Math.max(1, Math.min(count, max)), height = Math.max(1, Math.ceil(count / max));
  const data = new Float32Array(width * height * 4);
  data.set(colors);
  const size = kept?.getSize();
  if (kept && size?.width === width && size.height === height) {
    kept.update(data);
    return kept;
  }
  kept?.dispose();
  return new RawTexture(data, width, height, Constants.TEXTUREFORMAT_RGBA, scene, false, true, Constants.TEXTURE_NEAREST_NEAREST, Constants.TEXTURETYPE_FLOAT);
}

/** The stroke materials' plugins of each scene, which draw at the size of the view they draw in. @type {WeakMap<import('@babylonjs/core').Scene, Set<any>>} */
const following = new WeakMap();

/**
 * GreasedLine widens strokes by the aspect of the view it draws in: each view (and a render) sets it before drawing.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {any} plugin a GreasedLinePluginMaterial
 */
export function followResolution(scene, plugin) {
  let plugins = following.get(scene);
  if (!plugins) {
    following.set(scene, plugins = new Set());
    const resolution = new Vector2(), shown = plugins;
    scene.onBeforeCameraRenderObservable.add(() => {
      const engine = scene.getEngine();
      resolution.set(engine.getRenderWidth(), engine.getRenderHeight());
      for (const p of shown) p.resolution = resolution;
    });
  }
  plugins.add(plugin);
  plugin._material?.onDisposeObservable.addOnce(() => plugins.delete(plugin));
}

/**
 * A material for strokes: widths in world units, or in pixels with `sizeAttenuation`.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} name
 * @param {boolean} sizeAttenuation
 */
export function greasedLineMaterial(scene, name, sizeAttenuation) {
  const material = /** @type {import('@babylonjs/core').StandardMaterial} */ (CreateGreasedLineMaterial(name, { useColors: true, width: 1, sizeAttenuation, colorMode: COLOR_MODE_SET,
    colorDistributionType: COLOR_DISTRIBUTION_SEGMENT, cameraFacing: true }, scene));
  Object.assign(material, { transparencyMode: Material.MATERIAL_ALPHABLEND, disableDepthWrite: true, backFaceCulling: false, disableLighting: true });
  new SceneLinearStrokePlugin(material);
  return material;
}

/**
 * The GreasedLine mesh of strokes, its colors in `texture` (made or updated).
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} name
 * @param {Strokes} strokes
 * @param {any} plugin the material's GreasedLinePluginMaterial
 * @param {RawTexture | null} [texture]
 */
export function strokesMesh(scene, name, { lines, widths, colors }, plugin, texture) {
  let pointer = 0;
  const colorPointers = lines.flatMap((line) => Array.from({ length: line.length / 3 }, () => [pointer, pointer++]).flat());
  plugin.colorsTexture = colorsTexture(scene, colors, texture);
  return new GreasedLineMesh(name, scene, { points: lines, widths, colorPointers });
}

/**
 * A material for fills, drawn in their points' colors.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} name
 */
export function fillMaterial(scene, name) {
  const material = Object.assign(new ShaderMaterial(name, scene, { vertexSource: FILL_VERTEX, fragmentSource: FILL_FRAGMENT },
    { attributes: ['position', 'color'], uniforms: ['worldViewProjection', 'sceneLinear', 'gpLight'], needAlphaBlending: true }), { backFaceCulling: false, disableDepthWrite: true });
  material.onBindObservable.add(() => {
    const effect = material.getEffect(), light = material.metadata?.gpLight ?? [1, 1, 1];
    effect?.setFloat('sceneLinear', +scene.imageProcessingConfiguration.applyByPostProcess);
    effect?.setFloat3('gpLight', light[0], light[1], light[2]);
  });
  return material;
}

/**
 * A drawing's fills as a mesh (`kept` when given): its points' positions and fill colors, its triangles; null without fills.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} name
 * @param {Drawing} draw
 * @param {Mesh | null} [kept]
 */
export function fillMesh(scene, name, draw, kept) {
  if (!draw.triangles.length) { kept?.dispose(); return null; }
  const mesh = kept ?? new Mesh(name, scene);
  const count = draw.points.length / POINT_FLOATS, positions = new Float32Array(count * 3), colors = new Float32Array(count * 4);
  for (let p = 0; p < count; p++) {
    positions.set(draw.points.subarray(p * POINT_FLOATS, p * POINT_FLOATS + 3), p * 3);
    colors.set(draw.points.subarray(p * POINT_FLOATS + 8, p * POINT_FLOATS + 12), p * 4);
  }
  Object.assign(new VertexData(), { positions, colors, indices: Uint32Array.from(draw.triangles) }).applyToMesh(mesh, false);
  mesh.material ??= fillMaterial(scene, name);
  return mesh;
}

/**
 * A layer's input as a `grease_pencil:LAYER` entity gives it: its index in the object's layers, blend mode, matrix in its
 * object's space (Babylon's layout), scale, keyed frames and the drawing of each (null: none shown from that key on).
 * @typedef {{ layer: number, blend: number, matrix: number[], scale: number, light?: number[] | null, frames: number[], drawings: (Drawing | null)[] }} Layer
 */

/**
 * The drawing a layer shows at a frame: its last key's at or before it.
 * @param {Pick<Layer, 'frames' | 'drawings'>} layer
 * @param {number} frame
 */
export function drawingAt({ frames, drawings }, frame) {
  let at = -1;
  while (at + 1 < frames.length && frames[at + 1] <= frame) at++;
  return at < 0 ? null : drawings[at];
}

/**
 * The layer's drawing at the frame, as geometry.
 * @param {Layer & { frame?: number }} inputs
 * @param {{ frame: number }} context
 */
export function run({ frame: _, frames, drawings, ...layer }, { frame }) {
  return { geometry: { grease_pencil: { ...layer, drawing: drawingAt({ frames, drawings }, Math.floor(frame)) } } };
}

/** A layer's meshes in a page, under its object's node, each drawing's made once. @type {WeakMap<object, Map<Float32Array, Mesh[]>>} */
const made = new WeakMap();

/**
 * Draws a layer under its object's node: its drawing shown, the others hidden.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} node the object's
 * @param {Omit<Layer, 'frames' | 'drawings'> & { drawing: Drawing | null }} layer
 */
export function drawLayer(scene, node, { layer, blend, matrix, scale, light = null, drawing }) {
  const owner = scene.getNodeById(node);
  if (!owner) return;
  const holderId = `${node}/grease_pencil/${layer}`;
  let holder = /** @type {TransformNode | null} */ (scene.getTransformNodeById(holderId));
  if (!holder) {
    holder = new TransformNode(holderId, scene);
    holder.id = holderId;
    holder.parent = owner;
    Matrix.FromArray(matrix).decompose(holder.scaling, holder.rotationQuaternion ??= holder.rotation.toQuaternion(), holder.position);
  }
  const drawn = made.get(holder) ?? new Map();
  made.set(holder, drawn);
  if (drawing && !drawn.has(drawing.points)) {
    const name = `${holderId}/${drawn.size}`, order = { onion: 0, layer };
    const material = greasedLineMaterial(scene, name, false), plugin = material.pluginManager?.getPlugin('GreasedLinePluginMaterial');
    followResolution(scene, plugin);
    const strokes = strokeArrays(drawing, 0, drawing.curves.length / CURVE_INTS, scale);
    const meshes = [];
    if (strokes.lines.length) meshes.push(Object.assign(strokesMesh(scene, name, strokes, plugin), { material, alphaIndex: alphaIndex(order, 1) }));
    const fill = fillMesh(scene, name + ' fill', drawing);
    if (fill) meshes.push(Object.assign(fill, { alphaIndex: alphaIndex(order, 0) }));
    material.alphaMode = BLEND_MODES[blend] ?? Constants.ALPHA_COMBINE;
    if (fill?.material) fill.material.alphaMode = material.alphaMode;
    lightLayer([material, fill?.material], light);
    for (const mesh of meshes) mesh.parent = holder;
    drawn.set(drawing.points, meshes);
  }
  for (const [points, meshes] of drawn) for (const mesh of meshes) mesh.setEnabled(points === drawing?.points);
}
