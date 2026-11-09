// An exported package's scene in Node, without a page: sets controls by their Blender paths, lets what follows from
// them run (drivers, modifiers, Blender's fallback) and prints the named objects as evaluated, in Babylon's axes.
// usage: node headless-sdk.mjs <package>/scene.js '{"objects[\"Flywheel\"].rotation_euler[1]": 1.2}' Crosshead
import { pathToFileURL } from 'node:url';
import { NullEngine } from '@babylonjs/core';

const [scene, controls = '{}', ...names] = process.argv.slice(2);
const { load } = await import(pathToFileURL(scene).href);
const blend = await load(new NullEngine());

for (const [path, value] of Object.entries(JSON.parse(controls))) blend.set(path, value);
await blend.settled();

const objects = Object.fromEntries(names.map((name) => {
  const node = blend.scene.getNodeById(name);
  return [name, { matrix_world: [...node.computeWorldMatrix(true).m], positions: [...(node.getVerticesData?.('position') ?? [])] }];
}));
console.log(JSON.stringify(objects));
blend.dispose();
