// A retarget sanity sheet for a character demo, all on the CPU: for each action, four frames across its cycle (each
// foot's contact and the passing pose after it) from the front, three quarters and the side, in three columns: the
// source rig playing the library's action and the character playing its retargeted action, both rendered by the
// reference Blender (Cycles on the CPU), and the character in the exported page on SwiftShader. Then checks, which
// fail the run by name: each knee and elbow bends the same way in all three columns, the page's main segments point
// within 15 degrees of Blender's, its limb bones stay within 2% of their rest length, its hip height above the ground
// and hips to head match Blender's within 2 cm, and each of the character's meshes draws on the page.
//   usage: node tools/docs/retarget-sheet.mjs [actions, comma separated] (default Walk,Jog,Sprint)
//   BLEND, PACKAGE: the character's .blend and its exported package (default the character-controller example's);
//   OUT: where the sheets go (default .shots/retarget); AGAIN: see below
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../../tests/e2e/tools.mjs';
import { chromium } from '../../tests/e2e/app.mjs';
import { ffmpeg } from '../media.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const OUT = resolve(process.env.OUT ?? join(root, '.shots/retarget'));
const BLENDER = join(TOOLS.blender, 'blender-5.2.3-windows-x64', process.platform === 'win32' ? 'blender.exe' : 'blender');
const SIZE = [240, 320];
const VIEWS = ['front', 'three-quarter', 'side'];
const side = (s) => ({ [`hip.${s}`]: `Thigh_1.${s}`, [`knee.${s}`]: `Knee_1.${s}`, [`ankle.${s}`]: `Foot.${s}`,
  [`shoulder.${s}`]: `UpperArm_1.${s}`, [`elbow.${s}`]: `Forearm_1.${s}`, [`wrist.${s}`]: `Wrist.${s}` });
// Joints by role: each bone's head. Snow's deform bones (the page keeps those), and the library's.
const CHARACTER = Object.fromEntries(Object.entries({ hips: 'Spine', neck: 'Neck', head: 'Head', ...side('L'), ...side('R') }).map(([k, v]) => [k, [`DEF-${v}`, 'head']]));
const lower = (s) => ({ [`hip.${s}`]: `thigh.${s}`, [`knee.${s}`]: `shin.${s}`, [`ankle.${s}`]: `foot.${s}`,
  [`shoulder.${s}`]: `upper_arm.${s}`, [`elbow.${s}`]: `forearm.${s}`, [`wrist.${s}`]: `hand.${s}` });
