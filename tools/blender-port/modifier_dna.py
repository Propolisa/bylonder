"""Where Blender stores each property of some RNA structs: the DNA field (offset, size, kind, bit) its RNA definition
names, as Clang parses the RNA definition files for the module's wasm32 target.
- src/makesrna/dna-modifiers.json: the modifiers (rna_modifier.cc); with rna-modifiers.json
  (tools/blender-reference/modifiers.py) it lets JS read and write a ModifierData in the module.
- src/makesrna/dna-outliner.json: the structs the Outliner draws buttons for and JS binds (Object, ObjectBase,
  Collection, LayerCollection, SpaceOutliner), with each property's type, icon and enum items, which the module's RNA
  takes too (rna_dna_fields in wasm_module.py).
- src/makesrna/dna-curves.json: a Curve and its Nurb, BezTriple, BPoint, CharInfo and TextBox (rna_curve.cc); with
  rna-curves.json (tools/blender-reference/curves.py) it lets JS read and write curve and text data in the module.
- src/makesrna/dna-anim.json: the animation editors' spaces (SpaceGraphEditor, SpaceDopeSheetEditor), which the
  module's RNA takes too, with their RNA functions as dna-fcurve.json's (wasm/rna-space.cc).
- src/makesrna/dna-fcurve.json: the F-Curve structs (rna_fcurve.cc: FCurve, Keyframe, the F-Modifiers, drivers), an
  F-Modifier type's own properties stored in the struct its FModifier's `data` points to (RNA_def_struct_sdna_from:
  `from`, that pointer's offset in the base struct), and the names of the RNA functions each property has (`funcs`:
  get, set, range, length, update), which the module compiles from rna_fcurve.cc's runtime part (wasm/rna-fcurve.cc).
  A property with functions and no DNA field of its own is kept with its type and array length (`computed`).
- src/makesrna/dna-textures.json: a Texture of each type (rna_texture.cc: CloudsTexture and the others, all a Tex), for
  JS to read and write textures in the module.
- src/makesrna/dna-data.json: the data the scene sync writes into Main by RNA name (main-sync.js): lights, cameras,
  materials, worlds and the scene's settings.

Usage: tools/blender-port/modifier_dna.py SRC [OUTPUT]   (SRC: Blender sources of the manifest's tag; OUTPUT: one of them)
"""
import ctypes
import json
import os
import re
import subprocess
import sys

import clang.cindex as ci

import convert
import wasm_module

