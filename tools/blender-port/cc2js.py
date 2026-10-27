#!/usr/bin/env python3
"""First-draft ports of Blender C++ to JS through Clang's AST, to verify and fix by hand.

Clang resolves types, overloads and declarations, so the port's conventions apply exactly:
- BMesh elements are indices into bm's pools (-1 for none): `e->v1` is `bm.e.v1[e]`, `v->co` is `vco(bm, v)`.
- Vectors are [x, y, z] arrays used as values: `copy_v3_v3(a, b)` is `a = [...b]`, `add_v3_v3v3(r, a, b)` is
  `r = add_v3(a, b)`. Matrices are arrays of columns.
- Out parameters (r_* pointers and arrays, and vector arrays the function writes) are returned: alone from a void
  function with one, the out or null from a bool function with one, else [return value, ...outs] in parameter order.
  Callers destructure them.
- Iterators are the arrays of bmesh-query.js: `BM_ITER_ELEM (e, &iter, v, BM_EDGES_OF_VERT)` is
  `for (e of BM_EDGES_OF_VERT(bm, v))`.
- Functions that use the mesh take `bm` first unless they have `bm` or `bp` (`const { bm } = bp`).
Imports come from where Clang found each declaration; names the target module does not export yet are listed as
the ports still missing. Whatever has no mapping is marked `/*FIX*/`.

Needs Clang 18 with its Python bindings (`pip install libclang==18.1.1`), the Blender sources of the ported tag
(`git archive v5.2.3 source/blender intern extern | tar -x -C SRC`) and fmt and Eigen headers.
Usage: tools/blender-port/cc2js.py SRC source/blender/bmesh/tools/bmesh_bevel.cc [FUNCTION ...] > out.js
"""
import os
import re
import subprocess
import sys
import clang.cindex as ci

K = ci.CursorKind
T = ci.TypeKind
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
INCLUDES = ['blenlib', 'bmesh', 'makesdna', 'blenkernel', 'blentranslation', 'makesrna', 'imbuf', 'gpu', 'geometry',
            'functions', 'editors/include', '']

POOL = {'BMVert': 'v', 'BMEdge': 'e', 'BMFace': 'f', 'BMLoop': 'l'}
VEC_FIELDS = {('v', 'co'): 'vco', ('v', 'no'): 'vno', ('f', 'no'): 'fno'}
# fn(out, ...args) to `out = js(...args)`, and fn(inout, ...args) to `inout = js(inout, ...args)`.
OUT_FIRST = {
    'copy_v3_v3': lambda a: f'[...{a[0]}]', 'copy_v3_v3_db': lambda a: f'[...{a[0]}]', 'copy_v2_v2': lambda a: f'[...{a[0]}]',
    'copy_v4_v4': lambda a: f'[...{a[0]}]', 'copy_v3_fl': lambda a: f'[{a[0]}, {a[0]}, {a[0]}]', 'copy_v3_fl3': lambda a: f'[{", ".join(a)}]',
    'zero_v3': lambda a: '[0, 0, 0]', 'unit_m4': lambda a: 'unit_m4()', 'unit_m3': lambda a: 'unit_m3()', 'copy_m4_m4': lambda a: f'{a[0]}.map((c) => [...c])',
    'add_v3_v3v3': 'add_v3', 'sub_v3_v3v3': 'sub_v3', 'mul_v3_v3fl': 'mul_v3_fl', 'madd_v3_v3v3fl': 'madd', 'cross_v3_v3v3': 'cross_v3',
    'interp_v3_v3v3': 'interp_v3', 'mid_v3_v3v3': 'mid_v3', 'negate_v3_v3': 'negate_v3', 'normalize_v3_v3': 'normalize_v3',
    'closest_to_line_segment_v3': 'closest_to_line_segment_v3', 'closest_to_plane_v3': 'closest_to_plane_v3',
    'closest_to_line_v3': 'closest_to_line_v3', 'plane_from_point_normal_v3': 'plane_from_point_normal_v3',
    'mul_v3_m4v3': 'mul_m4_v3', 'mul_v2_m3v3': 'mul_v2_m3v3', 'mul_v3_m3v3': 'mul_m3_v3', 'axis_dominant_v3_to_m3': 'axis_dominant_v3_to_m3',
    'project_v3_v3v3': 'project_v3_v3v3', 'project_plane_normalized_v3_v3v3': 'project_plane_normalized_v3_v3v3',
    'invert_m4_m4': 'invert_m4_m4', 'mul_m4_m4m4': 'mul_m4_m4m4', 'mul_m3_m3m3': 'mul_m3_m3m3',
}
IN_OUT = {'add_v3_v3': 'add_v3', 'sub_v3_v3': 'sub_v3', 'mul_v3_fl': 'mul_v3_fl', 'madd_v3_v3fl': 'madd', 'negate_v3': 'negate_v3',
          'normalize_v3': 'normalize_v3', 'mul_m4_v4': 'mul_m4_v4', 'mul_m4_v3': 'mul_m4_v3', 'mul_m3_v3': 'mul_m3_v3'}
RENAME = {
    'dot_v3v3': 'dot_v3', 'fabsf': 'Math.abs', 'fabs': 'Math.abs', 'abs': 'Math.abs', 'sqrtf': 'Math.sqrt', 'sqrt': 'Math.sqrt',
    'cosf': 'Math.cos', 'cos': 'Math.cos', 'sinf': 'Math.sin', 'sin': 'Math.sin', 'tanf': 'Math.tan', 'acosf': 'Math.acos',
    'asinf': 'Math.asin', 'atan2f': 'Math.atan2', 'atan2': 'Math.atan2', 'powf': 'Math.pow', 'pow': 'Math.pow', 'floorf': 'Math.floor',
    'ceilf': 'Math.ceil', 'expf': 'Math.exp', 'logf': 'Math.log', 'min_ff': 'Math.min', 'max_ff': 'Math.max', 'min_ii': 'Math.min',
    'max_ii': 'Math.max', 'min_dd': 'Math.min', 'max_dd': 'Math.max', 'fmaxf': 'Math.max', 'fminf': 'Math.min', 'min': 'Math.min',
    'max': 'Math.max', 'safe_acosf': 'saacos', 'cbrtf': 'Math.cbrt', 'cbrt': 'Math.cbrt',
}
CONSTANTS = {'M_PI': 'Math.PI', 'M_PI_2': 'Math.PI / 2', 'M_PI_4': 'Math.PI / 4', 'M_SQRT2': 'Math.SQRT2', 'M_SQRT1_2': 'Math.SQRT1_2',
             'M_SQRT3': 'Math.sqrt(3)', 'M_SQRT1_3': 'Math.sqrt(1 / 3)', 'FLT_MAX': 'Number.MAX_VALUE', 'DBL_MAX': 'Number.MAX_VALUE',
             'FLT_EPSILON': '1.1920929e-7', 'INT_MAX': '2147483647', 'M_2PI': '2 * Math.PI', 'NULL': 'null', '__func__': "''"}
# Library functions with out parameters past the first, by position; they follow the out-parameter rule.
LIB_OUTS = {'isect_line_line_v3': ('int', [4, 5]), 'isect_line_line_epsilon_v3': ('int', [4, 5]),
            'isect_line_plane_v3': ('bool', [0]), 'isect_ray_plane_v3': ('bool', [2])}