const SOURCE_JOINTS = Object.fromEntries(Object.entries({ hips: 'hips', neck: 'neck', head: 'head', ...lower('L'), ...lower('R') }).map(([k, v]) => [k, [`DEF-${v}`, 'head']]));
// The characters a sheet is made for (CHARACTER): the rig, its joints, its example and demo, how the demo makes it (the
// page's code, given the loaded scene and an input), the gaits locomotion plays (other actions play on the body), and
// the library's actions each of its actions came from (none: no source column).
const PROFILES = {
  snow: { rig: 'RIG-Snow', joints: CHARACTER, blend: 'examples/character-controller/character-controller.blend', package: 'docs/demos/character-controller/world',
    make: "import { createSnow } from './snow.js'; const make = (blend, input) => createSnow(blend, { manual: true, input }).hero;",
    gaits: ['Walk', 'Jog', 'Sprint'], sources: { Idle: 'Idle_Loop', Walk: 'Walk_Loop', Jog: 'Jog_Fwd_Loop', Sprint: 'Sprint_Loop', Jump_Start: 'Jump_Start',
      Jump_Loop: 'Jump_Loop', Jump_Land: 'Jump_Land', Talk: 'Idle_Talking_Loop', Acting: null } },
  // The basic character's page (game.js): the guide's example 1.
  basic: { rig: 'Armature', joints: SOURCE_JOINTS, blend: 'examples/basic-character/basic-character.blend', package: 'docs/demos/basic-character/world',
    make: `import { Character, feet, gaze } from './world/scene.js';
const make = (blend, input) => {
  const hero = new Character(blend, 'Armature', { manual: true, input });
  hero.body.play(hero.locomotion);
  hero.add(feet());
  hero.add(gaze({ targets: [blend.scene.activeCamera] }));
  return hero;
};`, gaits: ['Walk', 'Run'], sources: { Idle: 'Idle_Loop', Walk: 'Walk_Loop', Run: 'Jog_Fwd_Loop', Jump: null } },
};
const PROFILE = PROFILES[process.env.CHARACTER ?? 'snow'];
const BLEND = resolve(process.env.BLEND ?? join(root, PROFILE.blend));
const PACKAGE = resolve(process.env.PACKAGE ?? join(root, PROFILE.package));
const SOURCE = join(dirname(BLEND), 'downloads/18ff1a7215f4852b/Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb');
const LIMBS = { thigh: ['hip', 'knee'], shin: ['knee', 'ankle'], 'upper arm': ['shoulder', 'elbow'], forearm: ['elbow', 'wrist'] };
// The main segments whose direction on the page must stay within ANGLE degrees of Blender's: T-poses, flips and
// twisted limbs alike.
const SEGMENTS = { spine: ['hips', 'neck'], neck: ['neck', 'head'], ...Object.fromEntries(['L', 'R'].flatMap((s) => Object.entries(LIMBS).map(([limb, [a, b]]) => [`${limb}.${s}`, [`${a}.${s}`, `${b}.${s}`]]))) };
const ANGLE = 15;
// A bend is counted where the middle joint sits at least this far off the line of its chain's ends (metres).
const BENT = 0.03;

function dirname(path) { return path.replace(/[\\/][^\\/]*$/, ''); }
const encode = (...args) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args]);

// Blender's columns and joints.
function blenderSide(actions) {
  const out = join(OUT, 'blender'), spec = join(OUT, 'spec.json');
  mkdirSync(out, { recursive: true });
  writeFileSync(spec, JSON.stringify({ rig: PROFILE.rig, source: SOURCE, size: SIZE, samples: 8, joints: { character: PROFILE.joints, source: SOURCE_JOINTS },
    actions: Object.fromEntries(actions.map((a) => [a, PROFILE.sources[a] ?? null])) }));
  execFileSync(BLENDER, ['-b', BLEND, '--python', fileURLToPath(new URL('retarget-sheet.blender.py', import.meta.url)), '--', out, spec], { stdio: ['ignore', 'ignore', 'inherit'], maxBuffer: 1 << 30 });
  return JSON.parse(readFileSync(join(out, 'blender.json'), 'utf8'));
}

