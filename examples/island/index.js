import { animate, animation, renderSettings } from '@workbench/sdk';
import { FRAMES, FPS, LENGTH, BEAT, OMEN, STRIKE, days, speed, seconds, frameAt, shotAt, smoothstep, falling, flash, shake, omen, fireFront, burning, sinceStrike, blastRadius, aftermath } from './story.js';
import { createToon } from './toon.js';
import { createIsland, createSea } from './island.js';
import { createForest } from './forest.js';
import { daylight, createClouds, createSmoke, meteorAt } from './sky.js';
import { createMarks } from './marks.js';
import { createBombs, createSteam, createWhales, createBirds, createFireflies, createTurtle } from './life.js';
import { createFamily } from './family.js';
import { createMeteor, fireLight, fireballAt } from './meteor.js';
import { createAudio } from './audio.js';

const { Vector3, Color3 } = BABYLON;
const mix = (a, b, t) => Color3.Lerp(a, b, Math.min(1, Math.max(0, t)));

// A volcanic island, its story told in time-lapse between its moments. The volcano pours lava down its slopes, the lava
// cools to soil and a forest grows, and a flock comes to live there. A seabird finds the island, and her mate; they
// raise a chick in a blossom tree. Over the island's far side an odd star has been there from the start, with a faint
// trail; it grows night after night, the flock leaves, and just after sunset it falls, breaking up in the sky, its main
// chunk striking the island's far shoulder glancingly. Burning debris lights the forest above the nest; the mountain
// cracks, the mother shoves the chick off the branch, and the blast hurls the tree out to sea with her on it. After a
// night on the beach the father and the chick find her on the wreck aground on the lava point, and they are together again. Low
// poly and toon shaded: the look is in toon.js, the story's clock in story.js, the family in family.js, the effects are
// layers of particles (particles.js), the sound is Babylon's spatial audio (audio.js).
export const createScene = async function () {
  const scene = new BABYLON.Scene(engine);
  // Flat toon shading needs few samples to smooth its edges.
  // Blender's Color Management look gives the film its contrast.
  renderSettings({ eevee: { taaRenderSamples: 1 }, viewSettings: { look: 'MEDIUM_HIGH_CONTRAST' } });
  const toon = createToon(scene);

  const dome = BABYLON.MeshBuilder.CreateSphere('Sky', { diameter: 400, segments: 24, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
  Object.assign(dome, { material: toon.sky, infiniteDistance: true, isPickable: false });
  // The island, and the island after the strike with its far coast blasted away, shown from that moment.
  const ground = toon.terrain(), island = createIsland(scene), struck = createIsland(scene, STRIKE);
  island.material = struck.material = ground;
  createSea(scene).material = toon.sea();
  const forest = createForest(scene, toon);
  const moving = [forest, createClouds(scene, toon), createSmoke(scene, toon), createBombs(scene, toon), createSteam(scene, toon), createWhales(scene, toon), createTurtle(scene, toon),
    createBirds(scene, toon, forest.spots), createFireflies(scene, toon, forest.spots), createFamily(scene, toon), createMeteor(scene, toon)];

  const camera = new BABYLON.TargetCamera('Camera', new Vector3(14, 6, -10), scene);
  Object.assign(camera, { fov: 0.95, minZ: 0.1, maxZ: 1000, lockedTarget: new Vector3(0, 1.6, 0) });
  moving.push(await createAudio(scene, camera, animation.time));
  moving.push(createMarks(scene, toon, camera));
  // Lava, fire and the meteor glow past white, which bloom spreads.
  const lens = new BABYLON.DefaultRenderingPipeline('Lens', true, scene, [camera]);
  Object.assign(lens, { bloomEnabled: true, bloomThreshold: 1.4, bloomWeight: 0.85, bloomKernel: 64 });
  // The lens: richer color and a soft vignette.
  const curves = new BABYLON.ColorCurves();
  Object.assign(curves, { globalSaturation: 35, shadowsSaturation: 20, shadowsHue: 250, shadowsDensity: 15 });
  Object.assign(lens.imageProcessing, { colorCurvesEnabled: true, colorCurves: curves, vignetteEnabled: true, vignetteWeight: 1.6, vignetteStretch: 0.4, vignetteColor: new BABYLON.Color4(0.05, 0.02, 0.1, 0) });

  // Everything that changes follows the frame, so playback and renders agree.
  // Island time (days) runs at the story's speed; wind, wings and particles keep the film's own time.
  scene.onBeforeRenderObservable.add(() => {
    const frame = animation.time.frame, day = days(frame), time = seconds(frame);
    const light = grade(daylight(day, speed(frame)), time), fire = fireLight(time);
    toon.light(light, day, time, meteorAt(frame), air(light, fire, time, camera.globalPosition));
    island.isVisible = time < BEAT.impact;
    struck.isVisible = !island.isVisible;
    toon.fire({ front: fireFront(time), heat: time >= BEAT.embers ? burning(time) : 0, blast: sinceStrike(time), blastReach: blastRadius(time), ash: aftermath(time) });
    for (const move of moving) move(day, time);
  });

  // The camera's shots (story.js) as keys: linear along each shot, held on its last frame, so each shot cuts to the
  // next. The impacts shake it.
  const shot = animate(camera, { id: 'camera', title: 'Camera', properties: { position: { label: 'Location' }, lockedTarget: { label: 'Look At' } } });
  if (!animation.action.tracks.length) {
    const PATHS = ['position.x', 'position.y', 'position.z', 'lockedTarget.x', 'lockedTarget.y', 'lockedTarget.z'];
    const tracks = PATHS.map((path) => ({ id: 'camera', path, keys: [] }));
    for (let frame = 1; frame <= FRAMES;) {
      const time = seconds(frame), { position, target, end } = shotAt(time), last = Math.min(FRAMES, frameAt(end) - 1);
      // The shake turns the camera, so a far shot shakes as hard as a near one.
      const shaking = shake(time, position[0], position[2]), reach = Math.hypot(...position.map((v, k) => v - target[k]));
      const jolt = (k, scale) => shaking * scale * reach * Math.sin(time * 37 + k * 2.1) * Math.sin(time * 11 + k);
      [...position.map((v, k) => v + jolt(k, 0.006)), ...target.map((v, k) => v + jolt(k + 3, 0.035))].forEach((value, k) => tracks[k].keys.push({ frame, value, interpolation: frame >= last ? 'CONSTANT' : 'LINEAR' }));
      frame = frame >= last ? frame + 1 : Math.min(last, frame + (shaking > 0.02 ? 1 : 6));
    }
    const markers = Object.entries(BEAT).map(([name, second]) => ({ name: name[0].toUpperCase() + name.slice(1), frame: frameAt(second) }));
    animation.load({ version: 3, action: { name: 'Island', tracks }, time: { frameStart: 1, frameEnd: FRAMES, fps: FPS, frameCurrent: 1 }, markers });
  }
  animation.seek(animation.time.state.frameStart);
  return scene;
};

// The story's grade over the day's light: unease under the growing star, the dusk deepening to violet under a magenta glow as
// the asteroid comes, the strike's white flash, smoke dimming the sun after, and gold on the last sunrise.
function grade(light, time) {
  const uneasy = smoothstep(BEAT.omen, BEAT.streak - 2, time) * (1 - smoothstep(BEAT.streak, BEAT.streak + 1, time));
  const coming = smoothstep(BEAT.streak - 6, BEAT.impact - 1, time) * (1 - smoothstep(BEAT.impact, BEAT.impact + 4, time));
  const burning = falling(time) ** 1.5, F = flash(time), smoke = smoothstep(BEAT.impact + 0.5, BEAT.impact + 5, time) * (1 - smoothstep(BEAT.dawn + 1, BEAT.wake + 2, time));
  const dawn = smoothstep(BEAT.wake - 1, BEAT.wake + 3, time), white = new Color3(1, 1, 1), ashen = aftermath(time) * dawn;
  let { skyTop, skyHorizon, sunColor, skyLight, groundLight } = light;
  skyTop = mix(skyTop, new Color3(0.26, 0.2, 0.46), 0.3 * uneasy);
  skyHorizon = mix(skyHorizon, new Color3(0.5, 0.78, 0.72), 0.22 * uneasy);
  skyTop = mix(skyTop, new Color3(0.035, 0.02, 0.09), 0.95 * coming);
  skyHorizon = mix(skyHorizon, new Color3(0.2, 0.1, 0.17), 0.9 * coming).add(new Color3(0.06, 0.02, 0.07).scale(burning));
  skyLight = mix(skyLight, new Color3(0.07, 0.05, 0.12), 0.92 * coming);
  sunColor = sunColor.scale(1 - 0.8 * coming);
  groundLight = groundLight.scale(1 - 0.6 * coming);
  skyTop = mix(skyTop, new Color3(0.14, 0.08, 0.12), 0.55 * smoke);
  skyHorizon = mix(skyHorizon, new Color3(0.75, 0.3, 0.14), 0.5 * smoke);
  sunColor = sunColor.scale(1 - 0.55 * smoke);
  skyLight = mix(skyLight, new Color3(0.38, 0.24, 0.24), 0.4 * smoke);
  skyHorizon = mix(skyHorizon, new Color3(1.0, 0.78, 0.5), 0.35 * dawn);
  sunColor = mix(sunColor, new Color3(1.0, 0.78, 0.5).scale(0.75), 0.4 * dawn);
  // The morning after: the sky ashen, the light brown and dim through the haze, the sun a weak orange disc.
  skyTop = mix(skyTop, new Color3(0.46, 0.42, 0.44), 0.7 * ashen);
  skyHorizon = mix(skyHorizon, new Color3(0.72, 0.58, 0.46), 0.75 * ashen);
  sunColor = mix(sunColor, new Color3(0.95, 0.6, 0.35).scale(0.55), 0.7 * ashen);
  skyLight = mix(skyLight, new Color3(0.42, 0.37, 0.36), 0.6 * ashen);
  groundLight = groundLight.scale(1 - 0.3 * ashen);
  return { ...light, skyTop: skyTop.add(white.scale(0.6 * F)), skyHorizon: skyHorizon.add(white.scale(0.8 * F)), sunColor: sunColor.add(white.scale(0.7 * F)),
    skyLight: skyLight.add(white.scale(0.5 * F)), groundLight: groundLight.add(white.scale(0.3 * F)), stars: Math.max(light.stars, 0.7 * coming) * (1 - 0.5 * smoke) };
}

// The air: the fire light, the haze (thicker with smoke), shafts of light, the aurora as the meteor nears, its star
// and the contrail it burns across the sky.
function air(light, fire, time, eye) {
  const smoke = Math.max(smoothstep(BEAT.impact, BEAT.impact + 4, time) * (1 - smoothstep(BEAT.dawn + 1, BEAT.wake + 2, time)), 0.75 * aftermath(time));
  const from = fireballAt(BEAT.streak), head = fireballAt(Math.min(time, BEAT.impact - 0.01));
  return {
    firePosition: fire.position, fireColor: fire.color,
    fogColor: mix(light.skyHorizon, new Color3(0.5, 0.42, 0.38), 0.6 * smoke), fogDensity: 0.004 + 0.016 * smoke, soot: 0.75 * aftermath(time),
    rays: 1 + 0.8 * smoothstep(BEAT.wake - 1, BEAT.wake + 3, time),
    omenDir: new Vector3(OMEN.x, OMEN.y, OMEN.z), omen: omen(time), aurora: smoothstep(BEAT.omen + 4, BEAT.leave, time) * (1 - smoothstep(BEAT.streak + 0.5, BEAT.impact, time)),
    trail: smoothstep(BEAT.entry, BEAT.entry + 0.8, time) * (1 - smoothstep(BEAT.impact + 1, BEAT.climax - 1, time)),
    trailTail: from.subtract(eye).normalize(), trailHead: head.subtract(eye).normalize(),
  };
}