# The JS module of each mapped helper.
HELPER_MODULES = {
    'blenlib/math-geom.js': {'add_v3', 'sub_v3', 'mul_v3_fl', 'madd', 'cross_v3', 'dot_v3', 'len_v3', 'len_squared_v3', 'interp_v3', 'mid_v3',
                             'negate_v3', 'normalize_v3', 'saacos', 'project_v3_v3v3', 'project_plane_normalized_v3_v3v3'},
    'blenlib/math-matrix.js': {'unit_m4', 'unit_m3', 'mul_m4_v3', 'mul_m4_v4', 'mul_m3_v3', 'invert_m4_m4', 'mul_m4_m4m4', 'mul_m3_m3m3'},
    'bmesh/intern/bmesh-class.js': {'vco', 'vno', 'fno', 'BM_ELEM_API_FLAG_ENABLE', 'BM_ELEM_API_FLAG_DISABLE', 'BM_ELEM_API_FLAG_TEST', 'BM_elem_flag_test', 'BM_elem_flag_enable', 'BM_elem_flag_disable',
                                    'BM_elem_flag_set', 'BMO_flag_test', 'BMO_flag_enable', 'BMO_flag_disable', 'BMO_flag_set'},
}
# Blender sources whose port lives under another name.
MODULE_FOR_SOURCE = {
    r'blenlib/BLI_math_(vector|geom|base|solvers)': 'blenlib/math-geom.js', r'blenlib/BLI_math_matrix': 'blenlib/math-matrix.js',
    r'blenlib/BLI_math_rotation': 'blenlib/math-rotation.js', r'blenlib/intern/math_(vector|geom|base)': 'blenlib/math-geom.js',
    r'blenlib/intern/math_matrix': 'blenlib/math-matrix.js', r'blenlib/BLI_kdtree': 'blenlib/kdtree.js',
    r'bmesh/intern/bmesh_iterators': 'bmesh/intern/bmesh-query.js', r'bmesh/intern/bmesh_inline': 'bmesh/intern/bmesh-class.js',
    r'bmesh/bmesh_class': 'bmesh/intern/bmesh-class.js', r'bmesh/intern/bmesh_operator_api': 'bmesh/intern/bmesh-operators.js',
}
VECTOR_TYPES = ('Vector', 'Array', 'Span', 'MutableSpan')
OPS = {'==': '===', '!=': '!=='}
PREFIX = {'!', '-', '+', '~', '*', '&', '++', '--'}


def canon(t):
    return t.get_canonical()


def decl_name(t):
    return canon(t).get_declaration().spelling


def pool_of(t):
    t = canon(t)
    return POOL.get(t.get_pointee().get_declaration().spelling) if t.kind == T.POINTER else None


def is_float_array(t):
    t = canon(t)
    return t.kind == T.CONSTANTARRAY and canon(t.element_type).kind in (T.FLOAT, T.DOUBLE)


def is_int(t):
    return canon(t).kind in (T.INT, T.UINT, T.SHORT, T.USHORT, T.LONG, T.ULONG, T.LONGLONG, T.ULONGLONG, T.CHAR_S, T.UCHAR,
                             T.SCHAR, T.CHAR_U, T.BOOL, T.ENUM)


def zero_of(t):
    t = canon(t)
    if t.kind == T.CONSTANTARRAY:
        inner = zero_of(t.element_type)
        if inner is None or inner.startswith('[') and canon(t.element_type).kind == T.CONSTANTARRAY:
            return f'Array.from({{ length: {t.element_count} }}, () => {inner})' if inner else f'new Array({t.element_count})'
        return f'[{", ".join([inner] * t.element_count)}]'
    if t.kind in (T.FLOAT, T.DOUBLE) or is_int(t):
        return '0' if t.kind != T.BOOL else 'false'
    if t.kind == T.POINTER:
        return '-1' if pool_of(t) else 'null'
    name = t.get_declaration().spelling
    if name in VECTOR_TYPES:
        return '[]'
    if name in ('Map', 'Set'):
        return f'new {name}()'
    return None


def kids(c):
    return [k for k in c.get_children() if k.kind not in (K.TYPE_REF, K.TEMPLATE_REF, K.NAMESPACE_REF)]


def unparen(s):
    if not (s.startswith('(') and s.endswith(')')):
        return s
    depth = 0
    for i, ch in enumerate(s[:-1]):
        depth += 1 if ch == '(' else -1 if ch == ')' else 0
        if depth == 0:
            return s
    return unparen(s[1:-1])


