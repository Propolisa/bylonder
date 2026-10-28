// Overlay extras for objects without geometry (overlay_camera.hh, overlay_light.hh, overlay_empty.hh,
// overlay_extra_vert.glsl, overlay_extra_groundline_vert.glsl): cameras as their frame and triangle (filled for the
// scene camera), lights as their screen-space icon, type shape and a line to the floor, empties in their display
// type, in the theme's colors (selected and active ones in the selection colors). Each shape is a mesh sharing its
// shape's buffers; its object's matrix (in Blender's axes, with Blender's packed per-instance data) and color are
// uniforms set as it draws. pick() finds the extra under a point, as Blender's selection draws them.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import { SpotLight } from '@babylonjs/core/Lights/spotLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Viewport } from '@babylonjs/core/Maths/math.viewport.js';
import { view_3d as theme } from '../editors/interface/userdef-default-theme.js';
import { SHAPES, VCLASS } from './overlay-shape.js';
import { drawView, DRAW_VIEW_GLSL } from './draw-view.js';

const VIEW_UNIFORMS = `uniform mat4 viewProjection;
uniform vec3 viewRight;
uniform vec3 viewUp;
uniform vec3 viewPosition;
uniform float persp;
uniform float pixelFac;
${DRAW_VIEW_GLSL}
float zfac(vec3 p) { return pixelFac * drw_point_world_to_homogenous(p).w; }`;

const EXTRA_VERTEX = `precision highp float;
attribute vec3 position;
attribute float vclass;
uniform mat4 obmat;
uniform vec4 color;
${VIEW_UNIFORMS}
varying vec4 finalColor;
bool flag_test(int flag, int bit) { return (flag & bit) != 0; }
void main() {
  int vc = int(vclass);
  vec3 pos = position;
  mat4 input_mat = obmat;
  vec4 inst_data = vec4(input_mat[0][3], input_mat[1][3], input_mat[2][3], input_mat[3][3]);
  float inst_color_data = color.a;
  mat4 m = input_mat;
  m[0][3] = m[1][3] = m[2][3] = 0.0;
  m[3][3] = 1.0;
  finalColor = color;
  if (color.a < 0.0) finalColor.a = 1.0;
  vec2 lamp_area_size = inst_data.xy;
  float lamp_clip_sta = inst_data.z, lamp_clip_end = inst_data.w;
  float lamp_spot_cosine = inst_data.x, lamp_spot_blend = inst_data.y;
  vec2 camera_corner = inst_data.xy, camera_center = inst_data.zw;
  float camera_dist = color.a;
  vec3 empty_size = inst_data.xyz;
  float empty_scale = inst_data.w;
  float lamp_spot_sine;
  vec3 vpos = pos, vofs = vec3(0.0);
  if (flag_test(vc, ${VCLASS.LIGHT_AREA_SHAPE})) {
    if (inst_color_data < 0.0) lamp_area_size = vec2(-inst_color_data);
    vpos.xy *= lamp_area_size;
  }
  else if (flag_test(vc, ${VCLASS.LIGHT_SPOT_SHAPE})) {
    lamp_spot_sine = sqrt(1.0 - lamp_spot_cosine * lamp_spot_cosine);
    lamp_spot_sine *= flag_test(vc, ${VCLASS.LIGHT_SPOT_BLEND}) ? lamp_spot_blend : 1.0;
    vpos = vec3(pos.xy * lamp_spot_sine, -lamp_spot_cosine);
  }
  else if (flag_test(vc, ${VCLASS.LIGHT_DIST})) {
    int dist_axis = int(pos.z);
    float dist = pos.z - floor(pos.z) - 0.5;
    float inv = sign(dist);
    dist = abs(dist) > 0.15 ? lamp_clip_end : lamp_clip_sta;
    vofs[dist_axis] = inv * dist / length(m[dist_axis].xyz);
    vpos.z = 0.0;
    if (lamp_clip_end < 0.0) vpos = vofs = vec3(0.0);
  }
  else if (flag_test(vc, ${VCLASS.CAMERA_FRAME})) {
    if (camera_dist > 0.0) vpos.z = -abs(camera_dist);
    else vpos.z *= -abs(camera_dist);
    vpos.xy = (camera_center + camera_corner * vpos.xy) * abs(vpos.z);
  }
  else if (flag_test(vc, ${VCLASS.EMPTY_SCALED})) vpos *= empty_scale;
  else if (flag_test(vc, ${VCLASS.EMPTY_SIZE})) vpos *= empty_size;
  else if (flag_test(vc, ${VCLASS.EMPTY_AXES})) {
    float axis = vpos.z;
    vofs[int(axis)] = (1.0 + fract(axis)) * empty_scale;
    vpos *= length(m[int(axis)].xyz) * empty_scale;
    vec3 axis_color = vec3(0.0);
    axis_color[int(axis)] = 1.0;
    finalColor.rgb = mix(axis_color + fract(axis), color.rgb, color.a);
    finalColor.a = 1.0;
  }
  vec3 world_pos;
  if (flag_test(vc, ${VCLASS.SCREENSPACE})) {
    vec3 screen_pos = viewRight * vpos.x + viewUp * vpos.y;
    vec3 p = (m * vec4(vofs, 1.0)).xyz;
    world_pos = p + screen_pos * zfac(p);
  }
  else if (flag_test(vc, ${VCLASS.SCREENALIGNED})) world_pos = (m * vec4(vofs, 1.0)).xyz + viewRight * vpos.x + viewUp * vpos.y;
  else world_pos = (m * vec4(vofs + vpos, 1.0)).xyz;
  if (flag_test(vc, ${VCLASS.LIGHT_SPOT_CONE})) {
    vec2 perp = vec2(pos.y, -pos.x);
    const float incr_angle = 2.0 * 3.1415 / 32.0;
    vec2 slope = vec2(cos(incr_angle), sin(incr_angle));
    vec3 p0 = (m * vec4((pos.xy * slope.x + perp * slope.y) * lamp_spot_sine, -lamp_spot_cosine, 1.0)).xyz;
    vec3 p1 = (m * vec4((pos.xy * slope.x - perp * slope.y) * lamp_spot_sine, -lamp_spot_cosine, 1.0)).xyz;
    vec3 edge = m[3].xyz - world_pos;
    vec3 n0 = normalize(cross(edge, p0 - world_pos));
    vec3 n1 = normalize(cross(edge, world_pos - p1));
    vec3 V = persp != 0.0 ? normalize(viewPosition - world_pos) : cross(viewRight, viewUp);
    if ((dot(n0, V) > 0.0) == (dot(n1, V) > 0.0)) world_pos = m[3].xyz;
  }
  gl_Position = drw_point_world_to_homogenous(world_pos);
}`;

