// The noodle shop: walk down the lane as the woman from the Compositor example, sit, buy a tea and sip it. Two packages
// exported from Bylonder (tools/docs/export-demo.mjs noodle-shop): the lane, the scene with its world, camera, view
// transform and compositor, loaded as the page's scene; she, Scope Selected Objects with her actions as clips, added to it.
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { VirtualJoystick } from '@babylonjs/core/Misc/virtualJoystick.js';
import { createEngine, load as loadLane } from './street/scene.js';
import { load as loadGirl } from './girl/scene.js';

const canvas = document.getElementById('c'), say = (text) => { document.getElementById('say').textContent = text; };
const engine = await createEngine(canvas), lane = await loadLane(engine), { scene } = lane, camera = scene.activeCamera;
camera.detachControl();
const girl = await loadGirl({ scene }), part = (name) => girl.entries.meshes.find((m) => m.name === name);
const tea = [part('Tea Cup'), part('Tea Steam Card')];
tea.forEach((m) => m.setEnabled(false));

// She is placed as in the lane's scene (her root unturned), her rig's origin on the floor where her feet are when she
// sits: where she stands to sit, facing away from the stool (SEAT, her hips at the end of Sit). `player` carries her
// from there, facing its +Z.
girl.entries.root.rotationQuaternion = Quaternion.Identity();
const sat = girl.play('Sit', { loop: false });
sat.goToFrame(sat.to);
girl.entries.skeletons[0].prepare(true);
scene.meshes.forEach((m) => m.computeWorldMatrix(true));
const SPOT = part('Tea Break Rig').getAbsolutePosition().clone(), SEAT = girl.entries.skeletons[0].bones[0].getAbsolutePosition(part('Tea Break'));
const SPOT_YAW = Math.atan2(SPOT.x - SEAT.x, SPOT.z - SEAT.z);
girl.stop('Sit');
const player = new TransformNode('player', scene);
player.position.copyFrom(SPOT);
player.rotation.y = SPOT_YAW;
player.computeWorldMatrix(true);
girl.entries.root.setParent(player);
const herself = new Set([...girl.entries.meshes]);

// Her clips: Walk (a stride in place, 2.2 m a cycle), Sit (standing to seated, her feet kept), Idle (seated) and Sip.
const PACE = 0.7, SPEED = 2.2 * PACE / (20 / 24);
let state = 'walking', busy = false, sips = 0;
const walk = girl.play('Walk', { speed: PACE });
const still = () => { walk.pause(); walk.goToFrame(walk.from); };
const once = (name, options, then) => girl.play(name, { loop: false, ...options }).onAnimationGroupEndObservable.addOnce(then);
function sit() {
  state = 'sitting';
  say(`${press} to buy a tea`);
  girl.stop('Walk');
  once('Sit', {}, () => { state = 'seated'; girl.play('Idle'); });
}
function stand() {
  state = 'standing';
  ['Idle', 'Sip'].forEach((name) => girl.stop(name));
  once('Sit', { speed: -1.5 }, () => { state = 'walking'; girl.play('Walk', { speed: PACE }); still(); });
}
function sip() {
  busy = true;
  girl.stop('Idle');
  once('Sip', {}, () => {
    busy = false;
    sips++;
    say(sips < 3 ? `Ahh. ${press} to sip again` : 'Warm. The rain sounds nice tonight.');
    girl.play('Idle');
  });
}
function act() {
  if (state === 'walking' && near()) return (state = 'arriving');
  if (state !== 'seated' || busy) return;
  if (!tea[0].isEnabled()) return tea.forEach((m) => m.setEnabled(true)), say(`A hot tea, 300 yen. ${press} to sip`);
  sip();
  say('');
}
const near = () => Vector3.Distance(player.position, SPOT) < 1.2;
player.position.set(-3, 0, -1.4);
player.rotation.y = Math.PI / 2;
still();

const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); ambience(); if (e.code === 'KeyE') act(); });
addEventListener('keyup', (e) => keys.delete(e.code));
// On a touch screen, Babylon's thumb sticks: the left walks, the right looks; and the E button.
const touch = matchMedia('(pointer: coarse)').matches, press = touch ? 'Tap E' : 'Press E';
const [walkStick, lookStick] = touch ? [true, false].map((left) => new VirtualJoystick(left, { limitToContainer: true })) : [];
const stick = (s) => (s?.pressed ? s.deltaPosition : Vector3.ZeroReadOnly);
if (touch) {
  const button = document.getElementById('act');
  button.hidden = false;
  button.addEventListener('pointerdown', (e) => { e.stopPropagation(); ambience(); act(); });
}
// Dragging looks round her.
let yaw = Math.PI / 2, pitch = 0.1, dragging = null;
canvas.addEventListener('pointerdown', (e) => { if (!touch) dragging = [e.clientX, e.clientY]; });
addEventListener('pointerup', () => { dragging = null; });
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  looked = performance.now();
  yaw += (e.clientX - dragging[0]) * 0.005;
  pitch = Math.min(1.1, Math.max(-0.1, pitch + (e.clientY - dragging[1]) * 0.004));
  dragging = [e.clientX, e.clientY];
});