INTERN = 'source/blender/makesrna/intern/'
# Each output: the RNA files read, which of their rna_def_* functions to walk, the structs kept (all when None), and
# whether each property's type, icon and enum items are written.
OUTPUTS = {
    'dna-modifiers.json': {'files': ['rna_modifier.cc'], 'functions': lambda name: name.lower().startswith('rna_def_modifier'),
                           'structs': None, 'detail': False},
    'dna-outliner.json': {'files': ['rna_object.cc', 'rna_layer.cc', 'rna_collection.cc', 'rna_space.cc'],
                          'functions': lambda name: name.startswith('rna_def_') or name.startswith('RNA_def_'),
                          'structs': ['Object', 'ObjectBase', 'Collection', 'LayerCollection', 'SpaceOutliner'], 'detail': True},
    'dna-curves.json': {'files': ['rna_curve.cc'], 'functions': lambda name: name == 'RNA_def_curve', 'structs': None, 'detail': True},
    'dna-anim.json': {'files': ['rna_space.cc'], 'functions': lambda name: name.startswith('rna_def_') or name.startswith('RNA_def_'),
                      'structs': ['SpaceGraphEditor', 'SpaceDopeSheetEditor'], 'detail': True, 'funcs': True},
    'dna-fcurve.json': {'files': ['rna_fcurve.cc'], 'functions': lambda name: name == 'RNA_def_fcurve',
                        'structs': ['FCurve', 'Keyframe', 'Driver', 'DriverVariable', 'DriverTarget', 'FModifier', 'FModifierGenerator', 'FModifierFunctionGenerator', 'FModifierEnvelope',
                                    'FModifierEnvelopeControlPoint', 'FModifierCycles', 'FModifierLimits', 'FModifierNoise',
                                    'FModifierStepped', 'FModifierSmooth'], 'detail': True, 'funcs': True,
                        'computed': True, 'enum_files': ['rna_curve.cc', 'rna_ID.cc']},
    'dna-textures.json': {'files': ['rna_texture.cc'], 'functions': lambda name: name == 'RNA_def_texture', 'structs': None, 'detail': True},
    'dna-data.json': {'files': ['rna_light.cc', 'rna_camera.cc', 'rna_material.cc', 'rna_world.cc', 'rna_scene.cc', 'rna_color.cc'],
                      'functions': lambda name: name.startswith('rna_def_') or name.startswith('RNA_def_'),
                      'structs': ['Light', 'PointLight', 'SpotLight', 'SunLight', 'AreaLight', 'Camera', 'Material', 'World', 'Scene',
                                  'RenderSettings', 'UnitSettings', 'ToolSettings', 'ColorManagedViewSettings', 'ColorManagedDisplaySettings'],
                      'detail': True},
}
SDNA_CALL = re.compile(r'RNA_def_property_(boolean|boolean_negative|boolean_bitset_array|int|float|enum|enum_bitflag|pointer|string)_sdna$')
# RNA_def_property and the shorthands that call it (RNA_def_boolean, RNA_def_float_vector, ...).
PROPERTY_CALL = re.compile(r'RNA_def_(property|boolean|int|float|enum|string|pointer)\w*$')
# What each argument of an RNA_def_property_*_funcs call names (after the property).
FUNC_ROLES = {'RNA_def_property_boolean_funcs': ('get', 'set'), 'RNA_def_property_int_funcs': ('get', 'set', 'range'),
              'RNA_def_property_float_funcs': ('get', 'set', 'range'), 'RNA_def_property_enum_funcs': ('get', 'set', None),
              'RNA_def_property_string_funcs': ('get', 'length', 'set'), 'RNA_def_property_dynamic_array_funcs': ('length',)}
SHORTHAND_TYPES = {'boolean': 'BOOLEAN', 'int': 'INT', 'float': 'FLOAT', 'enum': 'ENUM', 'string': 'STRING', 'pointer': 'POINTER'}


def driver_includes():
    """The system include directories Clang's driver uses for the target, which libclang does not add by itself."""
    out = subprocess.run(['clang++', '--target=wasm32-wasi', '-E', '-x', 'c++', '-', '-v'], input='', capture_output=True, text=True).stderr
    lines = out[out.index('#include <...> search starts here:'):out.index('End of search list.')].splitlines()[1:]
    resource = subprocess.run(['clang++', '-print-resource-dir'], capture_output=True, text=True).stdout.strip()
    return [f'-resource-dir={resource}', *(f'-isystem{line.strip()}' for line in lines)]


class Evaluate:
    """Clang's constant evaluation of an expression (clang_Cursor_Evaluate), which the Python bindings do not wrap."""
    INT, FLOAT, STRING = 1, 2, 4

    def __init__(self):
        lib = ci.conf.lib
        lib.clang_Cursor_Evaluate.restype = ctypes.c_void_p
        lib.clang_EvalResult_getKind.argtypes = [ctypes.c_void_p]
        lib.clang_EvalResult_getAsLongLong.argtypes = [ctypes.c_void_p]
        lib.clang_EvalResult_getAsLongLong.restype = ctypes.c_longlong
        lib.clang_EvalResult_getAsDouble.argtypes = [ctypes.c_void_p]
        lib.clang_EvalResult_getAsDouble.restype = ctypes.c_double
        lib.clang_EvalResult_getAsStr.argtypes = [ctypes.c_void_p]
        lib.clang_EvalResult_getAsStr.restype = ctypes.c_char_p
        lib.clang_EvalResult_dispose.argtypes = [ctypes.c_void_p]
        self.lib = lib

    def __call__(self, cursor):
        result = self.lib.clang_Cursor_Evaluate(cursor)
        if not result:
            return None
        try:
            kind = self.lib.clang_EvalResult_getKind(result)
            if kind == self.INT:
                return self.lib.clang_EvalResult_getAsLongLong(result)
            if kind == self.FLOAT:
                return self.lib.clang_EvalResult_getAsDouble(result)
            if kind == self.STRING:
                return self.lib.clang_EvalResult_getAsStr(result).decode()
            return None
        finally:
            self.lib.clang_EvalResult_dispose(result)


