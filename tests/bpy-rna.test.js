import assert from 'node:assert/strict';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import { registered } from '../src/python/bpy_interface.js';
import { blendData, contextStruct, setContextPointer, registerClass, structFind, structRna } from '../src/python/bpy_rna.js';
import { __class__, __kwargtrans__ } from '../src/bl_py/org.transcrypt.__runtime__.js';

// Blender's data and types as bpy gives them to Python, over the module's RNA (bpy_rna.js, rna-bridge.cc).
const blender = new BlenderMain();
const cube = blender.add('MESH', 'Cube');
blender.setBase(cube, { select: true, active: true });
setContextPointer(blender.C);
const data = blendData(), context = contextStruct();
const types = globalThis.__py_modules['_bpy.types'];

// Properties of each kind, read and written through RNA.
const ob = data.objects.get('Cube');
assert.equal(data.objects.length, 1);
assert.equal(ob.name, 'Cube');
assert.equal(ob.type, 'MESH');
assert.ok(ob instanceof Object && types.Object.__name__ === ob.__class__.__name__, 'a struct is an instance of its bpy.types class');
ob.location = [1, 2, 3];
assert.deepEqual([...ob.location], [1, 2, 3]);
ob.location[1] = 5;
assert.equal(ob.location.y, 5);
ob.location.z = 7;
assert.deepEqual(blender.transform(cube).location, [1, 5, 7], 'writes reach the object');
ob.rotation_mode = 'XYZ';
assert.equal(ob.rotation_mode, 'XYZ');
assert.throws(() => { ob.rotation_mode = 'NOPE'; });
assert.throws(() => { ob.type = 'EMPTY'; }, (error) => /read-only/.test(error.__args__[0]));
ob.name = 'Box';
assert.equal(data.objects.get('Box'), ob, 'one object per struct');
assert.equal(ob.data.rna_type.identifier, 'Mesh');
assert.equal(ob.bl_rna.identifier, 'Object');
assert.equal(ob.bl_rna.properties.get('location').subtype, 'TRANSLATION');
assert.ok(ob.bl_rna.properties.get('rotation_mode').enum_items.keys().includes('QUATERNION'));

// Functions, with the context, outputs and the collections' own functions.
const subsurf = ob.modifiers.new('Subdivision', 'SUBSURF');
assert.equal(subsurf.rna_type.identifier, 'SubsurfModifier');
assert.equal(ob.modifiers.length, 1);
subsurf.levels = 2;
assert.equal(ob.modifiers.__getitem__(0).levels, 2);
assert.equal(ob.select_get(), true);
ob.select_set(false);
assert.equal(ob.select_get(), false);
ob.select_set(true);
const empty = data.objects.new('Empty', null);
assert.equal(empty.type, 'EMPTY');
assert.equal(data.objects.length, 2);
data.objects.remove(empty);
assert.equal(data.objects.length, 1, 'a collection\'s own remove (BlendDataObjects.remove) over the generic one');

// Context members.
assert.equal(context.scene.name, 'Scene');
assert.equal(context.active_object, ob);
assert.deepEqual(context.selected_objects, [ob]);
assert.equal(context.mode, 'OBJECT');

// A class registered as an RNA type, with its settings and the properties it declares.
const Panel = __class__('TEST_PT_bridge', [types.Panel], { bl_label: 'Bridge', bl_space_type: 'PROPERTIES', bl_region_type: 'WINDOW', bl_context: 'object',
  bl_options: new Set(['DEFAULT_CLOSED']), draw(context) {} });
const panelType = registerClass(Panel);
assert.equal(structFind('TEST_PT_bridge'), panelType);
const props = globalThis.__py_modules['_bpy.props'];
const Group = __class__('TestGroup', [types.PropertyGroup], { __annotations__: {
  count: props.IntProperty(__kwargtrans__({ name: 'Count', default: 3, min: 0, max: 10 })),
  mode: props.EnumProperty(__kwargtrans__({ items: [['A', 'First', ''], ['B', 'Second', '']], default: 'B' })),
} });
const groupType = registerClass(Group);
const rna = structRna(groupType);
assert.equal(rna.properties.get('count').default, 3);
assert.equal(rna.properties.get('count').hard_max, 10);
assert.equal(rna.properties.get('mode').default, 'B');
assert.ok(registered, 'Blender\'s scripts loaded');

// A Python operator is Blender's operator type (rna-operator.cc): Blender runs it, its execute is the class's.
ob.select_set(false);
const { status } = blender.run('object.select_pattern', { pattern: 'Bo*' });
assert.equal(status & 4, 4, 'object.select_pattern finished');
assert.equal(ob.select_get(), true);
console.log('bpy over the module: properties, collections, functions, context and registration');
