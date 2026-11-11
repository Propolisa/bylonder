// The Noodle Shop: walk down the lane, sit at the stool, buy a tea, sip it and go home. The lane and the woman are two
// packages exported from Bylonder (tools/docs/export-demo.mjs noodle-shop): the lane is the scene, she is added to it.
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { VirtualJoystick } from '@babylonjs/core/Misc/virtualJoystick.js';
import { createEngine, load as loadLane } from './street/scene.js';
import { load as loadGirl } from './girl/scene.js';

// Setup

const $ = (id) => document.getElementById(id);
const touch = matchMedia('(pointer: coarse)').matches;
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const later = (seconds, then) => setTimeout(then, seconds * 1000);

const engine = await createEngine($('c'));
const { scene } = await loadLane(engine);
const camera = scene.activeCamera;
camera.detachControl();
const girl = await loadGirl({ scene });
const part = (name) => girl.entries.meshes.find((mesh) => mesh.name === name);
const tea = [part('Tea Cup'), part('Tea Steam Card')];
tea.forEach((mesh) => mesh.setEnabled(false));

// Her rig's origin is on the floor under her seated feet: SPOT is where she stands to sit, SEAT her hips once seated.
girl.entries.root.rotationQuaternion = Quaternion.Identity();
const seated = girl.play('Sit', { loop: false });
seated.goToFrame(seated.to);
girl.entries.skeletons[0].prepare(true);
scene.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
const SPOT = part('Tea Break Rig').getAbsolutePosition().clone();
const SEAT = girl.entries.skeletons[0].bones[0].getAbsolutePosition(part('Tea Break'));
const SPOT_YAW = Math.atan2(SPOT.x - SEAT.x, SPOT.z - SEAT.z);
girl.stop('Sit');

const player = new TransformNode('player', scene);
player.position.copyFrom(SPOT);
player.rotation.y = SPOT_YAW;
player.computeWorldMatrix(true);
girl.entries.root.setParent(player);
player.position.set(-3, 0, -1.4);
player.rotation.y = Math.PI / 2;
const herself = new Set(girl.entries.meshes);

// Her home is next door: a door on its hinge and a window upstairs, with a spot on the way to stop at.
const door = scene.getMeshByName('Apartment Door');
const pane = scene.getMeshByName('Apartment Window');
const doorway = door.getBoundingInfo().boundingBox.centerWorld.clone();
const HOME = new Vector3(doorway.x, 0, -0.7);
const INSIDE = new Vector3(doorway.x, 0, 0.6);
const SKY = new Vector3((SPOT.x + doorway.x) / 2, 0, -2.4);
door.rotation = door.rotationQuaternion.toEulerAngles();
door.rotationQuaternion = null;
const SHUT = door.rotation.y;

// Her window glows when its lamp is on.
const WARM = new Color3(1, 0.55, 0.25);
const glow = new GlowLayer('Glow', scene);
glow.addIncludedOnlyMesh(pane);

// Values eased each frame towards their targets: the door's swing, her lamp, the look up into the rain.
const target = { door: 0, lamp: 0, up: 0 };
const eased = { ...target };

// Her clips: Walk (a stride in place, 2.2 m a cycle), Sit (standing to seated), Idle (seated) and Sip.
const PACE = 0.7;
const SPEED = (2.2 * PACE) / (20 / 24);
const walk = girl.play('Walk', { speed: PACE });
let state = 'walking', busy = false, sips = 0, smelled = false, homeward = false, goal = null;

function stopWalking() {
  walk.pause();
  walk.goToFrame(walk.from);
}
function playOnce(name, options, then) {
  girl.play(name, { loop: false, ...options }).onAnimationGroupEndObservable.addOnce(then);
}
function walkTo(at, yaw, then) {
  state = 'arriving';
  goal = { at, yaw, then };
}
const near = (at) => Vector3.Distance(player.position, at) < 1.2;
stopWalking();

// Input

const keys = new Set();
addEventListener('keydown', (event) => {
  keys.add(event.code);
  startSound();
  if (event.code === 'KeyE') act();
});
addEventListener('keyup', (event) => keys.delete(event.code));

// Touch screens get Babylon's thumb sticks, the left to walk and the right to look, and the action button.
const [walkStick, lookStick] = touch ? [true, false].map((left) => new VirtualJoystick(left, { limitToContainer: true })) : [];
walkStick?.setJoystickColor('#f2b56b');
lookStick?.setJoystickColor('#f2b56b');
const stick = (s) => (s?.pressed ? s.deltaPosition : Vector3.ZeroReadOnly);
$('act').addEventListener('pointerdown', (event) => {
  event.stopPropagation();
  startSound();
  act();
});

