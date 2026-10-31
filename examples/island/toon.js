import { BEAT, NEST, IMPACT, STRIKE, WAVE, IMPACTS, SHADOW_SAMPLES } from './story.js';

// Toon shading: faceted surfaces lit in hard bands by the sun, the moon and a fire light (the meteor, the burning
// forest) over a sky and ground ambient, with a rim of sky light, fading into the air's haze with distance. The terrain,
// the sea and the sky add their own color in the same light.

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

const LIGHT = ['sunDir', 'sunColor', 'moonDir', 'moonColor', 'skyLight', 'groundLight', 'cameraPosition', 'fireLight', 'fireColor', 'fogColor', 'fogDensity', 'soot'];
const lighting = `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
flat varying vec3 vFace;
uniform vec3 sunDir, sunColor, moonDir, moonColor, skyLight, groundLight, cameraPosition, fireLight, fireColor, fogColor;
uniform float fogDensity, soot;
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
vec3 toon(vec3 albedo, vec3 n, float lit) {
  // After the strike soot dulls everything: greyer and darker.
  albedo = mix(albedo, mix(vec3(dot(albedo, vec3(0.3, 0.59, 0.11))), albedo, 0.45) * 0.6, soot);
  float d = dot(n, sunDir);
  float sun = 0.55 * smoothstep(0.0, 0.05, d) + 0.45 * smoothstep(0.45, 0.5, d);
  float moon = smoothstep(0.0, 0.05, dot(n, moonDir));
  vec3 ambient = mix(groundLight, skyLight, 0.5 + 0.5 * n.y);
  float rim = smoothstep(0.6, 0.65, 1.0 - max(dot(n, normalize(cameraPosition - vWorld)), 0.0));
  // The fire light in two hard bands that reach out as it brightens, and its rim on edges turned from it.
  vec3 toFire = fireLight - vWorld;
  float reach = lit * dot(fireColor, vec3(0.33)) / (1.0 + 0.3 * dot(toFire, toFire)), facing = dot(n, normalize(toFire));
  float fire = (0.6 * smoothstep(0.1, 0.13, reach) + 0.4 * smoothstep(0.4, 0.45, reach)) * smoothstep(-0.05, 0.05, facing);
  float fireRim = rim * smoothstep(0.08, 0.11, reach);
  return albedo * (ambient + sunColor * sun + moonColor * moon + 0.25 * rim * skyLight) + albedo * normalize(fireColor + 1e-4) * (1.6 * fire + 0.9 * fireRim);
}
// The air between: distance fades to the haze's color.
vec3 atmosphere(vec3 color) {
  return mix(color, fogColor, 1.0 - exp(-max(0.0, length(cameraPosition - vWorld) - 6.0) * fogDensity));
}`;

const plain = `${lighting}
uniform vec3 color, underglow, glow;
void main() {
  vec3 n = facet();
  gl_FragColor = vec4(atmosphere(toon(color, n, 1.0) + underglow * smoothstep(0.0, -0.6, n.y)) + glow, 1.0);
}`;

// Ink: a flat color, unlit and clear of the haze, for the comic marks drawn over the scene (marks.js).
const ink = `${lighting}
uniform vec3 color;
void main() { gl_FragColor = vec4(color, 1.0); }`;

