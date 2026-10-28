// The 3D Viewport's floor grid and axis lines (overlay_grid.hh, overlay_grid_vert/frag.glsl): lines generated from
// the vertex index on three grid levels around the point of interest, the levels chosen and faded by the distance
// to the floor, faded with distance, at grazing angles and at the edge of each level, in the theme's grid colors.
// Blender draws four passes with growing depth bias and fading alpha to blend the floor into geometry on it; one
// alpha-blended pass is drawn here.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { view_3d as theme, user_interface, colorShade, colorBlendShade } from '../editors/interface/userdef-default-theme.js';
import { drawView, DRAW_VIEW_GLSL } from './draw-view.js';

const STEPS_LEN = 8, STEPS_DRAW = 3;
const SHOW_GRID = 1, SHOW_AXES = 2, AXIS_X = 4, AXIS_Y = 8, PLANE_XY = 32, PLANE_XZ = 64, PLANE_YZ = 128, GRID_ALIGNED = 256, GRID_BEHIND_GEOMETRY = 4096;

const VERTEX = `precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
uniform vec4 steps[${STEPS_LEN}];
uniform vec2 offset;
uniform vec2 clipRect;
uniform float level;
uniform float numLines;
uniform float gridFlag;
uniform vec3 viewPosition;
uniform float persp;
uniform float pixelFac;
uniform vec2 sizeViewport;
varying vec3 vPos;
varying vec2 vCoord;
flat varying float vEmphasis;
flat varying float vAlpha;
flat varying vec2 vEdgeStart;
varying vec2 vEdgePos;
${DRAW_VIEW_GLSL}
bool flag_test(int flag, int bit) { return (flag & bit) != 0; }
int grid_flag, axis, line_level, lvl;
float step_size;
vec2 step_offs, clip_min, clip_max;
// One end of the current line: its [-1, 1] coordinate and world position, false when it is not drawn.
bool line_end(vec2 P, out vec2 coord, out vec3 pos) {
  coord = P / max(float(int(numLines) >> 1), 1.0);
  P = step_offs + step_size * P;
  pos = vec3(0.0);
  if (all(lessThan(P, clip_min)) || all(greaterThan(P, clip_max))) return false;
  P = clamp(P, clip_min, clip_max);
  if (flag_test(grid_flag, ${SHOW_GRID})) {
    if (flag_test(grid_flag, ${PLANE_XY})) pos.xy = P;
    else if (flag_test(grid_flag, ${PLANE_XZ})) pos.xz = P;
    else pos.yz = P;
    // A line under a line of the next level is drawn by that level.
    if (line_level < ${STEPS_DRAW} - 1 && lvl < ${STEPS_LEN} - 1) {
      float j = abs(P[1 - axis]) / steps[lvl + 1][axis];
      if (abs(floor(j + 0.5) - j) <= 1e-4) return false;
    }
  }
  else {
    if (!flag_test(grid_flag, ${AXIS_X} << axis)) return false;
    pos[axis] = P.x;
  }
  return true;
}
vec4 clip_position(vec3 pos) {
  vec4 p = drw_point_world_to_homogenous(pos);
  if (persp != 0.0) p.z += mix(0.00025, -0.0002, float(line_level) / ${4 * STEPS_DRAW}.0);
  else if (flag_test(grid_flag, ${GRID_BEHIND_GEOMETRY})) p.z = p.w;
  return p;
}
// Liang-Barsky clipping of a clip-space segment to the view volume: the kept range of t, empty when t0 > t1.
vec2 clip_segment(vec4 a, vec4 b) {
  vec2 t = vec2(0.0, 1.0);
  vec4 d = b - a;
  for (int i = 0; i < 3; i++) {
    for (int s = -1; s <= 1; s += 2) {
      float pa = a.w + float(s) * a[i], pd = d.w + float(s) * d[i];
      if (pd == 0.0) { if (pa < 0.0) return vec2(1.0, 0.0); }
      else if (pd > 0.0) t.x = max(t.x, -pa / pd);
      else t.y = min(t.y, -pa / pd);
    }
  }
  return t;
}
void main() {
  grid_flag = int(gridFlag);
  int num_lines = int(numLines);
  gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  int vertex_id = int(position.x);
  int side = vertex_id & 1;
  vec2 P;
  if (flag_test(grid_flag, ${SHOW_GRID})) {
    vertex_id = vertex_id >> 1;
    axis = vertex_id & 1;
    vertex_id = vertex_id >> 1;
    line_level = ${STEPS_DRAW} - 1 - vertex_id / num_lines;
    if (line_level < 0) return;
    vertex_id = vertex_id % num_lines;
    P = vec2(max(float(num_lines >> 1), 1.0), float(vertex_id) - float(num_lines >> 1));
  }
  else {
    axis = vertex_id >> 1;
    line_level = ${STEPS_DRAW} - 1;
    P = vec2(max(float(num_lines >> 1), 1.0), 0.0);
  }
  lvl = clamp(int(level) + line_level - (flag_test(grid_flag, ${GRID_ALIGNED}) ? 0 : 1), 0, ${STEPS_LEN} - 1);
  step_size = steps[lvl][axis];
  step_offs = offset;
  if (flag_test(grid_flag, ${SHOW_GRID})) {
    if (axis == 0) step_offs.y = round(offset.y / step_size) * step_size;
    else step_offs.x = round(offset.x / step_size) * step_size;
    clip_min = step_offs - clipRect;
    clip_max = step_offs + clipRect;
  }
  else {
    step_offs = vec2(viewPosition[axis], 0.0);
    float clip = axis == 2 ? clipRect.x : (flag_test(grid_flag, ${PLANE_YZ}) ? vec3(0.0, clipRect) : flag_test(grid_flag, ${PLANE_XZ}) ? vec3(clipRect.x, 0.0, clipRect.y) : vec3(clipRect, 0.0))[axis];
    clip_min = vec2(step_offs.x - clip, 0.0);
    clip_max = vec2(step_offs.x + clip, 0.0);
  }
  vEmphasis = clamp(float(line_level) - fract(level), 0.0, 1.0);
  vAlpha = clamp(float(line_level) + 1.0 - fract(level), 0.0, 1.0);
  if (persp == 0.0) vAlpha *= smoothstep(step_size * 0.25, step_size * 0.015625, pixelFac);
  // Both ends, clipped to the view volume here: long lines through the eye plane are not drawn reliably otherwise.
  vec2 P0 = vec2(-P.x, P.y), P1 = P;
  if (flag_test(grid_flag, ${SHOW_GRID}) && axis != 0) { P0 = P0.yx; P1 = P1.yx; }
  vec2 coord0, coord1;
  vec3 pos0, pos1;
  if (!line_end(P0, coord0, pos0) || !line_end(P1, coord1, pos1)) return;
  vec4 c0 = clip_position(pos0), c1 = clip_position(pos1);
  vec2 t = clip_segment(c0, c1);
  if (t.x > t.y) return;
  float k = side != 0 ? t.y : t.x;
  vPos = mix(pos0, pos1, k);
  vCoord = mix(coord0, coord1, k);
  gl_Position = mix(c0, c1, k);
  vEdgeStart = vEdgePos = ((gl_Position.xy / gl_Position.w) * 0.5 + 0.5) * sizeViewport;
}`;

