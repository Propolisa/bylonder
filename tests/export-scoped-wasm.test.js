// An export of what changed alone (scoped-export.js) gives the patch a whole export gives: for a moved light, for a moved
// constraint target (the constrained object follows), and for a changed driver input (the driven parts follow). The
// changed IDs are those Blender's depsgraph updated, as the app collects them after each evaluation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { blendData } from '../src/python/bpy_rna.js';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { packageState, tablesPatch } from '../src/io_scene_babylon/scene-patch.js';
import { exportChanged } from '../src/io_scene_babylon/scoped-export.js';
import { openExample } from './open-example.js';

const changes = (patch) => Object.fromEntries(Object.entries(patch.tables).map(([table, entries]) => [table, Object.keys(entries).sort()]).sort());

async function same(example, setup, edit, what) {
  const { world, sync } = openExample(example);
  setup?.(world, sync);
  sync.view();
  const updated = new Set();
  sync.onEvaluated((updates) => { for (const id of updates.keys()) updated.add(id); });
  const last = packageState(await exportPackage(world));
  updated.clear();
  edit(world, sync);
  sync.view();
  const ids = new Set(updated), scoped = await exportChanged(world, last, ids), whole = packageState(await exportPackage(world));
  const ours = tablesPatch(last, scoped), theirs = tablesPatch(last, whole);
  assert.deepEqual(changes(ours), changes(theirs), `${what}: the scoped export patches the entries a whole export patches`);
  assert.equal(scoped.version, whole.version, `${what}: and makes the same version`);
}

// Each case in a process of its own, as Blender's module holds one Main.
const CASES = {
  light: () => same('rigged-character', null, () => { blendData().objects.get('Key').location[0] += 0.5; }, 'a moved light'),
  constraint: () => same('nla', () => {
    blendData().objects.get('Ground').constraints.new('COPY_LOCATION').target = blendData().objects.get('Box');
  }, () => { blendData().objects.get('Box').location[1] += 0.5; }, 'a moved constraint target'),
  // Updates naming no ID the export knows: the whole scene is exported, never an empty patch.
  unmapped: async () => {
    const { world, sync } = openExample('rigged-character');
    sync.view();
    const last = packageState(await exportPackage(world));
    blendData().objects.get('Key').location[0] += 0.5;
    sync.view();
    const ours = await exportChanged(world, last, new Set([0x7fffffff])), whole = packageState(await exportPackage(world));
    assert.equal(ours.version, whole.version, 'unmapped updates export the whole scene');
    assert.ok(Object.keys(tablesPatch(last, ours).tables).length, 'and patch what changed');
  },
  driver: () => same('drivers-and-graph-editor', null, () => { blendData().objects.get('Flywheel').rotation_euler[1] += 0.7; }, 'a changed driver input'),
};
const one = process.env.SCOPED_CASE;
if (one) await CASES[one]();
else for (const name of Object.keys(CASES)) {
  const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, SCOPED_CASE: name }, encoding: 'utf8' });
  assert.equal(run.status, 0, `${name}: ${run.stderr.split(/\r?\n/).filter((line) => /Error|assert|expected|actual|^\s+[+-] /.test(line)).slice(0, 30).join('\n')}`);
}
if (!one) console.log('Export scoped: what changed exported alone patches as a whole export does');
process.exit(0);