class Port:
    def __init__(self, src_root, rel):
        self.root = os.path.abspath(src_root)
        path = os.path.join(self.root, rel)
        text = open(path).read()
        includes = [m.end() for m in re.finditer(r'^#include [^\n]*\n', text, re.M)]
        cut = includes[-1] if includes else 0
        self.tmp = os.path.join(os.path.dirname(path), '.port_' + os.path.basename(path))
        head = text[:cut] + f'#include "{os.path.join(HERE, "prelude.hh")}"\n'
        body, self.local_macros = wrap_local_macros(text[cut:], {})
        self._tu_text = head + body
        open(self.tmp, 'w').write(self._tu_text)
        resource = subprocess.run(['clang', '-print-resource-dir'], capture_output=True, text=True).stdout.strip()
        args = ['-std=c++20', '-x', 'c++', f'-resource-dir={resource}', '-I/usr/include/eigen3'] + [f'-I{os.path.join(self.root, "source/blender", d)}' for d in INCLUDES]
        args += [f'-I{os.path.join(self.root, d)}' for d in ('intern/guardedalloc', 'intern/atomic', 'intern/eigen', 'extern/fast_float', 'extern/xxhash')]
        self.tu = ci.Index.create().parse(self.tmp, args=args, options=ci.TranslationUnit.PARSE_DETAILED_PROCESSING_RECORD)
        if self.local_macros:
            # Again with each macro's parameter types taken from its first call, so its body ports like a function.
            types = {}
            for c in self.tu.cursor.walk_preorder():
                if c.kind == K.CALL_EXPR and c.spelling in self.local_macros and c.spelling not in types and self.in_main(c):
                    types[c.spelling] = [canon(a.type).spelling for a in c.get_arguments()]
            body, self.local_macros = wrap_local_macros(text[cut:], types)
            self._tu_text = head + body
            open(self.tmp, 'w').write(self._tu_text)
            self.tu = ci.Index.create().parse(self.tmp, args=args, options=ci.TranslationUnit.PARSE_DETAILED_PROCESSING_RECORD)
        os.remove(self.tmp)
        errors = [d for d in self.tu.diagnostics if d.severity >= 3]
        for d in errors[:10]:
            print(f'clang: {d}', file=sys.stderr)
        self.macros = {}
        for c in self.tu.cursor.get_children():
            if c.kind == K.MACRO_INSTANTIATION and self.in_main(c):
                self.macros[(c.extent.start.offset, c.extent.end.offset)] = c.spelling
        self.functions = [c for c in self.tu.cursor.walk_preorder() if c.kind in (K.FUNCTION_DECL, K.FUNCTION_TEMPLATE) and c.is_definition() and self.in_main(c)]
        self.sigs = {f.spelling: self.signature(f) for f in self.functions}
        for name, (ret, outs) in LIB_OUTS.items():
            self.sigs[name] = {'ret': ret, 'params': [{'name': f'p{i}', 'out': 'out' if i in outs else None} for i in range(max(outs) + 1)], 'lib': True}
        self.imports = {}

    def in_main(self, c):
        return bool(c.location.file) and c.location.file.name == self.tmp

    def text(self, c):
        s, e = c.extent.start.offset, c.extent.end.offset
        return self.tu_text()[s:e] if self.in_main(c) else c.spelling

    def tu_text(self):
        return self._tu_text

    def tokens(self, c):
        return list(self.tu.get_tokens(extent=c.extent))

    # --- signatures

    def signature(self, f):
        params = [{'name': p.spelling, 'type': p.type, 'cursor': p} for p in f.get_arguments()]
        body = next((k for k in f.get_children() if k.kind == K.COMPOUND_STMT), None)
        for p in params:
            p['out'] = self.out_kind(p, body) if body else None
        return {'ret': canon(f.result_type), 'params': params}

    def out_kind(self, p, body):
        t = canon(p['type'])
        pointer = t.kind in (T.POINTER, T.CONSTANTARRAY, T.INCOMPLETEARRAY)
        named = re.match(r'^(r|ret)_|^r$', p['name'] or '')
        events = []

        def visit(c, parents):
            if c.kind == K.DECL_REF_EXPR and c.referenced and c.referenced.hash == p['cursor'].hash:
                nested = any(x.kind in (K.IF_STMT, K.FOR_STMT, K.WHILE_STMT, K.DO_STMT, K.SWITCH_STMT, K.CONDITIONAL_OPERATOR, K.CXX_FOR_RANGE_STMT) for x in parents)
                kind = self.use_kind(c, parents)
                events.append('write' if kind == 'write' and not nested else 'nested write' if kind == 'write' else kind)
            for k in c.get_children():
                visit(k, parents + [c])
        visit(body, [])
        events = [e for e in events if e != 'test']
        floats = is_float_array(t) or t.kind == T.POINTER and canon(t.get_pointee()).kind in (T.FLOAT, T.DOUBLE)
        writes = any(e.endswith('write') for e in events)
        if not (named and pointer) and not (floats and writes):
            return None
        if not events or events[0] == 'write' or 'read' not in events:
            return 'out'
        return 'inout'

    def use_kind(self, ref, parents):
        """'write', 'read' or 'test' (an optional out parameter's null check) for one use of a parameter."""
        chain = [ref] + parents[::-1]
        i = 1
        while i < len(chain) and chain[i].kind in (K.UNEXPOSED_EXPR, K.PAREN_EXPR):
            i += 1
        parent = chain[i] if i < len(chain) else None
        child = chain[i - 1]
        if parent is None:
            return 'read'
        if parent.kind == K.UNARY_OPERATOR and self.unary_op(parent)[0] in ('*', '&'):
            j = i + 1
            while j < len(chain) and chain[j].kind in (K.UNEXPOSED_EXPR, K.PAREN_EXPR):
                j += 1
            grand = chain[j] if j < len(chain) else None
            if grand is not None and grand.kind == K.BINARY_OPERATOR and self.binop(grand) == '=' and kids(grand)[0].hash == chain[j - 1].hash:
                return 'write'
            if grand is not None and grand.kind == K.CALL_EXPR:
                return self.call_use(grand, chain[j - 1])
            return 'read'
        if parent.kind == K.ARRAY_SUBSCRIPT_EXPR:
            # Up through m[i][j] and &m[i]: a write into the array is a write of the parameter.
            j = i
            while j < len(chain) and (chain[j].kind in (K.ARRAY_SUBSCRIPT_EXPR, K.UNEXPOSED_EXPR, K.PAREN_EXPR) or
                                      chain[j].kind == K.UNARY_OPERATOR and self.unary_op(chain[j])[0] == '&'):
                j += 1
            grand = chain[j] if j < len(chain) else None
            node = chain[j - 1]
            if grand is not None and grand.kind == K.BINARY_OPERATOR and self.binop(grand) == '=' and kids(grand)[0].hash == node.hash:
                return 'write'
            if grand is not None and grand.kind == K.CALL_EXPR:
                return self.call_use(grand, node)
            return 'read'
        if parent.kind == K.BINARY_OPERATOR:
            op = self.binop(parent)
            if op == '=' and kids(parent)[0].hash == child.hash:
                return 'write'
            if op in ('&&', '||', '!=', '==') and canon(ref.type).kind == T.POINTER:
                return 'test'
        if parent.kind in (K.IF_STMT, K.CONDITIONAL_OPERATOR) and canon(ref.type).kind == T.POINTER:
            return 'test'
        if parent.kind == K.CALL_EXPR:
            return self.call_use(parent, child)
        return 'read'

    def call_use(self, call, arg):
        args = list(call.get_arguments())
        idx = next((n for n, a in enumerate(args) if a.hash == arg.hash), -1)
        name = call.spelling
        if idx == 0 and name in OUT_FIRST:
            return 'write'
        sig = self.sigs.get(name) if hasattr(self, 'sigs') else None
        if sig and 0 <= idx < len(sig['params']) and sig['params'][idx]['out'] == 'out':
            return 'write'
        return 'read'

    # --- operators from tokens

    def binop(self, c):
        lhs = kids(c)[0]
        end = lhs.extent.end.offset
        for tok in self.tokens(c):
            if tok.extent.start.offset >= end and tok.kind == ci.TokenKind.PUNCTUATION:
                return tok.spelling
        return '?'

    def unary_op(self, c):
        toks = self.tokens(c)
        if toks and toks[0].spelling in PREFIX and toks[0].extent.start.offset == c.extent.start.offset:
            return toks[0].spelling, 'prefix'
        return (toks[-1].spelling if toks else '?'), 'postfix'

    # --- emission

    def file_scope(self):
        """The file's constants: object-like macros, enums and file-scope variables, in source order."""
        out = []
        for c in self.tu.cursor.walk_preorder():
            if not self.in_main(c):
                continue
            if c.kind == K.MACRO_DEFINITION:
                toks = [t.spelling for t in c.get_tokens()]
                ext = list(c.get_tokens())
                function_like = len(ext) > 1 and ext[1].spelling == '(' and ext[1].extent.start.offset == ext[0].extent.end.offset
                if len(toks) > 1 and not function_like and not toks[0].startswith('_'):
                    value = self.text(c)[len(toks[0]):].strip()
                    value = re.sub(r'\bDEG2RADF\(([^)]*)\)', r'(\1 * Math.PI / 180)', value)
                    value = re.sub(r'\b(\w+)(?=\()', lambda m: RENAME.get(m.group(1), m.group(1)), value)
                    value = re.sub(r'(?<=[\d.])[fF]\b', '', value)
                    value = re.sub(r'\b(M_\w+|FLT_\w+)\b', lambda m: CONSTANTS.get(m.group(1), m.group(1)), value)
                    out.append((c.extent.start.offset, f'const {toks[0]} = {value};'))
            elif c.kind == K.ENUM_DECL and c.is_definition():
                values = [f'{e.spelling} = {e.enum_value}' for e in c.get_children() if e.kind == K.ENUM_CONSTANT_DECL]
                out.append((c.extent.start.offset, f'const {", ".join(values)};'))
            elif c.kind == K.VAR_DECL and c.semantic_parent and c.semantic_parent.kind in (K.TRANSLATION_UNIT, K.NAMESPACE):
                fp = FunctionPort.__new__(FunctionPort)
                fp.p, fp.temps, fp.statement_call, fp.sig = self, 0, False, {'params': [], 'ret': c.type}
                init = kids(c)
                value = fp.expr(init[-1], c.type) if init else zero_of(c.type)
                out.append((c.extent.start.offset, f'const {c.spelling} = {value};'))
        return [line for _, line in sorted(out)]

    def port(self, names=None):
        for f in self.functions:
            self.emit(f)
        self.imports = {}
        return [self.emit(f) for f in self.functions if not names or f.spelling in names]

    def emit(self, f):
        try:
            return FunctionPort(self, f).emit()
        except Exception as error:  # A converter bug in one function leaves the C++ for porting by hand.
            return f'/*FIX converter: {type(error).__name__}: {error}*/\n/*\n{self.text(f)}\n*/'


