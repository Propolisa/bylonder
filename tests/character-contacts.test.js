// Foot contacts (runtime/character/contacts.js) found from the basic rig's actions agree with their truth: each foot is
// down where the truth says, give or take a frame at each edge, the gaits' ground speeds come out, the same with root
// motion added, a jump's flight is found, and L and R markers start contacts where they are.
import assert from 'node:assert/strict';
import { STRIDE } from '../src/io_scene_babylon/runtime/character/pose.js';
import { createClip } from '../src/io_scene_babylon/runtime/character/clip.js';
import { readFileSync } from 'node:fs';
import { footContacts, contactAt, flight, contactsFromTracks } from '../src/io_scene_babylon/runtime/character/contacts.js';
import { basicRig } from './fixtures/basic-rig.js';

const { skeleton, clips, truth } = basicRig();
const legs = ['Left', 'Right'].map((side) => ['UpLeg', 'Leg', 'Foot'].map((b) => `mixamorig:${side}${b}`));
const truthAt = (windows, t, period) => windows.some(([a, b]) => (t >= a && t <= b) || (t + period >= a && t + period <= b));
const near = (windows, t, period, slack) => windows.some(([a, b]) => [a, b].some((edge) => Math.abs(((t - edge + period * 1.5) % period) - period / 2) <= slack));

for (const [name, clip] of clips) {
  const contacts = footContacts(clip, skeleton, legs), { period, speed, contacts: windows } = truth[name];
  assert.ok(Math.abs(contacts.speed - speed) < 0.08 * Math.max(speed, 1), `${name} speed ${contacts.speed.toFixed(3)} vs ${speed}`);
  [windows.L, windows.R].forEach((w, leg) => {
    for (let f = 0; f < clip.frames; f++) {
      const t = f / clip.fps, found = contacts.down[leg][f] === 1;
      if (found !== truthAt(w, t, period)) assert.ok(near(w, t, period, 1.5 / clip.fps), `${name} leg ${leg} at ${t.toFixed(3)} s: found ${found}`);
    }
  });
}
const air = flight(footContacts(clips.get('Jump'), skeleton, legs));
assert.ok(air && Math.abs(air[0] - truth.Jump.air[0]) < 0.05 && Math.abs(air[1] - truth.Jump.air[1]) < 0.05, `jump flight ${air}`);
assert.equal(flight(footContacts(clips.get('Idle'), skeleton, legs)), null, 'idle has no flight');

// Root motion: the walk moved forward by its speed: the planted foot is now still, and the speed the same.
const walk = clips.get('Walk'), hips = skeleton.boneIndex('mixamorig:Hips'), size = walk.bones.length * STRIDE;
const moving = Float32Array.from(walk.data);
for (let f = 0; f < walk.frames; f++) moving[f * size + walk.bones.indexOf(hips) * STRIDE + 2] += (f / walk.fps) * truth.Walk.speed;
const rooted = footContacts(createClip('WalkRooted', walk.fps, walk.bones, moving), skeleton, legs);
assert.ok(Math.abs(rooted.speed - truth.Walk.speed) < 0.1, `root motion speed ${rooted.speed}`);
assert.ok(Math.abs(rooted.down[0].reduce((a, b) => a + b, 0) - footContacts(walk, skeleton, legs).down[0].reduce((a, b) => a + b, 0)) <= 2, 'same contacts with root motion');

// Markers: an L marker late in the left foot's contact starts it there.
const marked = createClip('WalkMarked', walk.fps, walk.bones, walk.data, [{ name: 'L', frame: 6 }, { name: 'R', frame: 21 }]);
const byMarker = footContacts(marked, skeleton, legs);
assert.equal(byMarker.down[0][3], 0, 'before its marker the foot is not down');
assert.equal(byMarker.down[0][8], 1, 'after its marker it is');
assert.ok(contactAt(byMarker, 0, 7 / 30) === 1 && contactAt(byMarker, 0, 5.5 / 30) === 0.5, 'contactAt blends between frames');
// Snow's Walk, Jog and Sprint as Blender evaluates the rig (fixtures/snow-feet.json: its solved DEF-Foot and DEF-Toes
// heads and its root, per frame at 24 fps, with the actions' L and R markers). Blender's planted toes slide, per foot:
// Walk 0.94 and 0.96, Jog 5.24 and 5.41, Sprint 7.5 and 7.9 m/s, the sprint's stance two or three frames long.
{
  const snow = JSON.parse(readFileSync(new URL('./fixtures/snow-feet.json', import.meta.url), 'utf8'));
  for (const [name, low, high] of [['Walk', 0.92, 0.97], ['Jog', 5.2, 5.45], ['Sprint', 7.45, 7.95]]) {
    const d = snow[name], markers = d.markers.map(([marker, frame]) => ({ name: marker, time: frame / snow.fps }));
    const { speed } = contactsFromTracks({ ankles: d.ankles, balls: d.balls, root: d.root, fps: snow.fps, legLength: snow.legLength, markers });
    assert.ok(speed > low && speed < high, `Snow's ${name}: ${speed.toFixed(2)} m/s, Blender's feet ${low}-${high}`);
  }
  // A contact ends where Blender's planted toe stops moving with the ground (the walk's toe-off pivots slower): over
  // each of the walk's contacts the toe's travel matches the ground's within 1.5 cm.
  const d = snow.Walk, markers = d.markers.map(([marker, frame]) => ({ name: marker, time: frame / snow.fps }));
  const { down, speed } = contactsFromTracks({ ankles: d.ankles, balls: d.balls, root: d.root, fps: snow.fps, legLength: snow.legLength, markers });
  down.forEach((flags, leg) => {
    const frames = [...flags.keys()].filter((f) => flags[f]), first = frames[0], last = frames.at(-1);
    if (first === 0 && last === flags.length - 1) return;
    const travel = Math.abs(d.balls[leg][last][2] - d.balls[leg][first][2]), ground = (speed * (last - first)) / snow.fps;
    assert.ok(Math.abs(travel - ground) < 0.015, `walk leg ${leg}: the toe travels ${(100 * travel).toFixed(1)} cm, the ground ${(100 * ground).toFixed(1)} cm`);
  });
}
console.log('character contacts ok');