// The island's ground by the story's day: volcanic rock and beaches, lava running down five channels from the crater
// and cooling to basalt, then soil and grass spreading from the shore up the slopes. Long after, a meteor strikes the
// slope and a fire burns a path down through the forest past the nest tree (its front at fireFront from the centre).
const terrain = `${lighting}
uniform float day, fireFront, fireHeat, blast, blastReach, ash;
float fireAngle(float r) { return ${NEST.angle.toFixed(4)} + 0.12 * (sin(r * 1.9 + 1.0) - sin(${(NEST.r * 1.9 + 1).toFixed(4)})); }
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
  glow *= 1.0 - soiled;
  // The fire's path, burnt and glowing with embers.
  float off = abs(mod(a - fireAngle(r) + 3.14159, 6.28318) - 3.14159) * r, passed = fireFront - r;
  float scorched = step(${IMPACT.r.toFixed(4)}, r + 0.3) * step(s, 0.86) * step(0.0, passed + 0.35) * (1.0 - step(0.55 + 0.35 * wander, off));
  vec3 ash = mix(vec3(0.24, 0.22, 0.26), vec3(0.33, 0.3, 0.33), grain);
  color = mix(color, ash, scorched);
  // The asteroid's blast across the far side: the land burnt to black glass where it reached, molten in cracks that
  // cool over the following seconds.
  float struck = length(p.xz - vec2(${STRIKE.x.toFixed(4)}, ${STRIKE.z.toFixed(4)})), blasted = step(struck, blastReach + 0.6 * (wander - 0.5)) * step(0.0, blast);
  vec3 glass = mix(vec3(0.07, 0.05, 0.09), vec3(0.16, 0.12, 0.17), grain);
  color = mix(color, glass, blasted);
  // It cools in streaks: molten seams running out from the strike, each cooling at its own pace from yellow through
  // orange to a dull red, some still glowing by morning.
  vec2 fromStrike = p.xz - vec2(${STRIKE.x.toFixed(4)}, ${STRIKE.z.toFixed(4)});
  float seam = atan(fromStrike.y, fromStrike.x) * 9.0 + 2.5 * wander + 0.8 * sin(struck * 1.7), lane = floor(seam);
  float vein = 1.0 - smoothstep(0.04, 0.16, abs(fract(seam) - 0.5) * (0.6 + 0.8 * hash(vec2(lane, 3.1))));
  float cools = 3.0 + 40.0 * hash(vec2(lane, 7.7)) * hash(vec2(lane, 1.3)), heat = vein * (1.0 - smoothstep(0.0, cools, blast - struck * 0.08));
  glow += blasted * (heat * mix(vec3(0.9, 0.12, 0.02), vec3(2.8, 1.5, 0.3), heat * heat) + vec3(0.6, 0.1, 0.02) * (1.0 - smoothstep(0.0, 4.0, blast)));
  // Where the strike cut away the volcano's shoulder, its inside shows in section: layers of old flows, and the conduit
  // and the chamber below it still glowing.
  float inside = blasted * (1.0 - smoothstep(2.6, 3.4, r));
  vec3 layers = mix(vec3(0.23, 0.17, 0.21), vec3(0.42, 0.3, 0.3), step(0.5, fract(p.y * 3.2 + 0.4 * wander)));
  color = mix(color, layers, inside);
  float conduit = (1.0 - smoothstep(0.35, 0.55, r)) + (1.0 - smoothstep(1.0, 1.5, r)) * (1.0 - smoothstep(0.1, 0.6, p.y));
  glow += inside * min(1.0, conduit) * mix(vec3(1.6, 0.25, 0.04), vec3(2.6, 1.0, 0.15), 0.5 + 0.5 * sin(day * 40.0 + p.y * 6.0)) * (0.55 + 0.45 * (1.0 - smoothstep(0.0, 30.0, blast)));
  // Ash settling over it all, in drifts, thickest toward the strike.
  float drift = smoothstep(0.25, 0.75, patches + 0.35 * grain) * (0.55 + 0.45 * (1.0 - smoothstep(4.0, 12.0, struck)));
  color = mix(color, mix(vec3(0.33, 0.31, 0.33), vec3(0.45, 0.43, 0.44), grain), ash * (0.5 + 0.45 * drift) * step(s, 1.04));
  float embers = scorched * step(0.62, hash(p.xz * 5.3)) * (0.4 + 0.6 * (1.0 - smoothstep(0.0, 1.5, passed)));
  glow += (embers * fireHeat * mix(vec3(1.4, 0.25, 0.03), vec3(2.4, 0.8, 0.08), 0.5 + 0.5 * sin(day * 60.0 + grain * 9.0)));
  gl_FragColor = vec4(atmosphere(toon(color, n, 1.0) + glow), 1.0);
}`;

