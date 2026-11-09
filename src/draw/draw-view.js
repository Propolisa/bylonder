// The view an overlay draws for, in Blender's terms (draw_view_lib.glsl, RegionView3D): the inverse view matrix's axes
// and position in Blender coordinates, perspective or not, and the world size of a pixel at unit depth (pixsize).
// Babylon's (x, y, z) is Blender's (x, z, y); Babylon's camera looks down its +Z, Blender's down -Z.
// Computed once per view render and reused, without allocations.
import { Camera, MaterialPluginBase, PBRBaseMaterial, RegisterMaterialPlugin, ShaderStore, Vector3, Vector4 } from '@babylonjs/core';
import '@babylonjs/core/Shaders/ShadersInclude/reflectionFunction.js';
import { eeveeParity } from './eevee-parity.js';

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

// blender-port: draw_view_lib.glsl drw_world_incident_vector: light comes in toward a perspective view's eye, and along
// an orthographic view's forward axis everywhere. Babylon's lighting reads an eye point, so it reads one per shaded
// point: the view's eye, or the point one unit back along an orthographic view's axis.
export const VIEW_FORWARD = 'blViewForward';
export const viewEye = (P, eye = 'vEyePosition.xyz', forward = VIEW_FORWARD) => `(${forward}.w > 0.5 ? ${P} - ${forward}.xyz : ${eye})`;
const direction = new Vector3(), forward = new Vector4();
// The view's forward axis in Babylon's world, w 1 where it is orthographic (and `orthographic` is taken).
export function viewForward(camera, orthographic = true) {
  camera.getDirectionToRef(camera.getScene().useRightHandedSystem ? Vector3.RightHandedForwardReadOnly : Vector3.LeftHandedForwardReadOnly, direction);
  return forward.set(direction.x, direction.y, direction.z, orthographic && camera.mode === Camera.ORTHOGRAPHIC_CAMERA ? 1 : 0);
}

// Babylon's PBR materials through viewEye: the view direction before lighting, and reflectionFunction's eye, which no
// injection point reaches, matched against Babylon's source here so that an upgrade changing it fails at once. Without
// the scene's EEVEE Parity (eevee-parity.js) the view is bound as a perspective one, so the eye is Babylon's.
export const REFLECTION_EYE = /worldNormal,vEyePosition\.xyz/;
if (!REFLECTION_EYE.test(ShaderStore.IncludesShadersStore.reflectionFunction)) throw Error("Babylon's reflectionFunction changed: BlenderViewPlugin cannot set its eye");
const VIEW_CODE = { CUSTOM_FRAGMENT_BEFORE_LIGHTS: `viewDirectionW = normalize(${viewEye('vPositionW')} - vPositionW);`, [`!!${REFLECTION_EYE.source}`]: `worldNormal,${viewEye('worldPos.xyz')}` };
class BlenderViewPlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, 'BlenderView', 300, {}, true, true);
    // Bylonder adds it to every PBR material; an export loads without it.
    this.doNotSerialize = true;
  }
  getClassName() { return 'BlenderViewPlugin'; }
  isCompatible() { return true; }
  getUniforms(shaderLanguage = 0) {
    const ubo = [{ name: VIEW_FORWARD, size: 4, type: 'vec4' }];
    return shaderLanguage === 0 ? { ubo, fragment: `uniform vec4 ${VIEW_FORWARD};` } : { ubo };
  }
  bindForSubMesh(ubo, scene) { ubo.updateVector4(VIEW_FORWARD, viewForward(scene.activeCamera, eeveeParity(scene))); }
  // GLSL: Bylonder's PBR materials compile from it on WebGPU too (overrides/webgpu/pbr-from-glsl.js).
  getCustomCode(shaderType, shaderLanguage = 0) { return shaderType === 'fragment' && shaderLanguage === 0 ? VIEW_CODE : null; }
}
RegisterMaterialPlugin('BlenderView', (material) => (material instanceof PBRBaseMaterial ? new BlenderViewPlugin(material) : null));
