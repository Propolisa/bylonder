// A production rig's bones as page controls: above 64 bones, a bone's location, rotation and scale are controls only
// where the page reads or writes them (a "Controls" bone collection, a driver's path or written property, an F-Curve
// of its actions); a small rig keeps them all.
import assert from 'node:assert/strict';
import { posedByPage } from '../src/io_scene_babylon/controls-export.js';

const bone = (name) => ({ name });
const rig = (count, { controls = [], drivers = [], fcurves = [] } = {}) => ({
  name: 'Rig',
  pose: { bones: Object.assign(Array.from({ length: count }, (_, i) => bone(`B${i}`)), { length: count }) },
  data: { collections_all: { get: (name) => (name === 'Controls' ? { bones: controls.map(bone) } : null) } },
  animation_data: {
    drivers,
    action: { layers: [{ strips: [{ channelbags: [{ fcurves: fcurves.map((data_path) => ({ data_path })) }] }] }] },
    nla_tracks: [],
  },
});

assert.ok(posedByPage(rig(20))(bone('B3')), 'a small rig keeps every bone');
const big = posedByPage(rig(200, {
  controls: ['B1'],
  drivers: [{ data_path: 'pose.bones["B2"].rotation_euler', driver: { variables: [{ targets: [{ id: { name: 'Rig' }, data_path: 'pose.bones["B3"].scale.y' }] }] } }],
  fcurves: ['pose.bones["B4"].location', 'pose.bones["B5"]["custom"]'],
}));
assert.deepEqual(['B0', 'B1', 'B2', 'B3', 'B4', 'B5'].filter((name) => big(bone(name))), ['B1', 'B2', 'B3', 'B4'],
  'the Controls collection, a driven bone, a bone a driver reads, a keyed bone; not an untouched one or a keyed custom property');
console.log('Export pose controls: a big rig keeps only the bones the page reads or writes');
