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

// blender-port: overlay_shape.cc ShapeCache, the bone shapes. Solid shapes are triangle lists of { position, normal }
// with their outline's line adjacencies (indices into the triangles' vertices); the sphere is a fan and the envelope a
// strip as Blender draws them, the stick's vertices carry their StickBoneFlag, the envelope outline's its three points.
const bone_box_solid_tris = [[0, 2, 1], [0, 3, 2], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7], [4, 5, 6], [4, 6, 7]];
const bone_box_wire_lines_adjacency = [[4, 2, 0, 11], [0, 1, 2, 8], [2, 4, 1, 14], [1, 0, 4, 20], [0, 8, 11, 14], [2, 14, 8, 20], [1, 20, 14, 11], [4, 11, 20, 8], [20, 0, 11, 2], [11, 2, 8, 1], [8, 1, 14, 4], [14, 4, 20, 0]];
const bone_box_solid_normals = [[0, -1, 0], [0, -1, 0], [1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, -1], [-1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, 1], [0, 1, 0], [0, 1, 0]];
const bone_octahedral_verts = [[0, 0, 0], [0.1, 0.1, 0.1], [0.1, 0.1, -0.1], [-0.1, 0.1, -0.1], [-0.1, 0.1, 0.1], [0, 1, 0]];
const bone_octahedral_solid_tris = [[2, 1, 0], [3, 2, 0], [4, 3, 0], [1, 4, 0], [5, 1, 2], [5, 2, 3], [5, 3, 4], [5, 4, 1]];
const bone_octahedral_wire_lines_adjacency = [[0, 1, 2, 6], [0, 12, 1, 6], [0, 3, 12, 6], [0, 2, 3, 6], [1, 6, 2, 3], [1, 12, 6, 3], [1, 0, 12, 3], [1, 2, 0, 3], [2, 0, 1, 12], [2, 3, 0, 12], [2, 6, 3, 12], [2, 1, 6, 12]];
const S = Math.SQRT1_2;
const bone_octahedral_solid_normals = [[S, -S, 0], [0, -S, -S], [-S, -S, 0], [0, -S, S], [0.99388373, 0.11043154, 0], [0, 0.11043154, -0.99388373], [-0.99388373, 0.11043154, 0], [0, 0.11043154, 0.99388373]];
const solid = (verts, tris, normals, adjacency) => ({
  positions: tris.flatMap((tri) => tri.flatMap((v) => verts[v])), normals: normals.flatMap((n) => [...n, ...n, ...n]), adjacency: adjacency.flat(),
});
export const STICK = { COL_WIRE: 1 << 0, COL_HEAD: 1 << 1, COL_TAIL: 1 << 2, COL_BONE: 1 << 3, POS_HEAD: 1 << 4, POS_TAIL: 1 << 5, POS_BONE: 1 << 6 };
export const BONE_SHAPES = {
  bone_octahedron: () => solid(bone_octahedral_verts, bone_octahedral_solid_tris, bone_octahedral_solid_normals, bone_octahedral_wire_lines_adjacency),
  bone_box: () => solid(bone_box_verts, bone_box_solid_tris, bone_box_solid_normals, bone_box_wire_lines_adjacency),
  bone_sphere: () => { const ring = ring_vertices(0.05, 64); return Array.from({ length: 65 }, (_, a) => ring[a % 64]); },
  bone_stick: () => {
    const { COL_WIRE, COL_HEAD, COL_TAIL, COL_BONE, POS_HEAD, POS_TAIL, POS_BONE } = STICK, bone = COL_BONE | POS_BONE;
    const strip = [[0, 1, bone | POS_HEAD | COL_HEAD | COL_WIRE], [0, 1, bone | POS_TAIL | COL_TAIL | COL_WIRE], [0, 0, bone | POS_HEAD | COL_HEAD],
      [0, 0, bone | POS_TAIL | COL_TAIL], [0, -1, bone | POS_HEAD | COL_HEAD | COL_WIRE], [0, -1, bone | POS_TAIL | COL_TAIL | COL_WIRE]];
    const verts = strip.slice(0, -2).flatMap((_, t) => [strip[t], strip[t + 1], strip[t + 2]]), ring = ring_vertices(2, 12);
    for (let a = 0; a < 12; a++) {
      const [cv1, cv2] = [ring[a], ring[(a + 1) % 12]];
      for (const at of [POS_HEAD | COL_HEAD, POS_TAIL | COL_TAIL]) verts.push([0, 0, at], [...cv1, at | COL_WIRE], [...cv2, at | COL_WIRE]);
    }
    return verts;
  },
  bone_envelope: () => {
    const res = 24, lon_inc = (2 * Math.PI) / res, lat_inc = Math.PI / res, verts = [];
    const co = (lat, lon) => [Math.sin(lat) * Math.cos(lon), Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
    for (let i = 0, lon = 0; i < res; i++, lon += lon_inc) {
      for (let j = 0, lat = 0; j < res; j++, lat += lat_inc) verts.push(co(lat, lon), co(lat, lon + lon_inc));
      verts.push(co(Math.PI, lon), co(Math.PI, lon + lon_inc));
    }
    return verts;
  },
  bone_envelope_wire: () => {
    const resolution = 64, pt = (a) => [Math.sin((2 * Math.PI * a) / resolution), Math.cos((2 * Math.PI * a) / resolution)], verts = [];
    for (let a = 0; a <= resolution; a++) verts.push([pt(a - 2), pt(a - 1), pt(a)]);
    return verts;
  },
  bone_degrees_of_freedom: () => {
    const resolution = 16, verts = [], set = (x, y, quarter) => verts.push([quarter % 2 === 0 ? -x : x, quarter < 2 ? -y : y]);
    for (let quarter = 0; quarter < 4; quarter++) {
      let prev_z = 0;
      for (let i = 1; i < resolution; i++) {
        const z = Math.sin((Math.PI / 2) * i / (resolution - 1));
        let prev_x = 0;
        for (let j = 1; j <= resolution - i; j++) {
          const x = Math.sin((Math.PI / 2) * j / (resolution - 1));
          if (j === resolution - i) { set(prev_x, z, quarter); set(prev_x, prev_z, quarter); set(x, prev_z, quarter); }
          else { set(x, z, quarter); set(x, prev_z, quarter); set(prev_x, z, quarter); set(x, prev_z, quarter); set(prev_x, prev_z, quarter); set(prev_x, z, quarter); }
          prev_x = x;
        }
        prev_z = z;
      }
    }
    return verts;
  },
  bone_degrees_of_freedom_wire: () => { const ring = ring_vertices(1, 64); return Array.from({ length: 65 }, (_, a) => ring[a % 64]); },
};