const FRAGMENT = `precision highp float;
uniform float gridFlag;
uniform vec3 viewPosition;
uniform vec3 viewForward;
uniform float persp;
uniform float farClip;
uniform vec4 colorGrid;
uniform vec4 colorEmphasis;
uniform vec4 colorAxisX;
uniform vec4 colorAxisY;
uniform vec4 colorAxisZ;
varying vec3 vPos;
varying vec2 vCoord;
flat varying float vEmphasis;
flat varying float vAlpha;
flat varying vec2 vEdgeStart;
varying vec2 vEdgePos;
bool flag_test(int flag, int bit) { return (flag & bit) != 0; }
void main() {
  int grid_flag = int(gridFlag);
  const float eps = 2e-7;
  bvec3 axis_mask = bvec3(flag_test(grid_flag, ${AXIS_X}) && all(lessThanEqual(abs(vPos.yz), vec2(eps))),
                          flag_test(grid_flag, ${AXIS_Y}) && all(lessThanEqual(abs(vPos.xz), vec2(eps))),
                          flag_test(grid_flag, ${AXIS_X << 2}) && all(lessThanEqual(abs(vPos.xy), vec2(eps))));
  if (any(axis_mask) && flag_test(grid_flag, ${SHOW_GRID})) discard;
  vec4 color = axis_mask.x ? colorAxisX : axis_mask.y ? colorAxisY : axis_mask.z ? colorAxisZ : mix(colorGrid, colorEmphasis, vEmphasis);
  color.a *= vAlpha;
  if (persp != 0.0) {
    color.a *= 1.0 - min(1.0, length(vCoord));
    vec3 V = viewPosition - vPos;
    float dist = length(V);
    V /= dist;
    if (vPos.z == 0.0) color.a *= 1.0 - pow(1.0 - abs(V.z), 3.0);
    color.a *= 1.0 - smoothstep(0.0, 0.5 * farClip, dist - 0.5 * farClip);
  }
  else {
    float length_fade = 1.0 - min(1.0, dot(vCoord, vCoord));
    color.a *= length_fade * length_fade;
    if (flag_test(grid_flag, ${PLANE_XY})) color.a *= 1.0 - pow(1.0 - abs(viewForward.z), 3.0);
  }
  // Low alpha lines become dashes.
  const float dash_width = 4.0, fade_start = 0.1;
  if (color.a < fade_start && color.a / fade_start < fract(distance(vEdgeStart, vEdgePos) / dash_width)) discard;
  gl_FragColor = color;
}`;