const reachGlsl = `1.0${WAVE.lobes.map(([k, amount, phase]) => ` + ${amount.toFixed(3)} * cos(${k.toFixed(1)} * (side - ${WAVE.downrange.toFixed(4)}) + ${phase.toFixed(2)})`).join('')}`;
// The sea: deep blue, turquoise over the reef, rings of foam running in to the shore. After the strike, the great wave
// races out from each impact in a train of lumpy crests, highest downrange, with rough water behind, and the sea where
// it struck boils white.
const sea = `${lighting}
uniform float day, blast;
float shore(float a) { return 6.2 + 0.7 * sin(3.0 * a + 1.0) + 0.4 * sin(5.0 * a + 2.3) + 0.25 * sin(8.0 * a + 0.5); }
float landAt(vec2 q) { return 1.0 - smoothstep(0.8, 0.95, length(q) / shore(atan(q.y, q.x))); }
float islandShadow(vec2 from, vec2 p) {
  float hidden = 0.0;
  for (int k = 1; k <= ${SHADOW_SAMPLES}; k++) hidden = max(hidden, landAt(mix(from, p, float(k) / ${(SHADOW_SAMPLES + 1).toFixed(1)})));
  return hidden;
}
// An impact's mark on the sea, \`age\` seconds after it: its whitewater (x) and the dark churned water behind its wave (y).
// The island hides the sea behind it from the wave, which breaks white where it meets the shore.
vec2 impactSea(vec2 at, float age, float size) {
  if (age < 0.0) return vec2(0.0);
  float struck = length(vWorld.xz - at), side = atan(vWorld.z - at.y, vWorld.x - at.x), reach = ${reachGlsl};
  float travelled = 16.0 * size * pow(age, 0.75) * reach, behind = 1.0 + travelled - struck, fade = exp(-age / 14.0), front = 0.0;
  ${WAVE.train.map(([lag, height]) => `front = max(front, (1.0 - smoothstep(0.0, ${(0.3 + 0.5 * height).toFixed(2)} * max(size, 0.5), abs(1.0 + travelled * ${lag.toFixed(2)} - struck))) * ${height.toFixed(2)});`).join('\n  ')}
  float swell = behind * 0.4 / max(size, 0.4) - age * 0.5;
  float rough = step(0.0, behind) * step(0.82, fract(swell)) * step(0.45, hash(vec2(floor(swell), floor(side * 14.0)))) * exp(-behind / (12.0 * size));
  float churn = step(0.0, behind) * fade, wet = max(front * min(1.0, reach), rough * 0.6) * fade;
  if (churn > 0.0) {
    float hidden = islandShadow(at, vWorld.xz);
    wet = wet * (1.0 - hidden) + front * fade * hidden * (1.0 - hidden) * 3.0;
    churn *= 1.0 - hidden;
  }
  float boil = (1.0 - smoothstep(3.0 * size, 7.0 * size, struck)) * exp(-age / 25.0)
    * step(0.5, hash(vec2(floor(struck * 1.3 + 0.7 * sin(side * 5.0 + age)), floor(side * 9.0 + struck * 0.6) + floor(age * 4.0) * 17.0)));
  return vec2(max(wet, boil), 0.5 * churn);
}
void main() {
  float s = length(vWorld.xz) / shore(atan(vWorld.z, vWorld.x));
  vec3 color = mix(vec3(0.06, 0.45, 0.85), vec3(0.2, 0.9, 0.85), 1.0 - smoothstep(1.0, 1.4, s));
  float waves = step(fract((s - 1.0) * 6.0 + day * 2.5), 0.1) * (1.0 - smoothstep(1.05, 1.5, s));
  float foam = max(waves, 1.0 - smoothstep(1.0, 1.04, s));
  color = mix(color, vec3(0.95, 1.0, 1.0), foam);
  vec2 mark = vec2(0.0);
  ${IMPACTS.map(({ x, z, time, size }) => `mark = max(mark, impactSea(vec2(${x.toFixed(3)}, ${z.toFixed(3)}), blast - ${(time - BEAT.impact).toFixed(3)}, ${size.toFixed(2)}));`).join('\n  ')}
  color = mix(color, vec3(0.04, 0.22, 0.42), mark.y);
  color = mix(color, vec3(0.92, 0.97, 1.0), mark.x);
  vec3 v = normalize(cameraPosition - vWorld);
  float glint = 0.6 * smoothstep(0.99965, 0.99985, dot(reflect(-v, vec3(0.0, 1.0, 0.0)), sunDir));
  // The fire's light on the water, a broken path of glints toward it.
  vec3 toFire = fireLight - vWorld;
  float fireGlint = smoothstep(0.985, 0.995, dot(reflect(-v, vec3(0.0, 1.0, 0.0)), normalize(toFire))) * step(0.45, fract(s * 9.0 + day * 3.0));
  gl_FragColor = vec4(atmosphere(toon(color, vec3(0.0, 1.0, 0.0), 0.0) + glint * sunColor + fireGlint * fireColor * 0.5), 1.0);
}`;

