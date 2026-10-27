"""Ports Blender C++ functions to JS through Clang's AST; port.py drives it. The conventions:
- BMesh elements are indices into bm's pools (-1 for none): `e->v1` is `bm.e.v1[e]`, `v->co` is `vco(bm, v)`, an
  element's embedded struct field `e->v1_disk_link.next` is `bm.e.v1_disk_link_next[e]`.
- Vectors are [x, y, z] arrays used as values: `copy_v3_v3(a, b)` is `a = [...b]`, `add_v3_v3v3(r, a, b)` is
  `r = add_v3(a, b)`. Matrices are arrays of columns.
- Out parameters (r_* pointers and arrays, vector arrays the function writes, pointers to pointers it assigns through)
  are returned: alone from a void function with one, the out or null from a bool function with one, else
  [return value, ...outs] in parameter order. Callers destructure them.
- Iterators are the arrays of bmesh-query.js: `BM_ITER_ELEM (e, &iter, v, BM_EDGES_OF_VERT)` is
  `for (e of BM_EDGES_OF_VERT(bm, v))`.
- Functions that use the mesh take `bm` first unless they have `bm` or `bp` (`const { bm } = bp`). Blender's overloads
  per element type are one JS function taking the element's pool first.
Layout and parentheses are Prettier's (js.mjs), `const` is ESLint's. Whatever has no mapping is marked `/*FIX*/`.

Needs Clang 18 with its Python bindings (`pip install libclang==18.1.1`), the Blender sources of the ported tag
(`git archive v5.2.3 source/blender intern extern | tar -x -C SRC`) and fmt and Eigen headers.
Inspect one file: tools/blender-port/convert.py SRC source/blender/bmesh/intern/bmesh_query.cc [FUNCTION ...]
"""
import json
import os
import re
import struct
import subprocess
import sys

import clang.cindex as ci

import clangx
from rules import (INTEGER_WRAPPERS, ALLOCATORS, ARRAY_TYPES, CONSTANTS, DROPPED_CALL_PREFIXES, DROPPED_CALLS, DROPPED_FIELDS, DROPPED_TYPES,
                   HEADER_FIELDS, HELPER_MODULES, HTYPE, IN_OUT, METHODS, MODULE_FOR_SOURCE, OUT_FIRST, POOL, PRELUDE_HOMES,
                   PRELUDE_NEEDS_BM, RENAME, VEC_FIELDS, VECTOR_CONSTRUCTORS)

K = ci.CursorKind
T = ci.TypeKind
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
PRELUDE = os.path.join(HERE, 'prelude.hh')
INCLUDES = ['blenlib', 'bmesh', 'makesdna', 'blenkernel', 'blentranslation', 'makesrna', 'imbuf', 'gpu', 'geometry',
            'functions', 'editors/include', '']
NULLS = (K.CXX_NULL_PTR_LITERAL_EXPR, K.GNU_NULL_EXPR)
NESTING = (K.IF_STMT, K.FOR_STMT, K.WHILE_STMT, K.DO_STMT, K.SWITCH_STMT, K.CONDITIONAL_OPERATOR, K.CXX_FOR_RANGE_STMT)
OPS = {'==': '===', '!=': '!=='}


# --- types

def canon(t):
    """The canonical type, through references: a `T &` is used as a T."""
    t = t.get_canonical()
    return t.get_pointee().get_canonical() if t.kind in (T.LVALUEREFERENCE, T.RVALUEREFERENCE) else t


def decl_name(t):
    return canon(t).get_declaration().spelling


def pointee(t):
    t = canon(t)
    return canon(t.get_pointee()) if t.kind == T.POINTER else None


def pool_of(t):
    p = pointee(t)
    return POOL.get(p.get_declaration().spelling) if p is not None else None


def is_float(t):
    return canon(t).kind in (T.FLOAT, T.DOUBLE)


def is_int(t):
    return canon(t).kind in (T.INT, T.UINT, T.SHORT, T.USHORT, T.LONG, T.ULONG, T.LONGLONG, T.ULONGLONG, T.CHAR_S, T.UCHAR,
                             T.SCHAR, T.CHAR_U, T.BOOL, T.ENUM)


def is_record_pointer(t):
    p = pointee(t)
    return p is not None and p.kind == T.RECORD


def is_float_array(t):
    t = canon(t)
    return t.kind == T.CONSTANTARRAY and is_float(t.element_type)


def zero_of(t):
    """The JS of a default-initialized value of type t, or None when it has none."""
    t = canon(t)
    if t.kind == T.CONSTANTARRAY:
        inner = zero_of(t.element_type)
        if inner is None:
            return f'new Array({t.element_count})'
        if canon(t.element_type).kind == T.CONSTANTARRAY:
            return f'Array.from({{ length: {t.element_count} }}, () => {inner})'
        return f'[{", ".join([inner] * t.element_count)}]'
    if t.kind == T.BOOL:
        return 'false'
    if is_float(t) or is_int(t):
        return '0'
    if t.kind == T.POINTER:
        return '-1' if pool_of(t) else 'null'
    name = t.get_declaration().spelling
    if name in ARRAY_TYPES:
        return '[]'
    if name in ('Map', 'Set'):
        return f'new {name}()'
    if t.kind == T.RECORD:
        # Every field set, so objects of one struct share a shape.
        fields = [f'{f.spelling}: {zero_of(f.type) or "null"}' for f in t.get_fields() if f.spelling]
        return '{ ' + ', '.join(fields + ['$a: null', '$i: 0']) + ' }'
    return None


TYPED_ARRAYS = {T.FLOAT: 'Float32Array', T.DOUBLE: 'Float64Array', T.INT: 'Int32Array', T.UINT: 'Uint32Array', T.SHORT: 'Int16Array',
                T.USHORT: 'Uint16Array', T.CHAR_S: 'Int8Array', T.SCHAR: 'Int8Array', T.UCHAR: 'Uint8Array', T.CHAR_U: 'Uint8Array',
                T.LONG: 'Int32Array', T.ULONG: 'Uint32Array'}


def buffer_of(elem, count, helper):
    """A heap buffer of count elements of type elem: a typed array for numbers, objects of one shape for structs."""
    t = canon(elem)
    if t.kind in TYPED_ARRAYS:
        return f'new {TYPED_ARRAYS[t.kind]}({count})'
    zero = zero_of(t)
    if t.kind == T.RECORD:
        return f'{helper("structs")}({count}, () => ({zero}))'
    if t.kind == T.CONSTANTARRAY and zero is not None:
        return f'Array.from({{ length: {count} }}, () => {zero})'
    return f'new Array({count}).fill({zero})' if zero is not None else f'new Array({count})'


def fill_value(elem, byte):
    """The element value memset's byte gives a buffer of elem."""
    t = canon(elem)
    size = t.get_size()
    value = int.from_bytes(bytes([byte & 0xFF]) * size, 'little', signed=t.kind in (T.INT, T.SHORT, T.CHAR_S, T.SCHAR, T.LONG, T.LONGLONG))
    return str(value) if t.kind in TYPED_ARRAYS or is_int(t) else ('0' if byte == 0 else None)


# --- cursors

def kids(c):
    return [k for k in c.get_children() if k.kind not in (K.TYPE_REF, K.TEMPLATE_REF, K.NAMESPACE_REF)]


def strip(c):
    """c without the implicit nodes Clang wraps around it."""
    while c.kind == K.UNEXPOSED_EXPR and len(kids(c)) == 1:
        c = kids(c)[0]
    return c


def strip_parens_casts(c):
    while c.kind in (K.UNEXPOSED_EXPR, K.PAREN_EXPR, K.CSTYLE_CAST_EXPR) and kids(c):
        c = kids(c)[-1]
    return c


def arguments(call):
    """A call's arguments as written: default arguments (no source location in Clang) are left to the callee."""
    return [a for a in call.get_arguments() if not (a.kind == K.UNEXPOSED_EXPR and a.extent.start.file is None and not kids(a))]


UNSIGNED = (T.UINT, T.ULONG, T.USHORT, T.UCHAR, T.CHAR_U)


