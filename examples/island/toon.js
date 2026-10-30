// Toon shading: faceted surfaces lit in hard bands by the sun and the moon over a sky and ground ambient, with a rim of
// sky light. The terrain, the sea and the sky add their own color in the same light.

const vertex = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
#include<instancesDeclaration>
uniform mat4 viewProjection;
varying vec3 vWorld;
varying vec3 vNormal;
flat varying vec3 vFace;
void main() {
#include<instancesVertex>
  vec4 w = finalWorld * vec4(position, 1.0);
  vWorld = w.xyz;
  vFace = w.xyz;
  vNormal = mat3(finalWorld) * normal;
  gl_Position = viewProjection * w;
}`;

const LIGHT = ['sunDir', 'sunColor', 'moonDir', 'moonColor', 'skyLight', 'groundLight', 'cameraPosition'];
const lighting = `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
flat varying vec3 vFace;
uniform vec3 sunDir, sunColor, moonDir, moonColor, skyLight, groundLight, cameraPosition;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// The face's own normal, so every face is flat, turned to the side the mesh's normal faces.
vec3 facet() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  return dot(n, vNormal) < 0.0 ? -n : n;
}
vec3 toon(vec3 albedo, vec3 n) {
  float d = dot(n, sunDir);
  float sun = 0.55 * smoothstep(0.0, 0.05, d) + 0.45 * smoothstep(0.45, 0.5, d);
  float moon = smoothstep(0.0, 0.05, dot(n, moonDir));
  vec3 ambient = mix(groundLight, skyLight, 0.5 + 0.5 * n.y);
  float rim = smoothstep(0.6, 0.65, 1.0 - max(dot(n, normalize(cameraPosition - vWorld)), 0.0));
  return albedo * (ambient + sunColor * sun + moonColor * moon + 0.25 * rim * skyLight);
}`;

const plain = `${lighting}
uniform vec3 color, underglow, glow;
void main() {
  vec3 n = facet();
  gl_FragColor = vec4(toon(color, n) + underglow * smoothstep(0.0, -0.6, n.y) + glow, 1.0);
}`;

// The island's ground by the story's day: volcanic rock and beaches, lava running down five channels from the crater
// and cooling to basalt, then soil and grass spreading from the shore up the slopes.
const terrain = `${lighting}
uniform float day;
float shore(float a) { return 6.2 + 0.7 * sin(3.0 * a + 1.0) + 0.4 * sin(5.0 * a + 2.3) + 0.25 * sin(8.0 * a + 0.5); }
float channel(float a, float r) {
  float best = 0.0;
  for (int i = 0; i < 5; i++) {
    float c = float(i) * 1.2566 + 0.3 + 0.25 * sin(r * 1.7 + float(i));
    float d = abs(mod(a - c + 3.14159, 6.28318) - 3.14159) * r;
    best = max(best, 1.0 - smoothstep(0.22, 0.3, d));
  }
  return best;
}
// Every test is made at the face (its first corner), so each face takes one color and borders run along edges; noise
// bends the fronts and the bare summit's line, so nothing follows a ring or a height.
void main() {
  vec3 n = facet(), p = vFace;
  float a = atan(p.z, p.x), r = length(p.xz), s = r / shore(a);
  float grain = hash(p.xz * 3.1), wander = noise(p.xz * 0.55), patches = noise(p.xz * 1.3 + 7.0);
  vec3 rock = mix(vec3(0.36, 0.27, 0.4), vec3(0.43, 0.33, 0.47), grain);
  vec3 sand = mix(vec3(0.98, 0.84, 0.52), vec3(1.0, 0.9, 0.62), grain);
  vec3 basalt = mix(vec3(0.2, 0.18, 0.25), vec3(0.26, 0.22, 0.3), grain);
  vec3 soil = mix(vec3(0.62, 0.38, 0.2), vec3(0.7, 0.45, 0.24), grain);
  vec3 grass = mix(mix(vec3(0.3, 0.78, 0.32), vec3(0.55, 0.88, 0.36), grain), vec3(0.75, 0.9, 0.35), step(0.72, patches) * 0.6);
  float beach = step(0.8 + 0.05 * wander, s) * (1.0 - step(1.04, s));
  vec3 color = mix(rock, sand, beach);
  // Lava reaches a place at the day its front gets there, glows, and cools to basalt within a day and a quarter.
  float reached = 0.2 + 1.4 * clamp((r - 1.1) / (0.92 * shore(a) - 1.1), 0.0, 1.0) + 0.15 * wander;
  float lava = channel(a, r) * step(1.0, r) * step(s, 0.95) * step(reached, day);
  float crater = 1.0 - step(0.72 + 0.15 * wander, r);
  float age = day - reached, erupting = step(0.15, day);
  float heat = lava * (1.0 - smoothstep(0.15, 1.25, age)) + crater * (1.0 - smoothstep(2.2, 3.0, day)) * erupting;
  color = mix(color, basalt, max(lava, crater * erupting));
  vec3 glow = heat * mix(vec3(2.2, 0.35, 0.03), vec3(2.6, 1.1, 0.12), 0.5 + 0.5 * sin(day * 9.0 + r * 5.0 + grain * 3.0));
  // Soil, then grass, from the shore inward and up to a ragged line below the volcano's bare top.
  float inland = max(0.0, 1.0 - s / 0.85), summit = 2.3 + 1.3 * wander + 0.4 * grain;
  float land = step(s, 0.8 + 0.05 * wander) * (1.0 - step(summit, p.y));
  float front = 1.6 * (wander - 0.5) + 0.5 * grain;
  float soiled = step(2.8 + 1.6 * inland + front, day) * land;
  float grown = step(3.4 + 2.0 * inland + front + 0.3, day) * land * step(0.18, patches + 0.4 * grain);
  color = mix(mix(color, soil, soiled), grass, grown);
  gl_FragColor = vec4(toon(color, n) + glow * (1.0 - soiled), 1.0);
}`;

// The sea: deep blue, turquoise over the reef, rings of foam running in to the shore.
const sea = `${lighting}
uniform float day;
float shore(float a) { return 6.2 + 0.7 * sin(3.0 * a + 1.0) + 0.4 * sin(5.0 * a + 2.3) + 0.25 * sin(8.0 * a + 0.5); }
void main() {
  float s = length(vWorld.xz) / shore(atan(vWorld.z, vWorld.x));
  vec3 color = mix(vec3(0.06, 0.45, 0.85), vec3(0.2, 0.9, 0.85), 1.0 - smoothstep(1.0, 1.4, s));
  float waves = step(fract((s - 1.0) * 6.0 + day * 2.5), 0.1) * (1.0 - smoothstep(1.05, 1.5, s));
  float foam = max(waves, 1.0 - smoothstep(1.0, 1.04, s));
  color = mix(color, vec3(0.95, 1.0, 1.0), foam);
  vec3 v = normalize(cameraPosition - vWorld);
  float glint = 0.6 * smoothstep(0.9975, 0.999, dot(reflect(-v, vec3(0.0, 1.0, 0.0)), sunDir));
  gl_FragColor = vec4(toon(color, vec3(0.0, 1.0, 0.0)) + glint * sunColor, 1.0);
}`;

// The sky: day blue, a warm sunset band, deep night with stars; a hard sun disc and the moon opposite it.
const skyVertex = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDirection;
void main() { vDirection = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
const sky = `
precision highp float;
varying vec3 vDirection;
uniform vec3 sunDir, moonDir, skyTop, skyHorizon, meteorHead, meteorTail;
uniform float time, meteor, stars;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDirection);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 color = mix(skyHorizon, skyTop, pow(up, 0.55));
  // A faint warmth toward the sun near the horizon.
  float toward = max(0.0, dot(normalize(d.xz + 1e-4), normalize(sunDir.xz + 1e-4)));
  color += vec3(0.12, 0.06, 0.0) * toward * (1.0 - up) * smoothstep(-0.3, 0.1, sunDir.y) * (1.0 - smoothstep(0.1, 0.5, sunDir.y));
  vec3 cell = floor(d * 140.0);
  float star = step(0.9975, hash(cell)) * stars * smoothstep(0.05, 0.3, d.y) * (0.45 + 0.35 * sin(time * 4.0 + hash(cell + 7.0) * 40.0));
  // A shooting star: a streak from its tail to its head, brightest at the head.
  vec3 along = meteorHead - meteorTail;
  float k = clamp(dot(d - meteorTail, along) / dot(along, along), 0.0, 1.0);
  star += meteor * k * (1.0 - smoothstep(0.0015, 0.004, length(d - meteorTail - along * k)));
  // A small, soft sun and a faint moon, far off.
  float sun = smoothstep(0.99935, 0.9996, dot(d, sunDir)), halo = smoothstep(0.994, 0.9995, dot(d, sunDir)) * 0.12;
  float moon = smoothstep(0.99955, 0.9997, dot(d, moonDir)) * stars;
  color = mix(color, vec3(1.0, 0.95, 0.8), sun * 0.6) + halo * vec3(1.0, 0.85, 0.6) + star;
  color = mix(color, vec3(0.88, 0.9, 1.0), moon * 0.45);
  gl_FragColor = vec4(color, 1.0);
}`;

// A toon material of a kind (plain with a color, terrain, sea), and the sky's.
export function createToon(scene) {
  const materials = [];
  const make = (name, fragmentSource, uniforms = []) => {
    const material = new BABYLON.ShaderMaterial(name, scene, { vertexSource: vertex, fragmentSource }, {
      attributes: ['position', 'normal'], uniforms: ['world', 'viewProjection', ...LIGHT, ...uniforms],
    });
    materials.push(material);
    return material;
  };
  const skyMaterial = new BABYLON.ShaderMaterial('Sky', scene, { vertexSource: skyVertex, fragmentSource: sky }, {
    attributes: ['position'], uniforms: ['worldViewProjection', 'sunDir', 'moonDir', 'skyTop', 'skyHorizon', 'stars', 'time', 'meteor', 'meteorHead', 'meteorTail'],
  });
  skyMaterial.backFaceCulling = false;
  return {
    sky: skyMaterial,
    plain: (name, color) => make(name, plain, ['color', 'underglow', 'glow']).setColor3('color', BABYLON.Color3.FromHexString(color)).setColor3('underglow', BABYLON.Color3.Black()).setColor3('glow', BABYLON.Color3.Black()),
    terrain: () => make('Ground', terrain, ['day']),
    sea: () => make('Water', sea, ['day']),
    // The light of the moment, in every toon material and the sky.
    light({ sunDir, sunColor, moonDir, moonColor, skyLight, groundLight, skyTop, skyHorizon, stars }, day, time, meteor) {
      for (const material of materials) {
        material.setVector3('sunDir', sunDir).setColor3('sunColor', sunColor).setVector3('moonDir', moonDir).setColor3('moonColor', moonColor);
        material.setColor3('skyLight', skyLight).setColor3('groundLight', groundLight).setFloat('day', day);
      }
      skyMaterial.setVector3('sunDir', sunDir).setVector3('moonDir', moonDir).setFloat('time', time);
      skyMaterial.setColor3('skyTop', skyTop).setColor3('skyHorizon', skyHorizon).setFloat('stars', stars);
      skyMaterial.setFloat('meteor', meteor.strength).setVector3('meteorHead', meteor.head).setVector3('meteorTail', meteor.tail);
    },
  };
}