// The sky: day blue, a warm sunset band, deep night with stars; a small far sun with shafts of light, the moon opposite
// it. The meteor's story is drawn on it too: the new star with its coma and a tail turned from the sun, aurora curtains
// as it nears, and the burning contrail it leaves across the sky as it falls.
const skyVertex = `
precision highp float;
attribute vec3 position;
uniform mat4 world, worldViewProjection;
varying vec3 vDirection;
// In the world's axes: the dome may be mirrored or turned (its world matrix), the sky's directions are the world's.
void main() { vDirection = mat3(world) * position; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
const sky = `
precision highp float;
varying vec3 vDirection;
uniform vec3 sunDir, moonDir, skyTop, skyHorizon, meteorHead, meteorTail, omenDir, trailHead, trailTail;
uniform float time, meteor, stars, omen, aurora, trail, rays;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float hash1(float x) { return fract(sin(x * 91.17) * 43758.5453); }
float noise1(float x) { float i = floor(x), f = fract(x); return mix(hash1(i), hash1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
// Distance on the dome from d to the arc from a to b, and how far along it.
vec2 segment(vec3 d, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float k = clamp(dot(d - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return vec2(length(d - a - ab * k), k);
}
// Hard-edged shafts of light round a direction, turning slowly.
float shafts(vec3 d, vec3 to, float width) {
  vec3 side = normalize(cross(to, vec3(0.0, 1.0, 0.0))), up = cross(side, to);
  float angle = atan(dot(d, up), dot(d, side)), along = dot(d, to);
  float beam = step(0.55, noise1(angle * 9.0 + time * 0.05)) * step(0.0, along);
  return beam * smoothstep(1.0 - width, 1.0, along);
}
void main() {
  vec3 d = normalize(vDirection);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 color = mix(skyHorizon, skyTop, pow(up, 0.55));
  // A faint warmth toward the sun near the horizon.
  float toward = max(0.0, dot(normalize(d.xz + 1e-4), normalize(sunDir.xz + 1e-4)));
  color += vec3(0.12, 0.06, 0.0) * toward * (1.0 - up) * smoothstep(-0.3, 0.1, sunDir.y) * (1.0 - smoothstep(0.1, 0.5, sunDir.y));
  vec3 cell = floor(d * 140.0);
  float star = step(0.9975, hash(cell)) * stars * smoothstep(0.05, 0.3, d.y) * (0.45 + 0.35 * sin(time * 4.0 + hash(cell + 7.0) * 40.0));
  vec2 m = segment(d, meteorTail, meteorHead);
  star += meteor * m.y * (1.0 - smoothstep(0.0015, 0.004, m.x));
  // A small, soft sun with shafts when it is low, and a faint moon, far off.
  float sunDot = dot(d, sunDir), sun = smoothstep(0.99935, 0.9996, sunDot), halo = smoothstep(0.994, 0.9995, sunDot) * 0.12;
  float low = 1.0 - smoothstep(0.15, 0.45, sunDir.y);
  color += vec3(1.0, 0.75, 0.45) * 0.06 * rays * low * smoothstep(-0.2, 0.05, sunDir.y) * shafts(d, sunDir, 0.25);
  float moon = smoothstep(0.99955, 0.9997, dot(d, moonDir)) * stars;
  color = mix(color, vec3(1.0, 0.95, 0.8), sun * 0.6) + halo * vec3(1.0, 0.85, 0.6) + star;
  color = mix(color, vec3(0.88, 0.9, 1.0), moon * 0.45);
  // Aurora: curtains of green fading to violet above, rippling slowly, in hard vertical bands.
  float az = atan(d.z, d.x), base = 0.22 + 0.06 * sin(az * 3.0 + time * 0.15) + 0.03 * sin(az * 7.0 - time * 0.3);
  float curtain = smoothstep(base - 0.02, base, d.y) * (1.0 - smoothstep(base, base + 0.22, d.y)) * step(0.35, noise1(az * 40.0 + time * 0.6));
  color += aurora * stars * curtain * mix(vec3(0.15, 0.9, 0.5), vec3(0.55, 0.25, 0.9), smoothstep(base, base + 0.2, d.y)) * 0.55;
  // The new star: a core, its coma and a tail pointing away from the sun, ever larger.
  float o = dot(d, omenDir);
  vec3 away = normalize(omenDir - sunDir * dot(omenDir, sunDir) + vec3(0.0, 1e-3, 0.0));
  vec2 tail = segment(d, omenDir, normalize(omenDir + away * (0.04 + 0.22 * omen)));
  float core = smoothstep(1.0 - 0.00008 - 0.0004 * omen, 1.0, o), coma = smoothstep(1.0 - 0.0009 - 0.004 * omen, 1.0, o);
  float tailGlow = (1.0 - smoothstep(0.0, 0.004 + 0.02 * omen * tail.y, tail.x)) * (1.0 - tail.y);
  // An odd color for a star: cyan at the core, a violet coma, a sea-green tail; faint by day, vivid by night.
  float seen = 0.75 + 0.25 * stars;
  color += seen * (vec3(0.25, 0.85, 0.65) * core * (0.7 + 1.3 * omen) * step(0.01, omen) + (0.35 + omen) * (vec3(0.55, 0.3, 1.0) * coma * 0.9 + vec3(0.2, 0.9, 0.6) * tailGlow * 0.8));
  color += omen * vec3(0.5, 0.8, 1.0) * 0.05 * shafts(d, omenDir, 0.06);
  // The contrail: a white-hot line behind the fireball cooling to orange and smoke as it lingers, then fading.
  vec2 t = segment(d, trailTail, trailHead);
  float line = 1.0 - smoothstep(0.002, 0.006 + 0.01 * (1.0 - t.y), t.x);
  color += trail * line * mix(vec3(0.9, 0.35, 0.1), vec3(2.0, 1.6, 1.0), t.y * t.y);
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
    attributes: ['position'], uniforms: ['world', 'worldViewProjection', 'sunDir', 'moonDir', 'skyTop', 'skyHorizon', 'stars', 'time', 'meteor', 'meteorHead', 'meteorTail',
      'omenDir', 'omen', 'aurora', 'trail', 'trailHead', 'trailTail', 'rays'],
  });
  skyMaterial.backFaceCulling = false;
  let ground = null, water = null;
  return {
    // The fire's state in the ground.
    fire({ front, heat, blast, blastReach, ash }) {
      ground?.setFloat('fireFront', front).setFloat('fireHeat', heat).setFloat('blast', blast).setFloat('ash', ash).setFloat('blastReach', blastReach);
      water?.setFloat('blast', blast);
    },
    sky: skyMaterial,
    ink: (name, color) => Object.assign(make(name, ink, ['color']).setColor3('color', BABYLON.Color3.FromHexString(color)), { backFaceCulling: false }),
    plain: (name, color) => make(name, plain, ['color', 'underglow', 'glow']).setColor3('color', BABYLON.Color3.FromHexString(color)).setColor3('underglow', BABYLON.Color3.Black()).setColor3('glow', BABYLON.Color3.Black()),
    terrain: () => (ground = make('Ground', terrain, ['day', 'fireFront', 'fireHeat', 'blast', 'blastReach', 'ash'])),
    sea: () => (water = make('Water', sea, ['day', 'blast'])),
    // The light of the moment, in every toon material and the sky; `air` is the story's: the fire light, the haze, and
    // what the meteor draws on the sky.
    light({ sunDir, sunColor, moonDir, moonColor, skyLight, groundLight, skyTop, skyHorizon, stars }, day, time, meteor, air) {
      for (const material of materials) {
        material.setVector3('sunDir', sunDir).setColor3('sunColor', sunColor).setVector3('moonDir', moonDir).setColor3('moonColor', moonColor);
        material.setColor3('skyLight', skyLight).setColor3('groundLight', groundLight).setFloat('day', day);
        material.setVector3('fireLight', air.firePosition).setColor3('fireColor', air.fireColor).setColor3('fogColor', air.fogColor).setFloat('fogDensity', air.fogDensity).setFloat('soot', air.soot);
      }
      skyMaterial.setVector3('sunDir', sunDir).setVector3('moonDir', moonDir).setFloat('time', time);
      skyMaterial.setColor3('skyTop', skyTop).setColor3('skyHorizon', skyHorizon).setFloat('stars', stars);
      skyMaterial.setFloat('meteor', meteor.strength).setVector3('meteorHead', meteor.head).setVector3('meteorTail', meteor.tail);
      skyMaterial.setVector3('omenDir', air.omenDir).setFloat('omen', air.omen).setFloat('aurora', air.aurora).setFloat('rays', air.rays);
      skyMaterial.setFloat('trail', air.trail).setVector3('trailHead', air.trailHead).setVector3('trailTail', air.trailTail);
    },
  };
}
