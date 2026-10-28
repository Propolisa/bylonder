precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
uniform float time, amplitude, frequency;
varying float vHeight;
varying vec2 vUV;

void main() {
  vec3 p = position;
  float h = sin(p.x * frequency + time * 1.7) * cos(p.z * frequency * 0.8 + time * 1.3);
  h += 0.35 * sin((p.x + p.z) * frequency * 2.3 - time * 2.1);
  p.y = h * amplitude;
  vHeight = h;
  vUV = uv;
  gl_Position = worldViewProjection * vec4(p, 1.0);
}
