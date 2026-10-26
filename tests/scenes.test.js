import assert from 'node:assert/strict';
import { sceneList, activeSceneId, sceneRecords, setSceneData, switchScene, addScene, renameScene, removeScene, storedScenes, DEFAULT_BUILDER } from '../src/workspace/scenes.js';

// A project saved before scenes existed is one scene, "Scene", built by createScene, and stores nothing extra.
const legacy = { overrides: { render: { render: { resolutionPercentage: 50 } }, transforms: [{ id: 'a' }] }, animation: { version: 2, action: { name: 'Action', tracks: [{ id: 'a', path: 'position.x', keys: [] }] }, time: { fps: 30 } } };
assert.deepEqual(sceneList(legacy), [{ id: 'scene', name: 'Scene', builder: DEFAULT_BUILDER }]);
assert.equal(activeSceneId(legacy), 'scene');
assert.deepEqual(storedScenes(legacy), {});
assert.equal(sceneRecords(legacy)[0].overrides, legacy.overrides);

// Copy Settings: empty scene with the settings slices and frame range, no content or keys.
const project = structuredClone(legacy);
const settingsId = addScene(project, 'EMPTY');
let record = sceneRecords(project).find((s) => s.id === settingsId);
assert.equal(record.name, 'Scene.001', 'names follow Blender numbering');
assert.equal(record.builder, null);
assert.deepEqual(record.overrides, { render: legacy.overrides.render });
assert.deepEqual(record.animation.action.tracks, []);
assert.equal(record.animation.time.fps, 30);
assert.equal(activeSceneId(project), 'scene', 'adding does not switch');

// Full Copy: same builder and data, independent copies.
const copyId = addScene(project, 'FULL_COPY');
record = sceneRecords(project).find((s) => s.id === copyId);
assert.equal(record.builder, DEFAULT_BUILDER);
assert.deepEqual(record.overrides, legacy.overrides);
assert.notEqual(record.overrides, project.overrides);

// Switching moves the active data into its record and the target's into the project fields.
project.overrides = { transforms: [{ id: 'edited' }] };
switchScene(project, copyId);
assert.equal(activeSceneId(project), copyId);
assert.deepEqual(project.overrides, legacy.overrides);
assert.deepEqual(sceneRecords(project).find((s) => s.id === 'scene').overrides, { transforms: [{ id: 'edited' }] });
assert.equal(project.scenes.find((s) => s.id === copyId).overrides, undefined, 'the active record holds no stale copy');

// Data from a loaded but inactive scene goes to its record; the active scene's to the project fields.
setSceneData(project, 'scene', { animation: { version: 2, marker: 1 } });
assert.equal(sceneRecords(project).find((s) => s.id === 'scene').animation.marker, 1);
setSceneData(project, copyId, { overrides: { stores: {} } });
assert.deepEqual(project.overrides, { stores: {} });

// Rename keeps names unique; remove keeps at least one scene and moves off a deleted active scene.
renameScene(project, settingsId, 'Scene');
assert.equal(sceneList(project).find((s) => s.id === settingsId).name, 'Scene.001');
renameScene(project, settingsId, 'Titles');
const newId = addScene(project, 'NEW');
assert.equal(sceneList(project).find((s) => s.id === newId).name, 'Scene.001', 'the lowest free number is reused');
removeScene(project, copyId);
assert.notEqual(activeSceneId(project), copyId);
assert.equal(sceneList(project).length, 3);
const stored = storedScenes(project);
assert.equal(stored.scene, activeSceneId(project));
assert.equal(stored.scenes.length, 3);
const single = { scenes: [{ id: 'x', name: 'Only', builder: null }] };
assert.throws(() => removeScene(single, 'x'), /at least one scene/);
assert.throws(() => addScene(single, 'LINKED_COPY'), /Unknown scene type/);

console.log('Scenes: records, switching, new scene types, rename and delete passed');
