import { createMesh } from '@workbench/sdk';
import { random } from './random.js';
import { shore } from './island.js';
import { smoothstep, eruption, FPS, shotAngle } from './story.js';
import { setMatrices, place, createPuffs } from './sky.js';

const { Vector3, Quaternion, Color3 } = BABYLON;
const hidden = [Vector3.Zero(), 0];

// Lava bombs: glowing rocks thrown from the crater in arcs while it erupts.
export function createBombs(scene, toon) {
  const COUNT = 10, rand = random(5), throws = Array.from({ length: COUNT }, () => ({ angle: rand() * Math.PI * 2, reach: 1.2 + rand(), rate: 0.4 + rand() * 0.3, phase: rand() }));
  const bombs = createPuffs(scene, toon, 'Lava Bomb', '#000000', COUNT, (day, time) => throws.map(({ angle, reach, rate, phase }) => {
    const p = (time * rate + phase) % 1, strength = eruption(day) * smoothstep(0.15, 0.4, day);
    if (strength <= 0) return hidden;
    return [new Vector3(Math.cos(angle) * reach * p, 3.3 + 3.6 * p - 3.4 * p * p, Math.sin(angle) * reach * p), 0.16 * strength * Math.sin(Math.PI * p) ** 0.3];
  }));
  bombs.material.setColor3('glow', new Color3(2.6, 0.9, 0.15));
  return bombs;
}

// Steam where the lava meets the sea, while it is hot there.
export function createSteam(scene, toon) {
  const mouths = Array.from({ length: 5 }, (_, i) => {
    let angle = i * 1.2566 + 0.3, r = 6;
    for (let k = 0; k < 3; k++) { r = 0.93 * shore(angle); angle = i * 1.2566 + 0.3 + 0.25 * Math.sin(r * 1.7 + i); }
    return new Vector3(Math.cos(angle) * r, 0.15, Math.sin(angle) * r);
  });
  const PER = 4;
  return createPuffs(scene, toon, 'Steam Puff', '#f4f7ff', mouths.length * PER, (day, time) => mouths.flatMap((mouth, i) => Array.from({ length: PER }, (_, k) => {
    const p = (time * 0.7 + k / PER + i * 0.21) % 1, hot = smoothstep(1.45, 1.65, day) * (1 - smoothstep(2.4, 2.9, day));
    return [mouth.add(new Vector3(0.2 * Math.sin(k + time), 1.6 * p, 0.2 * Math.cos(k * 2 + time))), (0.18 + 0.4 * p) * (1 - p) * hot];
  })));
}

// A whale's tail, rising from the sea and slipping back under while the volcano is still young, with a splash.
export function createWhale(scene, toon) {
  const flukes = createMesh('Whale Tail', {
    vertices: [[0, -0.12, 0], [0, 0.12, 0], [0.05, 0, 0.9], [-0.05, 0, 0.9], [0, -0.75, 1.15], [0, -0.35, 1.0], [0, 0, 0.98], [0, 0.35, 1.0], [0, 0.75, 1.15]],
    faces: [[0, 1, 2], [1, 0, 3], [0, 2, 3], [1, 3, 2], [2, 6, 5, 4], [2, 8, 7, 6], [3, 4, 5, 6], [3, 6, 7, 8]],
  }, scene);
  flukes.material = toon.plain('Whale', '#3b4f7a');
  // Where the low shot looks past it: off the camera's left, between it and the island.
  const START = 7.5 * FPS, LENGTH = 2.6 * FPS, angle = shotAngle(START + LENGTH / 2) + 0.35;
  const buffer = setMatrices(flukes, 1), at = new Vector3(Math.cos(angle) * 10, 0, Math.sin(angle) * 10);
  const splash = createPuffs(scene, toon, 'Splash', '#ffffff', 8, (day, time) => Array.from({ length: 8 }, (_, i) => {
    const p = (time * FPS - START) / LENGTH, burst = Math.max(smoothstep(0.02, 0.1, p) * (1 - smoothstep(0.15, 0.35, p)), smoothstep(0.72, 0.8, p) * (1 - smoothstep(0.85, 1, p)));
    const a = (i / 8) * Math.PI * 2;
    return [at.add(new Vector3(Math.cos(a) * 0.7, 0.1 + 0.3 * burst, Math.sin(a) * 0.7)), 0.3 * burst];
  }));
  return (day, time) => {
    const p = (time * FPS - START) / LENGTH, up = p > 0 && p < 1 ? Math.sin(Math.PI * p) : 0;
    const turn = Quaternion.RotationYawPitchRoll(0.6, 0, -0.3 + 1.3 * Math.max(0, Math.min(1, p)));
    place(buffer, 0, at.add(new Vector3(0, -1.6 + 2.1 * up, 0)), new Vector3(1, 1, 1).scale(up > 0 ? 1.4 : 1e-4), turn);
    flukes.thinInstanceBufferUpdated('matrix');
    splash(day, time);
  };
}