class FunctionPort:
    def __init__(self, port, f):
        self.p, self.f, self.temps = port, f, 0
        self.sig = port.sigs[f.spelling]
        self.statement_call = False

    def emit(self):
        sig = self.sig
        params = [p['name'] for p in sig['params'] if p['out'] != 'out']
        prologue = []
        for p in sig['params']:
            if p['out'] != 'out':
                continue
            t = canon(p['type'])
            init = zero_of(t) if t.kind == T.CONSTANTARRAY else None
            if init is None and t.kind == T.POINTER:
                pt = canon(t.get_pointee())
                init = None if (is_int(pt) or pt.kind in (T.FLOAT, T.DOUBLE)) else '-1' if pool_of(pt) or decl_name(pt) in POOL else None
            prologue.append(f'let {p["name"]}{" = " + init if init else ""};')
        body_c = next(k for k in self.f.get_children() if k.kind == K.COMPOUND_STMT)
        body = self.block(body_c, 1)
        if sig['params'] and any(p['out'] for p in sig['params']) and canon(sig['ret']).kind == T.VOID:
            body = re.sub(r'\n}$', f'\n  {self.return_outs(None)};\n}}', body)
        if re.search(r'\bbm\b', body) and 'bm' not in params:
            if 'bp' in params:
                prologue.insert(0, 'const { bm } = bp;')
            else:
                params.insert(0, 'bm')
                sig['needs_bm'] = True
        if self.temps:
            prologue.append('let ' + ', '.join(f'_r{i}' for i in range(self.temps)) + ';')
        if prologue:
            body = body.replace('{\n', '{\n' + ''.join(f'  {s}\n' for s in prologue), 1)
        return f'function {self.f.spelling}({", ".join(params)}) {tidy(body)}'

    def outs(self):
        return [p for p in self.sig['params'] if p['out']]

    def return_outs(self, value):
        outs = [p['name'] for p in self.outs()]
        kind = canon(self.sig['ret']).kind
        if kind == T.VOID:
            return f'return {outs[0] if len(outs) == 1 else "[" + ", ".join(outs) + "]"}'
        if kind == T.BOOL and len(outs) == 1:
            return f'return {outs[0]}' if value == 'true' else 'return null' if value == 'false' else f'return {value} ? {outs[0]} : null'
        return f'return [{value}, {", ".join(outs)}]'

    # statements

    def block(self, c, depth):
        lines = [s for s in (self.stmt(k, depth) for k in c.get_children()) if s]
        return '{\n' + '\n'.join(lines) + '\n' + '  ' * (depth - 1) + '}'

    def body(self, c, depth):
        if c.kind == K.COMPOUND_STMT:
            return self.block(c, depth + 1)
        s = self.stmt(c, depth + 1)
        return '{\n' + (s + '\n' if s else '') + '  ' * depth + '}'

    def stmt(self, c, depth):
        pad = '  ' * depth
        k = c.kind
        ch = kids(c)
        if k == K.COMPOUND_STMT:
            return pad + self.block(c, depth + 1)
        if k == K.DECL_STMT:
            return '\n'.join(pad + s for s in self.declaration(c))
        if k == K.RETURN_STMT:
            value = unparen(self.expr(ch[0], canon(self.sig['ret']))) if ch else None
            if self.outs():
                return f'{pad}{self.return_outs(value)};'
            return f'{pad}return{" " + value if value is not None else ""};'
        if k == K.IF_STMT:
            ch = [x for x in ch if x.kind != K.VAR_DECL]
            cond = unparen(self.cond(ch[0]))
            if cond == 'true' and len(ch) == 2:
                return self.body(ch[1], depth - 1)[2:-2].rstrip() if ch[1].kind == K.COMPOUND_STMT else self.stmt(ch[1], depth)
            s = f'{pad}if ({cond}) {self.body(ch[1], depth)}'
            if len(ch) > 2:
                s += ' else ' + (self.stmt(ch[2], depth).lstrip() if ch[2].kind == K.IF_STMT else self.body(ch[2], depth))
            return s
        if k == K.WHILE_STMT:
            return f'{pad}while ({unparen(self.cond(ch[0]))}) {self.body(ch[1], depth)}'
        if k == K.DO_STMT:
            return f'{pad}do {self.body(ch[0], depth)} while ({unparen(self.cond(ch[1]))});'
        if k == K.FOR_STMT:
            return self.for_stmt(c, depth)
        if k == K.CXX_FOR_RANGE_STMT:
            var = next(x for x in ch if x.kind == K.VAR_DECL)
            rng = [x for x in ch if x.kind != K.VAR_DECL][-2]
            r = strip(rng)
            if r.kind == K.CALL_EXPR and r.spelling == 'index_range':
                base = self.expr(kids(kids(r)[0])[0]) if kids(r) and kids(kids(r)[0]) else '/*FIX*/'
                return f'{pad}for (let {var.spelling} = 0; {var.spelling} < {base}.length; {var.spelling}++) {self.body(ch[-1], depth)}'
            return f'{pad}for (const {var.spelling} of {self.expr(rng)}) {self.body(ch[-1], depth)}'
        if k == K.BREAK_STMT:
            return f'{pad}break;'
        if k == K.CONTINUE_STMT:
            return f'{pad}continue;'
        if k == K.NULL_STMT:
            return None
        if k == K.SWITCH_STMT:
            lines = []
            for x in kids(ch[-1]) if ch[-1].kind == K.COMPOUND_STMT else [ch[-1]]:
                lines += self.case(x, depth + 1)
            return f'{pad}switch ({self.expr(ch[0])}) {{\n' + '\n'.join(lines) + f'\n{pad}}}'
        if k in (K.CASE_STMT, K.DEFAULT_STMT):
            return '\n'.join(self.case(c, depth))
        s = self.expr_statement(c)
        return f'{pad}{s};' if s else None

    def case(self, c, depth):
        pad = '  ' * depth
        if c.kind == K.CASE_STMT:
            ch = kids(c)
            return [f'{pad}case {self.expr(ch[0])}:'] + self.case(ch[1], depth)
        if c.kind == K.DEFAULT_STMT:
            return [f'{pad}default:'] + self.case(kids(c)[0], depth)
        if c.kind == K.COMPOUND_STMT:
            return [pad[:-2] + '  {'] + [x for x in (self.stmt(k, depth + 1) for k in c.get_children()) if x] + [pad[:-2] + '  }']
        s = self.stmt(c, depth + 1)
        return [s] if s else []

    def for_stmt(self, c, depth):
        pad = '  ' * depth
        ch = kids(c)
        body = ch[-1]
        toks = self.p.tokens(c)
        semis, level = [], 0
        for t in toks:
            if t.spelling == '(':
                level += 1
            elif t.spelling == ')':
                level -= 1
                if level == 0:
                    break
            elif t.spelling == ';' and level == 1:
                semis.append(t.extent.start.offset)
        init = cond = inc = None
        it = next((x for x in ch[:-1] if x.kind == K.DECL_STMT and any(v.spelling == 'bl_port_it' for v in kids(x))), None)
        if it is not None:
            rest = [x for x in ch[:-1] if x.hash != it.hash]
            calls = [x for x in rest if strip(x).kind == K.CALL_EXPR and strip(x).spelling == 'next']
            incs = [x for x in rest if x not in calls]
            return self.iter_loop(next(v for v in kids(it) if v.spelling == 'bl_port_it'), calls[0] if calls else None, incs[0] if incs else None, body, depth)
        for x in ch[:-1]:
            o = x.extent.start.offset
            if len(semis) < 2:
                break
            if o < semis[0]:
                init = x
            elif o < semis[1]:
                cond = x
            else:
                inc = x
        if init is not None and init.kind == K.DECL_STMT:
            var = next((v for v in kids(init) if v.kind == K.VAR_DECL), None)
            if var is not None and var.spelling == 'bl_port_it':
                return self.iter_loop(var, cond, inc, body, depth)
        init_js = '' if init is None else ' '.join(self.declaration(init)).rstrip(';') if init.kind == K.DECL_STMT else self.expr_statement(init)
        cond_js = unparen(self.cond(cond)) if cond is not None else ''
        inc_js = self.expr(inc) if inc is not None else ''
        return f'{pad}for ({init_js}; {cond_js}; {inc_js}) {self.body(body, depth)}'

    def iter_loop(self, var, cond, inc, body, depth):
        ctor = strip(kids(var)[-1]) if kids(var) else None
        args = list(ctor.get_arguments()) if ctor is not None else []
        data, itype = (args + [None, None])[:2]
        itype_name = strip(itype).spelling if itype is not None else '/*FIX*/'
        ele = self.expr(list(strip(cond).get_arguments())[0]) if cond is not None else '/*FIX*/'
        source = f'{itype_name}(bm)' if itype_name.endswith('_OF_MESH') else f'{itype_name}(bm, {self.expr(data)})'
        self.p.imports.setdefault('bmesh/intern/bmesh-query.js', set()).add(itype_name)
        pad = '  ' * depth
        if inc is not None:
            index = self.expr(kids(strip(inc))[0]) if kids(strip(inc)) else '/*FIX*/'
            return f'{pad}for ([{unparen(index)}, {ele}] of {source}.entries()) {self.body(body, depth)}'
        return f'{pad}for ({ele} of {source}) {self.body(body, depth)}'

    def declaration(self, c):
        out = []
        for v in kids(c):
            if v.kind != K.VAR_DECL:
                continue
            t = canon(v.type)
            if t.get_declaration().spelling in ('BMIter', 'MemArena', 'BMOIter', 'bl_port_iter') or (
                    t.kind == T.POINTER and decl_name(t.get_pointee()) == 'MemArena'):
                continue
            toks = [t.spelling for t in self.p.tokens(v)]
            has_init = '=' in toks or (v.spelling in toks and '{' in toks[toks.index(v.spelling):]) or '(' in toks[toks.index(v.spelling):] if v.spelling in toks else bool(kids(v))
            init = kids(v) if has_init else []
            value = None
            if init:
                x = init[-1]
                sx = strip(x)
                if sx.kind == K.INIT_LIST_EXPR:
                    items = kids(sx)
                    if t.kind == T.CONSTANTARRAY and len(items) <= 1:
                        value = zero_of(t) if not items or self.expr(items[0]) in ('0', 'false', 'null', '-1') else f'[{self.expr(items[0])}]'
                    else:
                        value = '[' + ', '.join(self.expr(i) for i in items) + ']'
                elif sx.kind == K.CALL_EXPR and sx.referenced is not None and sx.referenced.kind == K.CONSTRUCTOR and not list(sx.get_arguments()):
                    value = zero_of(t) or '{}'
                else:
                    value = self.expr(x, t)
            else:
                value = zero_of(t)
                if value is None and t.kind == T.RECORD:
                    value = '{}'
            out.append(f'let {v.spelling}{" = " + value if value is not None else ""};')
        return out

    # expressions

    def macro(self, c):
        if not self.p.in_main(c):
            return None
        return self.p.macros.get((c.extent.start.offset, c.extent.end.offset))

    def cond(self, c):
        c0 = c
        c = strip_parens_casts(c)
        if c.kind == K.DECL_REF_EXPR and any(p['name'] == c.spelling and p['out'] == 'out' for p in self.sig['params']):
            return 'true'
        if pool_of(c.type):
            return f'{self.expr(c)} >= 0'
        if c.kind == K.UNARY_OPERATOR and self.p.unary_op(c)[0] == '!':
            inner = strip_parens_casts(kids(c)[0])
            if pool_of(inner.type):
                return f'{self.expr(inner)} < 0'
            s = self.cond(kids(c)[0])
            return f'!{s}' if re.fullmatch(r'[\w.\[\]]+(\(.*\))?', s) and s.count('(') == s.count(')') else f'!({s})'
        return self.expr(c0)

    def expr(self, c, want=None):
        name = self.macro(c)
        if name and c.kind not in (K.CALL_EXPR,):
            if name in CONSTANTS:
                return CONSTANTS[name]
            text = self.p.text(c)
            return name if text == name else f'/*FIX macro*/ {text}'
        k = c.kind
        ch = kids(c)
        if k in (K.UNEXPOSED_EXPR, K.CXX_FUNCTIONAL_CAST_EXPR, K.CSTYLE_CAST_EXPR, K.CXX_STATIC_CAST_EXPR,
                 K.CXX_REINTERPRET_CAST_EXPR, K.CXX_CONST_CAST_EXPR):
            if not ch:
                return self.p.text(c) or '/*FIX empty*/'
            inner = ch[-1]
            si = strip(inner)
            if si.kind in (K.CXX_NULL_PTR_LITERAL_EXPR, K.GNU_NULL_EXPR):
                return '-1' if pool_of(c.type) or (want is not None and pool_of(want)) else 'null'
            if canon(c.type).kind == T.BOOL and pool_of(inner.type):
                return f'{self.expr(inner)} >= 0'
            if is_int(c.type) and canon(c.type).kind != T.BOOL and canon(inner.type).kind in (T.FLOAT, T.DOUBLE) and k != K.UNEXPOSED_EXPR:
                return f'Math.trunc({self.expr(inner)})'
            return self.expr(inner, want)
        if k == K.CXX_NULL_PTR_LITERAL_EXPR or k == K.GNU_NULL_EXPR:
            return '-1' if want is not None and pool_of(want) else 'null'
        if k == K.DECL_REF_EXPR:
            ref = c.referenced
            self.note_import(ref, c.spelling)
            return CONSTANTS.get(c.spelling, c.spelling)
        if k == K.MEMBER_REF_EXPR:
            return self.member(c)
        if k == K.ARRAY_SUBSCRIPT_EXPR:
            return f'{self.expr(ch[0])}[{self.expr(ch[1])}]'
        if k == K.CALL_EXPR:
            return self.call(c, want)
        if k == K.INTEGER_LITERAL or k == K.FLOATING_LITERAL:
            toks = self.p.tokens(c)
            s = toks[0].spelling if toks else '0'
            s = re.sub(r'(?<=[\d.])[fFlLuU]+$', '', s)
            s = re.sub(r'^(\d+)\.$', r'\1', s)
            s = re.sub(r'^(\d+)\.0+$', r'\1', s)
            s = re.sub(r'^\.', '0.', s)
            return s
        if k == K.CXX_BOOL_LITERAL_EXPR:
            toks = self.p.tokens(c)
            return toks[0].spelling if toks else 'false'
        if k in (K.STRING_LITERAL, K.CHARACTER_LITERAL):
            return self.p.text(c)
        if k == K.PAREN_EXPR:
            return f'({self.expr(ch[0], want)})'
        if k == K.CONDITIONAL_OPERATOR:
            return f'{self.cond(ch[0])} ? {self.expr(ch[1], want)} : {self.expr(ch[2], want)}'
        if k == K.UNARY_OPERATOR:
            op, fix = self.p.unary_op(c)
            if op == '!':
                return self.cond(c)
            if op == '&' and strip_parens_casts(ch[0]).kind == K.ARRAY_SUBSCRIPT_EXPR and canon(c.type).kind == T.POINTER and canon(canon(c.type).get_pointee()).kind in (T.FLOAT, T.DOUBLE):
                base, index = kids(strip_parens_casts(ch[0]))
                i = self.expr(index)
                return f'{self.expr(base)}.slice({i}, {i} + 3)' if i != '0' else f'{self.expr(base)}.slice(0, 3)'
            if op in ('*', '&'):
                return self.expr(ch[0], want)
            a = self.expr(ch[0])
            t0 = canon(ch[0].type)
            if op in ('++', '--') and t0.kind == T.POINTER and canon(t0.get_pointee()).kind == T.RECORD:
                return f'/*FIX pointer{op}*/ {a}{op}'
            if fix == 'postfix':
                return f'{a}{op}'
            return f'{op}{a}' if re.fullmatch(r'[\w.\[\]()]+', a) else f'{op}({a})'
        if k in (K.BINARY_OPERATOR, K.COMPOUND_ASSIGNMENT_OPERATOR):
            return self.binary(c, want)
        if k == K.INIT_LIST_EXPR:
            return '[' + ', '.join(self.expr(x) for x in ch) + ']'
        if k == K.CXX_THIS_EXPR:
            return 'this'
        if k == K.ARRAY_SUBSCRIPT_EXPR:
            return f'{self.expr(ch[0])}[{self.expr(ch[1])}]'
        return f'/*FIX {k.name}*/ {self.p.text(c)}'

    def note_import(self, ref, name):
        if ref is None or not ref.location.file or self.p.in_main(ref):
            return
        if ref.kind not in (K.FUNCTION_DECL, K.VAR_DECL, K.ENUM_CONSTANT_DECL, K.FUNCTION_TEMPLATE):
            return
        module = module_for(ref.location.file.name, self.p.root)
        if module:
            self.p.imports.setdefault(module, set()).add(name)

    def member(self, c):
        ch = kids(c)
        field = c.spelling
        if not ch:
            return f'this.{field}'
        base = ch[0]
        bt = canon(base.type)
        st = bt.get_pointee() if bt.kind == T.POINTER else bt
        sname = canon(st).get_declaration().spelling
        if sname in POOL:
            pool = POOL[sname]
            b = self.expr(base)
            if (pool, field) in VEC_FIELDS:
                self.helper(VEC_FIELDS[(pool, field)])
                return f'{VEC_FIELDS[(pool, field)]}(bm, {b})'
            if field == 'head':
                return b
            return f'bm.{pool}.{field}[{b}]'
        if sname == 'BMHeader':
            inner = strip(base)
            elem = self.expr(kids(inner)[0]) if inner.kind == K.MEMBER_REF_EXPR and kids(inner) else self.expr(base)
            return elem if field == 'index' else f'/*FIX head.{field}*/ {elem}'
        return f'{self.expr(base)}.{field}'

    def binary(self, c, want=None):
        ch = kids(c)
        op = self.p.binop(c)
        lhs, rhs = ch[0], ch[1]
        if op in ('&&', '||'):
            def side(x):
                s = self.cond(x)
                sx = strip_parens_casts(x)
                if sx.kind == K.BINARY_OPERATOR and self.p.binop(sx) in ('&&', '||') and self.p.binop(sx) != op:
                    return f'({unparen(s)})'
                return s
            return f'{side(lhs)} {op} {side(rhs)}'
        if op == '=':
            return self.assign(lhs, self.expr(rhs, lhs.type))
        if op in ('==', '!='):
            for a, b in ((lhs, rhs), (rhs, lhs)):
                if strip(b).kind in (K.CXX_NULL_PTR_LITERAL_EXPR, K.GNU_NULL_EXPR) or self.p.text(strip(b)) in ('nullptr', 'NULL'):
                    if pool_of(strip_parens_casts(a).type):
                        return f'{self.expr(a)} {"<" if op == "==" else ">="} 0'
                    return f'{self.expr(a)} {op}= null'
        lt = canon(lhs.type)
        if op in ('+', '-') and lt.kind == T.POINTER and canon(lt.get_pointee()).kind == T.RECORD:
            return f'/*FIX pointer{op}*/ {self.expr(lhs)} {op} {self.expr(rhs)}'
        if op == '+' and lt.kind == T.POINTER and canon(lt.get_pointee()).kind in (T.FLOAT, T.DOUBLE):
            off = self.expr(rhs)
            return f'{self.expr(lhs)}.slice({off}, {off} + 3)'
        s = f'{self.expr(lhs)} {OPS.get(op, op)} {self.expr(rhs)}'
        if op == '/' and is_int(lhs.type) and is_int(rhs.type) and is_int(c.type):
            return f'Math.trunc({s})'
        return s

    def assign(self, lhs, value, size=3):
        s = strip_parens_casts(lhs)
        if s.kind == K.UNARY_OPERATOR and self.p.unary_op(s)[0] == '&' and strip_parens_casts(kids(s)[0]).kind == K.ARRAY_SUBSCRIPT_EXPR:
            base, index = kids(strip_parens_casts(kids(s)[0]))
            return f'{self.expr(base)}.splice({self.expr(index)}, {size}, ...{value})'
        if s.kind == K.MEMBER_REF_EXPR and kids(s):
            base = kids(s)[0]
            bt = canon(base.type)
            st = bt.get_pointee() if bt.kind == T.POINTER else bt
            pool = POOL.get(canon(st).get_declaration().spelling)
            if pool and (pool, s.spelling) in VEC_FIELDS:
                return f'bm.{pool}.{s.spelling}.set({value}, {self.expr(base)} * 3)'
        return f'{self.expr(lhs)} = {value}'

    def call_args(self, c):
        return [a for a in c.get_arguments() if a.extent.start.offset != a.extent.end.offset or a.kind != K.UNEXPOSED_EXPR or kids(a)]

    def expr_statement(self, c):
        s = strip(c)
        if s.kind == K.CALL_EXPR:
            name = s.spelling
            args = self.call_args(s)
            if name in ('BLI_assert', 'UNUSED_VARS') or name.startswith('MEM_delete') or name in ('MEM_freeN', 'MEM_SAFE_FREE', 'BLI_memarena_free'):
                return None
            if name in OUT_FIRST and args:
                m = OUT_FIRST[name]
                if not callable(m):
                    self.helper(m)
                rest = [self.expr(a) for a in args[1:]]
                return self.assign(args[0], m(rest) if callable(m) else f'{m}({", ".join(rest)})', 2 if '_v2' in name else 4 if '_v4' in name else 3)
            if name in IN_OUT and args:
                self.helper(IN_OUT[name])
                return self.assign(args[0], f'{IN_OUT[name]}({", ".join(self.expr(a) for a in args)})')
            sig = self.p.sigs.get(name)
            if sig and any(p['out'] for p in sig['params']):
                self.statement_call = True
                call = self.call(s)
                self.statement_call = False
                targets = self.out_targets(sig, args)
                outs = [p for p in sig['params'] if p['out']]
                ret_kind = canon(sig['ret']).kind if not sig.get('lib') else None
                void = ret_kind == T.VOID
                if (void or ret_kind == T.BOOL) and len(outs) == 1:
                    return self.assign(targets[0], call) if targets and targets[0] is not None else call
                lhs = ', '.join(self.expr(t) if t is not None else '' for t in targets)
                return re.sub(r'(, )+\] =', '] =', f'[{"" if void else ", "}{lhs}] = {call}')
        return self.expr(c)

    def out_targets(self, sig, args):
        out = []
        for i, p in enumerate(sig['params']):
            if not p['out'] or i >= len(args):
                continue
            a = strip(args[i])
            if a.kind == K.UNARY_OPERATOR and self.p.unary_op(a)[0] == '&':
                a = kids(a)[0]
            out.append(None if a.kind in (K.CXX_NULL_PTR_LITERAL_EXPR, K.GNU_NULL_EXPR) else a)
        return out

    def call(self, c, want=None):
        name = c.spelling
        ref = c.referenced
        args = self.call_args(c)
        js = lambda xs: [self.expr(a) for a in xs]
        if ref is not None and ref.kind == K.CONSTRUCTOR:
            if name in ('float3', 'double3', 'float2', 'float4', 'int3', 'int2'):
                return '[' + ', '.join(js(args)) + ']'
            if not args:
                return zero_of(c.type) or '{}'
            if len(args) == 1:
                return self.expr(args[0], want)
            return f'/*FIX ctor {name}*/ {self.p.text(c)}'
        callee = kids(c)[0] if kids(c) else None
        if name.startswith('operator'):
            return self.operator_call(c, name)
        if callee is not None and strip(callee).kind == K.MEMBER_REF_EXPR:
            return self.method_call(strip(callee), name, args)
        if name in ('BLI_memarena_alloc', 'BLI_memarena_calloc', 'MEM_malloc_arrayN', 'MEM_calloc_arrayN', 'MEM_mallocN', 'MEM_callocN'):
            m = re.search(r'sizeof\((.*?)\)\s*\*\s*(.*)$', self.p.text(args[-1]), re.S) or re.search(r'^(.*?)\s*\*\s*sizeof', self.p.text(args[-1]), re.S)
            if m:
                count = (m.group(2) if m.lastindex == 2 else m.group(1)).strip()
                return f'new Array({count})'
            return '{}'
        if name == 'memcpy':
            return f'{self.expr(args[0])} = {self.expr(args[1])}.slice()'
        if name == 'ELEM':
            a = js(args)
            return '(' + ' || '.join(f'{a[0]} === {x}' for x in a[1:]) + ')'
        if name in ('SWAP_', 'swap'):
            a = js(args)
            return f'[{a[0]}, {a[1]}] = [{a[1]}, {a[0]}]'
        if name in ('len_v3v3', 'len_squared_v3v3'):
            a = js(args)
            fn = 'len_v3' if name == 'len_v3v3' else 'len_squared_v3'
            self.p.imports.setdefault('blenlib/math-geom.js', set()).update({fn, 'sub_v3'})
            return f'{fn}(sub_v3({a[0]}, {a[1]}))'
        if name == 'compare_ff':
            a = js(args)
            return f'Math.abs({a[0]} - {a[1]}) <= {a[2]}'
        if name in ('normalize_v3', 'normalize_v3_length') and not self.statement_call:
            v = self.expr(args[0])
            t = f'_r{self.temps}'
            self.temps += 1
            self.helper('len_v3')
            self.helper('normalize_v3')
            return f'({t} = len_v3({v}), {v} = normalize_v3({v}), {t})'
        m = re.match(r'^BM_ELEM_API_FLAG_(ENABLE|DISABLE|TEST)$', name)
        if m:
            pool = pool_of(strip_parens_casts(args[0]).type) or '/*FIX pool*/'
            self.helper(name)
            return f'{name}(bm.{pool}, {", ".join(js(args))})'
        if re.match(r'^BM_elem_flag_|^BM_elem_index_', name):
            pool = pool_of(strip_parens_casts(args[0]).type) or '/*FIX pool*/'
            if name == 'BM_elem_index_get':
                return self.expr(args[0])
            if name == 'BM_elem_index_set':
                return f'/*FIX index_set*/ {self.p.text(c)}'
            fn = name.replace('_bool', '')
            self.helper(fn)
            return f'{fn}(bm.{pool}, {", ".join(js(args))})'
        m = re.match(r'^BMO_(vert|edge|face)_flag_(test|enable|disable|set)(_bool)?$', name)
        if m:
            fn = f'BMO_flag_{m.group(2)}'
            self.helper(fn)
            return f'{fn}(bm.{m.group(1)[0]}, {", ".join(js(args[1:]))})'
        if name in OUT_FIRST or name in IN_OUT:
            m = OUT_FIRST.get(name) or IN_OUT.get(name)
            rest = js(args[1:] if name in OUT_FIRST else args)
            v = m(rest) if callable(m) else f'{m}({", ".join(rest)})'
            if not callable(m):
                self.helper(m)
            if name in OUT_FIRST and name.startswith('invert'):
                return f'({self.expr(args[0])} = {v})'
            return f'/*FIX {name} as value*/ {v}'
        sig = self.p.sigs.get(name)
        kept = [(i, a) for i, a in enumerate(args) if not (sig and i < len(sig['params']) and sig['params'][i]['out'] == 'out')]
        params = sig['params'] if sig else []
        arg_js = []
        for i, a in kept:
            sa = strip(a)
            if sa.kind == K.UNARY_OPERATOR and self.p.unary_op(sa)[0] == '&':
                sa = kids(sa)[0]
            arg_js.append(self.expr(sa, params[i]['type'] if i < len(params) and 'type' in params[i] else None))
        js_name = RENAME.get(name, name)
        if js_name != name:
            if js_name in sum(map(list, HELPER_MODULES.values()), []):
                self.helper(js_name)
        elif ref is not None:
            self.note_import(ref, name)
        if sig and sig.get('needs_bm'):
            arg_js.insert(0, 'bm')
        elif ref is not None and not (sig and not sig.get('lib')) and needs_mesh(ref):
            arg_js.insert(0, 'bm')
        call = f'{js_name}({", ".join(arg_js)})'
        if sig and any(p['out'] for p in sig['params']) and not self.statement_call:
            targets = [self.expr(t) if t is not None else '' for t in self.out_targets(sig, args)]
            ret_kind = canon(sig['ret']).kind if not sig.get('lib') else (T.BOOL if sig['ret'] == 'bool' else T.INT)
            if all(not t for t in targets):
                return call if ret_kind == T.VOID else f'{call}[0]' if len(targets) > 1 or ret_kind != T.BOOL else call
            if ret_kind == T.BOOL and len(targets) == 1:
                return f'({targets[0]} = {call}) != null'
            t = f'_r{self.temps}'
            self.temps += 1
            return f'(([{"" if ret_kind == T.VOID else t + ", "}{", ".join(targets)}] = {call}), {t})'
        return call

    def helper(self, name):
        for module, names in HELPER_MODULES.items():
            if name in names:
                self.p.imports.setdefault(module, set()).add(name)

    def operator_call(self, c, name):
        args = [a for a in kids(c) if not (strip(a).kind == K.DECL_REF_EXPR and strip(a).spelling.startswith('operator'))]
        op = name[len('operator'):]
        if op == '[]':
            return f'{self.expr(args[0])}[{self.expr(args[1])}]'
        if op == '=':
            return self.assign(args[0], self.expr(args[1]))
        if op in ('+', '-') and len(args) == 2:
            fn = 'add_v3' if op == '+' else 'sub_v3'
            self.helper(fn)
            return f'{fn}({self.expr(args[0])}, {self.expr(args[1])})'
        if op == '*' and len(args) == 2:
            self.helper('mul_v3_fl')
            a, b = args
            if canon(a.type).kind in (T.FLOAT, T.DOUBLE):
                a, b = b, a
            return f'mul_v3_fl({self.expr(a)}, {self.expr(b)})'
        return f'/*FIX {name}*/ {self.p.text(c)}'

    def method_call(self, callee, name, args):
        base = kids(callee)[0] if kids(callee) else None
        b = self.expr(base) if base is not None else 'this'
        a = [self.expr(x) for x in args]
        simple = {'append': 'push', 'remove_last': 'pop', 'add': None, 'add_new': None, 'lookup': 'get', 'contains': 'has',
                  'remove': 'delete', 'add_overwrite': 'set'}
        container = canon(base.type).get_declaration().spelling if base is not None else ''
        if name in ('size', 'index_range') and not args:
            return f'{b}.length' if container not in ('Map', 'Set') else f'{b}.size'
        if name == 'is_empty':
            return f'{b}.length === 0' if container not in ('Map', 'Set') else f'{b}.size === 0'
        if name == 'last':
            return f'{b}.at(-1)'
        if name == 'first':
            return f'{b}[0]'
        if name == 'clear':
            return f'{b}.length = 0' if container not in ('Map', 'Set') else f'{b}.clear()'
        if name in ('data', 'as_span', 'as_mutable_span'):
            return b
        if name == 'lookup_default':
            return f'({b}.get({a[0]}) ?? {a[1]})'
        if name in ('add', 'add_new', 'add_overwrite'):
            return f'{b}.{"add" if container == "Set" else "set"}({", ".join(a)})'
        if name in simple and simple[name]:
            return f'{b}.{simple[name]}({", ".join(a)})'
        return f'{b}.{name}({", ".join(a)})'


