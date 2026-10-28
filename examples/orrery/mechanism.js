import { ring, gear, slab, ball, rod, turned } from './parts.js';

// The orrery's planets: stone, size, arm length, arm height (meters) and revolutions while the Earth makes one.
const PLANETS = [
  { name: 'Mercury', material: 'silver', radius: 0.018, arm: 0.2, height: 0.44, turns: 4.15 },
  { name: 'Venus', material: 'pearl', radius: 0.026, arm: 0.27, height: 0.4, turns: 1.62 },
  { name: 'Earth', material: 'lapis', radius: 0.03, arm: 0.35, height: 0.36, turns: 1, moon: true },
  { name: 'Mars', material: 'jasper', radius: 0.022, arm: 0.43, height: 0.32, turns: 0.53 },
  { name: 'Jupiter', material: 'malachite', radius: 0.05, arm: 0.53, height: 0.28, turns: 0.25 },
  { name: 'Saturn', material: 'gold', radius: 0.04, arm: 0.63, height: 0.24, turns: 0.1, rings: true },
];
const PLANET_LEVEL = 0.52;

// A pivot on the central column; what is parented to it turns when its rotation is keyed.
function pivot(scene, name, y, parent = null) {
  const node = new BABYLON.TransformNode(name, scene);
  node.parent = parent;
  node.position.y = y;
  return node;
}
const attach = (mesh, parent, material, [x, y, z] = [0, 0, 0]) => {
  mesh.parent = parent;
  mesh.material = material;
  mesh.position.set(x, y, z);
  return mesh;
};

export function createOrrery(scene, m) {
  const plinth = attach(slab('Plinth', [0.9, 0.12, 0.9], scene, { bevel: 0.012, segments: 4 }), null, m.marble);
  const drum = attach(turned('Drum', [[0, 0.12], [0.34, 0.12], [0.34, 0.13], [0.32, 0.14], [0.32, 0.17], [0.335, 0.18], [0.3, 0.19], [0, 0.19]], scene, { levels: 0 }), null, m.brass);

  // The gear train on the drum: 36, 12 and 24 teeth of the same pitch, so their teeth mesh as they turn.
  const deck = 0.196, pitch = 0.12 / 36;
  const gearAt = (name, teeth, x, material) => {
    const node = pivot(scene, name + ' Axle', deck);
    node.position.x = x;
    attach(gear(name, { teeth, radius: pitch * teeth + 0.005, depth: 0.01 }, scene), node, material);
    return node;
  };
  const drive = gearAt('Drive Gear', 36, 0, m.brass);
  const idler = gearAt('Idler Gear', 12, 0.16, m.blued);
  const third = gearAt('Third Gear', 24, -0.2, m.blued);
  const gears = [{ node: drive, ratio: 1, phase: 0 }, { node: idler, ratio: -3, phase: -Math.PI + Math.PI / 12 }, { node: third, ratio: -1.5, phase: Math.PI / 24 }];

  attach(rod('Column', 0.012, 0.36, scene), null, m.brass, [0, 0.2 + 0.18, 0]);
  const sun = attach(ball('Sun', 0.07, scene), null, m.sun, [0, PLANET_LEVEL + 0.04, 0]);
  const armillary = [0.12, 0.14, 0.16].map((radius, i) => {
    const node = pivot(scene, 'Armillary ' + (i + 1), PLANET_LEVEL + 0.04);
    node.rotation.x = 0.5 + i * 0.45;
    attach(ring('Armillary Ring ' + (i + 1), radius, 0.008, 0.003, scene), node, i === 1 ? m.silver : m.gold);
    return node;
  });

  const planets = PLANETS.map((p, i) => {
    const orbit = pivot(scene, p.name + ' Orbit', p.height);
    attach(slab(p.name + ' Arm', [p.arm, 0.006, 0.014], scene, { bevel: 0.002, segments: 2 }), orbit, m.brass, [p.arm / 2, -0.003, 0]);
    attach(rod(p.name + ' Post', 0.004, PLANET_LEVEL - p.height, scene), orbit, m.brass, [p.arm, (PLANET_LEVEL - p.height) / 2, 0]);
    const body = attach(ball(p.name, p.radius, scene), orbit, m[p.material], [p.arm, PLANET_LEVEL - p.height + p.radius, 0]);
    if (p.rings) {
      const rings = attach(ring('Saturn Rings', p.radius * 1.75, p.radius * 0.8, 0.0015, scene), body, m.silver);
      rings.rotation.x = 0.45;
    }
    const moon = p.moon ? pivot(scene, 'Moon Orbit', 0, body) : null;
    if (moon) attach(ball('Moon', 0.009, scene, 24), moon, m.silver, [0.065, 0, 0]);
    return { ...p, orbit, moon, phase: i * 1.9 };
  });
  return { plinth, drum, sun, gears, armillary, planets };
}
