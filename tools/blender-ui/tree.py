"""Blender's Python as one tree of JS modules: scripts/startup and scripts/modules at the port's tag, transpiled whole by
Transcrypt into src/bl_py/, with Bylonder's modules only at the boundary: Blender's C modules (_bpy, mathutils, idprop,
...) and the Python library modules Transcrypt lacks (here, in boundary/).

The scripts compile as they are, through passes that keep Python's meaning where Transcrypt differs:
- imports from bpy's C modules (bpy.types, bpy.app, ...) import _bpy's, which bpy re-exports;
- TranscryptFixes (transpile.py) for what Transcrypt compiles wrong;
- relative imports as absolute ones;
- imports inside functions, and module-level imports that close an import cycle, as lookups in the module registry
  (boundary/_modules.py), since Transcrypt cannot compile cycles; every module registers itself, and the tree's entry
  module imports them all, so they have loaded before any function runs.

usage: python3 tools/blender-ui/tree.py [--check] [--keep DIR]   (--check compiles without writing src/bl_py; --keep
       prepares the tree in DIR and keeps it, to read what Transcrypt compiled)
"""
import ast
import concurrent.futures
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import transpile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(transpile.REPO, 'src', 'bl_py')
ROOTS = ['scripts/startup', 'scripts/modules']
# Modules that reach the operating system or the network (downloads, extensions, translations' tooling, the
# interactive console's completion), which the browser has no use for.
EXCLUDED = ['_bpy_internal.http*', '_bpy_internal.extensions*', '_bpy_internal.assets.remote_library*', '_bl_i18n_utils*',
            'bl_i18n_utils*', '_bpy_internal.platform*', 'rlcompleter', 'blend_render_info', '_blendfile_header',
            'bl_app_templates_system*', 'console*', 'bl_console_utils*']
# bpy's C modules, which bpy's __init__ imports from _bpy.
C_NAMES = {'app', 'context', 'data', 'msgbus', 'props', 'types'}
# Bylonder's modules at the boundary, used by the tree in place of Blender's C modules and Python's library modules.
BOUNDARY = ['boundary', 'mathutils', 'idprop', 'os', 'sys']


def listing(path):
    """The Python files under a directory of Blender's repository at the tag, cached."""
    cache = os.path.join(os.path.expanduser('~/.cache/bylonder/blender'), transpile.TAG, path, '.listing.json')
    if os.path.exists(cache):
        return json.load(open(cache))
    url = f'{transpile.BLENDER}/contents/{path.replace("/", "%2F")}?ref={transpile.TAG}'
    entries = json.loads(subprocess.run(['curl', '-sfL', url], capture_output=True, check=True).stdout)
    files = [e['path'] for e in entries if e['type'] == 'file' and e['name'].endswith('.py')]
    for d in (e['path'] for e in entries if e['type'] == 'dir'):
        files += listing(d)
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    json.dump(files, open(cache, 'w'))
    return files


def module_name(build, path):
    name = os.path.relpath(path, build)[:-3].replace(os.sep, '.')
    return name[:-len('.__init__')] if name.endswith('.__init__') else name


def module_path(build, name):
    path = os.path.join(build, *name.split('.'))
    return os.path.join(path, '__init__.py') if os.path.isdir(path) else path + '.py'


def is_module(build, name):
    return os.path.exists(module_path(build, name))


def assemble(build):
    """Blender's scripts, without the excluded modules and those whose names are not identifiers, then the boundary."""
    files = [f for root in ROOTS for f in listing(root)]
    with concurrent.futures.ThreadPoolExecutor(16) as pool:
        sources = dict(zip(files, pool.map(transpile.fetch, files)))
    for path, source in sources.items():
        relative = path.split('/', 2)[2]
        name = relative[:-3].replace('/', '.').removesuffix('.__init__')
        if any(fnmatch.fnmatchcase(name, pattern) for pattern in EXCLUDED) or not all(p.isidentifier() for p in name.split('.')):
            continue
        target = os.path.join(build, relative)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        open(target, 'w').write(source)
    for root, _, names in os.walk(build):
        if root != build and '__init__.py' not in names:
            open(os.path.join(root, '__init__.py'), 'w').close()
    for package in BOUNDARY:
        source = os.path.join(HERE, package)
        target = build if package == 'boundary' else os.path.join(build, package)
        shutil.copytree(source, target, dirs_exist_ok=True)


