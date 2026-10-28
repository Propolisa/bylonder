// Blender's default theme (userdef_default_theme.c), 3D Viewport colors read from Blender 5.2, as RGBA 0..1.
export const view_3d = {
  vertex: [0, 0, 0, 1],
  vertex_select: [1, 0.4784, 0, 1],
  vertex_size: 3,
  edge_select: [1, 0.6, 0, 1],
  edge_width: 1,
  wire_edit: [0, 0, 0, 1],
  face: [1, 1, 1, 0.0078],
  face_select: [1, 0.6392, 0, 0.2],
  editmesh_active: [1, 1, 1, 0.2],
  facedot_size: 3,
  nurb_uline: [0.5647, 0.5647, 0, 1],
  nurb_sel_uline: [0.9412, 1, 0.251, 1],
  normal: [0.1333, 0.8667, 0.8667, 1],
};

// Curve colors shared by the editors (common.curves), as Edit Mode on curves draws handles and their points.
export const curves = {
  handle_free: [0.4549, 0.349, 0, 1],
  handle_auto: [0.4549, 0.051, 0, 1],
  handle_vect: [0.1373, 0.1373, 0.4549, 1],
  handle_align: [0.0824, 0.4392, 0, 1],
  handle_auto_clamped: [0.502, 0.1882, 0.3765, 1],
  handle_sel_free: [1, 0.7647, 0, 1],
  handle_sel_auto: [1, 0.098, 0, 1],
  handle_sel_vect: [0.2667, 0.2667, 1, 1],
  handle_sel_align: [0.4471, 1, 0.3412, 1],
  handle_sel_auto_clamped: [0.9412, 0.5647, 0.6275, 1],
  handle_vertex: [0, 0, 0, 1],
  handle_vertex_select: [1, 0.5216, 0, 1],
  handle_vertex_size: 5,
};

export const user_interface = {
  gizmo_primary: [0.9608, 0.9451, 0.302],
};
