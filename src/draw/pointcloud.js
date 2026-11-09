// Point clouds (main-api.cc main_pointclouds) as Blender's engines draw them: a sphere at each point
// (draw_pointcloud_lib.glsl). Each point is one camera-facing quad of a shared mesh, drawn instanced from the point's
// position and radius (16 bytes, no matrix), in the point cloud's material, whose PointCloudPlugin makes the quad a
// sphere: it discards outside the radius and writes the sphere's normal and depth.
import { Matrix, Mesh, MaterialPluginBase, StandardMaterial, Color3, VertexBuffer, VertexData } from '@babylonjs/core';

const ATTRIBUTE = 'pointcloud';

// blender-port: draw_pointcloud_lib.glsl point_get and object_to_world: the point in the object's space, its radius
// scaled by the object's scale; the quad faces the view and covers the sphere, which the fragment stage carves out.
const VERTEX_DEFINITIONS = `#ifdef POINTCLOUD
attribute vec4 ${ATTRIBUTE};
varying vec2 vPointCorner;
varying vec3 vPointCenter;
varying vec3 vPointRight;
varying vec3 vPointUp;
varying float vPointRadius;
#endif`;
const VERTEX_WORLDPOS = `#ifdef POINTCLOUD
vPointCorner = position.xy;
vPointCenter = (world * vec4(${ATTRIBUTE}.x, ${ATTRIBUTE}.z, ${ATTRIBUTE}.y, 1.0)).xyz;
vPointRadius = ${ATTRIBUTE}.w * length(vec3(length(world[0].xyz), length(world[1].xyz), length(world[2].xyz))) * 0.57735027;
vPointRight = vec3(view[0][0], view[1][0], view[2][0]);
vPointUp = vec3(view[0][1], view[1][1], view[2][1]);
worldPos = vec4(vPointCenter + (vPointRight * position.x + vPointUp * position.y) * vPointRadius, 1.0);
vPositionW = worldPos.xyz;
#endif`;
const FRAGMENT_DEFINITIONS = `#ifdef POINTCLOUD
varying vec2 vPointCorner;
varying vec3 vPointCenter;
varying vec3 vPointRight;
varying vec3 vPointUp;
varying float vPointRadius;
#endif`;
const FRAGMENT_MAIN_BEGIN = `#ifdef POINTCLOUD
float pointR2 = dot(vPointCorner, vPointCorner);
if (pointR2 > 1.0) discard;
vec3 pointToEye = normalize(cross(vPointRight, vPointUp));
pointToEye *= sign(dot(pointToEye, vEyePosition.xyz - vPointCenter));
vec3 pointN = normalize(vPointRight * vPointCorner.x + vPointUp * vPointCorner.y + pointToEye * sqrt(1.0 - pointR2));
vec4 pointClip = viewProjection * vec4(vPointCenter + pointN * vPointRadius, 1.0);
gl_FragDepth = pointClip.z / pointClip.w * 0.5 + 0.5;
#endif`;
const FRAGMENT_BEFORE_LIGHTS = '#ifdef POINTCLOUD\nnormalW = pointN;\n#endif';

export class PointCloudPlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, 'BlenderPointCloud', 310, { POINTCLOUD: false });
    this._enable(true);
  }
  // GLSL only: a WGSL material draws a point as its square (on WebGPU Bylonder's are GLSL, overrides/webgpu/pbr-from-glsl.js).
  static of(material) { return material.pluginManager?.getPlugin('BlenderPointCloud') ?? (material.shaderLanguage === 0 ? new PointCloudPlugin(material) : null); }
  getClassName() { return 'PointCloudPlugin'; }
  prepareDefines(defines, scene, mesh) { defines.POINTCLOUD = !!mesh.metadata?.pointcloud; }
  getAttributes(attributes, scene, mesh) { if (mesh.metadata?.pointcloud) attributes.push(ATTRIBUTE); }
  getCustomCode(shaderType) {
    return shaderType === 'vertex'
      ? { CUSTOM_VERTEX_DEFINITIONS: VERTEX_DEFINITIONS, CUSTOM_VERTEX_UPDATE_WORLDPOS: VERTEX_WORLDPOS }
      : { CUSTOM_FRAGMENT_DEFINITIONS: FRAGMENT_DEFINITIONS, CUSTOM_FRAGMENT_MAIN_BEGIN: FRAGMENT_MAIN_BEGIN, CUSTOM_FRAGMENT_BEFORE_LIGHTS: FRAGMENT_BEFORE_LIGHTS };
  }
}

// Blender's default surface (the startup cube's material) for a point cloud without one.
const defaults = new WeakMap();
const defaultMaterial = (scene) => {
  if (!defaults.has(scene)) defaults.set(scene, Object.assign(new StandardMaterial('__pointcloud default', scene, true), { diffuseColor: new Color3(0.8, 0.8, 0.8), specularColor: Color3.Black() }));
  return defaults.get(scene);
};

const QUAD = { positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2, 0, 2, 3] };

// Draws the point cloud records ({ key, matrix (Babylon's layout), material, points (4 floats each) }) on meshes kept
// in `drawn` by key, their buffers grown by doubling and otherwise reused; returns the keys drawn. `materialFor(ma)`
// gives Babylon's material of a Material, or null.
export function drawPointClouds(scene, records, drawn, materialFor) {
  for (const { key, matrix, material, points } of records) {
    let mesh = drawn.get(key);
    if (!mesh) {
      mesh = Object.assign(new Mesh('__pointcloud ' + key, scene), { isPickable: false, alwaysSelectAsActiveMesh: true, doNotSerialize: true, metadata: { pointcloud: true } });
      Object.assign(new VertexData(), QUAD).applyToMesh(mesh);
      drawn.set(key, mesh);
    }
    const count = points.length / 4;
    if (!(mesh.metadata.points?.length >= points.length)) {
      mesh.metadata.points = new Float32Array(2 ** Math.ceil(Math.log2(Math.max(points.length, 4))));
      mesh.setVerticesBuffer(new VertexBuffer(scene.getEngine(), mesh.metadata.points, ATTRIBUTE, { updatable: true, size: 4, stride: 4, instanced: true }));
    }
    mesh.metadata.points.set(points);
    mesh.getVertexBuffer(ATTRIBUTE).updateDirectly(mesh.metadata.points, 0);
    mesh.forcedInstanceCount = count;
    mesh.freezeWorldMatrix(Matrix.FromArray(matrix));
    mesh.material = materialFor(material) ?? defaultMaterial(scene);
    PointCloudPlugin.of(mesh.material);
  }
  return new Set(records.map(({ key }) => key));
}