def unsigned(t, js):
    """js wrapped around to the unsigned type t, as C converts and subtracts."""
    bits = canon(t).get_size() * 8
    return f'(({js}) >>> 0)' if bits == 32 else f'(({js}) & {(1 << bits) - 1})'


def is_struct_value(t):
    return canon(t).kind == T.RECORD and decl_name(t) not in ARRAY_TYPES | {'Map', 'Set'}


def record_fields(t):
    return [f.spelling for f in canon(t).get_fields() if f.spelling]


def dropped(t):
    """Whether values of type t have no JS counterpart (iterators, memory arenas), as such or pointed to."""
    t = canon(t)
    return t.get_declaration().spelling in DROPPED_TYPES or (pointee(t) is not None and pointee(t).get_declaration().spelling in DROPPED_TYPES)


def is_null(c):
    return strip_parens_casts(c).kind in NULLS


def refs_to(c, decl):
    """How many times c refers to the declaration decl."""
    return sum(1 for x in c.walk_preorder() if x.kind == K.DECL_REF_EXPR and x.referenced is not None and x.referenced.hash == decl.hash)


def is_unary(c, op):
    return c.kind == K.UNARY_OPERATOR and clangx.unary_operator(c)[0] == op


def is_binary(c, *ops):
    return c.kind in (K.BINARY_OPERATOR, K.COMPOUND_ASSIGNMENT_OPERATOR) and clangx.binary_operator(c) in ops


def address_of(c):
    """The operand of `&x`, or None."""
    s = strip(c)
    return kids(s)[0] if is_unary(s, '&') else None


def element_overload(ref):
    """Whether ref is one of Blender's overloads per element type, which the port joins into one function taking the
    element's pool first."""
    if ref is None or ref.kind != K.FUNCTION_DECL or ref.semantic_parent is None:
        return False
    key = (ref.spelling, ref.semantic_parent.hash)
    if key not in _overloads:
        same = [c for c in ref.semantic_parent.get_children() if c.kind == K.FUNCTION_DECL and c.spelling == ref.spelling]
        pools = {pool_of(a.type) for c in same for a in c.get_arguments()} - {None}
        _overloads[key] = len(same) > 1 and len(pools) > 1
    return _overloads[key]


_overloads = {}


def is_prelude(ref):
    return bool(ref is not None and ref.location.file and ref.location.file.name == PRELUDE)


def needs_mesh(ref):
    """Whether the JS port of a BMesh API function takes bm first: Blender's takes elements, not the mesh."""
    if ref.spelling in PRELUDE_NEEDS_BM:
        return True
    if not ref.location.file or '/source/blender/bmesh/' not in ref.location.file.name:
        return False
    params = list(ref.get_arguments())
    first = pointee(params[0].type) if params else None
    return not (first is not None and first.get_declaration().spelling == 'BMesh')


def module_for(path, root):
    """The Bylonder module that ports a Blender source file: kebab case, without the BLI_/BKE_/DNA_ prefix."""
    rel = os.path.relpath(path, os.path.join(root, 'source/blender'))
    if rel.startswith('..'):
        return None
    for pattern, module in MODULE_FOR_SOURCE.items():
        if re.match(pattern, rel):
            return module
    d, base = os.path.split(rel)
    if d.split('/')[0] in ('blenlib', 'blenkernel') and d.endswith('/intern'):
        d = d[:-len('/intern')]
    if d == 'bmesh':
        d = 'bmesh/intern'
    base = re.sub(r'^(BLI|BKE|DNA)_', '', os.path.splitext(base)[0].removesuffix('_inline'))
    return f'{d}/{base.replace("_", "-")}.js'


# --- parsing

