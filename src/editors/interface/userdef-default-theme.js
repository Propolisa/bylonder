// Blender's default theme (userdef_default_theme.c), 3D Viewport colors read from Blender 5.2, as RGBA 0..1.
export const view_3d = {
  vertex: [0, 0, 0, 1],
  vertex_select: [1, 0.4784, 0, 1],
  vertex_size: 3,
  edge_select: [1, 0.6, 0, 1],
  edge_width: 1,
  wire: [0, 0, 0, 1],
  wire_edit: [0, 0, 0, 1],
  face: [1, 1, 1, 0.0078],
  face_select: [1, 0.6392, 0, 0.2],
  editmesh_active: [1, 1, 1, 0.2],
  facedot_size: 3,
  object_selected: [0.9294, 0.3412, 0, 1],
  object_active: [1, 0.6275, 0.1569, 1],
  object_origin_size: 6,
  camera: [0, 0, 0, 1],
  light: [0, 0, 0, 0.3137],
  empty: [0, 0, 0, 1],
  view_overlay: [0, 0, 0, 1],
  grid: [0.3294, 0.3294, 0.3294, 0.502],
  grid_major: [0.3294, 0.3294, 0.3294, 1],
  grid_axis_brightness: 0.46,
  // The background (TH_BACK): gradients.high_gradient with background_type SINGLE_COLOR.
  background: [0.2392, 0.2392, 0.2392, 1],
};

export const user_interface = {
  gizmo_primary: [0.9608, 0.9451, 0.302],
  axis_x: [1, 0.2, 0.3216, 1],
  axis_y: [0.5451, 0.8627, 0, 1],
  axis_z: [0.1569, 0.5647, 1, 1],
};

// Blender stores theme colors as bytes; its shading helpers (interface/resources.cc) work on them.
const byte = (v) => Math.round(v * 255);
const clampByte = (v) => Math.min(255, Math.max(0, v)) / 255;

// get_color_shade_4fv: the color with `offset` added to RGB.
export const colorShade = (c, offset) => [...c.slice(0, 3).map((v) => clampByte(byte(v) + offset)), c[3] ?? 1];

// get_color_blend_shade_4fv: c1 mixed toward c2 by fac, then offset added to RGB.
export const colorBlendShade = (c1, c2, fac, offset) => {
  const mix = (a, b) => Math.floor((1 - fac) * byte(a) + fac * byte(b));
  return [0, 1, 2, 3].map((i) => clampByte(mix(c1[i] ?? 1, c2[i] ?? 1) + (i < 3 ? offset : 0)));
};

// The CSS color of a theme color.
export const cssColor = (c) => `rgb(${c.slice(0, 3).map(byte).join(' ')}${c[3] !== undefined && c[3] < 1 ? ` / ${c[3]}` : ''})`;
