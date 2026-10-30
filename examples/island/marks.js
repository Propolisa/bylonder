// Comic marks drawn over the film, flat and inked, each kind with its own shape: an alarm bursts from a bird's head in
// jagged red spikes; a whale's song and blow swell out in wide slow arcs; a great impact or the tree's crash pops a
// starburst; a falling rock streams speed lines behind it, and the mother's shove streaks after the chick. They face the camera and keep their size on screen, and come
// from the cue sheet (audio.js) and the rocks' paths (meteor.js), so they land with the sounds.
import { createMesh } from '@workbench/sdk';
import { BEAT, NEST, IMPACTS, smoothstep } from './story.js';
import { cues } from './audio.js';
import { fallingRocks } from './meteor.js';
import { WHALES } from './life.js';
import { whereIs } from './family.js';
import { setMatrices, place } from './sky.js';
import { random } from './random.js';

const { Vector3, Quaternion, Matrix } = BABYLON;
const FAR = new Vector3(0, -200, 0), NONE = new Vector3(1e-4, 1e-4, 1e-4);

// A stroke along a 2D line (in the mark's plane, X right and Y up) as thick as `widths` at its points; `border` widens
// it for the outline drawn behind.
function stroke(points, widths, border = 0) {
  const vertices = [], faces = [];
  points.forEach(([x, y], i) => {
    const [px, py] = points[Math.max(0, i - 1)], [nx, ny] = points[Math.min(points.length - 1, i + 1)], length = Math.hypot(nx - px, ny - py);
    const [tx, ty] = [(nx - px) / length, (ny - py) / length], w = widths[i] / 2 + border;
    const end = border && (i === 0 ? -1 : i === points.length - 1 ? 1 : 0);
    const [cx, cy] = [x + tx * end * border, y + ty * end * border];
    // Blender's axes: the mark's plane is X and Z.
    vertices.push([cx - ty * w, 0, cy + tx * w], [cx + ty * w, 0, cy - tx * w]);
    if (i) faces.push([2 * i - 2, 2 * i - 1, 2 * i + 1], [2 * i - 2, 2 * i + 1, 2 * i]);
  });
  return { vertices, faces };
}
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i / (n - 1), i));
const SHAPES = {
  // A jagged spike out from the centre, sharp at its tip.
  spike: [range(6, (t, i) => [0.35 + 0.65 * t, i % 2 ? 0.07 : -0.07]), range(6, (t) => 0.09 * (1 - t) + 0.005)],
  // A wide arc round the centre, thick in its middle.
  arc: [range(12, (t) => { const a = (t - 0.5) * 1.9; return [Math.cos(a), Math.sin(a)]; }), range(12, (t) => 0.025 + 0.085 * Math.sin(Math.PI * t))],
  // A starburst's spiky rim, closed.
  burst: [range(29, (t, i) => { const a = t * 2 * Math.PI, r = i % 2 ? 0.62 : 1; return [r * Math.cos(a), r * Math.sin(a)]; }), range(29, () => 0.09)],
  // A speed line: thick where the rock is, thinning to nothing behind it.
  speed: [range(6, (t) => [t, 0]), range(6, (t) => 0.06 * (1 - t) ** 1.3 + 0.004)],
};
const STYLES = { spike: ['#ff4a2a', '#2a0d14'], arc: ['#c4f4ff', '#14364d'], burst: ['#ffd84a', '#2e1606'], speed: ['#fff0f5', '#3a1430'] };

// The marks: [kind, start, how long it lasts, where it is (time), its turn on screen (or a direction to point along),
// its size as a part of the screen's height].
function marksOf() {
  const rand = random(17), list = [];
  for (const cue of cues()) {
    const urgent = cue.sound === 'alarm' || (cue.sound === 'mother' && cue.at > BEAT.climax - 3 && cue.at < BEAT.gone);
    if (urgent) for (let k = 0; k < 5; k++) list.push({ kind: 'spike', start: cue.at, life: 0.55, at: (t) => cue.place(t).add(new Vector3(0, 0.12, 0)), turn: Math.PI / 2 + (k - 2) * 0.5 + (rand() - 0.5) * 0.2, size: 0.11, k });
  }
  // A whale's song as it surfaces, then its blow: three arcs each side, one after another.
  for (const { start, at, size, length } of WHALES) for (const second of [start + 0.2, start + 0.28 * length]) for (let j = 0; j < 3; j++) for (const side of [0.5, Math.PI - 0.5]) {
    list.push({ kind: 'arc', start: second + j * 0.45, life: 2.4, at: () => at.add(new Vector3(0, 0.5 * size, 0)), turn: side, size: 0.12 * size });
  }
  const tree = new Vector3(NEST.x, NEST.ground + 1, NEST.z);
  for (const impact of IMPACTS.filter((i) => i.size >= 0.75)) list.push({ kind: 'burst', start: impact.time, life: 0.8, at: () => new Vector3(impact.x, 2 * impact.size, impact.z), turn: rand() * 6.28, size: 0.22 * impact.size });
  list.push({ kind: 'burst', start: BEAT.blast, life: 0.8, at: () => tree, turn: 0.3, size: 0.15 });
  // The shove: lines streaking along it from the mother past the chick, as it goes over the edge.
  const along = new Vector3(Math.cos(NEST.angle), -0.3, Math.sin(NEST.angle));
  for (let k = 0; k < 4; k++) list.push({ kind: 'push', start: BEAT.climax - 0.05 + k * 0.04, life: 0.55, at: (t) => whereIs('chick', t), along, k });
  return list;
}

