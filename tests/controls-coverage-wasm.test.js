// tags: live
// Which value edits reach a run, on the named scenes: every property Bylonder keeps equal in Main (rna-bylonder.js
// syncNames) of a struct an export ships is in controls-export.js SYNCED: set fast through its controls (or kept as
// it is), remade by the export's patch, or reloading the run. A property in none of them is a gap, listed. Structs not
// in the table yet are listed with their counts, and leave it struct by struct. Material colours, shape keys and custom
// properties are controls outside the sync table (node sockets, ID properties), fast already
// (tests/game-instant-edits-wasm.test.js).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const SCENES = ['rigged-character', 'desk-lamp', 'shape-keys', 'rendering'];
// The editor's own structs, which no export ships: the 3D cursor, the tool settings and the scene's display units.
const APP_STRUCTS = new Set(['View3DCursor', 'ToolSettings', 'UnitSettings']);
// The scene's own structs, read over the app's world.
const SCENE_STRUCTS = ['Scene', 'RenderSettings', 'SceneEEVEE', 'RaytraceEEVEE', 'ColorManagedViewSettings', 'ColorManagedDisplaySettings'];

// One scene's synced properties by struct, in a process of its own (Blender's module holds one Main).
async function syncedIn(id) {
  const { openExample } = await import('./open-example.js');
  const { createRNA, syncNames } = await import('../src/makesrna/rna-bylonder.js');
  const { world, sync } = openExample(id);
  world.mainSync = sync;
  sync.view();
  const r = createRNA({ world }), found = {};
  const add = (struct, owner) => { if (struct && !APP_STRUCTS.has(struct)) for (const name of syncNames(struct, owner)) (found[struct] ??= new Set()).add(name); };
  for (const node of world.objects) {
    add('Object', node);
    add(r.pointer('Object', node)?.data?.rna_type?.identifier, node);
  }
  for (const material of world.scene.materials) add('Material', material);
  for (const struct of SCENE_STRUCTS) add(struct, world);
  // The properties a full export binds to the scene, by struct and name: a measured kind that binds none here is set by
  // the export's patch.
  const { exportPackage } = await import('../src/io_scene_babylon/js-export.js');
  const { packageState } = await import('../src/io_scene_babylon/scene-patch.js');
  const ROOTS = { objects: 'Object', lights: 'Light', cameras: 'Camera', materials: 'Material' }, bound = new Set();
  for (const [path, property] of Object.entries(packageState(await exportPackage(world, {})).tables.properties)) {
    const [, root, name] = /^(\w+)\["(?:[^"\\]|\\.)*"\]\.(\w+)/.exec(path) ?? [];
    if (property?.bind && ROOTS[root]) bound.add(`${ROOTS[root]}.${name}`);
  }
  return { structs: Object.fromEntries(Object.entries(found).map(([struct, names]) => [struct, [...names]])), bound: [...bound] };
}

const id = process.argv[2];
if (id) console.log(JSON.stringify(await syncedIn(id)));
else {
  const { SYNCED, KEPT, REBUILD, RELOAD, NONE, APP } = await import('../src/io_scene_babylon/controls-export.js');
  const run = promisify(execFile), self = fileURLToPath(import.meta.url);
  const scenes = await Promise.all(SCENES.map(async (scene) => [scene, JSON.parse((await run(process.execPath, [self, scene], { encoding: 'utf8', maxBuffer: 1 << 26 })).stdout.trim().split('\n').at(-1))]));
  // A light of any type binds as Light (rna-bylonder.js LIGHT_STRUCTS).
  const tableOf = (struct) => SYNCED[struct] ?? (/Light$/.test(struct) ? SYNCED.Light : undefined);
  const lines = [], gaps = [], reloads = new Set(), undrawn = new Set(), pending = new Map();
  for (const [scene, { structs, bound }] of scenes) {
    const count = { fast: 0, rebuild: 0, reload: 0, none: 0, app: 0, pending: 0 };
    for (const [struct, names] of Object.entries(structs)) for (const name of names) {
      const table = tableOf(struct), kind = table?.[name];
      if (!table) { count.pending++; pending.set(struct, new Set([...(pending.get(struct) ?? []), name])); }
      else if (kind === undefined) gaps.push(`${scene}: ${struct}.${name}`);
      else if (typeof kind === 'function') count[bound.includes(`${/Light$/.test(struct) ? 'Light' : struct}.${name}`) ? 'fast' : 'rebuild']++;
      else if (kind === KEPT) count.fast++;
      else if (kind === REBUILD) count.rebuild++;
      else if (kind === RELOAD) { count.reload++; reloads.add(`${struct}.${name}`); }
      else if (kind === NONE) { count.none++; undrawn.add(`${/Light$/.test(struct) ? 'Light' : struct}.${name}`); }
      else if (kind === APP) count.app++;
    }
    const covered = count.fast + count.rebuild + count.reload;
    lines.push(`${scene}: ${covered} covered (${count.fast} fast, ${count.rebuild} rebuild, ${count.reload} reload), ${count.none} not drawn by pages, ${count.app} the editor's, ${count.pending} not in the table yet`);
  }
  assert.deepEqual(gaps, [], `synced properties with no kind in controls-export.js SYNCED: ${gaps.join(', ')}`);
  console.log(lines.join('\n'));
  console.log(`Reload: ${[...reloads].sort().join(', ') || 'none'}`);
  console.log(`Not drawn by pages: ${[...undrawn].sort().join(', ') || 'none'}`);
  console.log(`Not in the table yet: ${[...pending].map(([struct, names]) => `${struct} (${names.size})`).join(', ') || 'none'}`);
  console.log('Controls coverage: every synced property of a struct in the table has a kind');
}