const turn = (from, to, rate) => from + (Math.atan2(Math.sin(to - from), Math.cos(to - from)) * Math.min(1, rate));
// The camera: behind her over her shoulder, or seated, from beside the window to see her face, cup and stool; eased
// from one to the other, pulled in at once in front of whatever is between her and it or beside that line, and kept in
// the lane; the same height of view in portrait, a little further back.
const solid = (mesh) => mesh.isPickable && mesh.isVisible && mesh.isEnabled() && !herself.has(mesh) && mesh.visibility === 1 && !mesh.material?.needAlphaBlending?.();
const SEATED_VIEW = SPOT_YAW - 2, AT_SEAT = Vector3.Lerp(SPOT, SEAT, 0.5).addInPlace(new Vector3(0, 0.8, 0));
const target = player.position.add(new Vector3(0, 1.35, 0));
let distance = 3, looked = 0;
function follow(dt) {
  const portrait = engine.getRenderHeight() > engine.getRenderWidth(), seated = state === 'sitting' || state === 'seated';
  Object.assign(camera, { fovMode: Camera.FOVMODE_VERTICAL_FIXED, fov: portrait ? 1 : 0.75 });
  if (seated && performance.now() - looked > 2000) {
    yaw = turn(yaw, SEATED_VIEW, dt * 1.5);
    pitch += (0.35 - pitch) * Math.min(1, dt * 1.5);
  }
  const ease = Math.min(1, dt * 3);
  Vector3.LerpToRef(target, seated ? AT_SEAT : player.position.add(new Vector3(0, 1.35, 0)), ease, target);
  const back = new Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)), side = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const wanted = (seated ? 1.9 : 3) * (portrait ? 1.3 : 1);
  const room = Math.min(...[-0.7, 0, 0.7].map((offset) => {
    const end = target.add(back.scale(wanted)).addInPlace(side.scale(offset)), toward = end.subtract(target), length = toward.length();
    const hit = scene.pickWithRay(new Ray(target, toward.scaleInPlace(1 / length), length + 0.3), solid);
    return hit?.hit ? Math.max(1, (hit.distance - 0.3) * (wanted / length)) : wanted;
  }));
  distance = room < distance ? room : distance + (room - distance) * ease;
  camera.position.copyFrom(target.add(back.scale(distance)));
  // Inside the lane, off the shop fronts and below the lanterns hanging from them.
  camera.position.z = Math.min(Math.max(camera.position.z, -3.9), -1.7);
  camera.position.y = Math.min(camera.position.y, 1.9);
  camera.setTarget(target);
}

scene.onBeforeRenderObservable.add(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1), look = stick(lookStick), thumb = stick(walkStick);
  if (lookStick?.pressed) looked = performance.now();
  yaw += look.x * dt * 2;
  pitch = Math.min(1.1, Math.max(-0.1, pitch - look.y * dt));
  const ahead = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)), right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const axis = (plus, minus) => +plus.some((k) => keys.has(k)) - +minus.some((k) => keys.has(k));
  const move = ahead.scale(axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) + thumb.y).addInPlace(right.scale(axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']) + thumb.x));
  const moving = move.lengthSquared() > 0.01;
  if (moving && state === 'seated' && !busy) stand(), say('');
  if (state === 'arriving') {
    // A few steps to where she sits from, turning to have the stool behind her.
    const to = SPOT.subtract(player.position), left = to.length();
    player.position.addInPlace(to.scale(Math.min(1, (SPEED * dt) / Math.max(left, 1e-6))));
    player.rotation.y = turn(player.rotation.y, left > 0.15 ? Math.atan2(to.x, to.z) : SPOT_YAW, dt * 8);
    if (!walk.isPlaying) walk.play(true);
    if (left < 0.01 && Math.abs(turn(player.rotation.y, SPOT_YAW, 1) - player.rotation.y) < 0.05) sit();
  } else if (state === 'walking') {
    if (moving) {
      player.position.addInPlace(move.scale((SPEED * dt) / Math.max(1, move.length())));
      // The lane between the shop fronts.
      player.position.x = Math.min(Math.max(player.position.x, -24), 12);
      player.position.z = Math.min(Math.max(player.position.z, -3.9), -0.25);
      player.rotation.y = turn(player.rotation.y, Math.atan2(move.x, move.z), dt * 10);
      if (!walk.isPlaying) walk.play(true);
    } else if (walk.isPlaying) still();
    say(near() ? `${press} to sit` : '');
  }
  follow(dt);
});

// Rain on the awnings: brown noise, quiet, once a key is pressed (browsers start sound on a gesture).
let rain;
function ambience() {
  if (rain) return;
  const audio = new AudioContext(), noise = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate), data = noise.getChannelData(0);
  for (let i = 0, last = 0; i < data.length; i++) data[i] = last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
  rain = Object.assign(audio.createBufferSource(), { buffer: noise, loop: true });
  const filter = Object.assign(audio.createBiquadFilter(), { type: 'lowpass' }), gain = audio.createGain();
  filter.frequency.value = 900;
  gain.gain.value = 1.5;
  rain.connect(filter).connect(gain).connect(audio.destination);
  rain.start();
}

say(`${touch ? 'Left thumb to walk, right thumb to look' : 'WASD to walk, drag to look'}. The stool by the shop window is free.`);
addEventListener('resize', () => engine.resize());
engine.runRenderLoop(() => scene.render());
