// A package imports @babylonjs/core module by module (src/io_scene_babylon/babylon-modules.js): the index of Babylon's
// modules is current for the installed version, each name it gives comes from that module as the whole package exports
// it, and a module's imports are rewritten to those modules with the ones adding members it uses to other classes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as BABYLON from '@babylonjs/core';
import { babylonModules, MODULES_FILE } from '../scripts/babylon-modules.mjs';
import { babylonModule, deepImports } from '../src/io_scene_babylon/babylon-modules.js';

assert.equal(readFileSync(MODULES_FILE, 'utf8'), babylonModules(), 'babylon-modules.json is out of date: run node scripts/babylon-modules.mjs');

const core = (file) => import(`@babylonjs/core/${file}`);
for (const [name, value] of Object.entries(BABYLON)) assert.equal((await core(babylonModule(name)))[name], value, `${name} from ${babylonModule(name)}`);
// What Parse reads back by name: a registered class, a light's and a camera's constructor.
assert.equal(babylonModule('BABYLON.PBRMaterial'), 'Materials/PBR/pbrMaterial.js');
assert.equal(babylonModule('node:Light_Type_1'), 'Lights/directionalLight.js');
assert.equal(babylonModule('node:FreeCamera'), 'Cameras/universalCamera.js', 'Camera.Parse constructs a FreeCamera as a UniversalCamera');
assert.equal(babylonModule('node:ArcRotateCamera'), 'Cameras/arcRotateCamera.js');

const code = deepImports(`// A module.
import { Mesh, Vector3 as V,
  Color3 } from '@babylonjs/core';
import { x } from './x.js';
mesh.thinInstanceSetBuffer('matrix', data);
`);
assert.equal(code, `// A module.
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Vector3 as V } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { x } from './x.js';
mesh.thinInstanceSetBuffer('matrix', data);
`);
assert.throws(() => deepImports("import { NoSuchClass } from '@babylonjs/core';"), /exports no NoSuchClass/);
console.log(`${Object.keys(BABYLON).length} names, each from its module`);
