// Onion skins are a view's aid: a render (Render Image, whose world sets render visibility after its first draw) and
// playback show none, as Blender's render never draws them; the view shows them again after.
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';

const { world, scene, sync } = openExample('bouncing-ball');
sync.view();
// A drawing's mesh is named by its object, layer and onion skin (0: the frame itself).
const onionSkins = () => scene.meshes.filter((m) => m.name.startsWith('__grease_pencil') && +/ (-?\d+)( active| fill| points)?$/.exec(m.name)?.[1]).length;
scene.render();
assert.ok(onionSkins() > 0, 'the view shows onion skins');
world.collections.useRenderVisibility(true);
scene.render();
assert.equal(onionSkins(), 0, 'a render shows none');
world.collections.useRenderVisibility(false);
scene.render();
assert.ok(onionSkins() > 0, 'the view shows them again');
console.log('Grease Pencil: a render draws no onion skins, the view draws them');
process.exit(0);
