// Instanced objects drawn as a carrier's thin instances keep their instance matrices when the carrier's geometry is
// rebuilt: Link and Append's street lamp posts, whose source mesh is rebuilt after their carrier first draws, still
// draw at each of their 8 instances, as the lanterns on them do.
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';

const { scene, sync } = openExample('link-append');
for (const frame of [1, 2]) {
  sync.frameChanged(frame);
  sync.view();
  const carriers = scene.meshes.filter((m) => m.name.startsWith('__instances'));
  assert.equal(carriers.length, 2, 'the post and the lantern each have a carrier');
  for (const carrier of carriers) {
    assert.equal(carrier.thinInstanceCount, 8, `${carrier.name}: 8 lamps`);
    assert.ok(carrier.geometry.getVertexBuffer('world0'), `${carrier.name}: its instance matrices are on its geometry (frame ${frame})`);
  }
}
console.log('Instances: a carrier keeps its instance matrices on a rebuilt geometry');