const GROUND_VERTEX = `precision highp float;
attribute vec3 position;
attribute float vclass;
uniform mat4 obmat;
uniform vec4 color;
${VIEW_UNIFORMS}
varying vec4 finalColor;
void main() {
  finalColor = color;
  vec3 screen_pos = viewRight * position.x + viewUp * position.y;
  vec3 p = obmat[3].xyz;
  p.z *= position.z == 0.0 ? 0.0 : 1.0;
  gl_Position = drw_point_world_to_homogenous(p + screen_pos * zfac(p));
}`;

const FRAGMENT = `precision highp float;
varying vec4 finalColor;
void main() { gl_FragColor = finalColor; }`;

// Blender light settings Babylon's lights do not have, at Blender's defaults.
const LIGHT_DEFAULTS = { clip_start: 0.05, cutoff_distance: 40, spot_blend: 0.15 };
const EMPTY_SHAPES = { PLAIN_AXES: 'plain_axes', ARROWS: 'arrows', SINGLE_ARROW: 'single_arrow', CIRCLE: 'circle', CUBE: 'cube', SPHERE: 'empty_sphere', CONE: 'empty_cone', IMAGE: 'quad_wire' };
const SOLID = new Set(['camera_tria']);
// Babylon (x, y, z) is Blender (x, z, y).
const blender = (v, out, o, sign = 1) => { out[o] = sign * v.x; out[o + 1] = sign * v.z; out[o + 2] = sign * v.y; };

// A light's Blender type and its shapes (Lights::object_sync).
const lightType = (light) => (light instanceof SpotLight ? 'SPOT' : light instanceof PointLight ? 'POINT' : light.getClassName() === 'RectAreaLight' ? 'AREA' : 'SUN');
function lightShapes(light) {
  const type = lightType(light);
  const shape = { POINT: 'light_point_lines', SUN: 'light_sun_lines', SPOT: 'light_spot_lines', AREA: 'light_area_square_lines' }[type];
  return { type, shapes: ['light_icon_outer_lines', 'light_icon_inner_lines', ...(type === 'SUN' ? ['light_icon_sun_rays'] : []), shape, 'ground_line'] };
}