let yaw = Math.PI / 2, pitch = 0.1, dragging = null, looked = 0;
$('c').addEventListener('pointerdown', (event) => {
  if (!touch) dragging = [event.clientX, event.clientY];
});
addEventListener('pointerup', () => { dragging = null; });
addEventListener('pointermove', (event) => {
  if (!dragging) return;
  looked = performance.now();
  yaw += (event.clientX - dragging[0]) * 0.005;
  pitch = Math.min(1.1, Math.max(-0.1, pitch + (event.clientY - dragging[1]) * 0.004));
  dragging = [event.clientX, event.clientY];
});

// Interactions

const ICONS = {
  stool: 'M5 8h14M7 8 5 20M17 8l2 12M6.5 15h11',
  coin: 'M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16M9 8l3 4 3-4M12 12v5M9.5 13.5h5',
  cup: 'M5 10h14l-1.6 8.2a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8zM10 3.5c-1 1.4 1 2.4 0 4M14 3.5c-1 1.4 1 2.4 0 4',
  scent: 'M8 20c-2-3 2-5 0-8s2-5 0-8M12 20c-2-3 2-5 0-8s2-5 0-8M16 20c-2-3 2-5 0-8s2-5 0-8',
  home: 'M4 11 12 4l8 7M6.5 9v11h11V9M10.5 20v-5h3v5',
  tap: 'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16',
};
const icon = (name) => `<svg viewBox="0 0 24 24"><path d="${ICONS[name]}"/></svg>`;

let shown = '', chimed = null;
// The card at the bottom: a line, or an action with its icon and key. The touch button shows the same icon.
function say(text, action) {
  if (shown === `${text}|${action}`) return;
  shown = `${text}|${action}`;
  const card = $('say');
  if (text) {
    const key = touch ? icon('tap') : '<kbd>E</kbd>';
    card.innerHTML = action ? `${icon(action)}<span>${text}</span>${key}` : `<span>${text}</span>`;
    $('title').classList.remove('on');
    if (!calm) card.animate([{ scale: 0.9 }, { scale: 1 }], { duration: 380, easing: 'cubic-bezier(.3,1.8,.5,1)' });
  }
  card.classList.toggle('on', Boolean(text));
  if (action && action !== chimed) {
    sound('chime', 0.25);
    chimed = action;
  }
  if (action) $('act').innerHTML = icon(action);
  $('act').classList.toggle('on', Boolean(action));
}
function title(heading, line, seconds, place = 'top') {
  $('title').innerHTML = `<h1>${heading}</h1><p>${line}</p>`;
  $('title').className = `on ${place}`;
  later(seconds, () => $('title').classList.remove('on'));
}

// What she can do where she stands.
function nearby() {
  if (sips < 3 && near(SPOT)) return { text: 'Sit', icon: 'stool', run: () => walkTo(SPOT, SPOT_YAW, sit) };
  if (sips === 3 && !smelled && near(SKY)) return { text: 'Smells great', icon: 'scent', run: smell };
  if (sips === 3 && near(HOME)) return { text: 'Go home', icon: 'home', run: () => walkTo(HOME, 0, goHome) };
  return null;
}
function act() {
  navigator.vibrate?.(12);
  if (state === 'walking') nearby()?.run();
  else if (state === 'seated' && !busy && tea[0].isEnabled()) sip();
  else if (state === 'seated' && !busy) buy();
}

function sit() {
  state = 'sitting';
  sound('stool', 0.4);
  say('A hot tea, 300 yen', 'coin');
  girl.stop('Walk');
  playOnce('Sit', {}, () => {
    state = 'seated';
    girl.play('Idle');
  });
}
function stand() {
  state = 'standing';
  say('');
  sound('stool', 0.3);
  girl.stop('Idle');
  girl.stop('Sip');
  playOnce('Sit', { speed: -1.5 }, () => {
    state = 'walking';
    girl.play('Walk', { speed: PACE });
    stopWalking();
  });
}
function buy() {
  say('');
  tea.forEach((mesh) => mesh.setEnabled(true));
  sound('coins', 0.45);
  later(0.5, () => sound('pour', 0.4));
  later(3.6, () => sound('cup', 0.4));
  later(1.4, () => say('Sip', 'cup'));
}
function sip() {
  busy = true;
  say('');
  sound('sip', 0.5);
  fade(music, 0.08, 0.4);
  girl.stop('Idle');
  playOnce('Sip', {}, () => {
    busy = false;
    sips += 1;
    fade(music, MUSIC, 1.5);
    girl.play('Idle');
    if (sips < 3) say('Ahh. Another sip', 'cup');
    else title('The rain eases.', 'Home is just next door.', 3);
  });
}
// She stops, the camera eases into her eyes and up into the rain, and back.
function smell() {
  state = 'smelling';
  smelled = true;
  say('');
  stopWalking();
  sound('exhale', 0.35);
  fade(music, 0.08, 0.4);
  fade(rain, 0.8, 1);
  target.up = 1;
  later(4.5, () => {
    target.up = 0;
    fade(music, MUSIC, 1.5);
    fade(rain, RAIN, 1.5);
  });
  later(5.5, () => { state = 'walking'; });
}

