precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDirection;

void main() {
  vDirection = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
