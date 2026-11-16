// tags: lightmaps, cycles
// Baking with Cycles in the module, on Bake Corner (tests/fixtures/bake-corner.blend, tools/blender-reference/bake-fixtures.py):
// Blender's object.bake makes each of its bake types, and Bake Lightmaps (render/bake-lightmaps.js) runs it as Blender's
// job on a thread of its own, then stores each object's light, scaled to its peak, as its Bylonder lightmap, read here
// through RNA; Cancel stops it and leaves the scene as it was.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.BYLONDER_THREADS ??= '4';
const { blenderMain } = await import('../src/bmesh/bmesh-wasm.js');
await import('../src/python/bpy_interface.js');
const { blendData, setContextPointer } = await import('../src/python/bpy_rna.js');
const { files } = await import('../src/port/wasm.js');
await import('../src/io_scene_babylon/lightmaps.js');
const { bakeLightmaps, registerBakeLightmaps } = await import('../src/render/bake-lightmaps.js');
const { runningJobs } = await import('../src/windowmanager/wm-jobs.js');
const { registerRuntimeTypes } = await import('../src/runtimes/runtimes.js');
const { bylonderIcon } = await import('../src/python/bpy_icons.js');

registerRuntimeTypes(bylonderIcon());
const main = blenderMain();
setContextPointer(main.C);
main.readBlend(await readFile(new URL('./fixtures/bake-corner.blend', import.meta.url)));
const data = blendData();

// Each bake type into a 32 px image of the block (the pebble's normals from its high copy onto the low one): the
// spread of its values, from a script run in the module's Python.
const { loadCycles } = await import('../src/render/cycles.js');
await loadCycles();
files.set('/bake-types.py', new TextEncoder().encode(`import bpy, json, numpy as np
scene = bpy.context.scene
scene.render.engine, scene.cycles.samples = 'CYCLES', 4
def bake(target, kind, **args):
    image = bpy.data.images.new(kind, 32, 32, float_buffer=True)
    mat = target.material_slots[0].material
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image, mat.node_tree.nodes.active = image, node
    for ob in scene.objects: ob.select_set(False)
    for ob in args.pop('selected', ()): ob.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    result = bpy.ops.object.bake(type=kind, margin=2, **args)
    pixels = np.array(image.pixels[:]).reshape(-1, 4)[:, :3]
    mat.node_tree.nodes.remove(node)
    return [result == {'FINISHED'}, float(pixels.min()), float(pixels.max())]
block, low, high = (bpy.data.objects[n] for n in ('Block', 'Pebble Low', 'Pebble'))
try:
    results = {kind: bake(block, kind) for kind in ('COMBINED', 'AO', 'SHADOW', 'NORMAL', 'ROUGHNESS', 'EMIT')}
    for passes in (('DIRECT',), ('INDIRECT',), ('COLOR',)):
        results['DIFFUSE ' + passes[0]] = bake(block, 'DIFFUSE', pass_filter=set(passes))
    results['EMIT TILE'] = bake(bpy.data.objects['Tile'], 'EMIT')
    results['NORMAL SELECTED TO ACTIVE'] = bake(low, 'NORMAL', selected=[high], use_selected_to_active=True, cage_extrusion=0.05)
except Exception as error:
    import traceback
    results = {'error': traceback.format_exc()}
open('/bake-types.json', 'w').write(json.dumps(results))
`));
main.run('script.python_file_run', { filepath: '/bake-types.py' });
const types = JSON.parse(new TextDecoder().decode(files.get('/bake-types.json')));
assert.ok(!types.error, types.error);
for (const [kind, [finished, min, max]] of Object.entries(types)) {
  assert.ok(finished, `object.bake bakes ${kind}`);
  if (kind !== 'EMIT') assert.ok(max > min, `${kind} bakes a varied image: ${min.toFixed(3)} to ${max.toFixed(3)}`);
}
assert.ok(types['EMIT TILE'][2] > 1, 'the glowing tile bakes its emission');
assert.ok(Math.abs(types.ROUGHNESS[2] - 0.4) < 1e-3, "the block's roughness bakes as its material's 0.4");

