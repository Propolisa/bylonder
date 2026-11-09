// Reading an IR file (runtime/ir.js readIR): a version 1 file written before later schema changes still loads, omitted
// fields take their defaults, what can be solved is repaired with a warning, and what cannot names the path, what was
// expected and what is there. The JSON Schema made from the same schema accepts what readIR does.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { readIR } from '../src/io_scene_babylon/runtime/ir.js';

const file = () => JSON.parse(readFileSync(new URL('fixtures/ir-v1.json', import.meta.url), 'utf8'));
const read = (raw, options = {}) => {
  const warnings = [];
  return { ir: readIR(raw, { warn: (message) => warnings.push(message), ...options }), warnings };
};
const validate = new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync(new URL('../src/io_scene_babylon/runtime/ir.schema.json', import.meta.url), 'utf8')));

const v1 = read(file());
assert.deepEqual(v1.warnings, [], 'a version 1 file loads as it is');
assert.equal(v1.ir.properties['objects["Cube"].location[2]'].default, 1.25);
assert.ok(validate(file()), JSON.stringify(validate.errors));

// Omitted fields take their defaults.
const bare = read({ schema: 'bylonder-ir', version: 1 });
assert.deepEqual(bare.ir, { schema: 'bylonder-ir', version: 1, ids: {}, references: [], properties: {}, graphs: {}, entities: {}, order: [] });
assert.deepEqual(read({ schema: 'bylonder-ir', version: 1, entities: { 'OB:A/driver/x': { type: 'driver:SCRIPTED', id: 'OB:A' } } }).ir.entities['OB:A/driver/x'],
  { type: 'driver:SCRIPTED', id: 'OB:A', inputs: {}, outputs: {} });

// Repairs, each with a warning.
const broken = file();
delete broken.properties['objects["Cube"].location[2]'].type;
broken.entities['OB:Cube/modifier/Bevel'].inputs.width = { property: 'objects["Cube"].modifiers["Bevel"].missing' };
broken.entities['OB:Cube/modifier/Bevel'].implementation = 'future';
broken.order = ['OB:Gone/driver/x'];
const repaired = read(broken, { implementations: ['modifiers'] }), bevel = repaired.ir.entities['OB:Cube/modifier/Bevel'];
assert.equal(repaired.ir.properties['objects["Cube"].location[2]'].type, 'FLOAT', 'a property\'s type from its default');
assert.equal(bevel.inputs.width, undefined, 'a reference to a property the IR lacks is dropped');
assert.equal(bevel.implementation, undefined, 'an implementation this runtime does not ship leaves it baked');
assert.deepEqual(repaired.ir.order, ['OB:Cube/modifier/Bevel'], 'order is made from the entities');
assert.equal(repaired.warnings.length, 4, repaired.warnings.join('\n'));
assert.match(repaired.warnings.join('\n'), /entities\["OB:Cube\/modifier\/Bevel"\]\.inputs\.width refers to/);

// What cannot be read throws, naming the path, what was expected and what is there.
const corrupt = (change, message) => {
  const raw = file();
  change(raw);
  assert.throws(() => readIR(raw, { warn: () => {} }), message);
};
corrupt((raw) => { raw.entities['OB:Cube/modifier/Bevel'].type = 5; }, /^Error: ir\.entities\["OB:Cube\/modifier\/Bevel"\]\.type: expected string, got 5$/);
corrupt((raw) => { raw.properties['objects["Cube"].location[2]'].default = null; }, /ir\.properties\["objects\[\\"Cube\\"\]\.location\[2\]"\]\.default: .*got null/);
corrupt((raw) => { raw.version = 2; }, /ir\.version is 2: this runtime reads versions up to 1/);
corrupt((raw) => { raw.schema = 'gltf'; }, /Not a Bylonder IR/);
console.log('IR read: a version 1 file loads, defaults fill omitted fields, solvable problems are repaired with a warning and corruption names its path');