def field(struct, path):
    """Offset in bytes, size and kind of a DNA field (`a`, `a.b` or `a[i]`) of a struct type."""
    offset, type = 0, struct
    for part in path.split('.'):
        name, _, index = part.partition('[')
        offset += type.get_offset(name) // 8
        type = next(c.type for c in type.get_declaration().get_children() if c.kind == ci.CursorKind.FIELD_DECL and c.spelling == name)
        if index:
            type = type.get_array_element_type()
            offset += int(index.rstrip(']')) * type.get_size()
    length = type.get_array_size() if type.kind == ci.TypeKind.CONSTANTARRAY else None
    element = (type.get_array_element_type() if length else type).get_canonical()
    kind = ('pointer' if element.kind == ci.TypeKind.POINTER else 'float' if element.kind in (ci.TypeKind.FLOAT, ci.TypeKind.DOUBLE)
            else 'struct' if element.kind == ci.TypeKind.RECORD else 'int')
    signed = element.kind in (ci.TypeKind.CHAR_S, ci.TypeKind.SCHAR, ci.TypeKind.SHORT, ci.TypeKind.INT, ci.TypeKind.LONG,
                              ci.TypeKind.LONGLONG) or (element.kind == ci.TypeKind.ENUM and element.get_declaration().enum_type.spelling
                                                        in ('int', 'short', 'signed char', 'char'))
    return {'offset': offset, 'size': element.get_size(), 'kind': kind, **({'signed': True} if kind == 'int' and signed else {}),
            **({'length': length} if length else {})}


# Enum item arrays other RNA files define (an output's `enum_files`), by name, for the ones a file only declares.
ENUM_DEFINITIONS = {}


def initializer(decl):
    return next((c for c in decl.get_children() if c.kind == ci.CursorKind.INIT_LIST_EXPR), None)


def enum_items(cursor, evaluate):
    """[[value, identifier], ...] of an EnumPropertyItem array an expression names, without its separators."""
    decl = next((c.referenced for c in cursor.walk_preorder() if c.kind == ci.CursorKind.DECL_REF_EXPR), None)
    init = (initializer(decl) or ENUM_DEFINITIONS.get(decl.spelling)) if decl else None
    items = []
    for item in init.get_children() if init else []:
        values = [c.spelling[1:-1] if c.kind == ci.CursorKind.STRING_LITERAL else evaluate(c) for c in item.get_children()][:2]
        if len(values) == 2 and isinstance(values[1], str) and values[1]:
            items.append(values)
    return items