// The page's column: the demo as it ships (its snow.js: locomotion, feet, lean, gaze, springs, the rig's native
// solve) on flat ground, on SwiftShader. For each gait Snow moves straight ahead at the gait's own speed until it settles, then is
// caught when the action plays at each frame Blender's column shows.
async function pageSide(actions, blender) {
  const demo = dirname(PACKAGE), scene = readFileSync(join(PACKAGE, 'scene.js'), 'utf8');
  const babylon = scene.match(/"(https:\/\/cdn\.jsdelivr\.net\/npm\/@babylonjs\/core@[\d.]+\/)"/)[1];
  const harness = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{display:block;width:${SIZE[0]}px;height:${SIZE[1]}px}</style>
<script type="importmap">{ "imports": { "@babylonjs/core/": "${babylon}" } }</script><canvas id="c" width="${SIZE[0]}" height="${SIZE[1]}"></canvas>
<script type="module">
import { createEngine, load } from './world/scene.js';
${PROFILE.make}
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Frustum } from '@babylonjs/core/Maths/math.frustum.js';
const engine = await createEngine(document.getElementById('c'));
const blend = await load(engine);
await blend.settled?.();
const scene = blend.scene, view = new FreeCamera('retarget', Vector3.Zero(), scene);
view.mode = Camera.ORTHOGRAPHIC_CAMERA;
let move = Vector3.Zero();
// Flat ground, as Blender's column stands on: the field's hills levelled and the slope and steps gone, so the hips'
// height measures the retarget, not the terrain the feet adapt to.
const field = scene.getMeshByName('Ground'), positions = field.getVerticesData('position');
for (let i = 1; i < positions.length; i += 3) positions[i] = 0;
field.setVerticesData('position', positions);
field.refreshBoundingInfo();
for (const m of scene.meshes) if (m.name === 'Slope' || /^Step /.test(m.name)) m.setEnabled(false);
const hero = make(blend, () => ({ move }));
// OFF: effects to weigh 0, to tell what an effect changes from what the action plays (OFF=feet).
for (const name of ${JSON.stringify((process.env.OFF ?? '').split(',').filter(Boolean))}) hero.effect(name).weight = 0;
scene.activeCamera = view;
const skinned = scene.meshes.find((m) => m.skeleton);
// The character's meshes: skinned by its skeleton, or under its armature (or its node).
const armature = scene.getNodeByName('${PROFILE.rig}');
const under = (m) => m.isDescendantOf(armature) || m.isDescendantOf(hero.node);
const own = scene.meshes.filter((m) => m.getTotalVertices() > 0 && (m.skeleton === skinned.skeleton || under(m)));
// Those the page shows once the character is up (as tools/docs/record-snow-session.mjs's DRAWN check chooses them): a
// deformed copy counts, the original it hides does not.
let shown = [];
// The rest of the scene's props stay out of the views (a rock between camera and character); the ground stays.
for (const m of scene.meshes) if (!own.includes(m) && m !== field && !m.name.startsWith('Ground')) m.isVisible = false;
const DT = 1 / 120;
// Blender's axes (x, y, z) are the page's (x, z, y); Blender's -Y, the character's forward, is the page's -Z.
const toPage = ([x, y, z]) => new Vector3(x, z, y), toBlender = (v) => [v.x, v.z, v.y];
// The page's own render loop, as the demo runs it; the character advances only by its updates here, one a frame.
const frame = () => new Promise((done) => scene.onAfterRenderObservable.addOnce(() => done()));
engine.runRenderLoop(() => scene.render());
const step = async () => { hero.update(DT); await frame(); };
// An action that is not a gait plays on the body (null: locomotion plays).
let playing = null;
const joints = () => {
  const at = (name) => { const b = skinned.skeleton.bones.find((b) => b.name === name); return b ? toBlender(b.getAbsolutePosition(skinned)) : null; };
  // The ground under the character: where its movement stands (the armature's node is lifted by its authored height).
  const root = toBlender(hero.movement?.position ?? hero.node.position);
  return { root, ...Object.fromEntries(Object.entries(${JSON.stringify(PROFILE.joints)}).map(([role, [bone]]) => [role, at(bone)])) };
};
window.retarget = {
  // Moves the character back to the middle; a gait then moves it ahead at the action's speed for a while, locomotion
  // playing it; another action plays on its body, standing.
  async start(name) {
    hero.node.position.set(0, 0, 0);
    move = Vector3.Zero();
    playing = ${JSON.stringify(PROFILE.gaits)}.includes(name) ? null : hero.action(name, { once: true });
    hero.body.play(playing ?? hero.locomotion, { blend: 0 });
    for (let i = 0; i < 120; i++) await step();
    if (!playing) move = new Vector3(0, 0, -hero.action(name).contacts.speed);
    for (let i = 0; i < 180; i++) await step();
    // Temporary, for packages exported before load() waited for the rig's solver: those hide the character until its
    // first solve, which comes in real time; step on until it shows (at most a minute), then a second more.
    const showing = () => own.filter((m) => m.isEnabled() && m.isVisible);
    for (const end = performance.now() + 60000; !showing().length && performance.now() < end;) await step();
    for (const end = performance.now() + 1000; performance.now() < end;) await step();
    shown = showing();
  },
  // Steps on until the action plays \`seconds\` into itself, as locomotion times it (locomotion.js gait: phase 0 at the
  // left foot's first contact), then the joints and what plays.
  async at(name, seconds) {
    if (playing) {
      playing.seek(seconds);
      await step();
      while (!scene.isReady(true)) await frame();
      return { ...joints(), phase: 0, seconds: playing.time ?? seconds, weights: [] };
    }
    const action = hero.action(name), first = action.contacts.down[0]?.indexOf(1) ?? -1, start = Math.max(first, 0) / action.contacts.fps;
    const phase = (((seconds - start) / action.duration) % 1 + 1) % 1;
    const loco = hero.locomotion, ahead = (p) => (phase - p + 1) % 1;
    let gap = ahead(loco.phase);
    for (let i = 0; i < 600 && gap > 1e-3; i++) {
      await step();
      const next = ahead(loco.phase);
      if (next > gap) break;
      gap = next;
    }
    while (!scene.isReady(true)) await frame();
    await frame();
    return { ...joints(), phase: loco.phase, seconds: (start + loco.phase * action.duration) % action.duration, weights: [...loco.weights] };
  },
  // The camera on the character from one side; after the loop's next frame, the character's meshes on screen it did not
  // draw: not among its active meshes, or collapsed.
  async view(at, height, angle) {
    // \`at\`: the hips across, the root's height up.
    const a = angle * Math.PI / 180, centre = [at[0], at[1], at[2] + height * 0.52];
    const d = [-Math.sin(a), -Math.cos(a), 0.12], n = Math.hypot(...d);
    view.position = toPage(centre.map((c, i) => c + d[i] / n * 8));
    view.setTarget(toPage(centre));
    const half = height * 1.25 / 2, aspect = ${SIZE[0] / SIZE[1]};
    Object.assign(view, { orthoTop: half, orthoBottom: -half, orthoLeft: -half * aspect, orthoRight: half * aspect, minZ: 0.1, maxZ: 200 });
    await frame();
    if (!shown.length) return ['any of its meshes'];
    const planes = Frustum.GetPlanes(scene.getTransformMatrix()), drawn = new Set(scene.getActiveMeshes().data);
    return shown.filter((m) => m.isInFrustum(planes) && (!drawn.has(m) || m.getBoundingInfo().boundingBox.extendSizeWorld.length() <= 1e-3)).map((m) => m.name);
  },
};
window.ready = true;
</script>`;
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg' };
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/retarget.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(harness); }
    const file = join(demo, url);
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  }).listen(0);
  // SwiftShader: the CPU's own WebGL, so the GPU stays free.
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
  const page = await browser.newPage({ viewport: { width: SIZE[0], height: SIZE[1] } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://localhost:${server.address().port}/retarget.html`);
    await page.waitForFunction(() => window.ready, null, { timeout: 900000 });
    const height = Math.max(...Object.values(blender.rest).map((v) => v[2]));
    const result = {};
    for (const name of actions) {
      result[name] = [];
      await page.evaluate((n) => window.retarget.start(n), name);
      const { frames, start } = blender.actions[name];
      // One catch first, not kept: the first after the run-up can come before the gait has settled.
      await page.evaluate(([n, s]) => window.retarget.at(n, s), [name, (frames[2] - start) / blender.fps]);
      for (const [row, frame] of frames.entries()) {
        const pose = await page.evaluate(([n, s]) => window.retarget.at(n, s), [name, (frame - start) / blender.fps]);
        result[name].push(pose);
        for (const [i, view] of VIEWS.entries()) {
          const undrawn = await page.evaluate(([hips, h, a]) => window.retarget.view(hips, h, a), [[pose.hips[0], pose.hips[1], pose.root[2]], height, [0, 45, 90][i]]);
          if (i === 0) pose.undrawn = undrawn;
          await page.screenshot({ path: join(OUT, 'blender', name, `page-${row}-${view}.png`) });
        }
      }
    }
    if (errors.length) console.log(`page errors: ${errors.join('; ')}`);
    return result;
  } finally {
    await browser.close();
    server.close();
  }
}