// Birds: a small flock that comes once the forest has grown, circling the volcano, gliding and flapping in bursts.
export function createBirds(scene, toon) {
  const COUNT = 7, rand = random(21), flock = Array.from({ length: COUNT }, () => ({ radius: 3.5 + rand() * 2.5, height: 4.3 + rand() * 1.2, speed: 0.45 + rand() * 0.2, phase: rand() * Math.PI * 2 }));
  const part = (name, vertices, faces) => {
    const mesh = createMesh(name, { vertices, faces }, scene);
    mesh.material = toon.plain(name, '#fdf8f0');
    return { mesh, buffer: setMatrices(mesh, COUNT) };
  };
  const body = part('Bird Body', [[0.14, 0, 0], [-0.12, 0, 0.02], [0, 0.03, 0.03], [0, -0.03, 0.03], [0, 0, -0.03]], [[0, 2, 1], [0, 1, 3], [0, 3, 4], [0, 4, 2], [1, 2, 4], [1, 4, 3]]);
  const left = part('Bird Wing L', [[0.05, 0, 0], [-0.05, 0, 0], [-0.02, 0.28, 0.02]], [[0, 1, 2]]);
  const right = part('Bird Wing R', [[0.05, 0, 0], [-0.05, 0, 0], [-0.02, -0.28, 0.02]], [[0, 2, 1]]);
  return (day, time) => {
    const here = smoothstep(4.6, 5.3, day);
    flock.forEach(({ radius, height, speed, phase }, i) => {
      const a = phase + time * speed, position = new Vector3(Math.cos(a) * radius, height + 0.3 * Math.sin(time * 1.3 + phase), Math.sin(a) * radius);
      const bank = Quaternion.RotationYawPitchRoll(-a, 0, 0.35), flapping = smoothstep(0.2, 0.5, Math.sin(time * 0.9 + phase * 3));
      const flap = flapping * 0.7 * Math.sin(time * 14 + phase);
      const scale = new Vector3(1, 1, 1).scale(Math.max(1e-4, here * 3.5));
      place(body.buffer, i, position, scale, bank);
      place(left.buffer, i, position, scale, bank.multiply(Quaternion.RotationAxis(Vector3.Right(), -flap)));
      place(right.buffer, i, position, scale, bank.multiply(Quaternion.RotationAxis(Vector3.Right(), flap)));
    });
    for (const { mesh } of [body, left, right]) mesh.thinInstanceBufferUpdated('matrix');
  };
}

// Fireflies blinking over the forest at night, once it has grown.
export function createFireflies(scene, toon, spots) {
  const rand = random(31), flies = spots.slice(0, 70).map((at) => ({ at: at.add(new Vector3(rand() - 0.5, 0.6 + rand() * 0.9, rand() - 0.5)), phase: rand() * 20, rate: 2 + rand() * 2 }));
  const fireflies = createPuffs(scene, toon, 'Firefly', '#000000', flies.length, (day, time) => {
    const night = 1 - smoothstep(-0.25, 0.0, Math.sin(2 * Math.PI * (day + 0.05))), grown = smoothstep(5.6, 6.2, day);
    return flies.map(({ at, phase, rate }) => [at.add(new Vector3(0.15 * Math.sin(time * 0.7 + phase), 0.1 * Math.sin(time * 1.1 + phase), 0.15 * Math.cos(time * 0.6 + phase))),
      0.035 * night * grown * Math.max(0, Math.sin(time * rate + phase)) ** 3]);
  });
  fireflies.material.setColor3('glow', new Color3(1.6, 2.2, 0.6));
  return fireflies;
}
