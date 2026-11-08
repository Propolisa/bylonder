// A world's probe bakes once its own render passes can draw the world's box: its shaders compile apart from the views',
// and a bake before they are ready holds only the probe's clear color (race_spaceship's environment baked as flat grey).
import assert from 'node:assert/strict';
import { MeshBuilder, NullEngine, RenderTargetTexture, Scene, StandardMaterial } from '@babylonjs/core';
import { readyInPasses } from '../src/blenkernel/scene/world-babylon.js';

const engine = new NullEngine(), scene = new Scene(engine);
const box = MeshBuilder.CreateBox('__worldNodes', { size: 2 }, scene);
const probe = new RenderTargetTexture('probe', 16, scene, { isCube: true });
const readyIn = new Set([0]);
box.material = Object.assign(new StandardMaterial('world', scene), { isReadyForSubMesh: () => readyIn.has(engine.currentRenderPassId) });
assert.equal(readyInPasses(probe, box), false, "not ready while only the views' pass is");
for (const pass of probe.renderPassIds) readyIn.add(pass);
assert.equal(readyInPasses(probe, box), true, "ready once the probe's passes are");
assert.equal(engine.currentRenderPassId, 0, 'the current pass is left as it was');
console.log("World probe: baked once its own render passes can draw the world passed");
