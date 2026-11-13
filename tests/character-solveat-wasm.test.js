// The native rig's offline solve (native-solve.js solveAt, which contacts and procedural tools ask for poses the page
// is not showing) gives each call's result from that call's bones alone, every other bone at rest: a call never
// depends on what an earlier call gave. After a patch changes the rig's constraints, it solves the new rig, as a new
// export does. The two rig states are tests/fixtures/solveat-rig*.blend, written by
// tools/blender-reference/solveat-fixture.py: the Rigged Character on the native runtime, and the same with a Copy
// Rotation that turns its chest (and the head with it).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deserialize, serialize } from 'node:v8';
import { Matrix, NullEngine, Quaternion, Vector3 } from '@babylonjs/core';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { packageState, tablesPatch } from '../src/io_scene_babylon/scene-patch.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

// Each state exported in a process of its own (a second file opened in one process loses the rig's pose entity).
if (process.argv[2] === '--export') {
  const { world, sync } = openExample(new URL(`./fixtures/${process.argv[3]}`, import.meta.url));
  sync.view();
  writeFileSync(process.argv[4], serialize(await exportPackage(world)));
  process.exit(0);
}
const exported = async (file) => {
  const out = join(mkdtempSync(join(tmpdir(), 'solveat-')), 'made.bin');
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--export', file, out], { stdio: 'ignore', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=16384' } });
  const made = deserialize(readFileSync(out));
  rmSync(dirname(out), { recursive: true, force: true });
  return { made, state: packageState(made) };
};
const loaded = async ({ made }) => {
  const written = writePackage(made.files), blend = await (await import(written.url)).load(new NullEngine());
  await blend.settled();
  blend.playhead.pause();
  for (let i = 0; i < 2; i++) { blend.scene.render(); await blend.settled(); }
  return { blend, remove: written.remove };
};
// The head's world position the offline solve gives for the bones in `bases`, each turned about X from its rest.
const head = (blend, bases) => {
  const skeleton = blend.scene.getSkeletonById('Rig');
  const local = (name, turn) => {
    const rest = skeleton.bones.find((b) => b.name === name).getRestMatrix(), scale = new Vector3(), rotation = new Quaternion(), position = new Vector3();
    rest.decompose(scale, rotation, position);
    return Matrix.Compose(scale, Quaternion.RotationAxis(Vector3.Right(), turn).multiply(rotation), position);
  };
  return skeleton.bylonderRig.solveAt(new Map(bases.map(([name, turn]) => [name, local(name, turn)])))('head').getTranslation();
};

const first = await exported('solveat-rig.blend');

// A package's load resolves with the rig its native runtime solves attached, so its first frame draws it solved (not
// at rest, a T-pose, while the runtime loads).
{
  const written = writePackage(first.made.files), blend = await (await import(written.url)).load(new NullEngine());
  assert.ok(blend.scene.getSkeletonById('Rig').bylonderRig, 'the solver of the rig is attached when load resolves, before any frame');
  blend.dispose();
  written.remove();
}

const page = await loaded(first);
assert.ok(page.blend.scene.getSkeletonById('Rig').bylonderRig?.solveAt, 'the native rig offers an offline solve');
const alone = head(page.blend, [['chest', 0.6]]);
head(page.blend, [['spine', 0.8], ['chest', -0.4]]);
const again = head(page.blend, [['chest', 0.6]]);
assert.ok(again.subtract(alone).length() < 1e-5, `the same bones give the same result whatever came before (${alone} then ${again})`);

// A patch adds the Copy Rotation: the offline solve follows the new constraints, as a new export of them does.
const before = head(page.blend, []);
const second = await exported('solveat-rig-copied.blend');
assert.equal(await page.blend.patch({ ...tablesPatch(first.state, second.state), buffers: second.made.buffers }), page.blend, 'the patch applies to the open page, not a reload');
for (let i = 0; i < 2; i++) { page.blend.scene.render(); await page.blend.settled(); }
const fresh = await loaded(second);
const patched = head(page.blend, []), exportedAgain = head(fresh.blend, []);
assert.ok(exportedAgain.subtract(before).length() > 0.05, `the new constraint moves the head in a new export (${before} to ${exportedAgain})`);
assert.ok(patched.subtract(exportedAgain).length() < 1e-4, `after the patch the offline solve gives the new rig's head (${patched} against ${exportedAgain})`);
fresh.blend.dispose();
fresh.remove();
page.blend.dispose();
page.remove();
console.log('character solveAt: a load resolves with its rig solver attached; an offline solve depends only on the bones it is given, and follows a patched rig');
process.exit(0);