// Ending

function goHome() {
  state = 'home';
  homeward = true;
  say('');
  stopWalking();
  sound('door', 0.35);
  target.door = 1;
  later(0.3, () => { target.lamp = 1; });
  later(0.6, () => walkTo(INSIDE, 0, closeDoor));
}
function closeDoor() {
  state = 'home';
  player.setEnabled(false);
  target.door = 0.12;
  later(0.5, () => sound('door', 0.35));
  later(3.5, () => title('Good night.', '', 9, 'low'));
  later(3.5, () => fade(music, 0, 4));
  later(10, () => { target.lamp = 0.05; });
}

// Each frame

const turn = (from, to, rate) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * Math.min(1, rate);
// The camera's framings other than over her shoulder: seated, from beside the window; home, from down the lane, a
// little low and close, with her door and window in one shot (in portrait, turned to keep the lane's lanterns), held
// whatever is in the way.
const VIEWS = {
  sitting: { at: Vector3.Lerp(SPOT, SEAT, 0.5).addInPlace(new Vector3(0, 0.8, 0)), yaw: SPOT_YAW - 2, pitch: 0.35, distance: 1.9 },
  home: { at: new Vector3(doorway.x, 2.7, -0.2), yaw: -0.6, pitch: -0.15, distance: 2.4, fov: 1.25, held: true,
    portrait: { at: new Vector3(doorway.x + 0.9, 2.4, -1.7), yaw: -1.1, fov: 1.6 } },
};
VIEWS.seated = VIEWS.sitting;
const SHOULDER = new Vector3(0, 1.35, 0);
const aim = player.position.add(SHOULDER);
let distance = 3;
const solid = (mesh) => mesh.isPickable && mesh.isVisible && mesh.isEnabled() && !herself.has(mesh)
  && mesh.visibility === 1 && !mesh.material?.needAlphaBlending?.();

// The distance the camera can keep from `aim` along `back`, pulled in front of anything in the way.
function room(back, side, wanted) {
  return Math.min(...[-0.7, 0, 0.7].map((offset) => {
    const end = aim.add(back.scale(wanted)).addInPlace(side.scale(offset));
    const toward = end.subtract(aim);
    const length = toward.length();
    const hit = scene.pickWithRay(new Ray(aim, toward.scaleInPlace(1 / length), length + 0.3), solid);
    return hit?.hit ? Math.max(1, (hit.distance - 0.3) * (wanted / length)) : wanted;
  }));
}
function follow(dt) {
  const portrait = engine.getRenderHeight() > engine.getRenderWidth();
  const framing = homeward ? VIEWS.home : VIEWS[state];
  const view = framing && { ...framing, ...(portrait && framing.portrait) };
  camera.fovMode = Camera.FOVMODE_VERTICAL_FIXED;
  camera.fov = view?.fov ?? (portrait ? 1 : 0.75);
  if (view && performance.now() - looked > 2000) {
    yaw = turn(yaw, view.yaw, dt * 1.5);
    pitch += (view.pitch - pitch) * Math.min(1, dt * 1.5);
  }
  const ease = Math.min(1, dt * 3);
  Vector3.LerpToRef(aim, view?.at ?? player.position.add(SHOULDER), ease, aim);
  const back = new Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const side = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const wanted = (view?.distance ?? 3) * (portrait ? 1.3 : 1);
  const space = view?.held ? wanted : room(back, side, wanted);
  distance = space < distance ? space : distance + (space - distance) * ease;
  camera.position.copyFrom(aim.add(back.scale(distance)));
  // Inside the lane, off the shop fronts and below the lanterns hanging from them.
  camera.position.z = Math.min(Math.max(camera.position.z, -3.9), -1.7);
  camera.position.y = Math.min(camera.position.y, 1.9);
  // Smelling the air, from her eyes up the lane, past the lanterns, into the rain.
  const eyes = player.position.add(new Vector3(0, 1.55, 0));
  const sky = eyes.add(new Vector3(-1, 0.35, 0.1));
  Vector3.LerpToRef(camera.position, eyes, eased.up, camera.position);
  camera.setTarget(Vector3.Lerp(aim, sky, eased.up));
  girl.entries.root.setEnabled(eased.up < 0.6);
}