def wrap_local_macros(text, types):
    """The file's own function-like macros as template functions, so their call sites reach the AST as calls. Line
    numbers stay put."""
    names = []

    def repl(m):
        name, params, body = m.group(1), m.group(2), m.group(3)
        flat = re.sub(r'\\\n', ' ', body).strip()
        if not flat or ';' in flat or '#' in flat or re.match(r'^(do|if|for|while)\b', flat):
            return m.group(0)
        args = [a.strip() for a in params.split(',') if a.strip()]
        known = types.get(name)
        if known and len(known) == len(args):
            decl = f'inline auto {name}({", ".join(f"{t} {a}" for t, a in zip(known, args))}) {{ return ({flat}); }}'
        else:
            decl = f'template<{", ".join(f"class T{i}" for i in range(len(args)))}> inline auto {name}({", ".join(f"T{i} {a}" for i, a in enumerate(args))}) {{ return ({flat}); }}'
        names.append(name)
        return decl + '\n' * m.group(0).count('\n')
    return re.sub(r'^#define (\w+)\(([^)]*)\)((?:[^\n]*\\\n)*[^\n]*)', repl, text, flags=re.M), names


def strip(c):
    while c.kind == K.UNEXPOSED_EXPR and len(kids(c)) == 1:
        c = kids(c)[0]
    return c


