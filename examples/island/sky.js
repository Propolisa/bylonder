import { createPrimitive } from '@workbench/sdk';
import { random } from './random.js';
import { smoothstep, eruption, aftermath } from './story.js';

const { Vector3, Color3, Matrix, Quaternion } = BABYLON;
const mix = (a, b, t) => Color3.Lerp(a, b, Math.min(1, Math.max(0, t)));

// The light of a moment of a day: the sun climbing from the east, setting in the west, the moon opposite it; the sky's
// colors and the light they give change gently with the sun's height, never to black. The faster days pass, the more
// the light settles toward the day's average, as a long exposure would, so the time-lapse never flashes.
const C = (r, g, b) => new Color3(r, g, b);
const PALETTE = {
  day: { top: C(0.25, 0.6, 1), horizon: C(0.7, 0.92, 1), sun: C(1, 0.96, 0.88).scale(0.62), sky: C(0.36, 0.42, 0.54), moon: C(0, 0, 0) },
  dusk: { top: C(0.42, 0.46, 0.85), horizon: C(1, 0.74, 0.58), sun: C(1, 0.62, 0.42).scale(0.45), sky: C(0.42, 0.36, 0.5), moon: C(0, 0, 0) },
  night: { top: C(0.08, 0.11, 0.3), horizon: C(0.2, 0.24, 0.48), sun: C(0, 0, 0), sky: C(0.2, 0.23, 0.42), moon: C(0.18, 0.22, 0.36) },
};
const sunAt = (day) => { const a = 2 * Math.PI * (day + 0.05); return new Vector3(Math.cos(a) * 0.85, Math.sin(a), 0.45).normalize(); };
function moment(day) {
  const e = sunAt(day).y, daytime = smoothstep(-0.2, 0.35, e), night = 1 - smoothstep(-0.5, -0.1, e), dusk = Math.max(0, 1 - daytime - night);
  const blend = (key) => PALETTE.day[key].scale(daytime).add(PALETTE.dusk[key].scale(dusk)).add(PALETTE.night[key].scale(night));
  return { ...Object.fromEntries(Object.keys(PALETTE.day).map((key) => [key, blend(key)])), stars: night };
}
const AVERAGE = (() => {
  const samples = Array.from({ length: 48 }, (_, i) => moment(i / 48));
  return Object.fromEntries(Object.keys(samples[0]).map((key) => [key, key === 'stars' ? samples.reduce((n, m) => n + m.stars, 0) / 48
    : samples.reduce((sum, m) => sum.add(m[key]), C(0, 0, 0)).scale(1 / 48)]));
})();
export function daylight(day, daysPerSecond) {
  const now = moment(day), settle = 0.6 * smoothstep(0.15, 0.5, daysPerSecond);
  const light = Object.fromEntries(Object.keys(now).map((key) => [key, key === 'stars' ? now.stars + (AVERAGE.stars - now.stars) * settle : mix(now[key], AVERAGE[key], settle)]));
  const sunDir = sunAt(day);
  return { sunDir, moonDir: new Vector3(-sunDir.x, -sunDir.y, 0.35).normalize(), sunColor: light.sun, moonColor: light.moon, skyLight: light.sky,
    groundLight: light.sky.multiply(C(0.55, 0.5, 0.45)), skyTop: light.top, skyHorizon: light.horizon, stars: light.stars };
}

const setMatrices = (mesh, count) => {
  const buffer = new Float32Array(16 * count);
  mesh.thinInstanceSetBuffer('matrix', buffer, 16, false);
  mesh.alwaysSelectAsActiveMesh = true;
  return buffer;
};
// An instance's matrix: its place, size and turn (an angle about up, or a rotation).
const place = (buffer, i, position, scale, turn = 0) =>
  Matrix.Compose(scale, typeof turn === 'number' ? Quaternion.RotationAxis(Vector3.Up(), turn) : turn, position).copyToArray(buffer, i * 16);