// The knee's (or elbow's) distance in front of the line from hip to ankle (shoulder to wrist), Blender's -Y forward.
function bend(pose, s, [a, b, c]) {
  const [p, q, r] = [pose[`${a}.${s}`], pose[`${b}.${s}`], pose[`${c}.${s}`]];
  if (!p || !q || !r) return null;
  const line = r.map((v, i) => v - p[i]), len = Math.hypot(...line), t = q.reduce((sum, v, i) => sum + (v - p[i]) * line[i], 0) / (len * len);
  return -(q[1] - (p[1] + line[1] * t));
}
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const direction = (p, [a, b]) => { const d = p[b].map((v, i) => v - p[a][i]), n = Math.hypot(...d); return d.map((v) => v / n); };

function checks(actions, blender, page) {
  const failures = [], notes = [];
  for (const name of actions) {
    const entry = blender.actions[name];
    entry.frames.forEach((frame, row) => {
      const columns = { source: entry.source[row], Blender: entry.character[row], page: page[name][row] };
      for (const s of ['L', 'R']) for (const [joint, chain] of [['knee', ['hip', 'knee', 'ankle']], ['elbow', ['shoulder', 'elbow', 'wrist']]]) {
        const signs = Object.entries(columns).filter(([, pose]) => pose).map(([col, pose]) => [col, bend(pose, s, chain)]);
        const counted = signs.filter(([, v]) => v !== null && Math.abs(v) >= BENT);
        if (new Set(counted.map(([, v]) => Math.sign(v))).size > 1) failures.push(`${name} frame ${frame}: ${joint}.${s} bends ${counted.map(([c, v]) => `${c} ${v > 0 ? 'forward' : 'back'} ${(Math.abs(v) * 100).toFixed(1)} cm`).join(', ')}`);
      }
      const pose = page[name][row], rest = blender.rest;
      for (const s of ['L', 'R']) for (const [limb, [a, b]] of Object.entries(LIMBS)) {
        const now = dist(pose[`${a}.${s}`], pose[`${b}.${s}`]), was = dist(rest[`${a}.${s}`], rest[`${b}.${s}`]);
        if (Math.abs(now / was - 1) > 0.02) failures.push(`${name} frame ${frame}: page ${limb}.${s} is ${(now * 100).toFixed(1)} cm, rest ${(was * 100).toFixed(1)} cm (${((now / was - 1) * 100).toFixed(1)}%)`);
      }
      for (const [segment, ends] of Object.entries(SEGMENTS)) {
        if (!ends.every((joint) => pose[joint] && columns.Blender[joint])) continue;
        const angle = Math.acos(Math.min(1, direction(pose, ends).reduce((sum, v, i) => sum + v * direction(columns.Blender, ends)[i], 0))) * 180 / Math.PI;
        if (angle > ANGLE) failures.push(`${name} frame ${frame}: page ${segment} points ${angle.toFixed(0)} degrees off Blender's`);
      }
      for (const mesh of pose.undrawn ?? []) failures.push(`${name} frame ${frame}: page does not draw ${mesh}`);
      // The hips' height above the ground: the page's root stands on the (rolling) ground under it, Blender's ground is z 0.
      const b = columns.Blender, dz = (pose.hips[2] - pose.root[2]) - b.hips[2], reach = dist(pose.hips, pose.head) - dist(b.hips, b.head);
      if (Math.abs(dz) > 0.02) failures.push(`${name} frame ${frame}: page hips ${(Math.abs(dz) * 100).toFixed(1)} cm ${dz > 0 ? 'higher' : 'lower'} above the ground than Blender's`);
      if (Math.abs(reach) > 0.02) failures.push(`${name} frame ${frame}: page hips to head ${(reach * 100).toFixed(1)} cm off Blender's`);
      notes.push(`${name} ${frame}: knees L ${['source', 'Blender', 'page'].map((c) => columns[c] ? (bend(columns[c], 'L', ['hip', 'knee', 'ankle']) * 100).toFixed(1) : '-').join('/')} R ${['source', 'Blender', 'page'].map((c) => columns[c] ? (bend(columns[c], 'R', ['hip', 'knee', 'ankle']) * 100).toFixed(1) : '-').join('/')} cm, hips dz ${(dz * 100).toFixed(1)} cm, page at ${(pose.seconds * blender.fps + entry.start).toFixed(1)} (phase ${pose.phase.toFixed(3)}) weights ${pose.weights.map((w) => w.toFixed(2)).join(' ')}`);
    });
  }
  return { failures, notes };
}

