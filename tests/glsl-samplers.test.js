// Blender's functions that take samplers run as copies that sample the uniforms they are called with (WebGPU's GLSL
// takes no sampler arguments): overloads by sampler type, nested calls, and the originals gone.
import assert from 'node:assert/strict';
import { specializeSamplers } from '../src/nodes/blender/glsl.js';

const shader = specializeSamplers(`uniform highp sampler2D bl_image_3;
uniform isampler2D ids;
vec4 texture_load(sampler2D s, ivec2 t) { return texelFetch(s, t, 0); }
ivec4 texture_load(isampler2D s, ivec2 t) { return texelFetch(s, t, 0); }
void node_tex_image_linear(vec3 co, sampler2D ima, inout vec4 color, inout float alpha) {
  color = texture(ima, co.xy) + texture_load(ima, ivec2(0));
  alpha = color.a;
}
void main() {
  vec4 c; float a;
  node_tex_image_linear(vec3(0.0), bl_image_3, c, a);
  ivec4 i = texture_load(ids, ivec2(1));
}`);
assert.match(shader, /vec4 texture_load_bl_image_3\(ivec2 t\) \{ return texelFetch\(bl_image_3, t, 0\); \}/);
assert.match(shader, /ivec4 texture_load_ids\(ivec2 t\) \{ return texelFetch\(ids, t, 0\); \}/);
assert.match(shader, /void node_tex_image_linear_bl_image_3\(vec3 co, inout vec4 color, inout float alpha\) \{\n  color = texture\(bl_image_3, co\.xy\) \+ texture_load_bl_image_3\(ivec2\(0\)\);/);
assert.match(shader, /node_tex_image_linear_bl_image_3\(vec3\(0\.0\), c, a\);/);
assert.doesNotMatch(shader, /\bsampler2D (s|ima)\b/);
assert.ok(shader.indexOf('texture_load_bl_image_3(ivec2 t)') < shader.indexOf('node_tex_image_linear_bl_image_3(vec3 co'), 'a copy precedes its callers');
console.log('GLSL samplers: functions taking samplers run as copies for the uniforms they are called with');

// A function Babylon marks for its inliner keeps its sampler parameters: Babylon inlines it on WebGPU.
const inlined = specializeSamplers(`uniform sampler2D ltc;
#define inline
vec4 area(sampler2D s, vec2 uv) { return texture(s, uv); }
`);
assert.match(inlined, /#define inline\nvec4 area\(sampler2D s, vec2 uv\)/);
console.log('GLSL samplers: functions Babylon inlines are left to it');