class Source:
    """One Blender source file parsed by Clang, with the prelude after its includes and its own function-like
    macros turned into functions."""

    def __init__(self, root, rel, registry=None, float32=False):
        self.root = os.path.abspath(root)
        self.rel = rel
        # Exact float arithmetic: C rounds every float operation to 32 bits, JS computes in doubles.
        self.float32 = float32
        self.registry = registry if registry is not None else {}
        path = os.path.join(self.root, rel)
        self.original = open(path).read()
        self.tmp = os.path.join(os.path.dirname(path), '.port_' + os.path.basename(path))
        resource = subprocess.run(['clang', '-print-resource-dir'], capture_output=True, text=True).stdout.strip()
        self.args = ['-std=c++20', '-x', 'c++', f'-resource-dir={resource}', '-Wno-c++11-narrowing', '-I/usr/include/eigen3']
        self.args += [f'-I{os.path.join(self.root, "source/blender", d)}' for d in INCLUDES]
        self.args += [f'-I{os.path.join(self.root, d)}' for d in ('intern/guardedalloc', 'intern/atomic', 'intern/eigen', 'intern/profile', 'extern/fast_float', 'extern/xxhash')]
        plain = self.parse(self.original)
        includes = [c for c in plain.cursor.get_children() if c.kind == K.INCLUSION_DIRECTIVE and self.in_main(c)]
        self.prelude_line = max((c.extent.end.line for c in includes), default=0)
        bodies = [(f.extent.start.offset, f.extent.end.offset) for f in plain.cursor.walk_preorder()
                  if f.kind in (K.FUNCTION_DECL, K.FUNCTION_TEMPLATE) and f.is_definition() and self.in_main(f)]
        self.local_macro_lines = {c.extent.start.line for c in plain.cursor.get_children() if c.kind == K.MACRO_DEFINITION
                                  and self.in_main(c) and any(start <= c.extent.start.offset < end for start, end in bodies)}
        # File-scope macros only: one defined inside a function uses its locals.
        macros = [c for c in plain.cursor.get_children() if c.kind == K.MACRO_DEFINITION and self.in_main(c) and clangx.is_function_like(c)
                  and not any(start <= c.extent.start.offset < end for start, end in bodies)]
        self.local_macros = {m.spelling: self.macro_parts(m) for m in macros}
        self.local_macros = {n: p for n, p in self.local_macros.items() if p}
        self.tu = self.parse(self.prepared({}))
        if self.local_macros:
            # Again with each macro's parameter types taken from its first call, so its body ports like a function.
            types, assigned = {}, set()
            for c in self.tu.cursor.walk_preorder():
                if c.kind == K.CALL_EXPR and c.spelling in self.local_macros and c.spelling not in types and self.in_main(c):
                    types[c.spelling] = [canon(a.type).spelling for a in c.get_arguments()]
                if is_binary(c, '=') and strip_parens_casts(kids(c)[0]).kind == K.CALL_EXPR:
                    assigned.add(strip_parens_casts(kids(c)[0]).spelling)
            # A macro written to stays a macro: its expansion is an lvalue the converter ports as such.
            self.local_macros = {n: m for n, m in self.local_macros.items() if n not in assigned}
            self.tu = self.parse(self.prepared(types))
        os.remove(self.tmp)
        for d in [d for d in self.tu.diagnostics if d.severity >= 3][:10]:
            print(f'clang: {d}', file=sys.stderr)
        self.macros = {}
        for c in self.tu.cursor.get_children():
            if c.kind == K.MACRO_INSTANTIATION and self.in_main(c):
                self.macros[(c.extent.start.offset, c.extent.end.offset)] = (c.spelling, c.referenced)
        self.functions = [c for c in self.tu.cursor.walk_preorder() if c.kind in (K.FUNCTION_DECL, K.FUNCTION_TEMPLATE) and c.is_definition() and self.in_main(c)]
        self.sigs = {}
        for f in self.functions:
            self.sigs[f.spelling] = self.signature(f)
            self.registry[f.spelling] = self.sigs[f.spelling]

    def parse(self, text):
        self.text_of_tu = text
        open(self.tmp, 'w').write(text)
        return ci.Index.create().parse(self.tmp, args=self.args, options=ci.TranslationUnit.PARSE_DETAILED_PROCESSING_RECORD)

    def macro_parts(self, m):
        """(lines, parameters, body) of an expression-like macro definition, or None."""
        toks = list(m.get_tokens())
        close = next((i for i, t in enumerate(toks) if t.spelling == ')'), None)
        body = toks[close + 1:] if close is not None else []
        if not body or any(t.spelling in (';', '#', '##') for t in body) or body[0].spelling in ('do', 'if', 'for', 'while', 'switch'):
            return None
        params = [t.spelling for t in toks[2:close] if t.spelling != ',']
        text = self.original[body[0].extent.start.offset:body[-1].extent.end.offset]
        return (m.extent.start.line, m.extent.end.line), params, re.sub(r'\\\n', ' ', text)

    def prepared(self, types):
        """The source with the prelude after its includes, and its macros as functions."""
        lines = self.original.split('\n')
        for name, ((first, last), params, body) in self.local_macros.items():
            known = types.get(name)
            if known and len(known) == len(params):
                decl = f'inline auto {name}({", ".join(f"{t} {p}" for t, p in zip(known, params))}) {{ return ({body}); }}'
            else:
                head = ', '.join(f'class T{i}' for i in range(len(params)))
                decl = f'template<{head}> inline auto {name}({", ".join(f"T{i} {p}" for i, p in enumerate(params))}) {{ return ({body}); }}'
            lines[first - 1:last] = [decl] + [''] * (last - first)
        lines.insert(self.prelude_line, f'#include "{PRELUDE}"')
        return '\n'.join(lines)

    def in_main(self, c):
        return bool(c.location.file) and c.location.file.name == self.tmp

    def text(self, c):
        if self.in_main(c):
            return self.text_of_tu[c.extent.start.offset:c.extent.end.offset]
        if not c.location.file:
            return c.spelling
        return open(c.location.file.name, errors='replace').read()[c.extent.start.offset:c.extent.end.offset]

    def sig_of(self, name):
        return self.sigs.get(name) or self.registry.get(name)

    def find(self, name):
        return next((f for f in self.functions if f.spelling == name), None)

    def definition(self, name, rel):
        """The definition of name in the file rel (this file or a header it includes), with its signature known."""
        if not hasattr(self, 'definitions'):
            self.definitions = {}
            for c in self.tu.cursor.walk_preorder():
                if c.kind in (K.FUNCTION_DECL, K.FUNCTION_TEMPLATE) and c.is_definition() and c.location.file:
                    self.definitions.setdefault((c.spelling, os.path.relpath(c.location.file.name, self.root).replace('/.port_', '/')), c)
        f = self.definitions.get((name, rel))
        if f is not None and f.spelling not in self.sigs:
            self.sigs[f.spelling] = self.registry[f.spelling] = self.signature(f)
        return f

    # --- out parameters

    def signature(self, f):
        params = [{'name': p.spelling, 'type': p.type, 'cursor': p} for p in f.get_arguments()]
        body = next((k for k in f.get_children() if k.kind == K.COMPOUND_STMT), None)
        for p in params:
            p['out'] = self.out_kind(p, body) if body is not None else None
        return {'ret': canon(f.result_type), 'params': params}

    def out_kind(self, p, body):
        t = canon(p['type'])
        named = re.match(r'^(r|ret)_|^r$', p['name'] or '')
        events = []

        def visit(c, parents):
            if c.kind == K.DECL_REF_EXPR and c.referenced is not None and c.referenced.hash == p['cursor'].hash:
                kind = self.use_kind(c, parents)
                nested = any(x.kind in NESTING for x in parents)
                events.append(('nested ' if nested and kind.endswith('write') else '') + kind)
            for k in c.get_children():
                visit(k, parents + [c])
        visit(body, [])
        events = [e for e in events if e not in ('test', 'rebind')]
        target = pointee(t)
        writes = any(e.endswith('write') for e in events)
        whole = any(e in ('write', 'nested write') for e in events)
        # A fixed array parameter (`float r_co[3]`) is a value: an output when written. A pointer is an output when
        # the function writes all of what it points to (`*r_len = n`, copy_v3_v3(r_co, ...)); one it only fills
        # element by element (`r_tris[i][0] = ...`) is a buffer the caller provides, as in C.
        if t.kind == T.CONSTANTARRAY:
            if not writes:
                return None
        elif target is None or target.kind == T.CONSTANTARRAY or not whole:
            return None
        # An r_ parameter is an output unless read before written; any other is one only when first written
        # unconditionally, at the top of the function.
        first = events[0] if events else 'write'
        if 'read' not in events or first in ('write', 'element write') or (named and first.endswith('write')):
            return 'out'
        return 'inout'

    def use_kind(self, ref, parents):
        """'write' (of what the parameter holds or points to), 'element write', 'rebind' (a pointer parameter set to
        point elsewhere), 'read' or 'test' (an optional out parameter's null check) for one use."""
        chain = [ref] + parents[::-1]
        up = lambda i, kinds: next((j for j in range(i, len(chain)) if not (chain[j].kind in kinds)), len(chain))
        i = up(1, (K.UNEXPOSED_EXPR, K.PAREN_EXPR))
        parent = chain[i] if i < len(chain) else None
        child = chain[i - 1]
        if parent is None:
            return 'read'
        writes_to = lambda node, at: at is not None and is_binary(at, '=') and kids(at)[0].hash == node.hash
        if parent.kind == K.UNARY_OPERATOR and clangx.unary_operator(parent)[0] in ('*', '&'):
            j = up(i + 1, (K.UNEXPOSED_EXPR, K.PAREN_EXPR))
            grand = chain[j] if j < len(chain) else None
            if writes_to(chain[j - 1], grand):
                return 'write'
            return self.call_use(grand, chain[j - 1]) if grand is not None and grand.kind == K.CALL_EXPR else 'read'
        if parent.kind == K.ARRAY_SUBSCRIPT_EXPR:
            # Up through m[i][j] and &m[i]: a write into the array is a write of the parameter.
            j = i
            while j < len(chain) and (chain[j].kind in (K.ARRAY_SUBSCRIPT_EXPR, K.UNEXPOSED_EXPR, K.PAREN_EXPR) or is_unary(chain[j], '&')):
                j += 1
            grand = chain[j] if j < len(chain) else None
            if writes_to(chain[j - 1], grand):
                return 'element write'
            if grand is not None and grand.kind == K.CALL_EXPR:
                return 'element write' if self.call_use(grand, chain[j - 1]) == 'write' else 'read'
            return 'read'
        pointer = canon(ref.type).kind == T.POINTER
        if writes_to(child, parent):
            return 'rebind' if pointer else 'write'
        if pointer and (is_binary(parent, '&&', '||', '!=', '==') or parent.kind in (K.IF_STMT, K.CONDITIONAL_OPERATOR)):
            return 'test'
        if parent.kind == K.CALL_EXPR:
            return self.call_use(parent, child)
        return 'read'

    def call_use(self, call, arg):
        index = next((n for n, a in enumerate(call.get_arguments()) if a.hash == arg.hash), -1)
        if index == 0 and call.spelling in OUT_FIRST:
            return 'write'
        sig = self.sig_of(call.spelling) if hasattr(self, 'sigs') else None
        if sig and 0 <= index < len(sig['params']) and sig['params'][index]['out'] == 'out':
            return 'write'
        return 'read'

    # --- emission

    def emit(self, f):
        """The JS of f, and what it uses: ('function', name, cursor), ('constant', name, cursor or JS value) and
        ('helper', name, module)."""
        fp = FunctionPort(self, f)
        try:
            return fp.emit(), fp.deps
        except Exception as error:  # A converter bug in one function leaves the C++ for porting by hand.
            message = json.dumps(f'{f.spelling}: the converter failed ({type(error).__name__}: {error})')
            return f'function {f.spelling}() {{\n  throw new Error({message}); /*FIX converter*/\n}}\n/*\n{self.text(f)}\n*/', fp.deps


