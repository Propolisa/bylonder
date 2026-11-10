// EEVEE's volumes in exported pages as in the app: the Volumes example's dust (an object's Volume) and Hair Dynamics'
// water (the world's Volume Scatter) ship as volume materials built from the IR's graphs, drawn by the app's volume
// passes in bylonder-volumes/ (GPL, beside its notice). Volumes Off in File > Export's Branches leaves them out.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { sceneBranches } from '../src/io_scene_babylon/branches.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { gplFiles } from '../src/io_scene_babylon/runtime-files.js';
import { current } from '../scripts/modifiers-polyfill.mjs';

const EXAMPLES = { volumes: ['Dust', 'node_volume_principled'], 'hair-dynamics': [null, 'node_volume_scatter'] };
const example = process.argv[2];
// One example per process: a second example opened in the same one does not settle.
if (!example) {
  assert.ok(await current('volumes.bundle.js'), 'volumes.bundle.js is out of date: run node scripts/modifiers-polyfill.mjs');
  for (const name of Object.keys(EXAMPLES)) execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log("Export: object and world volumes ship with the app's volume passes, their materials made from the IR");
  process.exit(0);
}
{
  const [domain, node] = EXAMPLES[example];
  const { world, sync } = openExample(example);
  sync.view();
  const files = await exportModule(world);
  const config = JSON.parse(files['scene.js'].match(/const VOLUMES = (.*);/)[1]);
  assert.deepEqual(config.domains.map(([id]) => id), [domain], `${example}: its volume is ${domain ?? "the world's"}`);
  assert.ok(gplFiles(files).some(([path]) => path === 'bylonder-volumes/volumes.js') && gplFiles(files).some(([path]) => path === 'bylonder-volumes/LICENSE.md'),
    `${example}: the package ships the volume passes beside GPL's notice`);
  assert.ok(Object.keys(JSON.parse(files['bylonder-nodes/nodes.js'].replace(/^[^]*export default /, '').replace(/;\s*$/, '')).graphs).some((key) => key.endsWith('/volume')),
    `${example}: the volume's nodes are kernels of its graph`);
  const written = writePackage(files);
  const blend = await (await import(written.url)).load(new NullEngine());
  const volume = blend.scene.materials.find((m) => m.name.startsWith('__volume'));
  assert.ok(volume?.getBlockByPredicate((b) => b.getClassName() === 'BlenderVolumeOutputBlock'), `${example}: the page parses the volume material`);
  assert.ok(volume.getBlockByName('blender:nodes').options.code.join('\n').includes(node), `${example}: its nodes are Blender's, made from the IR`);
  // Without a GPU the page draws no volumes, and renders.
  blend.scene.render();
  blend.dispose();
  written.remove();
  assert.ok(sceneBranches(world).volumes, `${example}: Branches lists its volumes`);
  const off = await exportModule(world, { branches: { volumes: { state: 'OFF', instances: {} } } });
  assert.ok(!off['scene.js'].includes('const VOLUMES =') && !gplFiles(off).some(([path]) => path.startsWith('bylonder-volumes/')), `${example}: Off ships no volumes`);
}
process.exit(0);