class Imports(ast.NodeTransformer):
    """Imports of bpy's C modules as _bpy's, relative imports as absolute ones, and imports in functions as registry
    lookups."""

    def __init__(self, build, name, package):
        self.build, self.name, self.package, self.depth = build, name, package, 0

    def visit_FunctionDef(self, node):
        self.depth += 1
        self.generic_visit(node)
        self.depth -= 1
        return node

    visit_AsyncFunctionDef = visit_FunctionDef

    def absolute(self, node):
        if not node.level:
            module = node.module
        else:
            parts = self.package.split('.')
            module = '.'.join(parts[:len(parts) - node.level + 1] + ([node.module] if node.module else []))
        first, _, rest = module.partition('.')
        if first == 'bpy' and rest.split('.')[0] in C_NAMES and self.name != 'bpy':
            return '_' + module
        if module == 'bpy' and self.name != 'bpy' and all(a.name in C_NAMES for a in node.names):
            return '_bpy'
        return module

    def visit_Import(self, node):
        if not self.depth:
            return node
        return [ast.parse(f'{a.asname or a.name.split(".")[0]} = _module({(a.name if a.asname else a.name.split(".")[0])!r})').body[0]
                for a in node.names]

    def visit_ImportFrom(self, node):
        module = self.absolute(node)
        if self.depth:
            return [ast.parse(f'{a.asname or a.name} = _member({module!r}, {a.name!r})').body[0] for a in node.names]
        submodules = [a for a in node.names if is_module(self.build, f'{module}.{a.name}')]
        rest = [a for a in node.names if a not in submodules]
        out = [ast.Import(names=[ast.alias(name=f'{module}.{a.name}', asname=a.asname or a.name)]) for a in submodules]
        return out + ([ast.ImportFrom(module=module, names=rest, level=0)] if rest else [])


def module_imports(build, name, tree):
    """The tree's modules a module imports at its top level, with the statement importing each."""
    out = []
    for node in tree.body:
        if isinstance(node, ast.Import):
            out += [(a.name, node) for a in node.names if is_module(build, a.name)]
        elif isinstance(node, ast.ImportFrom) and is_module(build, node.module):
            out.append((node.module, node))
    return [(target, node) for target, node in out if target != name]


def lazy_cycles(build, trees, entry):
    """Module-level `import x` statements that close a cycle, as `x = _lazy('x')`."""
    state, back = {}, {}
    sys.setrecursionlimit(20000)

    def visit(name):
        state[name] = 'open'
        for target, node in module_imports(build, name, trees[name]):
            if state.get(target) == 'open':
                back.setdefault(name, set()).add(id(node))
            elif target not in state and target in trees:
                visit(target)
        state[name] = 'done'
    for name in entry:
        if name not in state:
            visit(name)
    for name, nodes in back.items():
        body = []
        for node in trees[name].body:
            if id(node) in nodes and isinstance(node, ast.Import):
                body += [ast.parse(f'{a.asname or a.name.split(".")[0]} = _lazy({(a.name if a.asname else a.name.split(".")[0])!r})').body[0]
                         for a in node.names]
            else:
                if id(node) in nodes:
                    print(f'{name}: a from-import closes a cycle: {ast.unparse(node)}', file=sys.stderr)
                body.append(node)
        trees[name].body = body


# Python library modules Transcrypt has (transcrypt/modules).
TRANSCRYPT = {'cmath', 'copy', 'dataclasses', 'datetime', 'inspect', 'itertools', 'logging', 'math', 'random', 're', 'time',
              'typing', 'unicodedata', 'warnings', '__future__'}