function steer(dt) {
  const look = stick(lookStick);
  const thumb = stick(walkStick);
  if (lookStick?.pressed) looked = performance.now();
  yaw += look.x * dt * 2;
  pitch = Math.min(1.1, Math.max(-0.1, pitch - look.y * dt));
  const ahead = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const axis = (plus, minus) => Number(plus.some((k) => keys.has(k))) - Number(minus.some((k) => keys.has(k)));
  const forward = axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) + thumb.y;
  const sideways = axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']) + thumb.x;
  return ahead.scale(forward).addInPlace(right.scale(sideways));
}
function walkOn(move, dt) {
  player.position.addInPlace(move.scale((SPEED * dt) / Math.max(1, move.length())));
  player.position.x = Math.min(Math.max(player.position.x, -24), 12);
  player.position.z = Math.min(Math.max(player.position.z, -3.9), -0.25);
  player.rotation.y = turn(player.rotation.y, Math.atan2(move.x, move.z), dt * 10);
  footstep(dt);
  if (!walk.isPlaying) walk.play(true);
}
// A few steps to where she is going, turning to face as she will there.
function arrive(dt) {
  const to = goal.at.subtract(player.position);
  const left = to.length();
  player.position.addInPlace(to.scale(Math.min(1, (SPEED * dt) / Math.max(left, 1e-6))));
  player.rotation.y = turn(player.rotation.y, left > 0.15 ? Math.atan2(to.x, to.z) : goal.yaw, dt * 8);
  footstep(dt);
  if (!walk.isPlaying) walk.play(true);
  if (left < 0.01 && Math.abs(turn(player.rotation.y, goal.yaw, 1) - player.rotation.y) < 0.05) goal.then();
}

scene.onBeforeRenderObservable.add(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  const move = steer(dt);
  const moving = move.lengthSquared() > 0.01;
  if (moving && state === 'seated' && !busy) stand();
  if (state === 'arriving') arrive(dt);
  if (state === 'walking') {
    if (moving) walkOn(move, dt);
    else if (walk.isPlaying) stopWalking();
    const action = nearby();
    say(action?.text ?? '', action?.icon);
  }
  for (const key in target) eased[key] += (target[key] - eased[key]) * Math.min(1, dt * 1.5);
  door.rotation.y = SHUT + eased.door;
  pane.material.emissiveColor.copyFrom(WARM.scale(eased.lamp));
  $('drops').style.opacity = eased.up;
  follow(dt);
});

// Sound

const MUSIC = 0.22;
const RAIN = 0.45;
const NAMES = ['music', 'rain', 'step-1', 'step-2', 'step-3', 'step-4', 'stool', 'coins', 'pour', 'cup', 'sip', 'door', 'chime', 'exhale'];
const FORMAT = new Audio().canPlayType('audio/ogg; codecs=opus') ? 'ogg' : 'mp3';
const buffers = {};
let audio = null, music = null, rain = null, stepIn = 0;

// Browsers start sound only on a key press or touch.
async function startSound() {
  if (audio) return;
  audio = new AudioContext();
  await Promise.all(NAMES.map(load));
  music = sound('music', 0, { loop: true });
  rain = sound('rain', 0, { loop: true });
  fade(music, MUSIC, 3);
  fade(rain, RAIN, 3);
}
async function load(name) {
  const response = await fetch(`sounds/${name}.${FORMAT}`);
  buffers[name] = await audio.decodeAudioData(await response.arrayBuffer());
}
// Plays a sound at `volume` and returns its gain, to fade.
function sound(name, volume, { loop = false, rate = 1 } = {}) {
  if (!buffers[name]) return null;
  const source = new AudioBufferSourceNode(audio, { buffer: buffers[name], loop, playbackRate: rate });
  const gain = new GainNode(audio, { gain: volume });
  source.connect(gain).connect(audio.destination);
  source.start();
  return gain.gain;
}
function fade(level, volume, seconds) {
  level?.setTargetAtTime(volume, audio.currentTime, seconds / 3);
}
function footstep(dt) {
  stepIn -= dt;
  if (stepIn > 0) return;
  stepIn = 0.45 + Math.random() * 0.05;
  sound(`step-${1 + Math.floor(Math.random() * 4)}`, 0.35, { rate: 0.95 + Math.random() * 0.1 });
}

$('line').textContent = `${touch ? 'Left thumb to walk, right thumb to look' : 'WASD to walk, drag to look'}. The stool by the shop window is free.`;
later(6, () => $('title').classList.remove('on'));
addEventListener('resize', () => engine.resize());
engine.runRenderLoop(() => scene.render());