// One sheet per action: a row per frame, for each view the three columns, labelled.
function sheet(name, blender) {
  const dir = join(OUT, 'blender', name), cells = join(OUT, 'cells', name);
  rmSync(cells, { recursive: true, force: true });
  mkdirSync(cells, { recursive: true });
  let k = 0;
  blender.actions[name].frames.forEach((frame, row) => {
    for (const view of VIEWS) for (const [col, label] of [['source', 'library'], ['character', 'Blender'], ['page', 'page']]) {
      const file = join(dir, `${col}-${row}-${view}.png`), cell = join(cells, `${String(k++).padStart(3, '0')}.png`);
      const text = `${label} ${view} f${frame}`.replace(/:/g, '\\:');
      if (existsSync(file)) encode('-i', file, '-vf', `scale=${SIZE[0]}:${SIZE[1]},drawtext=text='${text}':x=4:y=4:fontsize=13:fontcolor=white:box=1:boxcolor=black@0.6`, cell);
      else encode('-f', 'lavfi', '-i', `color=c=gray:s=${SIZE[0]}x${SIZE[1]}`, '-frames:v', '1', '-vf', `drawtext=text='${text} (none)':x=4:y=4:fontsize=13:fontcolor=white`, cell);
    }
  });
  // xstack, not tile: tile kept only the last of these images.
  const path = join(OUT, `${name}.png`), columns = VIEWS.length * 3, gap = 4;
  const layout = Array.from({ length: k }, (_, i) => `${(i % columns) * (SIZE[0] + gap)}_${Math.floor(i / columns) * (SIZE[1] + gap)}`).join('|');
  const inputs = Array.from({ length: k }, (_, i) => ['-i', join(cells, `${String(i).padStart(3, '0')}.png`)]).flat();
  encode(...inputs, '-filter_complex', `${Array.from({ length: k }, (_, i) => `[${i}:v]`).join('')}xstack=inputs=${k}:layout=${layout}:fill=white,format=rgb24`, '-frames:v', '1', path);
  return path;
}

const actions = (process.argv[2] ?? 'Walk,Jog,Sprint').split(',');
mkdirSync(OUT, { recursive: true });
// AGAIN=1 (or a report's path): the sheets and checks again from the last run's (that report's) renders and joints.
const again = process.env.AGAIN && JSON.parse(readFileSync(process.env.AGAIN === '1' ? join(OUT, 'report.json') : process.env.AGAIN, 'utf8'));
// PAGE_ONLY (a report's path): Blender's side from that report, the page's afresh.
const pageOnly = process.env.PAGE_ONLY && JSON.parse(readFileSync(process.env.PAGE_ONLY, 'utf8'));
const blender = again ? again.blender : pageOnly ? pageOnly.blender : blenderSide(actions);
const page = again ? again.page : await pageSide(actions, blender);
for (const name of actions) console.log(`sheet: ${sheet(name, blender)}`);
const { failures, notes } = checks(actions, blender, page);
if (!again) writeFileSync(join(OUT, 'report.json'), JSON.stringify({ blender, page, failures, notes }, null, 1));
console.log(notes.join('\n'));
if (failures.length) {
  console.log(`\n${failures.length} retarget checks fail:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('retarget checks pass');