// Render properties > Bake > Lightmaps' Bake Lightmaps (bylonder.bake_lightmaps) of the selected floor (Direct on) and
// block (Direct off), each bake Blender's job, its progress the status bar's (wm-jobs.js).
registerBakeLightmaps({ icon: bylonderIcon(), blender: () => main, changed: () => {} });
const floor = data.objects.get('Floor'), block = data.objects.get('Block');
block.bylonder.lightmap.direct = false;
Object.assign(data.scenes.get('Bake Corner').bylonder.lightmap_bake, { resolution: 64, samples: 8 });
for (const ob of data.objects) ob.select_set(ob === floor || ob === block);
const materials = () => [...data.materials].map((m) => m.node_tree.nodes.length).join();
const before = materials();
assert.ok(main.run('bylonder.bake_lightmaps').status & 4, 'Bake Lightmaps starts');
const fractions = [];
while (runningJobs().length) {
  fractions.push(runningJobs()[0].progress);
  await new Promise((resolve) => setTimeout(resolve, 50));
}
assert.ok(fractions.length > 2 && fractions.every((f, i) => f >= 0 && f <= 1 && (!i || f >= fractions[i - 1] - 1e-6)), 'progress rises from 0 to 1');
assert.equal(materials(), before, 'the temporary bake nodes are gone');
for (const ob of [floor, block]) {
  const lightmap = ob.bylonder.lightmap, image = lightmap.image;
  assert.equal(lightmap.uv_map, 'Lightmap');
  assert.ok(ob.data.uv_layers.get('Lightmap') && ob.data.uv_layers.active_index === 0 && ob.data.uv_layers[0].active_render, `${ob.name}: a lightmap UV map, its own UV map still the one it renders`);
  assert.equal(image.size[0], 64);
  assert.ok(image.packed_file, `${ob.name}: the image is packed in the .blend`);
  // The light over its peak, its Intensity the peak: the brightest pixels near 1 (8-bit, dithered, JPEG, which softens a
  // lone bright pixel of an undenoised bake), and next to none at 1.
  const pixels = image.pixels, values = Array.from({ length: pixels.length / 4 }, (_, i) => Math.max(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]));
  const peak = Math.max(...values), clipped = values.filter((v) => v > 0.999).length / values.length;
  assert.ok(peak > 0.75 && clipped < 0.01, `${ob.name}: the image spans its range without clipping (peak ${peak.toFixed(3)}, ${(clipped * 100).toFixed(1)}% at 1)`);
}
assert.ok(floor.bylonder.lightmap.direct && floor.bylonder.lightmap.intensity > 1, `the sunlit floor's light peaks above 1 (${floor.bylonder.lightmap.intensity})`);
assert.ok(!block.bylonder.lightmap.direct && block.bylonder.lightmap.intensity < floor.bylonder.lightmap.intensity, "the block's lightmap holds its bounce and sky, not the sun's direct light");

// Cancel during the first bake: nothing changes, the selection is as it was.
const image = floor.bylonder.lightmap.image.name;
for (const ob of data.objects) ob.select_set(ob.name === 'Pebble');
let cancel = false;
const cancelled = await bakeLightmaps(main, ['Floor'], { resolution: 64, samples: 64, progress: () => { cancel = true; }, cancelled: () => cancel });
assert.deepEqual(cancelled, [], 'Cancel bakes nothing more');
assert.equal(floor.bylonder.lightmap.image.name, image, "the floor keeps its lightmap");
assert.equal(materials(), before, 'a cancelled bake leaves no bake nodes');
assert.deepEqual([...data.objects].filter((ob) => ob.select_get()).map((ob) => ob.name), ['Pebble'], 'the selection is as it was');
console.log(`bake types: ${Object.keys(types).join(', ')}; lightmaps: ${[floor, block].map((ob) => `${ob.name} ${ob.bylonder.lightmap.intensity.toFixed(2)}`).join(', ')}`);
process.exit(0);
