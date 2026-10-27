"""WebAssembly units: self-contained parts of Blender built from Blender's own sources with Clang's wasm32-wasi target,
called with C-layout typed arrays (src/port/wasm.js).

A unit (manifest `units`: JS module, API functions by source file, and the other sources it links) gets:
- exports.cc: an `extern "C"` export per API function. Span<T> and OffsetIndices<T> parameters arrive as a pointer
  and a length in elements of T's numbers, raw pointers as pointers, numbers as numbers.
- its sources compiled and linked; the linker names any symbol they lack or define twice.
- <module>.wasm, and <module>.unit.gen.js with one function per API function: it copies inputs in with .set(), calls,
  and copies outputs (MutableSpan, and non-const pointers named r_*) back.
"""
import hashlib
import os
import subprocess
import sys

import convert

K = convert.K
T = convert.T
HERE = os.path.dirname(os.path.abspath(__file__))
C_TYPES = {T.FLOAT: 'float', T.DOUBLE: 'double', T.INT: 'int', T.UINT: 'unsigned int', T.SHORT: 'short', T.USHORT: 'unsigned short',
           T.CHAR_S: 'char', T.SCHAR: 'signed char', T.UCHAR: 'unsigned char', T.BOOL: 'bool', T.LONG: 'long', T.ULONG: 'unsigned long'}


def scalar_of(t):
    """The number type a Span element is made of: float for float3, int for int."""
    t = convert.canon(t)
    if t.kind in C_TYPES:
        return t
    if t.get_num_template_arguments() > 0:
        return scalar_of(t.get_template_argument_type(0))
    fields = list(t.get_fields())
    return scalar_of(fields[0].type) if fields else None


class Param:
    """How one API parameter crosses the boundary."""

    def __init__(self, p):
        self.name = p.spelling
        t = convert.canon(p.type)
        container = t.get_declaration().spelling
        self.output = False
        if container in ('Span', 'MutableSpan', 'OffsetIndices'):
            element = t.get_template_argument_type(0)
            scalar = scalar_of(element)
            self.kind, self.scalar = 'span', scalar
            self.components = convert.canon(element).get_size() // scalar.get_size()
            self.output = container == 'MutableSpan'
            const = '' if self.output else 'const '
            self.c_params = f'{const}{C_TYPES[scalar.kind]} *{self.name}, int {self.name}_len'
            element_type = convert.canon(element).spelling
            span = f'{container if container != "OffsetIndices" else "Span"}<{element_type}>(reinterpret_cast<{const}{element_type} *>({self.name}), {self.name}_len / {self.components})'
            self.c_arg = f'OffsetIndices<{element_type}>({span})' if container == 'OffsetIndices' else span
        elif t.kind == T.POINTER:
            target = convert.canon(t.get_pointee())
            scalar = scalar_of(target.element_type if target.kind == T.CONSTANTARRAY else target)
            const = target.is_const_qualified() or (target.kind == T.CONSTANTARRAY and convert.canon(target.element_type).is_const_qualified())
            self.kind, self.scalar = 'pointer', scalar
            self.output = not const
            self.c_params = f'{"const " if const else ""}{C_TYPES[scalar.kind]} *{self.name}'
            self.c_arg = f'reinterpret_cast<{p.type.spelling}>({self.name})'
            self.inout = not const and not self.name.startswith('r_')
        elif t.kind in C_TYPES or t.kind == T.ENUM:
            self.kind = 'number'
            self.c_params = f'{C_TYPES.get(t.kind, "int")} {self.name}'
            self.c_arg = self.name if t.kind != T.ENUM else f'{t.spelling}({self.name})'
        else:
            sys.exit(f'{p.semantic_parent.spelling}({self.name}): {t.spelling} cannot cross a unit boundary')

    @property
    def js_args(self):
        return [f'p_{self.name}', f'{self.name}.length'] if self.kind == 'span' else [f'p_{self.name}'] if self.kind == 'pointer' else [self.name]


def qualified(f):
    scope, parent = [], f.semantic_parent
    while parent is not None and parent.kind == K.NAMESPACE:
        scope.insert(0, parent.spelling)
        parent = parent.semantic_parent
    return '::'.join(scope + [f.spelling])