def strip_parens_casts(c):
    while c.kind in (K.UNEXPOSED_EXPR, K.PAREN_EXPR, K.CSTYLE_CAST_EXPR) and kids(c):
        c = kids(c)[-1]
    return c


def needs_mesh(ref):
    """Whether the JS port of a BMesh API function takes bm first: Blender's takes elements, not the mesh."""
    if not ref.location.file or '/bmesh/' not in ref.location.file.name:
        return False
    params = list(ref.get_arguments())
    return not (params and decl_name(canon(params[0].type).get_pointee() if canon(params[0].type).kind == T.POINTER else params[0].type) == 'BMesh')


def module_for(path, root):
    rel = os.path.relpath(path, os.path.join(root, 'source/blender'))
    if rel.startswith('..'):
        return None
    for pattern, module in MODULE_FOR_SOURCE.items():
        if re.match(pattern, rel):
            return module
    d, base = os.path.split(rel)
    base = re.sub(r'(_inline|_private|_intern)?\.(hh|h|cc|c)$', '', base)
    base = re.sub(r'^BLI_', '', base)
    if d == 'bmesh':
        d = 'bmesh/intern'
    return f'{d}/{base.replace("_", "-")}.js'


def exported(module):
    path = os.path.join(REPO, 'src', module)
    if not os.path.exists(path):
        return None
    text = open(path).read()
    names = set(re.findall(r'^export (?:async )?(?:function\*? |class |const |let )(\w+)', text, re.M))
    for decl in re.findall(r'^export (?:const|let) ([^;]*)', text, re.M):
        depth, start = 0, 0
        for i, ch in enumerate(decl + ','):
            depth += ch in '([{' and 1 or ch in ')]}' and -1 or 0
            if ch == ',' and depth == 0:
                m = re.match(r'\s*(\w+)\s*=', decl[start:i])
                if m:
                    names.add(m.group(1))
                start = i + 1
    names |= set(n.split(' as ')[-1].strip() for group in re.findall(r'^export \{([^}]*)\}', text, re.M) for n in group.split(','))
    return names


