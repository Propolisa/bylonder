// Exports of what Blender evaluates (babylon-export.js, js-export.js), from the examples opened as a project opens
// them: Geometry Nodes' instances, a driven object, NLA strips and a constraint come out as Blender shows them.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from '@babylonjs/core';
import { idStruct } from '../src/python/bpy_rna.js';
import { openExample } from './open-example.js';
import { serializeScene } from '../src/io_scene_babylon/babylon-export.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

const open = openExample;
const animated = (json, name, property) => json.animationGroups.flatMap((g) => g.targetedAnimations).find((t) => t.targetId === name && t.animation.property === property);
const range = (keys, i) => { const values = keys.map((k) => k.values[i]); return Math.max(...values) - Math.min(...values); };

// Each example in a process of its own: the module holds one Main, which opening another replaces.
const SCENARIOS = {
  async instances() {
    // Geometry Nodes' instances (the planet's trees and rocks) are thin instances in both exports, which no longer throw.
    const { world } = open('geometry-nodes');
    const json = await serializeScene(world);
    const instanced = json.meshes.filter((m) => m.thinInstances?.instancesCount);
    assert.ok(instanced.length && instanced.every((m) => m.name.endsWith('Instances')), `instances are exported: ${json.meshes.map((m) => m.name)}`);
    assert.ok(instanced.every((m) => m.thinInstances.matrixData.length >= 16 * m.thinInstances.instancesCount && json.geometries.vertexData.some((g) => g.id === m.geometryId)),
      'each with its matrices and its source geometry');
    assert.match((await exportModule(world))['scene.js'], /thinInstanceSetBuffer/, 'the JavaScript export writes them too');
  },
  async driver() {
  // The Steam Engine's crosshead, moved by a driver only, slides in the export as it does in Blender.
    const { world } = open('drivers-and-graph-editor');
    const json = await serializeScene(world);
    const slide = animated(json, 'Crosshead', 'position');
    assert.ok(slide && range(slide.animation.keys, 0) > 0.5, 'the driven crosshead slides');
  },
  async nla() {
  // The NLA example has no active action, only strips: the box's motion is exported as Blender evaluates them.
    const { world } = open('nla');
    const json = await serializeScene(world);
    const moves = animated(json, 'Box', 'position');
    assert.ok(moves && Math.max(range(moves.animation.keys, 0), range(moves.animation.keys, 1), range(moves.animation.keys, 2)) > 0.5, 'the strips move the box');
  },
  async constraint() {
  // A constrained object is written where its constraint puts it, not at its own location.
    const { world, sync, node } = open('nla');
    const box = idStruct(sync.objectOf(node('Box'))), camera = idStruct(sync.objectOf(node('Camera')));
    const constraint = box.constraints.new('COPY_LOCATION');
    constraint.target = camera;
    sync.sceneChanged();
    const json = await serializeScene(world);
    const at = Vector3.FromArray(json.meshes.find((m) => m.name === 'Box').position), expected = sync.worldMatrix(node('Camera')).getTranslation();
    assert.ok(Vector3.Distance(at, expected) < 1e-3, `the box is at the camera's location: ${at} vs ${expected}`);
  },
  // A camera and a sun aimed by Track To at the moving box look at it in the export, and follow it.
  async aimed() {
    const { world, sync, node } = open('nla');
    const box = idStruct(sync.objectOf(node('Box')));
    for (const name of ['Camera', 'Light']) {
      const track = idStruct(sync.objectOf(node(name))).constraints.new('TRACK_TO');
      Object.assign(track, { target: box, track_axis: 'TRACK_NEGATIVE_Z', up_axis: 'UP_Y' });
    }
    sync.sceneChanged();
    const json = await serializeScene(world);
    const target = sync.worldMatrix(node('Box')).getTranslation();
    const camera = json.cameras.find((c) => c.name === 'Camera'), light = json.lights.find((l) => l.name === 'Light');
    const toBox = (from) => target.subtract(Vector3.FromArray(from)).normalize();
    // Babylon's camera parser reads its rotation as Euler angles.
    const looks = new Vector3(0, 0, 1).applyRotationQuaternion(Quaternion.FromEulerVector(Vector3.FromArray(camera.rotation)));
    assert.ok(Vector3.Dot(looks, toBox(camera.position)) > 0.999, `the camera looks at the box: ${looks} vs ${toBox(camera.position)}`);
    assert.ok(Vector3.Dot(Vector3.FromArray(light.direction), toBox(light.position)) > 0.999, 'the sun shines at the box');
    assert.ok(animated(json, 'Camera', 'rotationQuaternion') && animated(json, 'Light', 'direction'), 'and both follow it as it moves');
  },
};

const scenario = process.argv[2];
if (scenario) await SCENARIOS[scenario]();
else for (const name of Object.keys(SCENARIOS)) execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], { stdio: ['ignore', 'ignore', 'inherit'] });
if (!scenario) console.log('Export of evaluated scenes: Geometry Nodes instances, a driven object, NLA strips and a constraint come out as Blender evaluates them');