//   objects() -> the scene's objects (world.objects), which hold the empties
//   color(node, themeType) -> its theme wire color (selected, active or the type's), sceneCamera() -> the scene camera,
//   visible(node), aspect() -> the render's width / height
export function createExtrasOverlay(scene, { objects, color: themeColor = (node, type) => theme[type], sceneCamera = () => null, visible = () => true, aspect = () => 16 / 9 }) {
  const materials = new Map();
  const material = (name, vertex, { solid = false, blend = false } = {}) => {
    const key = name + solid;
    if (materials.has(key)) return materials.get(key);
    const m = new ShaderMaterial('__overlay' + name, scene, { vertexSource: vertex, fragmentSource: FRAGMENT }, {
      attributes: ['position', 'vclass'], needAlphaBlending: blend,
      uniforms: ['viewProjection', 'obmat', 'color', 'viewRight', 'viewUp', 'viewPosition', 'persp', 'pixelFac'],
    });
    m.backFaceCulling = false;
    m.onBindObservable.add((mesh) => {
      const v = drawView(scene), e = m.getEffect(), data = mesh.metadata.extra;
      update(data);
      e.setMatrices('obmat', data.matrix);
      e.setFloat4('color', data.color[0], data.color[1], data.color[2], data.color[3]);
      e.setFloat3('viewRight', v.right[0], v.right[1], v.right[2]);
      e.setFloat3('viewUp', v.up[0], v.up[1], v.up[2]);
      e.setFloat3('viewPosition', v.position[0], v.position[1], v.position[2]);
      e.setFloat('persp', v.persp ? 1 : 0);
      e.setFloat('pixelFac', v.pixelFac);
    });
    materials.set(key, m);
    return m;
  };
  // One mesh per shape holds its buffers; every use shares them.
  const sources = new Map();
  const shapeMesh = (shape) => {
    if (!sources.has(shape)) {
      const verts = SHAPES[shape](), source = new Mesh('__shape ' + shape, scene);
      source.setVerticesData('position', Float32Array.from(verts.flatMap((v) => v.slice(0, 3))), false, 3);
      source.setVerticesData('vclass', Float32Array.from(verts, (v) => v[3]), false, 1);
      source.setEnabled(false);
      sources.set(shape, source);
    }
    const mesh = new Mesh('__extra ' + shape, scene);
    sources.get(shape).geometry.applyToMesh(mesh);
    const fill = SOLID.has(shape) ? Material.TriangleFillMode : Material.LineListDrawMode;
    mesh._getRenderingFillMode = () => fill;
    mesh.isUnIndexed = true;
    mesh.material = shape === 'ground_line' ? material('GroundLine', GROUND_VERTEX, { blend: true }) : material('Extra', EXTRA_VERTEX, { solid: SOLID.has(shape) });
    Object.assign(mesh, { isPickable: false, alwaysSelectAsActiveMesh: true, doNotSerialize: true });
    return mesh;
  };

  const entries = new Map(); // node -> { meshes, kind }
  let dirty = true;
  const markDirty = () => { dirty = true; };
  const observers = [
    [scene.onNewCameraAddedObservable, markDirty], [scene.onCameraRemovedObservable, markDirty],
    [scene.onNewLightAddedObservable, markDirty], [scene.onLightRemovedObservable, markDirty],
    [scene.onNewTransformNodeAddedObservable, markDirty], [scene.onTransformNodeRemovedObservable, markDirty],
  ].map(([observable, fn]) => [observable, observable.add(fn)]);

  const isEmpty = (node) => !node.getTotalVertices && !node.name.startsWith('__');
  const kindOf = (node) => (node instanceof Camera ? 'camera' : node.getClassName?.().endsWith('Light') ? 'light' : 'empty');
  const shapesOf = (node, kind) => {
    if (kind === 'camera') return ['camera_frame', node === sceneCamera() ? 'camera_tria' : 'camera_tria_wire'];
    if (kind === 'light') return lightShapes(node).shapes;
    return [EMPTY_SHAPES[node.metadata?.empty_display_type] ?? 'plain_axes'];
  };
  const extraNodes = () => [
    ...scene.cameras.filter((c) => !c.name.startsWith('__')),
    ...scene.lights,
    ...objects().filter(isEmpty),
  ];
  function rebuild() {
    dirty = false;
    const nodes = new Set(extraNodes());
    for (const [node, entry] of entries) {
      const signature = shapesOf(node, entry.kind).join();
      if (nodes.has(node) && !node.isDisposed?.() && entry.signature === signature) continue;
      entry.meshes.forEach((mesh) => mesh.dispose());
      entries.delete(node);
    }
    for (const node of nodes) {
      if (entries.has(node)) continue;
      const kind = kindOf(node), shapes = shapesOf(node, kind);
      const entry = { node, kind, lightType: kind === 'light' ? lightType(node) : null, signature: shapes.join(), matrix: new Float32Array(16), color: new Float32Array(4), meshes: [] };
      entry.meshes = shapes.map((shape) => {
        const mesh = shapeMesh(shape);
        mesh.metadata = { editable: false, overlay: true, extra: { entry, shape, matrix: new Float32Array(16), color: new Float32Array(4) } };
        return mesh;
      });
      entries.set(node, entry);
    }
  }

  const FORWARD = new Vector3(0, 0, 1);
  const right = new Vector3(), up = new Vector3(), forward = new Vector3(), position = new Vector3(), scaling = new Vector3();
  // The object's matrix in Blender's axes, columns x, y, z, location (column-major, as GLSL reads it).
  const setMatrix = (m, x, y, z, location, sx = 1, sy = 1, sz = 1) => {
    blender(x, m, 0, sx); blender(y, m, 4, sy); blender(z, m, 8, sz); blender(location, m, 12);
    m[3] = m[7] = m[11] = 0; m[15] = 1;
  };
  const basis = (node) => {
    const w = node.computeWorldMatrix();
    w.decompose(scaling, undefined, position);
    Vector3.TransformNormalToRef(Vector3.RightReadOnly, w, right);
    Vector3.TransformNormalToRef(Vector3.UpReadOnly, w, up);
    Vector3.TransformNormalToRef(FORWARD, w, forward);
  };
  const perpendicular = (z) => {
    // Any unit axes completing z: the spot's cone and the sun's rays are round.
    right.copyFromFloats(Math.abs(z.y) < 0.99 ? 0 : 1, Math.abs(z.y) < 0.99 ? 1 : 0, 0);
    Vector3.CrossToRef(right, z, up); up.normalize();
    Vector3.CrossToRef(z, up, right); right.normalize();
  };
  const wireColor = (node, kind, out) => {
    const c = themeColor(node, kind);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = 1;
  };

  // Fills a shape's uniforms from its object (Cameras/Lights/Empties::object_sync).
  function update(data) {
    const { entry, shape, matrix: m, color } = data, node = entry.node;
    wireColor(node, entry.kind, color);
    if (entry.kind === 'camera') {
      basis(node);
      forward.scaleInPlace(-1);
      right.normalize(); up.normalize(); forward.normalize();
      setMatrix(m, right, up, forward, position);
      // BKE_camera_view_frame_ex at draw size 1: the frame projected to depth 1.
      const ratio = aspect(), drawsize = 0.5, vertical = node.fovMode === Camera.FOVMODE_VERTICAL_FIXED;
      const ortho = node.mode === Camera.ORTHOGRAPHIC_CAMERA;
      const fac = ortho ? 0.5 * Math.abs((node.orthoRight ?? 1) - (node.orthoLeft ?? -1)) : drawsize;
      const depth = ortho ? -1 : -drawsize / Math.tan(node.fov / 2);
      const facx = fac * (vertical ? ratio : 1), facy = fac * (vertical ? 1 : 1 / ratio);
      const cx = facx / Math.abs(depth), cy = facy / Math.abs(depth);
      if (shape === 'camera_frame') { m[3] = cx; m[7] = cy; m[11] = 0; m[15] = 0; }
      else {
        const tria_size = 0.7 * drawsize / Math.abs(depth), tria_margin = 0.1 * drawsize / Math.abs(depth);
        m[3] = m[7] = -tria_size; m[11] = 0; m[15] = cy + tria_margin + tria_size;
      }
      color[3] = depth;
    } else if (entry.kind === 'light') {
      const light = node, type = entry.lightType;
      position.copyFrom(light.getAbsolutePosition?.() ?? light.position ?? Vector3.ZeroReadOnly);
      if (type === 'POINT') { right.copyFromFloats(1, 0, 0); up.copyFromFloats(0, 0, 1); forward.copyFromFloats(0, 1, 0); }
      else if (type === 'AREA') { right.copyFromFloats(1, 0, 0); up.copyFromFloats(0, 1, 0); forward.copyFromFloats(0, 0, 1); }
      else {
        // Blender's lights shine down their -Z; a hemispheric light's direction points at its sky.
        forward.copyFrom(light.direction).normalize();
        if (!(light instanceof HemisphericLight)) forward.scaleInPlace(-1);
        perpendicular(forward);
      }
      const spot = type === 'SPOT' ? 10 : 1;
      setMatrix(m, right, up, forward, position, spot, spot, spot);
      if (shape === 'ground_line') { color.set(theme.light); return; }
      m[11] = LIGHT_DEFAULTS.clip_start;
      m[15] = LIGHT_DEFAULTS.cutoff_distance;
      if (type === 'POINT') m[3] = m[7] = light.radius;
      else if (type === 'AREA') { m[3] = light.width; m[7] = light.height; }
      else if (type === 'SPOT') {
        const a = Math.cos(light.angle / 2), b = LIGHT_DEFAULTS.spot_blend, c = a * b - a - b, a2 = a * a, c2 = c * c;
        m[3] = a;
        m[7] = Math.sqrt((a2 - a2 * c2) / (c2 - a2 * c2));
        color[3] = -Math.max(light.radius, 1e-30);
      }
    } else {
      basis(node);
      // Blender's local Y and Z are Babylon's local Z and Y.
      setMatrix(m, right, forward, up, position);
      m[15] = node.metadata?.empty_display_size ?? 1;
    }
  }

  return {
    get meshes() { if (dirty) rebuild(); return [...entries.values()].flatMap((e) => e.meshes); },
    // Called per view right before it renders.
    setEnabled(value) {
      if (dirty) rebuild();
      for (const entry of entries.values()) {
        const shown = value && visible(entry.node);
        for (const mesh of entry.meshes) mesh.isVisible = shown;
      }
    },
    changed: markDirty,
    // The extra object under a point of a view (pixels in its render target), within Blender's selection radius.
    pick(x, y, camera, accept = () => true) {
      if (dirty) rebuild();
      let best = null, bestDistance = Infinity;
      const engine = scene.getEngine(), transform = camera.getTransformationMatrix();
      const region = new Viewport(0, 0, engine.getRenderWidth() * camera.viewport.width, engine.getRenderHeight() * camera.viewport.height);
      const project = (p) => Vector3.Project(p, Matrix.IdentityReadOnly, transform, region);
      for (const entry of entries.values()) {
        if (!visible(entry.node) || !accept(entry.node)) continue;
        const points = pickSegments(entry);
        for (let i = 0; i < points.length; i += 2) {
          const a = project(points[i]), b = points[i + 1] ? project(points[i + 1]) : a;
          const d = segmentDistance(x, y, a, b) - (entry.kind === 'light' && !points[i + 1] ? 12 : 0);
          if (a.z >= 0 && a.z <= 1 && d < bestDistance) { bestDistance = d; best = entry.node; }
        }
      }
      return bestDistance <= 5 ? best : null;
    },
    dispose() {
      for (const [observable, observer] of observers) observable.remove(observer);
      for (const entry of entries.values()) entry.meshes.forEach((mesh) => mesh.dispose());
      for (const source of sources.values()) source.dispose();
      for (const m of materials.values()) m.dispose();
    },
  };

  // World-space line segments (pairs of Babylon points) that select an extra; a lone point is a light's icon.
  function pickSegments(entry) {
    const data = entry.meshes[0].metadata.extra;
    update(data);
    const m = data.matrix, point = (x, y, z) => new Vector3(
      m[0] * x + m[4] * y + m[8] * z + m[12], m[2] * x + m[6] * y + m[10] * z + m[14], m[1] * x + m[5] * y + m[9] * z + m[13]);
    if (entry.kind === 'light') return [point(0, 0, 0), null];
    if (entry.kind === 'camera') {
      const depth = Math.abs(data.color[3]), cx = m[3] * depth, cy = m[7] * depth;
      const corners = [[-cx, -cy], [-cx, cy], [cx, cy], [cx, -cy]].map(([x, y]) => point(x, y, -depth));
      return corners.flatMap((c, i) => [c, corners[(i + 1) % 4], c, point(0, 0, 0)]);
    }
    const size = m[15];
    return SHAPES[data.shape === 'arrows' ? 'plain_axes' : data.shape]().filter((v) => v[3] === VCLASS.EMPTY_SCALED || v[3] === VCLASS.NONE).map(([x, y, z]) => point(x * size, y * size, z * size));
  }
}

function segmentDistance(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length2)) : 0;
  return Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
}
