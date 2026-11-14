// The cost of live edits on a scene: a full export, then each named edit exported as a live edit would be
// (scoped-export.js exportChanged), timed. usage: node --max-old-space-size=8192 tools/perf/live-edit-cost.mjs <blend> <edit>...
import { blendData } from '../../src/python/bpy_rna.js';
import { exportPackage } from '../../src/io_scene_babylon/js-export.js';
import { packageState } from '../../src/io_scene_babylon/scene-patch.js';
import { exportChanged } from '../../src/io_scene_babylon/scoped-export.js';
import { openExample } from '../../tests/open-example.js';

const EDITS = {
  material: () => {
    const inputs = blendData().materials.get('Rocks').node_tree.nodes.get('Principled BSDF').inputs;
    inputs.get('Emission Color').default_value = [1, 0, 0, 1];
    inputs.get('Emission Strength').default_value = 2;
  },
  move: () => { blendData().objects.get('RIG-Snow').location[0] += 0.6; },
  mesh: () => {
    const mesh = blendData().objects.get('GEO-snow-shirt').data;
    for (const v of mesh.vertices) { const co = v.co; v.co = [co[0] * 1.3, co[1] * 1.3, co[2]]; }
    const basis = mesh.shape_keys?.key_blocks[0];
    if (basis) for (const p of basis.data) { const co = p.co; p.co = [co[0] * 1.3, co[1] * 1.3, co[2]]; }
  },
};
const t = () => performance.now();
let t0 = t();
const { world, sync } = openExample(process.argv[2]);
sync.view();
console.log('OPEN', Math.round(t() - t0), 'ms, objects', world.objects.length);
const updated = new Set(), flags = new Map();
sync.onEvaluated((updates) => { for (const [id, flag] of updates) { updated.add(id); flags.set(id, (flags.get(id) ?? 0) | flag); } });
t0 = t();
let last = packageState(await exportPackage(world));
console.log('FULL', Math.round(t() - t0), 'ms');
for (const name of process.argv.slice(3)) {
  updated.clear(); flags.clear();
  EDITS[name]();
  sync.view();
  const { keyOfPointer } = await import('../../src/io_scene_babylon/scoped-export.js');
  console.log('FLAGS', name, JSON.stringify([...flags].map(([id, flag]) => [keyOfPointer(id), '0x' + flag.toString(16)])));
  t0 = t();
  last = await exportChanged(world, last, new Set(updated));
  console.log('SCOPED', name, Math.round(t() - t0), 'ms');
}
process.exit(0);
