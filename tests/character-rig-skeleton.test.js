// A character poses the skeleton its armature's constraints solve (the IR's pose entity names it), not whichever of the
// armature's skeletons (one per skinned mesh space) comes first.
import assert from 'node:assert/strict';
import { skeletonOf } from '../src/io_scene_babylon/runtime/character/rig.js';

const skeletons = [{ id: 'RIG-Snow GEO-snow_head_helper' }, { id: 'RIG-Snow GEO-snow-hair_base' }];
const blend = (ir) => ({ ir, scene: { skeletons } });
const posed = { entities: { 'OB:RIG-Snow/constraints/pose': { inputs: { skeleton: 'RIG-Snow GEO-snow-hair_base' } } } };
assert.equal(skeletonOf(blend(posed), 'RIG-Snow').id, 'RIG-Snow GEO-snow-hair_base', 'the skeleton the pose entity solves');
assert.equal(skeletonOf(blend({ entities: {} }), 'RIG-Snow').id, 'RIG-Snow GEO-snow_head_helper', 'without one, the first named for the armature');
assert.throws(() => skeletonOf(blend({}), 'RIG-Cat'), /No skeleton for armature "RIG-Cat"/, 'none names the ones there are');
console.log('character rig skeleton: ok');
