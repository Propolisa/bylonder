// An export of what changed alone (scoped-export.js) gives the patch a whole export gives: for a moved light, for a moved
// constraint target (the constrained object follows), and for a changed driver input (the driven parts follow). The
// changed IDs are those Blender's depsgraph updated, as the app collects them after each evaluation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { packageState, tablesPatch } from '../src/io_scene_babylon/scene-patch.js';
import { exportChanged, keyOfPointer } from '../src/io_scene_babylon/scoped-export.js';
import { openExample } from './open-example.js';

const changes = (patch) => Object.fromEntries(Object.entries(patch.tables).map(([table, entries]) => [table, Object.keys(entries).sort()]).sort());

async function same(example, setup, edit, what, check = null) {
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
  check?.(ours);
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
  // A mesh the native rig runtime deforms, widened: its Mesh's data is patched, the rig's entity referencing it kept.
  native: () => same('rigged-character', (world, sync) => {
    const data = blendData(), rig = data.objects.get('Rig'), body = data.objects.get('Body');
    // An Action constraint, which Blender's constraint kernels do not run, puts the rig on the native runtime.
    Object.assign(rig.pose.bones.get('chest').constraints.new('ACTION'), { use_eval_time: true, eval_time: 0.5, frame_start: 1, frame_end: 21,
      use_bone_object_action: false }).action = rig.animation_data.action;
    // A copy of the body with a Corrective Smooth only the runtime runs.
    const smooth = data.objects.new('Smooth', body.data.copy());
    contextStruct().scene.collection.objects.link(smooth);
    Object.assign(smooth, { parent: body.parent, matrix_parent_inverse: body.matrix_parent_inverse, location: body.location, rotation_euler: body.rotation_euler, scale: body.scale });
    smooth.modifiers.new('Armature', 'ARMATURE').object = rig;
    Object.assign(smooth.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH'), { factor: 0.8, iterations: 4, use_only_smooth: true });
    sync.blender.tag(sync.objectOf(world.objects.find((n) => n.name === 'Rig')), 2);
  }, () => {
    const mesh = blendData().objects.get('Smooth').data;
    for (const v of mesh.vertices) v.co = [v.co[0] * 1.3, v.co[1] * 1.3, v.co[2]];
    for (const block of mesh.shape_keys?.key_blocks ?? []) for (const p of block.data) p.co = [p.co[0] * 1.3, p.co[1] * 1.3, p.co[2]];
    mesh.update();
  }, 'a widened mesh the native runtime deforms', (patch) => {
    assert.deepEqual(Object.keys(patch.tables.meshes ?? {}), ['ME:Body.001'], `the Mesh's data is patched: ${JSON.stringify(changes(patch))}`);
    assert.ok(!patch.tables.entities, `and the rig's entity, which references it, is not: ${JSON.stringify(changes(patch))}`);
  }),
  driver: () => same('drivers-and-graph-editor', null, () => { blendData().objects.get('Flywheel').rotation_euler[1] += 0.7; }, 'a changed driver input'),
  // A moved rig: the live re-export takes the rig's verdict from the full export before it (no checks again) and still
  // patches what a whole export patches, as the rig's own inputs did not change.
  rig: () => same('rigged-character', null, (world) => {
    assert.ok(world.rigVerdicts?.has('Rig'), "the full export kept the rig's verdict");
    blendData().objects.get('Rig').location[0] += 0.6;
  }, 'a moved rig'),
  // A material's own node tree is the material's change, which reaches the objects using it, not the scene as a whole.
  material: () => same('rigged-character', null, () => {
    const material = [...blendData().materials].find((m) => m.node_tree?.nodes.get('Principled BSDF'));
    assert.equal(keyOfPointer(material.node_tree.as_pointer()), `MA:${material.name}`, "an embedded node tree is its material's");
    material.node_tree.nodes.get('Principled BSDF').inputs.get('Roughness').default_value = 0.123;
  }, "a material's node value"),
};
const one = process.env.SCOPED_CASE;
if (one) await CASES[one]();
else for (const name of Object.keys(CASES)) {
  const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, SCOPED_CASE: name }, encoding: 'utf8' });
  assert.equal(run.status, 0, `${name}: ${run.stderr.split(/\r?\n/).filter((line) => /Error|assert|expected|actual|^\s+[+-] /.test(line)).slice(0, 30).join('\n')}`);
}
if (!one) console.log('Export scoped: what changed exported alone patches as a whole export does');
process.exit(0);
