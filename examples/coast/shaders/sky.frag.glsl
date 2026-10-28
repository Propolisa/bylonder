precision highp float;
// Dusk sky: a gradient from the glowing horizon to the night above, the sun's halo, a band of lit clouds, a crescent
// moon and the first stars. Colors are display colors, matched to the scene's fog at the horizon.
uniform vec3 sunDirection, moonDirection, horizon, zenith, glow;
uniform float cloudShift;
varying vec3 vDirection;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float sum = 0.0, amplitude = 0.5;
  for (int i = 0; i < 5; i++) { sum += amplitude * noise(p); p *= 2.03; amplitude *= 0.5; }
  return sum;
}

void main() {
  vec3 d = normalize(vDirection);
  float up = max(d.y, 0.0);
  float sun = max(dot(d, sunDirection), 0.0);
  vec3 color = mix(horizon, zenith, pow(up, 0.45));
  color += glow * (pow(sun, 6.0) * 0.6 + pow(sun, 60.0) * 0.8) * (1.0 - up * 0.6);
  color += vec3(1.0, 0.85, 0.6) * smoothstep(0.9993, 0.9997, sun) * 3.0;

  // Clouds: long streaks low in the sky, lit from below by the sun on the side facing it.
  vec2 streak = d.xz / max(d.y + 0.08, 0.02) * vec2(0.6, 2.4) + vec2(cloudShift, 0.0);
  float cloud = smoothstep(0.5, 0.78, fbm(streak)) * smoothstep(0.02, 0.1, d.y) * (1.0 - smoothstep(0.25, 0.6, d.y));
  vec3 lit = mix(vec3(0.42, 0.24, 0.32), vec3(1.0, 0.55, 0.32), pow(sun, 3.0));
  color = mix(color, lit, cloud * 0.85);

  float moon = dot(d, moonDirection);
  float crescent = smoothstep(0.99985, 0.9999, moon) * (1.0 - smoothstep(0.99985, 0.9999, dot(d, normalize(moonDirection + vec3(0.004, 0.003, 0.0)))));
  color += vec3(0.95, 0.92, 0.8) * crescent * 1.5;

  float star = step(0.9985, hash(floor(d.xz / (d.y + 0.2) * 240.0))) * smoothstep(0.25, 0.7, d.y) * (1.0 - cloud);
  color += vec3(star * 0.8);

  color += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(color, 1.0);
}