def stub_boundary(build, trees):
    """Names the tree imports from boundary modules that do not define them, and modules neither the tree nor Transcrypt
    has, defined as None (stubbed modules say so), so the tree compiles while the boundary grows."""
    wanted = {}
    def want(module, names=()):
        if module and module.split('.')[0] not in TRANSCRYPT:
            wanted.setdefault(module, set()).update(names)
    for tree in trees.values():
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and not node.level:
                want(node.module, [a.name for a in node.names])
            elif isinstance(node, ast.Import):
                for a in node.names:
                    want(a.name)
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ('_member', '_module', '_lazy') \
                    and all(isinstance(a, ast.Constant) for a in node.args):
                want(node.args[0].value, [node.args[1].value] if len(node.args) > 1 else [])
    for module, names in wanted.items():
        path = module_path(build, module)
        if is_module(build, module) and module_name(build, path) in trees and not module.startswith('_bpy'):
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        for package in (module.rsplit('.', i)[0] for i in range(1, module.count('.') + 1)):
            os.makedirs(os.path.join(build, *package.split('.')), exist_ok=True)
            open(os.path.join(build, *package.split('.'), '__init__.py'), 'a').close()
        source = open(path).read() if os.path.exists(path) else f'# {module}: stubbed by tree.py; not at the boundary yet.\n'
        defined = {d for d in (transpile.defined_name(n) for n in ast.parse(source).body) if d}
        missing = sorted(n for n in names - defined if not is_module(build, f'{module}.{n}'))
        open(path, 'w').write(source + ''.join(f'{n} = None\n' for n in missing))
        trees.setdefault(module, ast.parse(open(path).read()))


def prepare(build):
    """The passes over every module; returns the modules' names."""
    trees = {}
    for root, _, names in os.walk(build):
        for file in names:
            if file.endswith('.py'):
                path = os.path.join(root, file)
                name = module_name(build, path)
                package = name if file == '__init__.py' else name.rpartition('.')[0]
                tree = ast.parse(open(path).read())
                tree = Imports(build, name, package).visit(tree)
                trees[name] = transpile.TranscryptFixes().visit(ast.parse(ast.unparse(tree)))
    entry = sorted(n for n in trees if n != '_modules')
    lazy_cycles(build, trees, entry)
    stub_boundary(build, trees)
    for name, tree in trees.items():
        source = ast.unparse(tree)
        if name != '_modules' and re.search(r'\b_(module|member|lazy)\(', source):
            source = 'from _modules import _module, _member, _lazy\n' + source
        source += transpile.HELPERS if transpile.uses_helpers(source) else ''
        open(module_path(build, name), 'w').write(source)
    open(os.path.join(build, '__main__.py'), 'w').write(''.join(f'import {n}\n' for n in entry))
    return entry


def compile_tree(build):
    result = subprocess.run([sys.executable, '-P', '-s', '-m', 'transcrypt', '-b', '-n', '-k', '-m', '__main__.py'], cwd=build,
                            capture_output=True, text=True, env={**os.environ, 'PYTHONHASHSEED': '0'})
    if 'Error while compiling' in result.stdout + result.stderr:
        sys.exit((result.stdout + result.stderr).split('Error while compiling')[-1])
    return os.path.join(build, '__target__')


def write(target, modules):
    """The modules, each registering itself in the module registry, into src/bl_py."""
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    for file in os.listdir(target):
        if not file.endswith('.js'):
            continue
        script = open(os.path.join(target, file)).read()
        script = re.sub(r"^// Transcrypt'ed from Python, .*\n", '', script, flags=re.M)
        name = file[:-3]
        if name in modules:
            script += f"\nimport * as __self__ from './{file}';\n(globalThis.__py_modules ??= {{}})[{name!r}] = __self__;\n"
        open(os.path.join(OUT, file), 'w').write(f'// Generated by tools/blender-ui/tree.py from Blender {transpile.TAG}; do not edit.\n' + script)
    print(f'wrote {len(os.listdir(OUT))} files to {os.path.relpath(OUT, transpile.REPO)}')


def main():
    keep = sys.argv[sys.argv.index('--keep') + 1] if '--keep' in sys.argv else None
    if keep:
        shutil.rmtree(keep, ignore_errors=True)
        os.makedirs(keep)
    with tempfile.TemporaryDirectory() as temporary:
        build = keep or temporary
        assemble(build)
        modules = prepare(build)
        target = compile_tree(build)
        print(f'{len(modules)} modules compiled')
        if '--check' not in sys.argv:
            write(target, set(modules))


if __name__ == '__main__':
    main()