const easeBack = (u) => { const t = Math.min(1, Math.max(0, u)) - 1; return 1 + 2.7 * t ** 3 + 1.7 * t ** 2; };

export function createMarks(scene, toon, camera) {
  const marks = marksOf(), SPEED_LINES = 48, lines = Array.from({ length: SPEED_LINES }, (_, i) => ({ phase: (i * 0.618) % 1, across: ((i * 0.37) % 1) * 2 - 1, length: 0.6 + 0.4 * ((i * 0.71) % 1) }));
  const kinds = Object.fromEntries(Object.entries(SHAPES).map(([kind, [points, widths]]) => {
    const count = kind === 'speed' ? SPEED_LINES + marks.filter((m) => m.kind === 'push').length : Math.max(1, marks.filter((m) => m.kind === kind).length);
    const layers = [['', 0], [' Outline', 0.035]].map(([suffix, border], k) => {
      const mesh = createMesh(`Mark ${kind[0].toUpperCase() + kind.slice(1)}${suffix}`, stroke(points, widths, border), scene);
      mesh.material = toon.ink(`Mark ${kind}${suffix}`, STYLES[kind][k]);
      Object.assign(mesh, { isPickable: false, alwaysSelectAsActiveMesh: true });
      return { mesh, buffer: setMatrices(mesh, count), behind: k };
    });
    return [kind, { layers, used: 0, count }];
  }));
  const basis = new Matrix();
  return (day, time) => {
    // The screen's plane at the camera now: right, up and into the scene.
    const eye = camera.position, forward = camera.lockedTarget.subtract(eye).normalize();
    const right = Vector3.Cross(Vector3.Up(), forward).normalize(), up = Vector3.Cross(forward, right);
    Matrix.FromXYZAxesToRef(right, up, forward, basis);
    const facing = Quaternion.FromRotationMatrix(basis), screen = 2 * Math.tan(camera.fov / 2);
    for (const kind of Object.values(kinds)) kind.used = 0;
    // One mark: at a point, turned on screen, as big as a part of the screen's height there (squash flattens it).
    const draw = (kind, at, turn, size, squash = 1) => {
      const k = kinds[kind], i = k.used++, d = Vector3.Distance(eye, at), s = size * d * screen;
      for (const { buffer, behind } of k.layers) {
        // Drawn a little toward the camera, clear of what makes it; its outline just behind it.
        const position = at.add(forward.scale(-Math.min(0.5, 0.3 * s) + behind * 0.004 * d));
        place(buffer, i, position, new Vector3(s, s * squash, s), facing.multiply(Quaternion.RotationAxis(new Vector3(0, 0, 1), turn)));
      }
    };
    for (const m of marks) {
      const u = (time - m.start) / m.life;
      if (u < 0 || u > 1) continue;
      const at = m.at(time);
      if (m.kind === 'spike') draw('spike', at, m.turn + 0.06 * Math.sin(time * 70 + m.k), m.size * easeBack(u * 5) * (1 - smoothstep(0.7, 1, u)));
      else if (m.kind === 'arc') draw('arc', at, m.turn, m.size * (0.5 + 0.9 * (1 - (1 - u) ** 2)), 1 - smoothstep(0.75, 1, u));
      else if (m.kind === 'push') {
        const angle = Math.atan2(Vector3.Dot(m.along, up), Vector3.Dot(m.along, right)) + Math.PI, across = up.scale(Math.cos(angle)).add(right.scale(-Math.sin(angle)));
        const d = Vector3.Distance(eye, at) * screen;
        draw('speed', at.add(across.scale((m.k - 1.5) * 0.025 * d)).add(m.along.normalize().scale(-0.03 * d)), angle, 0.2 * (1 - u) * (0.8 + 0.1 * m.k));
      } else draw('burst', at, m.turn + 0.3 * u, m.size * easeBack(u * 6) * (1 - smoothstep(0.75, 1, u)));
    }
    // Speed lines behind each falling rock, along its path on screen; each slides back and fades as it goes.
    const rocks = fallingRocks(time);
    if (rocks.length) lines.forEach((line, i) => {
      const rock = rocks[i % rocks.length], age = (time * 2.5 + line.phase) % 1;
      const along = rock.velocity, angle = Math.atan2(Vector3.Dot(along, up), Vector3.Dot(along, right)) + Math.PI;
      // As long as a few of the rock's own widths on screen, so a far rock trails short lines and a near one long.
      const d = Vector3.Distance(eye, rock.position), across = up.scale(Math.cos(angle)).add(right.scale(-Math.sin(angle))), seen = rock.size / (d * screen);
      const at = rock.position.add(across.scale(line.across * 0.9 * rock.size)).add(along.normalize().scale(-age * 2 * rock.size));
      draw('speed', at, angle, Math.min(0.3, 7 * seen) * line.length * (1 - age), 1);
    });
    for (const k of Object.values(kinds)) {
      for (const { buffer } of k.layers) for (let i = k.used; i < k.count; i++) place(buffer, i, FAR, NONE);
      for (const { mesh } of k.layers) mesh.thinInstanceBufferUpdated('matrix');
    }
  };
}
