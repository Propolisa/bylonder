// The noodle shop: walk down the lane as the woman from the Compositor example, sit, buy a tea and sip it. The lane and
// she are two packages exported from Bylonder with Scope Selected Objects (tools/docs/export-demo.mjs noodle-shop),
// loaded into this page's own scene as .glb files are.
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import './street/bylonder/scene-loader.js';
import { load } from './girl/scene.js';

const canvas = document.getElementById('c'), say = (text) => { document.getElementById('say').textContent = text; };
const engine = new Engine(canvas, true), scene = new Scene(engine);
scene.clearColor = new Color4(0.02, 0.025, 0.05, 1);
Object.assign(scene, { fogMode: Scene.FOGMODE_EXP2, fogDensity: 0.04, fogColor: new Color3(0.05, 0.05, 0.09) });
scene.imageProcessingConfiguration.toneMappingEnabled = true;
new HemisphericLight('sky', new Vector3(0, 1, 0), scene).intensity = 0.25;
new GlowLayer('neon', scene).intensity = 0.6;

// The lane through Babylon's SceneLoader, as a .glb; she with her controller, to pose and play her.
await ImportMeshAsync('./street/scene.bylonder', scene);
const girl = await load({ scene });
const part = (name) => girl.entries.meshes.find((m) => m.name === name);
const [skeleton] = girl.entries.skeletons, bone = (name) => skeleton.bones.find((b) => b.name === name);
const tea = [part('Tea Cup'), part('Tea Steam Card')];
tea.forEach((m) => m.setEnabled(false));

// She hangs from `player`, set where she sits on the stool, facing as she sits; walking lifts her by `lift`.
const SEAT = new Vector3(0.37, 0, 0.63), SEAT_YAW = Math.atan2(-0.643, -0.766), LIFT = 0.95;
const player = new TransformNode('player', scene), lift = new TransformNode('lift', scene);
lift.parent = player;
player.position.copyFrom(SEAT);
player.rotation.y = SEAT_YAW;
player.computeWorldMatrix(true);
girl.entries.root.setParent(lift);

const camera = new ArcRotateCamera('follow', Math.PI / 2, 1.15, 3.2, SEAT.add(new Vector3(0, 1, 0)), scene);
camera.attachControl(canvas, true);
Object.assign(camera, { lowerRadiusLimit: 2, upperRadiusLimit: 8, upperBetaLimit: 1.45, minZ: 0.05 });

// A walk of her own: legs and arms swing from her rig's rest pose, as the package has no walk.
const rest = new Map(skeleton.bones.map((b) => [b, Quaternion.FromRotationMatrix(b.getRestMatrix())]));
const turn = (name, angle) => bone(name).setRotationQuaternion(rest.get(bone(name)).multiply(Quaternion.RotationAxis(Vector3.Right(), angle)));
function walkPose(phase, speed) {
  skeleton.returnToRest();
  const swing = Math.sin(phase) * 0.55 * speed;
  turn('LeftUpLeg', swing); turn('RightUpLeg', -swing);
  turn('LeftLeg', -Math.max(0, -Math.sin(phase)) * 0.9 * speed); turn('RightLeg', -Math.max(0, Math.sin(phase)) * 0.9 * speed);
  turn('LeftArm', -1.25 - swing * 0.4); turn('RightArm', -1.25 + swing * 0.4);
  lift.position.y = LIFT + Math.abs(Math.cos(phase)) * 0.03 * speed;
}

// Seated, she breathes (frames 1 to 140 of the lane's loop) and, asked, sips (150 to 214) from her cup.
let state = 'walking', sipping = false, sips = 0, phase = 0;
girl.playhead.onChanged.add(({ frame }) => {
  if (sipping && frame >= 214) { sipping = false; sips++; say(sips < 3 ? 'Ahh. Press E to sip again' : 'Warm. The rain sounds nice tonight.'); }
  if (!sipping && frame > 140) girl.playhead.seek(1);
});
const sit = () => {
  state = 'seated';
  player.position.copyFrom(SEAT);
  player.rotation.y = SEAT_YAW;
  lift.position.y = 0;
  girl.playhead.seek(1);
  girl.playhead.play();
};
const stand = () => {
  state = 'walking';
  girl.playhead.pause();
};
stand();
player.position.set(8, 0, 1.3);
player.rotation.y = -Math.PI / 2;

const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); ambience(); if (e.code === 'KeyE') act(); });
addEventListener('keyup', (e) => keys.delete(e.code));
function act() {
  if (state === 'walking' && near()) return sit(), say('Press E to buy a tea');
  if (state === 'seated' && !tea[0].isEnabled()) return tea.forEach((m) => m.setEnabled(true)), say('A hot tea, 300 yen. Press E to sip');
  if (state === 'seated' && !sipping) { sipping = true; girl.playhead.seek(150); say(''); }
}
const near = () => Vector3.Distance(player.position, SEAT) < 1.2;

scene.onBeforeRenderObservable.add(() => {
  const dt = engine.getDeltaTime() / 1000, ahead = camera.target.subtract(camera.position);
  ahead.y = 0;
  ahead.normalize();
  const right = Vector3.Cross(Vector3.Up(), ahead), move = Vector3.Zero();
  if (keys.has('KeyW') || keys.has('ArrowUp')) move.addInPlace(ahead);
  if (keys.has('KeyS') || keys.has('ArrowDown')) move.subtractInPlace(ahead);
  if (keys.has('KeyD') || keys.has('ArrowRight')) move.addInPlace(right);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) move.subtractInPlace(right);
  const moving = move.lengthSquared() > 0;
  if (moving && state === 'seated') stand(), say('');
  if (state === 'walking') {
    if (moving) {
      player.position.addInPlace(move.normalize().scale(1.4 * dt));
      // The lane between the shop fronts.
      player.position.x = Math.min(Math.max(player.position.x, -20), 12);
      player.position.z = Math.min(Math.max(player.position.z, 0.35), 4);
      player.rotation.y = Math.atan2(move.x, move.z);
      phase += dt * 8;
    }
    walkPose(phase, moving ? 1 : 0);
    if (!sipping) say(near() ? 'Press E to sit' : '');
  }
  // Closer while she sits.
  const seated = state === 'seated';
  camera.target.copyFrom(Vector3.Lerp(camera.target, player.position.add(new Vector3(0, seated ? 0.7 : 1, 0)), 0.08));
  camera.radius += ((seated ? 2 : 3.2) - camera.radius) * 0.05;
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

say('WASD to walk, drag to look. The stool by the shop window is free.');
addEventListener('resize', () => engine.resize());
engine.runRenderLoop(() => scene.render());
