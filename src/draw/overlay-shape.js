// The overlay engine's extra shapes (overlay_shape.cc): line lists (triangles for camera_tria) of positions with a
// vertex class that tells overlay_extra_vert.glsl how to place each vertex. Same vertices as Blender's.
export const VCLASS = {
  NONE: 0, LIGHT_AREA_SHAPE: 1 << 0, LIGHT_SPOT_SHAPE: 1 << 1, LIGHT_SPOT_BLEND: 1 << 2, LIGHT_SPOT_CONE: 1 << 3,
  LIGHT_DIST: 1 << 4, CAMERA_FRAME: 1 << 5, CAMERA_DIST: 1 << 6, CAMERA_VOLUME: 1 << 7, SCREENSPACE: 1 << 8,
  SCREENALIGNED: 1 << 9, EMPTY_SCALED: 1 << 10, EMPTY_AXES: 1 << 11, EMPTY_AXES_NAME: 1 << 12, EMPTY_SIZE: 1 << 14,
};
const V = VCLASS;
const diamond_nsegments = 4, inner_nsegments = 8, outer_nsegments = 10, circle_nsegments = 32;

const ring_vertices = (radius, segments, half = false) => Array.from({ length: segments + (half ? 1 : 0) }, (_, i) => {
  const angle = ((half ? 1 : 2) * Math.PI * i) / segments;
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
});

function append_line_loop(dest, verts, z, flag, dashed = false) {
  const step = dashed ? 2 : 1;
  for (let i = 0; i < Math.floor(verts.length / step); i++) {
    for (let j = 0; j < 2; j++) {
      const cv = verts[(i * step + j) % verts.length];
      dest.push([cv[0], cv[1], z, flag]);
    }
  }
}

function light_distance_z_get(axis, start) {
  return { x: start ? 0.4 : 0.3, X: start ? 0.6 : 0.7, y: start ? 1.4 : 1.3, Y: start ? 1.6 : 1.7, z: start ? 2.4 : 2.3, Z: start ? 2.6 : 2.7 }[axis] ?? 0;
}

function sphere_axes_circles(radius, vclass, segments) {
  const ring = ring_vertices(radius, segments), verts = [];
  for (let axis = 0; axis < 3; axis++) {
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < 2; j++) {
        const [a, b] = ring[(i + j) % segments];
        verts.push(axis === 0 ? [a, b, 0, vclass] : axis === 1 ? [a, 0, b, vclass] : [0, a, b, vclass]);
      }
    }
  }
  return verts;
}

function light_append_direction_line(verts, axis = 'z', diamond = ring_vertices(1.2, diamond_nsegments)) {
  const zsta = light_distance_z_get(axis, true), zend = light_distance_z_get(axis, false);
  verts.push([0, 0, zsta, V.LIGHT_DIST], [0, 0, zend, V.LIGHT_DIST]);
  append_line_loop(verts, diamond, zsta, V.LIGHT_DIST | V.SCREENSPACE);
  append_line_loop(verts, diamond, zend, V.LIGHT_DIST | V.SCREENSPACE);
}

const bone_box_verts = [[1, 0, 1], [1, 0, -1], [-1, 0, -1], [-1, 0, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1], [-1, 1, 1]];
const bone_box_wire_lines = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];

const quad = (flag) => [[-1, -1], [-1, 1], [-1, 1], [1, 1], [1, 1], [1, -1], [1, -1], [-1, -1]].map(([x, y]) => [x, y, 0, flag]);