def definitions(tu, evaluate, files, walked, detail):
    """{RNA struct: {sdna, properties: {identifier: {field, bit, negative, custom}}}} from the rna_def_* functions, following
    the helpers they call with the struct (rna_def_modifier_panel_open_prop and the like). With `detail`, each property's
    type, icon (and whether its icons are consecutive, negative when reversed) and enum items too."""
    functions = {c.spelling: c for c in tu.cursor.walk_preorder() if c.kind == ci.CursorKind.FUNCTION_DECL and c.is_definition()
                 and c.location.file and os.path.basename(c.location.file.name) in files}
    structs, state = {}, {'struct': None, 'prop': None}

    def walk(function, seen):
        for call in function.walk_preorder():
            if call.kind != ci.CursorKind.CALL_EXPR:
                continue
            name, args = call.spelling, list(call.get_arguments())
            if name == 'RNA_def_struct':
                identifier, base = evaluate(args[1]), evaluate(args[2])
                state['struct'] = structs.setdefault(identifier, {'properties': {}, **({'sdna': identifier} if detail else {}),
                                                                  **({'base': base} if base else {})})
            elif name == 'RNA_def_struct_sdna' and state['struct'] is not None:
                state['struct']['sdna'] = evaluate(args[1])
            elif name == 'RNA_def_struct_sdna_from' and state['struct'] is not None:
                state['struct']['sdna'], state['struct']['from'] = evaluate(args[1]), evaluate(args[2])
            elif PROPERTY_CALL.match(name) and not name.startswith('RNA_def_property_') and state['struct'] is not None:
                identifier = evaluate(args[1])
                state['prop'] = state['struct']['properties'].setdefault(identifier, {'field': identifier})
                if detail:
                    shorthand = SHORTHAND_TYPES.get(name.split('_')[2])
                    state['prop']['type'] = shorthand or {0: 'BOOLEAN', 1: 'INT', 2: 'FLOAT', 3: 'STRING', 4: 'ENUM', 5: 'POINTER'}.get(evaluate(args[2]))
                    if shorthand == 'ENUM':
                        state['prop']['items'] = enum_items(args[2], evaluate)
                    if re.match(r'RNA_def_(float|int|boolean)_(vector|color|array|translation|rotation)', name):
                        state['prop']['array'] = evaluate(args[2])
            elif state['prop'] is not None and (match := SDNA_CALL.match(name)):
                if evaluate(args[1]) is not None:
                    state['prop']['struct'] = evaluate(args[1])
                state['prop']['field'] = evaluate(args[2])
                if match[1].startswith('boolean') and len(args) > 3:
                    state['prop']['bit'] = evaluate(args[3])
                if match[1] == 'boolean_bitset_array':
                    state['prop']['bitset'] = evaluate(args[4])
                if match[1] == 'boolean_negative':
                    state['prop']['negative'] = True
                if match[1] == 'enum_bitflag':
                    state['prop']['bitflag'] = True
            elif detail and state['prop'] is not None and name == 'RNA_def_property_ui_icon':
                state['prop']['icon'], state['prop']['consecutive'] = evaluate(args[1]), evaluate(args[2])
            elif detail and state['prop'] is not None and name == 'RNA_def_property_enum_items':
                state['prop']['items'] = enum_items(args[1], evaluate)
            elif detail and state['prop'] is not None and name == 'RNA_def_property_array':
                state['prop']['array'] = evaluate(args[1])
            elif state['prop'] is not None and name.startswith('RNA_def_property_') and name.endswith('_funcs'):
                state['prop']['custom'] = True
                if detail:
                    names = [evaluate(a) for a in args[1:]]
                    roles = FUNC_ROLES.get(name, ())
                    state['prop'].setdefault('funcs', {}).update({role: n for role, n in zip(roles, names) if role and n})
            elif detail and state['prop'] is not None and name == 'RNA_def_property_flag' and any(
                    c.kind == ci.CursorKind.DECL_REF_EXPR and c.spelling.startswith('PROP_CONTEXT') for c in args[1].walk_preorder()):
                state['prop']['context_update'] = True
            elif detail and state['prop'] is not None and name == 'RNA_def_property_update' and evaluate(args[2]):
                state['prop'].setdefault('funcs', {})['update'] = evaluate(args[2])
            elif name in functions and name not in seen and name.startswith('rna_def_'):
                outer = dict(state)
                walk(functions[name], seen | {name})
                # A helper that defines a struct of its own (rna_def_object_modifiers) leaves the caller's as it was.
                if detail and state['struct'] is not outer['struct']:
                    state.update(outer)

    for name, function in functions.items():
        if walked(name):
            state.update(struct=None, prop=None)
            walk(function, {name})
    return structs


