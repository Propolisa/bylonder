// The view an overlay draws for, in Blender's terms (draw_view_lib.glsl, RegionView3D): the inverse view matrix's axes
// and position in Blender coordinates, perspective or not, and the world size of a pixel at unit depth (pixsize).
// Babylon's (x, y, z) is Blender's (x, z, y); Babylon's camera looks down its +Z, Blender's down -Z.
// Computed once per view render and reused, without allocations.

const view = { right: [0, 0, 0], up: [0, 0, 0], forward: [0, 0, 0], position: [0, 0, 0], persp: true, pixelFac: 1, size: [1, 1], winmat: [1, 1], camera: null, renderId: -1 };

const blender = (m, o, out, sign = 1) => { out[0] = sign * m[o]; out[1] = sign * m[o + 2]; out[2] = sign * m[o + 1]; };

export function drawView(scene) {
  const camera = scene.activeCamera, renderId = scene.getRenderId();
  if (view.camera === camera && view.renderId === renderId) return view;
  view.camera = camera;
  view.renderId = renderId;
  const m = camera.getWorldMatrix().m, p = camera.getProjectionMatrix().m, engine = scene.getEngine();
  blender(m, 0, view.right);
  blender(m, 4, view.up);
  blender(m, 8, view.forward, -1);
  blender(m, 12, view.position);
  view.persp = p[15] === 0;
  view.size[0] = engine.getRenderWidth() * camera.viewport.width;
  view.size[1] = engine.getRenderHeight() * camera.viewport.height;
  view.winmat[0] = Math.abs(p[0]);
  view.winmat[1] = Math.abs(p[5]);
  // ED_view3d_update_viewmat: pixsize = len_px / len_sc.
  view.pixelFac = 2 / (Math.min(view.winmat[0], view.winmat[1]) * Math.max(view.size[0], view.size[1]));
  return view;
}

// GLSL helpers shared by overlay shaders: Blender world positions to Babylon's clip space.
export const DRAW_VIEW_GLSL = `
vec3 babylon_point(vec3 p) { return vec3(p.x, p.z, p.y); }
vec4 drw_point_world_to_homogenous(vec3 p) { return viewProjection * vec4(babylon_point(p), 1.0); }
`;
