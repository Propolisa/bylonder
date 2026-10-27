"""Where Blender stores each modifier property: the DNA field (offset, size, kind, bit) its RNA definition in
rna_modifier.cc names, as Clang parses that file for the module's wasm32 target. Written to src/makesrna/dna-modifiers.json;
with rna-modifiers.json (tools/blender-reference/modifiers.py) it lets JS read and write a ModifierData in the module.

Usage: tools/blender-port/modifier_dna.py SRC   (SRC: Blender sources of the manifest's tag)
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

RNA = 'source/blender/makesrna/intern/rna_modifier.cc'
SDNA_CALL = re.compile(r'RNA_def_property_(boolean|boolean_negative|boolean_bitset_array|int|float|enum|enum_bitflag|pointer|string)_sdna$')
# RNA_def_property and the shorthands that call it (RNA_def_boolean, RNA_def_float_vector, ...).
PROPERTY_CALL = re.compile(r'RNA_def_(property|boolean|int|float|enum|string|pointer)\w*$')


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


def definitions(tu, evaluate):
    """{RNA struct: {sdna, properties: {identifier: {field, bit, negative, custom}}}} from the rna_def_* functions, following
    the helpers they call with the struct (rna_def_modifier_panel_open_prop and the like)."""
    functions = {c.spelling: c for c in tu.cursor.walk_preorder() if c.kind == ci.CursorKind.FUNCTION_DECL and c.is_definition()
                 and c.location.file and c.location.file.name.endswith('rna_modifier.cc')}
    structs, state = {}, {'struct': None, 'prop': None}

    def walk(function, seen):
        for call in function.walk_preorder():
            if call.kind != ci.CursorKind.CALL_EXPR:
                continue
            name, args = call.spelling, list(call.get_arguments())
            if name == 'RNA_def_struct':
                state['struct'] = structs.setdefault(evaluate(args[1]), {'properties': {}})
            elif name == 'RNA_def_struct_sdna' and state['struct'] is not None:
                state['struct']['sdna'] = evaluate(args[1])
            elif PROPERTY_CALL.match(name) and not name.startswith('RNA_def_property_') and state['struct'] is not None:
                identifier = evaluate(args[1])
                state['prop'] = state['struct']['properties'].setdefault(identifier, {'field': identifier})
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
            elif state['prop'] is not None and name.startswith('RNA_def_property_') and name.endswith('_funcs'):
                state['prop']['custom'] = True
            elif name in functions and name not in seen and name.startswith('rna_def_'):
                walk(functions[name], seen | {name})

    for name, function in functions.items():
        if name.lower().startswith('rna_def_modifier'):
            state.update(struct=None, prop=None)
            walk(function, {name})
    return structs


def main():
    root = sys.argv[1]
    manifest = json.load(open(os.path.join(wasm_module.HERE, 'manifest.json')))
    spec = manifest['modules']['bmesh/bmesh.wasm']
    tree, _ = wasm_module.patched_tree(root)
    _, includes, _ = wasm_module.dependencies(tree + '-build', spec.get('dependencies', {}))
    args = [a for a in includes + wasm_module.flags(tree, spec) if a != '-O2'] + driver_includes() + ['-x', 'c++']
    tu = ci.Index.create().parse(os.path.join(tree, RNA), args=args)
    errors = [d for d in tu.diagnostics if d.severity >= ci.Diagnostic.Error]
    if errors:
        sys.exit(f'{RNA} does not parse:\n' + '\n'.join(str(d) for d in errors[:10]))
    records = {c.spelling: c.type for c in tu.cursor.walk_preorder() if c.kind == ci.CursorKind.STRUCT_DECL and c.is_definition()}
    out = {}
    for rna, definition in sorted(definitions(tu, Evaluate()).items()):
        sdna = definition.get('sdna')
        if sdna not in records:
            continue
        props = {}
        for identifier, prop in definition['properties'].items():
            if prop['field'] is None:
                continue
            struct = records[prop.get('struct', sdna)]
            try:
                located = field(struct, prop['field'])
            except (StopIteration, ValueError):
                continue  # No DNA field of its own: a property whose functions compute it.
            props[identifier] = {**located, **{k: prop[k] for k in ('bit', 'bitset', 'negative', 'bitflag', 'custom') if k in prop}}
        out[rna] = {'sdna': sdna, 'size': records[sdna].get_size(), 'properties': props}
    path = os.path.join(convert.REPO, 'src', 'makesrna', 'dna-modifiers.json')
    json.dump(out, open(path, 'w'), indent=1)
    print(f'{os.path.relpath(path, convert.REPO)}: {len(out)} structs, {sum(len(s["properties"]) for s in out.values())} properties')


if __name__ == '__main__':
    main()