export const SHAPES = {
  quad_wire: () => quad(V.EMPTY_SCALED),
  plain_axes: () => [[0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]].map((p) => [...p, V.EMPTY_SCALED]),
  single_arrow: () => {
    const verts = [], p = [[0, 0, 1], [0.035, 0.035, 0.75], [-0.035, 0.035, 0.75]];
    for (let sides = 0; sides < 4; sides++) {
      if (sides % 2 === 1) { p[1][0] = -p[1][0]; p[2][1] = -p[2][1]; }
      else { p[1][1] = -p[1][1]; p[2][0] = -p[2][0]; }
      for (let i = 0, a = 1; i < 2; i++, a++) verts.push([...p[i], V.EMPTY_SCALED], [...p[a], V.EMPTY_SCALED]);
    }
    verts.push([0, 0, 0, V.EMPTY_SCALED], [0, 0, 0.75, V.EMPTY_SCALED]);
    return verts;
  },
  cube: () => bone_box_wire_lines.map((i) => [bone_box_verts[i][0], bone_box_verts[i][1] * 2 - 1, bone_box_verts[i][2], V.EMPTY_SCALED]),
  circle: () => {
    const resolution = 64, ring = ring_vertices(1, resolution), verts = [];
    for (let a = 0; a < resolution + 1; a++) {
      const cv1 = ring[a % resolution], cv2 = ring[(a + 1) % resolution];
      verts.push([cv1[0], 0, cv1[1], V.EMPTY_SCALED], [cv2[0], 0, cv2[1], V.EMPTY_SCALED]);
    }
    return verts;
  },
  empty_sphere: () => sphere_axes_circles(1, V.EMPTY_SCALED, 32),
  empty_cone: () => {
    const resolution = 8, ring = ring_vertices(1, resolution), verts = [];
    for (let i = 0; i < resolution; i++) {
      const cv = ring[i % resolution];
      verts.push([cv[0], 0, cv[1], V.EMPTY_SCALED], [0, 2, 0, V.EMPTY_SCALED]);
      for (let j = 0; j < 2; j++) { const c = ring[(i + j) % resolution]; verts.push([c[0], 0, c[1], V.EMPTY_SCALED]); }
    }
    return verts;
  },
  arrows: () => {
    const scaled = (points, [sx, sy]) => points.map(([x, y]) => [x * sx, y * sy]);
    const names = [
      scaled([[0.9, 1], [-1, -1], [-0.9, 1], [1, -1]], [0.0215, 0.025]),
      scaled([[-1, 1], [0, -0.1], [1, 1], [0, -0.1], [0, -0.1], [0, -1]], [0.0175, 0.025]),
      scaled([[-0.95, 1], [0.95, 1], [0.95, 1], [0.95, 0.9], [0.95, 0.9], [-1, -0.9], [-1, -0.9], [-1, -1], [-1, -1], [1, -1]], [0.02, 0.025]),
    ];
    const marker = scaled([[-1, 0], [0, 1], [0, 1], [1, 0], [1, 0], [0, -1], [0, -1], [-1, 0]], [0.007, 0.007]);
    const verts = [];
    for (let axis = 0; axis < 3; axis++) {
      const flag = V.EMPTY_AXES | V.SCREENALIGNED, pos_on_axis = axis + 1e-8;
      verts.push([0, 0, 0, V.NONE], [0, 0, pos_on_axis, flag]);
      for (let j = 1; j < 7; j++) for (const [x, y] of marker) verts.push([x * (4 * j) / 6, y * (4 * j) / 6, pos_on_axis, flag]);
      for (const [x, y] of names[axis]) verts.push([x * 4, y * 4, pos_on_axis + 0.25, V.EMPTY_AXES | V.EMPTY_AXES_NAME | V.SCREENALIGNED]);
    }
    return verts;
  },
  camera_frame: () => {
    const rect = [[-1, -1], [-1, 1], [1, 1], [1, -1]], verts = [];
    append_line_loop(verts, rect, 1, V.CAMERA_FRAME);
    for (const [x, y] of rect) verts.push([x, y, 1, V.CAMERA_FRAME], [x, y, 0, V.CAMERA_FRAME]);
    return verts;
  },
  camera_tria_wire: () => { const verts = []; append_line_loop(verts, [[-1, 1], [1, 1], [0, 0]], 1, V.CAMERA_FRAME); return verts; },
  camera_tria: () => [[-1, 1], [1, 1], [0, 0]].map(([x, y]) => [x, y, 1, V.CAMERA_FRAME]),
  ground_line: () => {
    const verts = [];
    append_line_loop(verts, ring_vertices(1.35, diamond_nsegments), 0, V.NONE);
    verts.push([0, 0, 1, V.NONE], [0, 0, 0, V.NONE]);
    return verts;
  },
  light_icon_outer_lines: () => { const verts = []; append_line_loop(verts, ring_vertices(9 * 1.33, outer_nsegments * 2), 0, V.SCREENSPACE, true); return verts; },
  light_icon_inner_lines: () => {
    const verts = [];
    append_line_loop(verts, ring_vertices(9 * 0.3, diamond_nsegments), 0, V.SCREENSPACE);
    append_line_loop(verts, ring_vertices(9, inner_nsegments * 2), 0, V.SCREENSPACE, true);
    return verts;
  },
  light_icon_sun_rays: () => ring_vertices(9, 8).flatMap(([x, y]) => [1.6, 1.9, 2.2, 2.5].map((s) => [x * s, y * s, 0, V.SCREENSPACE])),
  light_point_lines: () => { const verts = []; append_line_loop(verts, ring_vertices(1, circle_nsegments), 0, V.SCREENALIGNED | V.LIGHT_AREA_SHAPE); return verts; },
  light_sun_lines: () => [[0, 0, 0, V.NONE], [0, 0, -20, V.NONE]],
  light_spot_lines: () => {
    const ring = ring_vertices(1, circle_nsegments), verts = [];
    append_line_loop(verts, ring, 0, V.SCREENALIGNED | V.LIGHT_AREA_SHAPE);
    append_line_loop(verts, ring, 0, V.LIGHT_SPOT_SHAPE);
    append_line_loop(verts, ring, 0, V.LIGHT_SPOT_SHAPE | V.LIGHT_SPOT_BLEND);
    for (const [x, y] of ring) verts.push([0, 0, 0, V.NONE], [x, y, -1, V.LIGHT_SPOT_SHAPE | V.LIGHT_SPOT_CONE]);
    light_append_direction_line(verts);
    return verts;
  },
  light_area_disk_lines: () => { const verts = []; append_line_loop(verts, ring_vertices(0.5, circle_nsegments), 0, V.LIGHT_AREA_SHAPE); light_append_direction_line(verts); return verts; },
  light_area_square_lines: () => {
    const verts = [];
    append_line_loop(verts, [[-0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0.5, -0.5]], 0, V.LIGHT_AREA_SHAPE);
    light_append_direction_line(verts);
    return verts;
  },
};