def tidy(body):
    """`let x = <zero>;` whose next use is `x = value;` is declared there; declarations never reassigned are const."""
    lines = body.split('\n')
    i = 0
    while i < len(lines):
        m = re.match(r'^(\s*)let (\w+)(?: = (?:\[[0, ]*\]|-1|null|0|Array\.from\(.*\)|\{\}))?;$', lines[i])
        if m:
            pad, name = m.groups()
            word = re.compile(rf'\b{name}\b')
            j = next((k for k in range(i + 1, len(lines)) if word.search(lines[k])), -1)
            a = j > 0 and re.match(rf'^{re.escape(pad)}{name} = (.*);$', lines[j])
            if a and not word.search(a.group(1)):
                lines[j] = f'{pad}let {name} = {a.group(1)};'
                del lines[i]
                continue
        i += 1
    text = '\n'.join(lines)

    def const(m):
        pad, name, rest = m.groups()
        assigned = re.findall(rf'(?:^|[^.\w]){name}\s*(?:[-+*/%|&^]|<<|>>)?=(?!=)|\b{name}(?:\+\+|--)|(?:\+\+|--){name}\b|(?:^\s*|\()\[[^\]=]*\b{name}\b[^\]=]*\] =(?!=)|for \(\[?[^;]*\b{name}\b[^;]* of ', text, re.M)
        return m.group(0) if len(assigned) > 1 else f'{pad}const {name}{rest}'
    return re.sub(r'^(\s*)let (\w+)( = .*;)$', const, text, flags=re.M)


def main():
    src_root, rel, *names = sys.argv[1:]
    port = Port(src_root, rel)
    functions = port.port(set(names) or None)
    lines = []
    missing = []
    for module in sorted(port.imports):
        names_ = sorted(port.imports[module])
        have = exported(module)
        if have is not None:
            missing += [f'{n} ({module})' for n in names_ if n not in have]
        target = os.path.relpath(os.path.join(REPO, 'src', module), os.path.join(REPO, 'src', os.path.dirname(module_for(os.path.join(port.root, rel), port.root))))
        lines.append(f"import {{ {', '.join(names_)} }} from '{target if target.startswith('.') else './' + target}';")
    if missing:
        lines.append('// Not ported yet: ' + ', '.join(missing))
    scope = [] if names else port.file_scope()
    print('\n'.join(lines) + '\n\n' + ('\n'.join(scope) + '\n\n' if scope else '') + '\n\n'.join(functions))
    fixes = sum(f.count('/*FIX') for f in functions)
    print(f'{len(functions)} functions, {fixes} FIX marks, {len(missing)} missing imports', file=sys.stderr)


if __name__ == '__main__':
    main()