class FunctionPort:
    def __init__(self, source, f, sig=None):
        self.p, self.f = source, f
        self.sig = sig or source.sigs[f.spelling]
        self.temps = 0
        self.statement_call = False
        self.uses_bm = False
        self.deps = set()

    def temp(self):
        name = f'_r{self.temps}'
        self.temps += 1
        return name

    @property
    def bm(self):
        self.uses_bm = True
        return 'bm'

    def emit(self):
        sig = self.sig
        params = [p['name'] + self.default_of(i) for i, p in enumerate(sig['params']) if p['out'] != 'out']
        outs = [p for p in sig['params'] if p['out'] == 'out']
        body = next(k for k in self.f.get_children() if k.kind == K.COMPOUND_STMT)
        lines = self.block_lines(body, [(f'let {p["name"]}{self.out_init(p)};', p['cursor']) for p in outs])
        statements = list(body.get_children())
        if self.outs() and canon(sig['ret']).kind == T.VOID and not (statements and statements[-1].kind == K.RETURN_STMT):
            lines.append(f'{self.return_outs(None)};')
        prologue = []
        if self.uses_bm and not {'bm', 'bp'} & {p['name'] for p in sig['params']}:
            params.insert(0, 'bm')
            sig['needs_bm'] = True
        elif self.uses_bm and 'bm' not in params:
            prologue.append('const { bm } = bp;')
        sig['emitted'] = True
        if self.temps:
            prologue.append('let ' + ', '.join(f'_r{i}' for i in range(self.temps)) + ';')
        return f'function {self.f.spelling}({", ".join(params)}) {{\n' + '\n'.join(prologue + lines) + '\n}'

    def default_of(self, index):
        """` = value` for a parameter Blender's declaration gives a default, else ''."""
        decl = self.f.canonical
        params = list(decl.get_arguments()) if decl is not None else []
        if index >= len(params):
            return ''
        p = params[index]
        level, equals = 0, None
        for t in p.get_tokens():
            level += t.spelling in ('(', '[', '{', '<') and 1 or t.spelling in (')', ']', '}', '>') and -1 or 0
            if t.spelling == '=' and level == 0:
                equals = t.extent.end.offset
                break
        value = next((x for x in kids(p) if equals is not None and x.extent.start.offset >= equals), None)
        return f' = {self.expr(value, p.type)}' if value is not None else ''

    def out_init(self, p):
        t = canon(p['type'])
        if t.kind == T.CONSTANTARRAY:
            return f' = {zero_of(t)}'
        pt = pointee(t)
        if pt is None or is_int(pt) or is_float(pt):
            return ''
        if pt.kind == T.POINTER:
            return ' = -1' if pool_of(pt) else ''
        return ' = []'

    def outs(self):
        return [p for p in self.sig['params'] if p['out']]

    def return_outs(self, value):
        outs = [p['name'] for p in self.outs()]
        kind = canon(self.sig['ret']).kind
        if kind == T.VOID:
            return f'return {outs[0] if len(outs) == 1 else "[" + ", ".join(outs) + "]"}'
        if kind == T.BOOL and len(outs) == 1:
            return f'return {outs[0]}' if value == 'true' else 'return null' if value == 'false' else f'return ({value}) ? {outs[0]} : null'
        return f'return [{value}, {", ".join(outs)}]'

    # --- statements

    def block_lines(self, compound, declared=()):
        """A block's statements, after the declarations `declared` [(JS, cursor)]. A variable declared without a
        value whose first use writes all of it is declared there instead."""
        lines, pending = [], {}

        def declare(js, var):
            lines.append(js)
            if js.startswith('let '):
                pending[var.hash] = (len(lines) - 1, var)
        for js, var in declared:
            declare(js, var)
        for s in compound.get_children():
            if s.kind == K.DECL_STMT:
                for v in kids(s):
                    if v.kind == K.VAR_DECL:
                        js = self.declaration_of(v)
                        if js is not None:
                            declare(js, v) if clangx.var_init(v) is None else lines.append(js)
                continue
            emitted = self.stmt(s)
            folded = self.fold(s, emitted, pending, lines)
            if folded or emitted:
                lines.append(folded or emitted)
            for key, (_, v) in list(pending.items()):
                if refs_to(s, v):
                    del pending[key]
        return [line for line in lines if line is not None]

    def fold(self, s, emitted, pending, lines):
        """`let x;` then `x = value;` as `let x = value;`, when the statement uses x only as what it writes."""
        if not emitted or '\n' in emitted:
            return None
        for key, (index, v) in pending.items():
            if refs_to(s, v) == 1 and emitted.startswith(f'{v.spelling} = ') and emitted.endswith(';'):
                lines[index] = None
                del pending[key]
                return f'let {emitted}'
        return None

    def body(self, c):
        if c.kind == K.COMPOUND_STMT:
            return '{\n' + '\n'.join(self.block_lines(c)) + '\n}'
        s = self.stmt(c)
        return '{\n' + (s or '') + '\n}'

    def stmt(self, c):
        k = c.kind
        ch = kids(c)
        if k == K.COMPOUND_STMT:
            return self.body(c)
        if k == K.DECL_STMT:
            return '\n'.join(self.declaration(c)) or None
        if k == K.RETURN_STMT:
            value = self.expr(ch[0], canon(self.sig['ret'])) if ch else None
            if self.outs():
                return f'{self.return_outs(value)};'
            return f'return{" " + value if value is not None else ""};'
        if k == K.IF_STMT:
            ch = [x for x in ch if x.kind != K.VAR_DECL]
            cond = self.cond(ch[0])
            if cond == 'true' and len(ch) == 2:
                return '\n'.join(self.block_lines(ch[1])) if ch[1].kind == K.COMPOUND_STMT else self.stmt(ch[1])
            s = f'if ({cond}) {self.body(ch[1])}'
            if len(ch) > 2:
                s += ' else ' + (self.stmt(ch[2]) if ch[2].kind == K.IF_STMT else self.body(ch[2]))
            return s
        if k == K.WHILE_STMT:
            return f'while ({self.cond(ch[0])}) {self.body(ch[1])}'
        if k == K.DO_STMT:
            return f'do {self.body(ch[0])} while ({self.cond(ch[1])});'
        if k == K.FOR_STMT:
            return self.for_stmt(c)
        if k == K.CXX_FOR_RANGE_STMT:
            var = next(x for x in ch if x.kind == K.VAR_DECL)
            rng = strip([x for x in ch if x.kind != K.VAR_DECL][-2])
            if rng.kind == K.CALL_EXPR and rng.spelling == 'index_range' and kids(rng) and kids(kids(rng)[0]):
                n = var.spelling
                return f'for (let {n} = 0; {n} < {self.expr(kids(kids(rng)[0])[0])}.length; {n}++) {self.body(ch[-1])}'
            return f'for (const {var.spelling} of {self.expr(rng)}) {self.body(ch[-1])}'
        if k == K.BREAK_STMT:
            return 'break;'
        if k == K.CONTINUE_STMT:
            return 'continue;'
        if k == K.NULL_STMT:
            return None
        if k == K.SWITCH_STMT:
            cases = kids(ch[-1]) if ch[-1].kind == K.COMPOUND_STMT else [ch[-1]]
            return f'switch ({self.expr(ch[0])}) {{\n' + '\n'.join(line for x in cases for line in self.case(x)) + '\n}'
        if k in (K.CASE_STMT, K.DEFAULT_STMT):
            return '\n'.join(self.case(c))
        s = self.expr_statement(c)
        return f'{s};' if s else None

    def case(self, c):
        if c.kind == K.CASE_STMT:
            value, rest = kids(c)
            return [f'case {self.expr(value)}:'] + self.case(rest)
        if c.kind == K.DEFAULT_STMT:
            return ['default:'] + self.case(kids(c)[0])
        s = self.stmt(c)
        return [s] if s else []

    def for_slots(self, c):
        """(init, cond, inc) of a for statement; Clang leaves out empty ones, so the `;` tokens place the rest."""
        semis, level = [], 0
        for t in c.get_tokens():
            if t.spelling == '(':
                level += 1
            elif t.spelling == ')':
                level -= 1
                if level == 0:
                    break
            elif t.spelling == ';' and level == 1:
                semis.append(t.extent.start.offset)
        slots = [None, None, None]
        if len(semis) == 2:
            for x in kids(c)[:-1]:
                o = x.extent.start.offset
                slots[0 if o < semis[0] else 1 if o < semis[1] else 2] = x
        return slots

    def for_stmt(self, c):
        ch = kids(c)
        body = ch[-1]
        it = next((x for x in ch[:-1] if x.kind == K.DECL_STMT and any(v.spelling == 'bl_port_it' for v in kids(x))), None)
        if it is not None:
            rest = [x for x in ch[:-1] if x.hash != it.hash]
            nexts = [x for x in rest if strip(x).kind == K.CALL_EXPR and strip(x).spelling == 'next']
            incs = [x for x in rest if x not in nexts]
            var = next(v for v in kids(it) if v.spelling == 'bl_port_it')
            return self.iter_loop(var, nexts[0] if nexts else None, incs[0] if incs else None, body)
        init, cond, inc = self.for_slots(c)
        init_js = '' if init is None else ' '.join(self.declaration(init)).rstrip(';') if init.kind == K.DECL_STMT else self.expr_statement(init)
        cond_js = self.cond(cond) if cond is not None else ''
        inc_js = self.expr(inc) if inc is not None else ''
        return f'for ({init_js}; {cond_js}; {inc_js}) {self.body(body)}'

    def element(self, pointer, offset):
        """The struct `offset` elements from where pointer points: struct arrays are objects that know their array
        and index (`$a`, `$i`, set by structs() in src/port/c.js)."""
        p = self.expr(pointer)
        if offset == '0':
            return p
        if strip_parens_casts(pointer).kind in (K.DECL_REF_EXPR, K.MEMBER_REF_EXPR) and all(
                x.kind in (K.DECL_REF_EXPR, K.MEMBER_REF_EXPR, K.UNEXPOSED_EXPR, K.PAREN_EXPR) for x in pointer.walk_preorder()):
            return f'{p}.$a[{p}.$i + {offset}]'
        return f'{self.helper("element_at")}({p}, {offset})'

    def iter_loop(self, var, cond, inc, body):
        ctor = strip(clangx.var_init(var))
        data, itype = (arguments(ctor) + [None, None])[:2]
        itype_name = strip(itype).spelling if itype is not None and strip(itype).spelling else '/*FIX itype*/'
        ele = self.expr(arguments(strip(cond))[0]) if cond is not None else '/*FIX*/'
        source = f'{itype_name}({self.bm})' if itype_name.endswith('_OF_MESH') else f'{itype_name}({self.bm}, {self.expr(data)})'
        if itype_name.startswith('BM_'):
            self.deps.add(('helper', itype_name, 'bmesh/intern/bmesh-query.js'))
        if inc is not None:
            index = self.expr(kids(strip(inc))[0]) if kids(strip(inc)) else '/*FIX*/'
            return f'for ([{index}, {ele}] of {source}.entries()) {self.body(body)}'
        return f'for ({ele} of {source}) {self.body(body)}'

    def declaration(self, c):
        return [js for v in kids(c) if v.kind == K.VAR_DECL for js in [self.declaration_of(v)] if js is not None]

    def declaration_of(self, v):
        """`let name = value;` for a variable declaration, or None for one the port drops."""
        t = canon(v.type)
        if dropped(t):
            return None
        init = clangx.var_init(v)
        if init is None:
            value = zero_of(t)
        else:
            si = strip(init)
            if si.kind == K.INIT_LIST_EXPR:
                items = kids(si)
                zero = t.kind == T.CONSTANTARRAY and all(clangx.evaluate(x) == 0 for x in items)
                value = zero_of(t) if zero else '[' + ', '.join(self.expr(x) for x in items) + ']'
            elif (si.kind == K.CALL_EXPR and si.referenced is not None and si.referenced.kind == K.CONSTRUCTOR and not arguments(si)) or (
                    si.kind == K.UNEXPOSED_EXPR and not kids(si)):
                value = zero_of(t)
            elif is_struct_value(t) and si.kind in (K.DECL_REF_EXPR, K.MEMBER_REF_EXPR, K.UNARY_OPERATOR, K.ARRAY_SUBSCRIPT_EXPR):
                # A struct initialized from another is a copy of its fields.
                source, tmp = self.expr(init), self.temp()
                value = f'(({tmp} = {source}), {{ ' + ', '.join([f'{f}: {tmp}.{f}' for f in record_fields(t)] + ['$a: null', '$i: 0']) + ' })'
            else:
                value = self.expr(init, t)
        return f'let {v.spelling}{" = " + value if value is not None else ""};'

    # --- expressions

    def macro(self, c):
        """(name, definition) of the object-like macro c is exactly an expansion of, or None."""
        span = (c.extent.start.offset, c.extent.end.offset)
        if not self.p.in_main(c) or getattr(self, 'expanding', None) == span:
            return None
        macro = self.p.macros.get(span)
        return macro if macro and macro[1] is not None and not clangx.is_function_like(macro[1]) else None

    def cond(self, c):
        s = strip_parens_casts(c)
        if s.kind == K.DECL_REF_EXPR and any(p['name'] == s.spelling and p['out'] == 'out' for p in self.sig['params']):
            return 'true'
        if pool_of(s.type):
            return f'({self.expr(s)} >= 0)'
        if is_unary(s, '!'):
            inner = strip_parens_casts(kids(s)[0])
            if pool_of(inner.type):
                return f'({self.expr(inner)} < 0)'
            return f'!({self.cond(kids(s)[0])})'
        return self.expr(c)

    def expr(self, c, want=None):
        macro = self.macro(c)
        if macro and c.kind != K.CALL_EXPR:
            return self.macro_constant(c, *macro)
        k = c.kind
        ch = kids(c)
        if k in (K.UNEXPOSED_EXPR, K.CXX_FUNCTIONAL_CAST_EXPR, K.CSTYLE_CAST_EXPR, K.CXX_STATIC_CAST_EXPR,
                 K.CXX_REINTERPRET_CAST_EXPR, K.CXX_CONST_CAST_EXPR):
            if not ch:
                return fix(k.name, self.p.text(c))
            inner = ch[-1]
            if is_null(inner):
                return '-1' if pool_of(c.type) or (want is not None and pool_of(want)) else 'null'
            if canon(c.type).kind == T.BOOL and pool_of(inner.type):
                return f'({self.expr(inner)} >= 0)'
            if is_int(c.type) and canon(c.type).kind != T.BOOL and is_float(inner.type) and k != K.UNEXPOSED_EXPR:
                return f'Math.trunc({self.expr(inner)})'
            if self.p.float32 and canon(c.type).kind == T.FLOAT and canon(inner.type).kind == T.DOUBLE:
                return f'Math.fround({self.expr(inner)})'
            if is_int(c.type) and canon(c.type).kind != T.BOOL and canon(inner.type).kind == T.BOOL:
                return f'Number({self.expr(inner)})'
            if canon(c.type).kind in UNSIGNED and is_int(inner.type) and canon(inner.type).kind not in UNSIGNED and canon(inner.type).kind != T.BOOL:
                value = clangx.evaluate(c)
                return str(value) if value is not None else unsigned(c.type, self.expr(inner))
            # An explicit cast states the type a value is used as: static_cast<T *>(BLI_memarena_alloc(...)) allocates T.
            return self.expr(inner, want if k == K.UNEXPOSED_EXPR else c.type)
        if k in NULLS:
            return '-1' if want is not None and pool_of(want) else 'null'
        if k == K.DECL_REF_EXPR:
            ref = c.referenced
            if ref is not None and ref.kind in (K.VAR_DECL, K.PARM_DECL) and dropped(ref.type):
                return 'null'
            if ref is not None and ref.kind == K.ENUM_CONSTANT_DECL and ref.semantic_parent.is_scoped_enum():
                self.note_ref(ref, ref.semantic_parent.spelling)
                return f'{ref.semantic_parent.spelling}.{c.spelling}'
            self.note_ref(ref, c.spelling)
            return CONSTANTS.get(c.spelling, c.spelling)
        if k == K.MEMBER_REF_EXPR:
            return self.member(c)
        if k == K.ARRAY_SUBSCRIPT_EXPR:
            if is_record_pointer(ch[0].type):
                return self.element(ch[0], self.expr(ch[1]))
            return f'{self.expr(ch[0])}[{self.expr(ch[1])}]'
        if k == K.CALL_EXPR:
            return self.call(c, want)
        if k in (K.INTEGER_LITERAL, K.FLOATING_LITERAL):
            return self.literal(c)
        if k == K.CXX_BOOL_LITERAL_EXPR:
            return 'true' if clangx.evaluate(c) else 'false'
        if k == K.STRING_LITERAL:
            return c.spelling
        if k == K.CHARACTER_LITERAL:
            return str(clangx.evaluate(c))
        if k == K.PAREN_EXPR:
            return f'({self.expr(ch[0], want)})'
        if k == K.CONDITIONAL_OPERATOR:
            return f'({self.cond(ch[0])} ? {self.expr(ch[1], want)} : {self.expr(ch[2], want)})'
        if k == K.UNARY_OPERATOR:
            return self.unary(c, want)
        if k in (K.BINARY_OPERATOR, K.COMPOUND_ASSIGNMENT_OPERATOR):
            return self.binary(c)
        if k == K.INIT_LIST_EXPR:
            return '[' + ', '.join(self.expr(x) for x in ch) + ']'
        if k == K.CXX_THIS_EXPR:
            return 'this'
        if k == K.CXX_UNARY_EXPR and clangx.evaluate(c) is not None:
            return str(clangx.evaluate(c))
        return fix(k.name, self.p.text(c))

    def literal(self, c):
        """A number as the lexer spelled it, without C's suffixes; inside a macro's expansion, as Clang evaluates it."""
        token = next(c.get_tokens(), None)
        if token is None or token.kind != ci.TokenKind.LITERAL:
            return number_js(clangx.evaluate(c), c.type)
        spelling = token.spelling
        if self.p.float32 and canon(c.type).kind == T.FLOAT:
            return number_js(clangx.evaluate(c), c.type, exact=True)
        number = spelling.rstrip('fFlLuU') if not spelling.lower().startswith('0x') else spelling.rstrip('lLuU')
        return re.sub(r'\.$', '', number) if not number.startswith('.') else f'0{number}'

    def macro_constant(self, c, name, definition):
        """An expansion of an object-like macro: a JS constant of the same name, valued as Clang evaluates it."""
        if name in CONSTANTS:
            return CONSTANTS[name]
        # The value is the expansion, ported like any expression; Clang's evaluation when that has no JS form.
        self.expanding = (c.extent.start.offset, c.extent.end.offset)
        value = self.expr(c)
        self.expanding = None
        local = any(x.kind == K.DECL_REF_EXPR and x.referenced is not None and x.referenced.kind in (K.VAR_DECL, K.PARM_DECL)
                    and x.referenced.semantic_parent is not None and x.referenced.semantic_parent.kind not in (K.TRANSLATION_UNIT, K.NAMESPACE)
                    for x in c.walk_preorder())
        if local or (definition is not None and self.p.in_main(definition) and definition.extent.start.line in self.p.local_macro_lines):
            return value  # A macro of the function's own variables stays inline.
        if '/*FIX' in value:
            value = number_js(clangx.evaluate(c), c.type)
        if value is None:
            return fix(f'macro {name}', self.p.text(c))
        self.deps.add(('constant', name, (definition, value)))
        return name

    def unary(self, c, want=None):
        op, postfix = clangx.unary_operator(c)
        operand = kids(c)[0]
        if op == '!':
            return self.cond(c)
        if op == '&':
            target = strip_parens_casts(operand)
            p = pointee(c.type)
            if target.kind == K.ARRAY_SUBSCRIPT_EXPR and p is not None and is_float(p):
                base, index = kids(target)
                i = self.expr(index)
                return f'{self.expr(base)}.slice({i}, {i} + 3)'
            return self.expr(operand, want)
        if op == '*':
            return self.expr(operand, want)
        a = self.expr(operand)
        if op in ('++', '--') and canon(operand.type).kind in UNSIGNED:
            # C's unsigned integers wrap around.
            step = f'{a} = {unsigned(operand.type, f"{a} {op[0]} 1")}'
            if not postfix:
                return f'({step})'
            t = f'_r{self.temps}'
            self.temps += 1
            return f'(({t} = {a}), ({step}), {t})'
        if op in ('++', '--') and is_record_pointer(operand.type):
            # Stepping a struct pointer: the neighbouring element of its array; a step's value is the pointer after it.
            step = f'{a} = {self.element(operand, "1" if op == "++" else "-1")}'
            if not postfix:
                return f'({step})'
            t = f'_r{self.temps}'
            self.temps += 1
            return f'(({t} = {a}), ({step}), {t})'
        return f'{a}{op}' if postfix else f'{op}({a})'

    def note_ref(self, ref, name):
        """Records a declaration the port uses: functions and constants, or the shim behind a prelude macro."""
        if ref is None or not ref.location.file:
            return
        if ref.kind not in (K.FUNCTION_DECL, K.VAR_DECL, K.ENUM_CONSTANT_DECL, K.FUNCTION_TEMPLATE):
            return
        if ref.kind == K.VAR_DECL and ref.semantic_parent is not None and ref.semantic_parent.kind not in (K.TRANSLATION_UNIT, K.NAMESPACE):
            return
        if is_prelude(ref):
            self.deps.add(('helper', name, PRELUDE_HOMES.get(name)))
            return
        self.deps.add(('function' if ref.kind in (K.FUNCTION_DECL, K.FUNCTION_TEMPLATE) else 'constant', name, ref))

    def helper(self, name):
        for module, names in HELPER_MODULES.items():
            if name in names:
                self.deps.add(('helper', name, module))
        return name

    def element_pool(self, c):
        """The pool and JS of a member access's element, when it is a BMesh element (directly or through ->head)."""
        t = canon(c.type)
        record = (pointee(t) if t.kind == T.POINTER else t).get_declaration().spelling
        return POOL.get(record)

    def member(self, c):
        ch = kids(c)
        field = c.spelling
        if not ch:
            return f'this.{field}'
        base = ch[0]
        pool = self.element_pool(base)
        if pool:
            b = self.expr(base)
            if (pool, field) in VEC_FIELDS:
                return f'{self.helper(VEC_FIELDS[(pool, field)])}({self.bm}, {b})'
            if field == 'head':
                return b
            return f'{self.bm}.{pool}.{field}[{b}]'
        outer = strip(base)
        if outer.kind == K.MEMBER_REF_EXPR and kids(outer):
            # An element's embedded struct: e->v1_disk_link.next is bm.e.v1_disk_link_next[e], v->head.hflag is bm.v.hflag[v].
            opool = self.element_pool(kids(outer)[0])
            elem = self.expr(kids(outer)[0])
            if opool and outer.spelling == 'head':
                if field in HEADER_FIELDS:
                    return f'{self.bm}.{opool}.{field}[{elem}]'
                if field == 'htype':
                    return HTYPE[opool]
                return fix(f'head.{field}', elem)
            if opool:
                return f'{self.bm}.{opool}.{outer.spelling}_{field}[{elem}]'
        return f'{self.expr(base)}.{field}'

    def binary(self, c):
        lhs, rhs = kids(c)[:2]
        op = clangx.binary_operator(c)
        if op in ('&&', '||'):
            return f'({self.cond(lhs)} {op} {self.cond(rhs)})'
        if op == '=':
            return self.assign(lhs, self.expr(rhs, lhs.type))
        if is_record_pointer(lhs.type) and is_record_pointer(rhs.type) and op in ('<', '>', '<=', '>='):
            return f'({self.expr(lhs)}.$i {op} {self.expr(rhs)}.$i)'
        if is_record_pointer(lhs.type) and is_record_pointer(rhs.type) and op == '-':
            return f'({self.expr(lhs)}.$i - {self.expr(rhs)}.$i)'
        if op in ('+=', '-=') and is_record_pointer(lhs.type):
            return f'{self.expr(lhs)} = {self.element(lhs, self.expr(rhs) if op == "+=" else f"-({self.expr(rhs)})")}'
        if self.p.float32 and canon(c.type).kind == T.FLOAT and op in ('+=', '-=', '*=', '/='):
            return self.assign(lhs, f'Math.fround({self.expr(lhs)} {op[0]} {self.expr(rhs)})')
        if op in ('==', '!='):
            for a, b in ((lhs, rhs), (rhs, lhs)):
                if is_null(b):
                    if pool_of(strip_parens_casts(a).type):
                        return f'({self.expr(a)} {"<" if op == "==" else ">="} 0)'
                    return f'({self.expr(a)} {op}= null)'
        if op in ('+', '-') and is_record_pointer(lhs.type):
            return self.element(lhs, self.expr(rhs) if op == '+' else f'-({self.expr(rhs)})')
        if op == '+' and pointee(lhs.type) is not None and is_float(pointee(lhs.type)):
            off = self.expr(rhs)
            return f'{self.expr(lhs)}.slice({off}, {off} + 3)'
        s = f'({self.expr(lhs)} {OPS.get(op, op)} {self.expr(rhs)})'
        if op == '/' and is_int(lhs.type) and is_int(rhs.type) and is_int(c.type):
            return f'Math.trunc{s}'
        if op == '-' and canon(c.type).kind in UNSIGNED:
            return unsigned(c.type, s)
        if self.p.float32 and canon(c.type).kind == T.FLOAT and op in ('+', '-', '*', '/'):
            return f'Math.fround{s}'
        return s

    def assign(self, lhs, value, size=3):
        s = strip_parens_casts(lhs)
        target = address_of(s)
        if target is not None and strip_parens_casts(target).kind == K.ARRAY_SUBSCRIPT_EXPR:
            base, index = kids(strip_parens_casts(target))
            return f'{self.expr(base)}.splice({self.expr(index)}, {size}, ...{value})'
        if is_binary(s, '+') and pointee(kids(s)[0].type) is not None and is_float(pointee(kids(s)[0].type)):
            # A write through `p + offset` into a float array.
            return f'{self.expr(kids(s)[0])}.splice({self.expr(kids(s)[1])}, {size}, ...{value})'
        if is_struct_value(s.type):
            # A struct assigned by value: its fields copy, the element keeps its place in its array.
            target, t = self.expr(lhs), self.temp()
            return f'(({t} = {value}), ' + ', '.join(f'({target}.{f} = {t}.{f})' for f in record_fields(s.type)) + ')'
        if s.kind == K.MEMBER_REF_EXPR and kids(s):
            pool = self.element_pool(kids(s)[0])
            if pool and (pool, s.spelling) in VEC_FIELDS:
                return f'{self.bm}.{pool}.{s.spelling}.set({value}, {self.expr(kids(s)[0])} * 3)'
        return f'{self.expr(lhs)} = {value}'

    def expr_statement(self, c):
        s = strip(c)
        if is_binary(s, '=') and strip(kids(s)[0]).spelling in DROPPED_FIELDS:
            return None
        if s.kind == K.CALL_EXPR:
            name = s.spelling
            args = arguments(s)
            if name in DROPPED_CALLS or name.startswith(DROPPED_CALL_PREFIXES):
                return None
            if name in OUT_FIRST and args:
                m = OUT_FIRST[name]
                rest = [self.expr(a) for a in args[1:]]
                value = m(rest) if callable(m) else f'{self.helper(m)}({", ".join(rest)})'
                return self.assign(args[0], value, 2 if '_v2' in name else 4 if '_v4' in name else 3)
            if name in IN_OUT and args:
                return self.assign(args[0], f'{self.helper(IN_OUT[name])}({", ".join(self.expr(a) for a in args)})')
            sig = self.p.sig_of(name)
            if sig and self.has_outs(sig):
                self.statement_call = True
                call = self.call(s)
                self.statement_call = False
                targets = self.out_targets(sig, args)
                ret_kind = canon(sig['ret']).kind
                if ret_kind in (T.VOID, T.BOOL) and len(targets) == 1:
                    return self.assign(targets[0], call) if targets[0] is not None else call
                lhs = ([] if ret_kind == T.VOID else ['']) + [self.expr(t) if t is not None else '' for t in targets]
                while lhs and lhs[-1] == '':
                    lhs.pop()
                return f'[{", ".join(lhs)}] = {call}' if lhs else call
        return self.expr(c)

    def has_outs(self, sig):
        return any(p['out'] for p in sig['params'])

    def out_targets(self, sig, args):
        out = []
        for i, p in enumerate(sig['params']):
            if not p['out'] or i >= len(args):
                continue
            a = address_of(args[i])
            a = a if a is not None else strip(args[i])
            out.append(None if is_null(a) else a)
        return out

    def call(self, c, want=None):
        name = c.spelling
        ref = c.referenced
        args = arguments(c)
        js = lambda xs: [self.expr(a) for a in xs]
        if ref is not None and ref.kind == K.CONSTRUCTOR:
            if name in VECTOR_CONSTRUCTORS:
                return '[' + ', '.join(js(args)) + ']'
            if not args:
                return zero_of(c.type) or '{}'
            if decl_name(c.type) in ARRAY_TYPES and is_int(args[0].type) and len(args) <= 2:
                return f'new Array({self.expr(args[0])})' + (f'.fill({self.expr(args[1])})' if len(args) == 2 else '')
            if len(args) == 1:
                return self.expr(args[0], want)
            return fix(f'constructor {name}', self.p.text(c))
        callee = kids(c)[0] if kids(c) else None
        if name.startswith('operator'):
            return self.operator_call(c, name)
        if callee is not None and strip(callee).kind == K.MEMBER_REF_EXPR:
            return self.method_call(strip(callee), name, args)
        self.call_node, self.call_type = c, c.type
        special = self.special_call(name, args, want)
        if special is not None:
            return special
        if name in OUT_FIRST or name in IN_OUT:
            m = OUT_FIRST.get(name) or IN_OUT.get(name)
            rest = js(args[1:] if name in OUT_FIRST else args)
            value = m(rest) if callable(m) else f'{self.helper(m)}({", ".join(rest)})'
            if name in OUT_FIRST and name.startswith('invert'):
                return f'({self.expr(args[0])} = {value})'
            return f'/*FIX {name} as a value*/ {value}'
        sig = self.p.sig_of(name)
        params = sig['params'] if sig else []
        arg_js = []
        for i, a in enumerate(args):
            if i < len(params) and params[i]['out'] == 'out':
                continue
            target = address_of(a)
            arg_js.append(self.expr(target if target is not None else a, params[i]['type'] if i < len(params) else None))
        js_name = RENAME.get(name, name)
        if js_name != name:
            self.helper(js_name)
        else:
            self.note_ref(ref, name)
        if element_overload(ref):
            pool = next((pool_of(strip_parens_casts(a).type) for a in args if pool_of(strip_parens_casts(a).type)), None)
            if args and pointee(args[0].type) is not None and pointee(args[0].type).get_declaration().spelling == 'BMesh':
                arg_js = arg_js[1:]
            arg_js.insert(0, f'{self.bm}.{pool}' if pool else f'/*FIX pool*/ {self.bm}')
        elif (sig and sig.get('needs_bm')) or (ref is not None and not (sig and sig.get('emitted')) and needs_mesh(ref)):
            arg_js.insert(0, self.bm)
        call = f'{js_name}({", ".join(arg_js)})'
        if self.p.float32 and js_name.startswith('Math.') and canon(c.type).kind == T.FLOAT:
            call = f'Math.fround({call})'
        if sig and self.has_outs(sig) and not self.statement_call:
            targets = [self.expr(t) if t is not None else '' for t in self.out_targets(sig, args)]
            ret_kind = canon(sig['ret']).kind
            if not any(targets):
                return call if ret_kind == T.VOID or (ret_kind == T.BOOL and len(targets) == 1) else f'{call}[0]'
            if ret_kind == T.BOOL and len(targets) == 1:
                return f'(({targets[0]} = {call}) != null)'
            t = f'_r{self.temps}'
            self.temps += 1
            return f'(([{"" if ret_kind == T.VOID else t + ", "}{", ".join(targets)}] = {call}), {t})'
        return call

    def special_call(self, name, args, want=None):
        """Calls with their own JS form, or None."""
        js = lambda xs: [self.expr(a) for a in xs]
        if name in ALLOCATORS:
            elem = pointee(want) if want is not None and pointee(want) is not None and canon(pointee(want)).kind != T.VOID else pointee(self.call_type)
            if name.endswith('arrayN') and len(args) >= 2:
                count = [args[0]]
            else:
                count = [f for f in self.product(args[-1]) if strip_parens_casts(f).kind != K.CXX_UNARY_EXPR] if args else []
            if elem is None or canon(elem).kind == T.VOID:
                return f'new Array({" * ".join(self.expr(f) for f in count)})' if count else '{}'
            if not count:
                return zero_of(elem) or '{}'
            return buffer_of(elem, ' * '.join(self.expr(f) for f in count), self.helper)
        if name == 'bl_port_alloca':
            return buffer_of(pointee(args[0].type), self.expr(args[1]), self.helper)
        if name == 'memset':
            dst, byte = args[0], clangx.evaluate(args[1])
            elem = pointee(strip_parens_casts(dst).type)
            if (elem is None or elem.kind == T.VOID) and want is not None:
                elem = pointee(want)
            value = fill_value(elem, byte) if elem is not None and byte is not None else None
            return f'{self.expr(dst, want)}.fill({value})' if value is not None else fix('memset', self.p.text(self.call_node))
        if name == 'memcpy':
            dst, src = args[0], args[1]
            elem = pointee(strip_parens_casts(dst).type)
            count = [f for f in self.product(args[2]) if strip_parens_casts(f).kind != K.CXX_UNARY_EXPR]
            n = ' * '.join(self.expr(f) for f in count) or '1'
            if elem is not None and canon(elem).kind in TYPED_ARRAYS:
                return f'{self.expr(dst)}.set({self.expr(src)}.subarray(0, {n}))'
            return f'{self.expr(dst)}.splice(0, {n}, ...{self.expr(src)}.slice(0, {n}))'
        if name == 'ELEM':
            a = js(args)
            return '(' + ' || '.join(f'{a[0]} === {x}' for x in a[1:]) + ')'
        if name in ('SWAP_', 'swap'):
            a, b = js(args)
            if canon(args[0].type).kind == T.RECORD:
                return '; '.join(f'[{a}.{f}, {b}.{f}] = [{b}.{f}, {a}.{f}]' for f in record_fields(args[0].type))
            return f'[{a}, {b}] = [{b}, {a}]'
        if name in ('len_v3v3', 'len_squared_v3v3'):
            a, b = js(args)
            return f'{self.helper("len_v3" if name == "len_v3v3" else "len_squared_v3")}({self.helper("sub_v3")}({a}, {b}))'
        if name == 'compare_ff':
            a, b, eps = js(args)
            return f'(Math.abs({a} - {b}) <= {eps})'
        if name in ('normalize_v3', 'normalize_v3_length') and not self.statement_call:
            v = self.expr(args[0])
            t = f'_r{self.temps}'
            self.temps += 1
            return f'({t} = {self.helper("len_v3")}({v}), {v} = {self.helper("normalize_v3")}({v}), {t})'
        pool = lambda: pool_of(strip_parens_casts(args[0]).type) or '/*FIX pool*/'
        if re.fullmatch(r'BM_ELEM_API_FLAG_(ENABLE|DISABLE|TEST)', name):
            return f'{self.helper(name)}({self.bm}.{pool()}, {", ".join(js(args))})'
        if name == 'BM_elem_index_get':
            return f'{self.bm}.{pool()}.index[{self.expr(args[0])}]'
        if name == 'BM_elem_index_set':
            return f'{self.bm}.{pool()}.index[{self.expr(args[0])}] = {self.expr(args[1])}'
        if name.startswith('BM_elem_flag_'):
            return f'{self.helper(name.removesuffix("_bool"))}({self.bm}.{pool()}, {", ".join(js(args))})'
        m = re.fullmatch(r'BMO_(vert|edge|face)_flag_(test|enable|disable|set)(_bool)?', name)
        if m:
            return f'{self.helper("BMO_flag_" + m.group(2))}({self.bm}.{m.group(1)[0]}, {", ".join(js(args[1:]))})'
        return None

    def product(self, c):
        """The factors of a product like `sizeof(T) * count * (n + 1)`."""
        inner = strip_parens_casts(c)
        if is_binary(inner, '*'):
            return [f for k in kids(inner) for f in self.product(k)]
        return [c]

    def operator_call(self, c, name):
        # The callee is a reference to the operator function; the rest are the operands.
        args = [a for a in kids(c) if not (pointee(a.type) is not None and pointee(a.type).kind == T.FUNCTIONPROTO)]
        op = name[len('operator'):].strip()
        if args and strip(args[0]).kind == K.MEMBER_REF_EXPR and strip(args[0]).spelling.startswith('operator') and kids(strip(args[0])):
            # Conversion operators: a pointer-like owner is truthy when set, an Array converts to its data.
            base = self.expr(kids(strip(args[0]))[0])
            return f'({base} != null)' if op == 'bool' else base
        if op == '[]':
            return f'{self.expr(args[0])}[{self.expr(args[1])}]'
        if op == '->' or (op == '*' and len(args) == 1):
            return self.expr(args[0])
        if op == 'bool':
            return f'({self.expr(args[0])} != null)'
        if op == '=':
            return self.assign(args[0], self.expr(args[1]))
        if all(is_int(a.type) or decl_name(a.type) in INTEGER_WRAPPERS for a in args):
            # Operators on enum class flags (BLI_enum_flags.hh) act on the underlying integers.
            if len(args) == 1:
                return f'{op}({self.expr(args[0])})'
            if op.endswith('=') and op not in ('==', '!=', '<=', '>='):
                return f'{self.expr(args[0])} {op} {self.expr(args[1])}'
            return f'({self.expr(args[0])} {OPS.get(op, op)} {self.expr(args[1])})'
        if op in ('+', '-') and len(args) == 2:
            return f'{self.helper("add_v3" if op == "+" else "sub_v3")}({self.expr(args[0])}, {self.expr(args[1])})'
        if op == '*' and len(args) == 2:
            a, b = args
            if is_float(a.type):
                a, b = b, a
            return f'{self.helper("mul_v3_fl")}({self.expr(a)}, {self.expr(b)})'
        return fix(name, self.p.text(c))

    def method_call(self, callee, name, args):
        base = kids(callee)[0] if kids(callee) else None
        b = self.expr(base) if base is not None else 'this'
        a = [self.expr(x) for x in args]
        keyed = (canon(base.type).get_declaration().spelling if base is not None else '') in ('Map', 'Set')
        if name in ('size', 'index_range') and not args:
            return f'{b}.size' if keyed else f'{b}.length'
        if name == 'is_empty':
            return f'({b}.size === 0)' if keyed else f'({b}.length === 0)'
        if name == 'last':
            return f'{b}.at(-1)'
        if name == 'first':
            return f'{b}[0]'
        if name == 'clear':
            return f'{b}.clear()' if keyed else f'{b}.length = 0'
        if name in ('data', 'as_span', 'as_mutable_span'):
            return b
        if name == 'lookup_default':
            return f'({b}.get({a[0]}) ?? {a[1]})'
        if name in ('add', 'add_new', 'add_overwrite'):
            setlike = base is not None and canon(base.type).get_declaration().spelling == 'Set'
            return f'{b}.{"add" if setlike else "set"}({", ".join(a)})'
        return f'{b}.{METHODS.get(name, name)}({", ".join(a)})'


def fix(what, source):
    """A placeholder for what the converter cannot port yet: valid JS that names it, and fails if it runs."""
    note = re.sub(r'\s+', ' ', source).replace('*/', '* /')
    return f'undefined /*FIX {what}: {note}*/'


def number_js(value, t, exact=False):
    """A number as JS: a float's shortest spelling that reads back as the same float, or with exact, the double
    equal to that float."""
    if value is None:
        return None
    if canon(t).kind == T.FLOAT:
        single = struct.unpack('f', struct.pack('f', value))[0]
        if exact:
            return repr(single)
        return next(s for p in range(1, 18) for s in [f'{single:.{p}g}'] if struct.unpack('f', struct.pack('f', float(s)))[0] == single)
    return repr(value)


def main():
    root, rel, *names = sys.argv[1:]
    source = Source(root, rel)
    for f in source.functions:
        source.emit(f)
    print('\n\n'.join(source.emit(f)[0] for f in source.functions if not names or f.spelling in names))


if __name__ == '__main__':
    main()