// Grid steps for metric units in a user view (view3d_grid_steps_ex): one meter and up, ten times larger each.
const STEPS = Float32Array.from({ length: STEPS_LEN * 4 }, (_, i) => 10 ** Math.floor(i / 4));
const LINES = { persp: 151, ortho: 301 };

// The axis a Babylon camera looks along, if it looks along one (an aligned orthographic view): 0 X, 1 Y, 2 Z.
const alignedAxis = (forward) => forward.findIndex((v) => Math.abs(v) > 0.99999);

export function createGridOverlay(scene) {
  const colors = {
    colorGrid: colorShade(theme.grid, 10),
    // Division lines lighter than the grid on a background darker than the grid.
    colorEmphasis: colorShade(theme.grid_major, 20),
    ...Object.fromEntries(['x', 'y', 'z'].map((a) => ['colorAxis' + a.toUpperCase(),
      colorBlendShade(theme.grid, user_interface['axis_' + a], 0.85, Math.trunc((theme.grid_axis_brightness * 2 - 1) * 255))])),
  };
  const material = new ShaderMaterial('__gridOverlay', scene, { vertexSource: VERTEX, fragmentSource: FRAGMENT }, {
    attributes: ['position'], needAlphaBlending: true,
    uniforms: ['viewProjection', 'steps', 'offset', 'clipRect', 'level', 'numLines', 'gridFlag', 'viewPosition', 'viewForward', 'persp', 'pixelFac', 'sizeViewport', 'farClip', ...Object.keys(colors)],
  });
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.setArray4('steps', [...STEPS]);
  for (const [name, c] of Object.entries(colors)) material.setColor4(name, new Color4(...c));
  const part = (name, count, flags) => {
    const mesh = new Mesh(name, scene);
    // Each vertex holds its index: Blender's shader reads gl_VertexID, which crashed Chromium's software GL here.
    mesh.setVerticesData(VertexBuffer.PositionKind, Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 ? 0 : i / 3)), false);
    Object.assign(mesh, { isUnIndexed: true, isPickable: false, alwaysSelectAsActiveMesh: true, doNotSerialize: true, material });
    mesh.metadata = { editable: false, overlay: true, gridFlags: flags };
    mesh._getRenderingFillMode = () => Material.LineListDrawMode;
    return mesh;
  };
  const grid = part('__grid', 4 * STEPS_DRAW * LINES.ortho, 'grid'), axes = part('__gridAxes', 6, 'axes');
  const offset = [0, 0];
  material.onBindObservable.add((mesh) => {
    const v = drawView(scene), effect = material.getEffect(), f = v.forward, eye = v.position;
    const aligned = v.persp ? -1 : alignedAxis(f);
    let gridFlag, axisFlag;
    if (aligned < 0) {
      axisFlag = SHOW_AXES | AXIS_X | AXIS_Y;
      gridFlag = SHOW_GRID | PLANE_XY | AXIS_X | AXIS_Y;
    } else {
      // Right/left views show Y and Z, top/bottom X and Y, front/back X and Z, on the plane they look at.
      const shown = [[1, 2], [0, 2], [0, 1]][aligned];
      axisFlag = SHOW_AXES | GRID_ALIGNED | GRID_BEHIND_GEOMETRY | shown.reduce((bits, a) => bits | (AXIS_X << a), 0);
      gridFlag = SHOW_GRID | GRID_ALIGNED | GRID_BEHIND_GEOMETRY | [PLANE_YZ, PLANE_XZ, PLANE_XY][aligned] | AXIS_X | AXIS_Y;
    }
    const camera = scene.activeCamera;
    let dist;
    if (v.persp) dist = Math.abs(eye[2] / f[2]) + (Math.abs(eye[2]) - Math.abs(eye[2] / f[2])) * (1 - Math.abs(f[2]));
    else if (aligned >= 0) dist = Math.max(10 * 12 / (v.size[0] * v.winmat[0]), STEPS[0]);
    else dist = camera.radius ?? 10;
    if (aligned === 0) { offset[0] = eye[1]; offset[1] = eye[2]; }
    else if (aligned === 1) { offset[0] = eye[0]; offset[1] = eye[2]; }
    else if (aligned === 2) { offset[0] = eye[0]; offset[1] = eye[1]; }
    else {
      const t = v.persp ? dist : (Math.abs(f[2]) > 1e-6 ? eye[2] / f[2] : 0);
      offset[0] = eye[0] - t * f[0];
      offset[1] = eye[1] - t * f[1];
    }
    let level = STEPS_LEN - 1;
    for (let i = 0; i < STEPS_LEN; i++) {
      const curr = STEPS[i * 4], next = i < STEPS_LEN - 1 ? STEPS[i * 4 + 4] : curr * 10;
      if (next >= dist || i === STEPS_LEN - 1) { level = i + (dist - curr) / (next - curr); break; }
    }
    const far = camera.maxZ;
    effect.setFloat('gridFlag', mesh === grid ? gridFlag : axisFlag);
    effect.setFloat('numLines', v.persp ? LINES.persp : LINES.ortho);
    effect.setFloat('level', level);
    effect.setFloat2('offset', offset[0], offset[1]);
    if (v.persp) effect.setFloat2('clipRect', far, far); else effect.setFloat2('clipRect', 4 / v.winmat[0], 4 / v.winmat[1]);
    effect.setFloat3('viewPosition', eye[0], eye[1], eye[2]);
    effect.setFloat3('viewForward', f[0], f[1], f[2]);
    effect.setFloat('persp', v.persp ? 1 : 0);
    effect.setFloat('pixelFac', v.pixelFac);
    effect.setFloat2('sizeViewport', v.size[0], v.size[1]);
    effect.setFloat('farClip', far);
  });
  return {
    meshes: [grid, axes],
    dispose() { grid.dispose(); axes.dispose(); material.dispose(); },
  };
}
