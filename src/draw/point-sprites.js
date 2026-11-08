// Points of a size in pixels (gl_PointSize) as quads facing the view, one quad drawn instanced per point: WebGPU draws
// points one pixel wide, so both backends draw sized points this way. The mesh's positions are the quad's corners and
// each point's attributes are per instance (`point`, its position, and any others); its shader, with POINT_SPRITE_VERTEX
// (and POINT_SPRITE_OPTIONS in its ShaderMaterial), sets gl_Position = bl_point_sprite(clip, size) where it set
// gl_PointSize, and reads bl_point_coord where it read gl_PointCoord.
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';

export const POINT_SPRITE_VERTEX = `uniform vec2 bl_viewport;
varying vec2 bl_point_coord;
vec4 bl_point_sprite(vec4 clip, float size) {
  bl_point_coord = position.xy * 0.5 + 0.5;
  return vec4(clip.xy + position.xy * size / bl_viewport * clip.w, clip.zw);
}`;
export const POINT_SPRITE_FRAGMENT = 'varying vec2 bl_point_coord;';
export const POINT_SPRITE_OPTIONS = { attributes: ['point'], uniforms: ['bl_viewport'], defines: ['#define POINT_SPRITES'] };

export const CORNERS = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], QUAD = [0, 1, 2, 0, 2, 3];

// Makes `mesh` a quad drawn per point in its material, which is told the view's size in pixels.
export function pointSprites(mesh) {
  const { material } = mesh;
  mesh.setVerticesData('position', CORNERS);
  mesh.setIndices(QUAD);
  material.onBindObservable.add(() => {
    const engine = material.getScene().getEngine(), { width, height } = material.getScene().activeCamera.viewport;
    material.getEffect().setFloat2('bl_viewport', engine.getRenderWidth() * width, engine.getRenderHeight() * height);
  });
  return mesh;
}

// Its first `count` points, from per point attributes { kind: [data, size] }; the mesh shows only with points.
export function setPoints(mesh, attributes, count) {
  for (const [kind, [values, size]] of Object.entries(attributes)) {
    const buffer = mesh.getVertexBuffer(kind), data = values instanceof Float32Array ? values : Float32Array.from(values);
    if (buffer && buffer.getData().length >= data.length) buffer.updateDirectly(data, 0);
    else mesh.setVerticesBuffer(new VertexBuffer(mesh.getEngine(), data, kind, { updatable: true, size, instanced: true }));
  }
  mesh.forcedInstanceCount = count;
  mesh.isVisible = count > 0;
}