// Clouds: clusters of flattened puffs (Blender's Ico Sphere) on the horizon, circling the island once every two days, so
// they race as the time-lapse speeds up.
export function createClouds(scene, toon) {
  const puff = createPrimitive('Cloud Puff', 'mesh.primitive_ico_sphere_add', { subdivisions: 1, radius: 1 }, scene);
  puff.material = toon.plain('Cloud', '#ffffff');
  const rand = random(11), clouds = Array.from({ length: 12 }, (_, i) => ({
    angle: (i / 12) * Math.PI * 2 + rand() * 0.5, radius: 32 + rand() * 12, height: 5 + rand() * 5,
    puffs: Array.from({ length: 3 + Math.floor(rand() * 3) }, () => [rand() * 2 - 1, rand() * 0.4, rand() - 0.5, 0.6 + rand() * 0.6]),
  }));
  const buffer = setMatrices(puff, clouds.reduce((n, c) => n + c.puffs.length, 0)), white = Color3.White(), sooty = new Color3(0.44, 0.4, 0.42);
  return (day, time) => {
    // After the strike they are dirty with smoke.
    puff.material.setColor3('color', Color3.Lerp(white, sooty, aftermath(time)));
    let i = 0;
    for (const cloud of clouds) {
      const a = cloud.angle + Math.PI * day, center = new Vector3(Math.cos(a) * cloud.radius, cloud.height, Math.sin(a) * cloud.radius);
      for (const [x, y, z, size] of cloud.puffs) {
        const offset = Vector3.TransformCoordinates(new Vector3(x * 2.4, y * 2, z * 2), Matrix.RotationY(-a));
        place(buffer, i++, center.add(offset), new Vector3(size * 2.6, size * 1.4, size * 2), -a);
      }
    }
    puff.thinInstanceBufferUpdated('matrix');
  };
}

// Puffs of one mesh and color: each frame, `at(day, time)` gives [position, size] for each.
export function createPuffs(scene, toon, name, color, count, at) {
  const puff = createPrimitive(name, 'mesh.primitive_ico_sphere_add', { subdivisions: 1, radius: 1 }, scene);
  puff.material = toon.plain(name, color);
  const buffer = setMatrices(puff, count);
  return Object.assign((day, time) => {
    at(day, time).forEach(([position, size], i) => place(buffer, i, position, new Vector3(size, size, size), i * 1.7));
    puff.thinInstanceBufferUpdated('matrix');
  }, { material: puff.material });
}

// Smoke rising from the crater while the volcano erupts, lit orange from below by the lava.
export function createSmoke(scene, toon) {
  const COUNT = 8;
  const smoke = createPuffs(scene, toon, 'Smoke Puff', '#7d7488', COUNT, (day) => Array.from({ length: COUNT }, (_, i) => {
    const p = (day * 1.6 + i / COUNT) % 1;
    return [new Vector3(0.6 * p * Math.sin(i * 2.4), 3.2 + 3.5 * p, 0.6 * p * Math.cos(i * 2.4) + 0.8 * p), (0.25 + 0.75 * p) * (1 - 0.5 * p) * eruption(day)];
  }));
  return (day, time) => {
    smoke.material.setColor3('underglow', new Color3(1.1, 0.35, 0.08).scale(eruption(day) * (0.8 + 0.2 * Math.sin(time * 7))));
    smoke(day, time);
  };
}

// One shooting star, on the night that falls about twenty seconds in.
export function meteorAt(frame) {
  const t = (frame - 490) / 14, strength = t > 0 && t < 1 ? Math.sin(Math.PI * t) : 0;
  const from = new Vector3(-0.8, 0.55, 0.4).normalize(), to = new Vector3(-0.2, 0.35, 0.9).normalize();
  const head = Vector3.Lerp(from, to, Math.max(0, Math.min(1, t))).normalize();
  return { strength, head, tail: Vector3.Lerp(from, head, 0.6).normalize() };
}

export { setMatrices, place };