class UnitBuild:
    def __init__(self, driver, module, unit):
        self.driver, self.module, self.unit = driver, module, unit
        self.root = driver.root
        self.build = os.path.join(self.root, '.port-wasm')
        os.makedirs(os.path.join(self.build, 'include'), exist_ok=True)
        # Header-only libraries whose directories sit with the host's headers, which a wasm build must not see.
        for name, target in (('fmt', '/usr/include/fmt'), ('Eigen', '/usr/include/eigen3/Eigen')):
            link = os.path.join(self.build, 'include', name)
            if not os.path.exists(link):
                os.symlink(target, link)
        self.api = []
        for name, rel in unit['api'].items():
            f = driver.source(rel).find(name)
            if f is None:
                sys.exit(f'{module}: no {name} in {rel}')
            self.api.append((f, [Param(p) for p in f.get_arguments()]))
        source = driver.source(next(iter(unit['api'].values())))
        self.flags = ['--target=wasm32-wasi', '-std=c++20', '-O3', '-DNDEBUG', '-DFMT_HEADER_ONLY', '-fignore-exceptions',
                      '-include', os.path.join(HERE, 'wasm', 'compat.h')]
        self.flags += [a for a in source.args if a.startswith('-I')]
        self.flags += [f'-I{os.path.join(self.root, "intern/guardedalloc/intern")}', f'-I{os.path.join(self.build, "include")}']

    def exports_cc(self):
        headers = sorted({f.canonical.location.file.name for f, _ in self.api})
        lines = [f'#include "{h}"' for h in headers] + ['', 'using namespace blender;', '']
        for f, params in self.api:
            ret = convert.canon(f.result_type)
            c_ret = 'void' if ret.kind == T.VOID else C_TYPES[ret.kind]
            lines.append(f'extern "C" __attribute__((export_name("{f.spelling}"))) {c_ret} port_{f.spelling}('
                         f'{", ".join(p.c_params for p in params)})\n{{\n  {"" if c_ret == "void" else "return "}'
                         f'{qualified(f)}({", ".join(p.c_arg for p in params)});\n}}\n')
        path = os.path.join(self.build, self.module.removesuffix('.js').replace('/', '_') + '.exports.cc')
        open(path, 'w').write('\n'.join(lines))
        return path

    def compile(self, path):
        """The object of path, cached by content and flags."""
        digest = hashlib.sha1((open(path, 'rb').read().hex() + ' '.join(self.flags)).encode()).hexdigest()[:16]
        obj = os.path.join(self.build, 'objects', f'{os.path.basename(path)}.{digest}.o')
        if not os.path.exists(obj):
            os.makedirs(os.path.dirname(obj), exist_ok=True)
            result = subprocess.run(['clang++', *self.flags, '-c', path, '-o', obj], capture_output=True, text=True)
            if result.returncode:
                sys.exit(f'{self.module}: {os.path.relpath(path, self.root)} does not build to WebAssembly\n{result.stderr}')
        return obj

    def link(self):
        sources = sorted({*self.unit['api'].values(), *self.unit.get('sources', [])})
        return [self.compile(self.exports_cc()), self.compile(os.path.join(HERE, 'wasm', 'platform.cc')),
                *(self.compile(os.path.join(self.root, rel)) for rel in sources)]

    def build_module(self):
        objects = self.link()
        wasm = self.driver_path('.wasm')
        result = subprocess.run(['clang++', '--target=wasm32-wasi', '-O3', '-mexec-model=reactor', '-Wl,--gc-sections', '-Wl,--strip-all',
                                 '-Wl,--export=malloc', '-Wl,--export=free', '-Wl,--error-limit=0', '-o', wasm, *objects], capture_output=True, text=True)
        if result.returncode:
            sys.exit(f'{self.module}: link failed\n{result.stderr}')
        open(self.driver_path('.unit.gen.js'), 'w').write(self.binding())
        print(f'built {os.path.relpath(wasm, convert.REPO)}: {os.path.getsize(wasm)} bytes from {len(objects)} objects', file=sys.stderr)

    def driver_path(self, suffix):
        return os.path.join(convert.REPO, 'src', self.module.removesuffix('.js') + suffix)

    def binding(self):
        functions = []
        for f, params in self.api:
            arrays = [p for p in params if p.kind != 'number']
            places = [f'const p_{p.name} = heap.{"out" if p.output and not getattr(p, "inout", False) else "in"}({p.name});' for p in arrays]
            result = '' if convert.canon(f.result_type).kind == T.VOID else 'const result = '
            outs = [f'heap.copyOut({p.name}, p_{p.name});' for p in arrays if p.output]
            functions.append(f'export function {f.spelling}({", ".join(p.name for p in params)}) {{\n'
                             f'heap.reserve({" + ".join(f"size({p.name})" for p in arrays) or "0"});\n' + '\n'.join(places) +
                             f'\n{result}heap.exports.{f.spelling}({", ".join(a for p in params for a in p.js_args)});\n' + '\n'.join(outs) +
                             ('\nreturn result;' if result else '') + '\n}')
        runtime = os.path.relpath(os.path.join(convert.REPO, 'src/port/wasm.js'), os.path.dirname(self.driver_path('.js')))
        return (f'// Generated by tools/blender-port/port.py from Blender {self.driver.manifest["blender"]}: Blender\'s code for '
                f'{", ".join(f.spelling for f, _ in self.api)}, built to WebAssembly. Do not edit.\n'
                f"import {{ instantiate, size }} from '{runtime if runtime.startswith('.') else './' + runtime}';\n\n"
                f"const heap = await instantiate(new URL('./{os.path.basename(self.driver_path('.wasm'))}', import.meta.url));\n\n"
                + '\n\n'.join(functions) + '\n')


def build_units(driver):
    paths = []
    for module, unit in driver.manifest.get('units', {}).items():
        build = UnitBuild(driver, module, unit)
        build.build_module()
        paths.append(build.driver_path('.unit.gen.js'))
    return paths
