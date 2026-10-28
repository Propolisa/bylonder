precision highp float;
uniform vec3 deep, shallow;
varying float vHeight;
varying vec2 vUV;

void main() {
  float t = smoothstep(-1.2, 1.2, vHeight);
  vec3 color = mix(deep, shallow, t);
  float grid = step(0.97, fract(vUV.x * 24.0)) + step(0.97, fract(vUV.y * 24.0));
  gl_FragColor = vec4(color + grid * 0.04, 1.0);
}