def write(tree, args, output, spec):
    evaluate = Evaluate()
    found, records = {}, {}
    units = [ci.Index.create().parse(os.path.join(tree, INTERN, file), args=args) for file in spec.get('enum_files', [])]
    ENUM_DEFINITIONS.update({c.spelling: initializer(c) for tu in units for c in tu.cursor.walk_preorder()
                             if c.kind == ci.CursorKind.VAR_DECL and 'EnumPropertyItem' in c.type.spelling and initializer(c)})
    for file in spec['files']:
        tu = ci.Index.create().parse(os.path.join(tree, INTERN, file), args=args)
        errors = [d for d in tu.diagnostics if d.severity >= ci.Diagnostic.Error]
        if errors:
            sys.exit(f'{file} does not parse:\n' + '\n'.join(str(d) for d in errors[:10]))
        records.update({c.spelling: c.type for c in tu.cursor.walk_preorder() if c.kind == ci.CursorKind.STRUCT_DECL and c.is_definition()})
        found.update(definitions(tu, evaluate, [file], spec['functions'], spec['detail']))
    out = {}
    for rna, definition in sorted((rna, definition) for rna, definition in found.items() if rna):
        sdna = definition.get('sdna')
        if sdna not in records or (spec['structs'] is not None and rna not in spec['structs']):
            continue
        props = {}
        keys = ('bit', 'bitset', 'negative', 'bitflag', 'custom') + (('type', 'icon', 'consecutive', 'items') if spec['detail'] else ())
        keys += ('funcs', 'array') if spec.get('funcs') else ()
        for identifier, prop in definition['properties'].items():
            # An update with the context (PROP_CONTEXT_UPDATE) takes it, not Main and the scene.
            if prop.pop('context_update', False) and 'update' in prop.get('funcs', {}):
                prop['funcs']['update_context'] = prop['funcs'].pop('update')
            try:
                located = field(records[prop.get('struct', sdna)], prop['field']) if prop['field'] is not None else None
            except (StopIteration, ValueError):
                located = None
            # No DNA field of its own: a property whose functions compute it, kept only with those where asked.
            if located is None and not (spec.get('computed') and prop.get('funcs')):
                continue
            props[identifier] = {**(located or {}), **{k: prop[k] for k in keys if k in prop}}
            # An RNA array over consecutive scalar fields (a light's r, g, b) has RNA's length.
            if spec['detail'] and prop.get('array') and located and 'length' not in located and located['kind'] not in ('struct', 'pointer'):
                props[identifier]['length'] = prop['array']
        base = found.get(definition.get('base'), {})
        origin = {'base': definition['base'], 'from': field(records[base['sdna']], definition['from'])['offset']} if 'from' in definition else {}
        out[rna] = {'sdna': sdna, 'size': records[sdna].get_size(), **origin, 'properties': props}
    path = os.path.join(convert.REPO, 'src', 'makesrna', output)
    json.dump(out, open(path, 'w'), indent=1)
    print(f'{os.path.relpath(path, convert.REPO)}: {len(out)} structs, {sum(len(s["properties"]) for s in out.values())} properties')


def main():
    root = sys.argv[1]
    manifest = json.load(open(os.path.join(wasm_module.HERE, 'manifest.json')))
    spec = manifest['modules']['bmesh/bmesh.wasm']
    tree, _ = wasm_module.patched_tree(root)
    _, includes, _ = wasm_module.dependencies(tree + '-build', spec.get('dependencies', {}))
    args = [a for a in includes + wasm_module.flags(tree, spec) if a != '-O2'] + driver_includes() + ['-x', 'c++']
    for output, output_spec in OUTPUTS.items():
        if len(sys.argv) < 3 or sys.argv[2] == output:
            write(tree, args, output, output_spec)


if __name__ == '__main__':
    main()
