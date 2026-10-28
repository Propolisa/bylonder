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
BOUNDARY = ['boundary', 'mathutils', 'idprop']


# Each of Blender's scripts in the build (by its path there) and where Blender has it ('/blender/scripts/startup/...').
FILES = {}


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
    files = [f for root in ROOTS for f in transpile.listing(root)]
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
        FILES[relative] = '/blender/' + path
    for root, _, names in os.walk(build):
        if root != build and '__init__.py' not in names:
            open(os.path.join(root, '__init__.py'), 'w').close()
    for package in BOUNDARY:
        source = os.path.join(HERE, package)
        target = build if package == 'boundary' else os.path.join(build, package)
        shutil.copytree(source, target, dirs_exist_ok=True)
    open(os.path.join(build, '_files.py'), 'w').write(
        "# Blender's scripts as files where Blender has them (written by tree.py), for the boundary's os.\n"
        f'files = {sorted(FILES.values())!r}\n')


def bpy_types(build):
    """_bpy/types.py, Blender's bpy.types: RNA's structs as classes with their bases (src/makesrna/rna-structs.json,
    written by Blender), then Blender's Python additions to them (_bpy_types.py), as Blender merges the two; modules
    are immutable in JS, so the merge happens here, and _bpy_types re-exports the merged classes."""
    structs = json.load(open(os.path.join(transpile.REPO, 'src', 'makesrna', 'rna-structs.json')))
    order, seen = [], set()
    def visit(name):
        if name in seen:
            return
        seen.add(name)
        if structs[name]['base']:
            visit(structs[name]['base'])
        order.append(name)
    for name in sorted(structs):
        visit(name)
    additions = ast.parse(open(os.path.join(build, '_bpy_types.py')).read())
    defined = [d for n in additions.body for d in transpile.defined_names(n)]
    # The structs Blender's additions define are theirs; those deriving from one come after them.
    def after(name):
        base = structs[name]['base']
        return bool(base) and (base in defined or after(base))
    stub = lambda n: f"class {n}({structs[n]['base'] or 'bpy_struct'}):\n    pass\n\n\n"
    stubs = ''.join(stub(n) for n in order if n not in defined and not after(n))
    later = ''.join(stub(n) for n in order if n not in defined and after(n))
    body = [n for n in additions.body if not (isinstance(n, ast.ImportFrom) and n.module == '_bpy')]
    namespace = 'class _types:\n' + ''.join(f'    {n} = {n}\n' for n in ('bpy_struct', 'bpy_struct_meta_idprop', 'bpy_func', 'ID', 'Struct'))
    open(os.path.join(build, '_bpy', 'types.py'), 'w').write(
        "# Blender's bpy.types: RNA's structs (generated by tree.py) merged with Blender's _bpy_types.py.\n"
        "__pragma__('js', '{}', '/* js-import {blRna, hasStruct} from ../makesrna/rna.js */')\n"
        'class bpy_struct:\n    pass\n\n\n'
        "# bl_rna of every struct class, by its name, as Blender gives each its StructRNA.\n"
        "__pragma__('js', '{}', \"globalThis.Object.defineProperty(bpy_struct, 'bl_rna', {get() { return blRna(this.__name__); }, enumerable: true, configurable: true});\")\n"
        "# Struct.bl_rna_get_subclass (rna_access.cc): a registered subclass's RNA by idname (a node type's).\n"
        "__pragma__('js', '{}', \"bpy_struct.bl_rna_get_subclass = (id, fallback = null) => hasStruct(id) ? blRna(id) : fallback;\")\n"
        '\n\nclass bpy_struct_meta_idprop(type):\n    pass\n\n\n'
        'class bpy_func:\n    pass\n\n\nclass bpy_prop_collection:\n    pass\n\n\n'
        + stubs + namespace + '\n\n' + ast.unparse(ast.Module(body=body, type_ignores=[])) + '\n\n\n' + later)
    open(os.path.join(build, '_bpy_types.py'), 'w').write(
        "# Blender's _bpy_types.py, merged into _bpy.types by tree.py.\n" + f"from _bpy.types import {', '.join(defined)}\n")


class Imports(ast.NodeTransformer):
    """Imports of bpy's C modules as _bpy's, relative imports as absolute ones, imports in functions as registry
    lookups, and __file__ as the module's path in Blender's layout."""

    def __init__(self, build, name, package, path):
        self.build, self.name, self.package, self.depth, self.path = build, name, package, 0, path

    def visit_Module(self, node):
        """A package's __import__(name=__name__, fromlist=names) with names a module-level list: its submodules imported
        as its names too, as that __import__ makes them in Python (bl_ui's register() uses them as names)."""
        lists = {t.id: n.value for n in node.body if isinstance(n, ast.Assign) and isinstance(n.value, ast.List) for t in n.targets
                 if isinstance(t, ast.Name)}
        body = []
        for statement in node.body:
            body.append(statement)
            call = statement.value if isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Call) else None
            fromlist = next((k.value for k in call.keywords if k.arg == 'fromlist'), None) if call and getattr(call.func, 'id', None) == '__import__' else None
            if isinstance(fromlist, ast.Name) and fromlist.id in lists:
                names = [e.value for e in lists[fromlist.id].elts if isinstance(e, ast.Constant)]
                body += [ast.Import([ast.alias(f'{self.name}.{n}', n)]) for n in names if is_module(self.build, f'{self.name}.{n}')]
        node.body = body
        self.generic_visit(node)
        return node

    def visit_Name(self, node):
        return ast.Constant(self.path) if node.id == '__file__' else node

    def visit_Call(self, node):
        """__import__ and globals(), which Transcrypt lacks, from the module registry."""
        self.generic_visit(node)
        if isinstance(node.func, ast.Name) and node.func.id == '__import__':
            node.func.id = '_import'
        elif isinstance(node.func, ast.Name) and node.func.id == 'globals' and not node.args:
            node.args = [ast.Constant(self.name)]
            node.func.id = '_globals'
        return node

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
        if node.module == '__future__':
            return None
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


class ModuleAttributes(ast.NodeTransformer):
    """Assignments to an imported module's attributes (_bpy.context = ...) as calls of its __py_setattr__ (write()), as
    ES modules cannot be assigned to from outside; the module reassigns its own binding, which its importers see."""

    assigned = set()  # (module, attribute) pairs the tree assigns, for write()

    def __init__(self, tree):
        self.modules = {a.asname or a.name.split('.')[0]: a.name if a.asname else a.name.split('.')[0]
                        for n in tree.body if isinstance(n, ast.Import) for a in n.names}

    def visit_Assign(self, node):
        self.generic_visit(node)
        target = node.targets[0]
        if len(node.targets) == 1 and isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name) and target.value.id in self.modules:
            ModuleAttributes.assigned.add((self.modules[target.value.id], target.attr))
            setter = ast.Attribute(ast.Name(target.value.id, ast.Load()), '__py_setattr__', ast.Load())
            return ast.copy_location(ast.Expr(ast.Call(setter, [ast.Constant(target.attr), node.value], [])), node)
        return node

    def visit_Delete(self, node):
        """del of a module's attribute as setting it to None: JS modules have no deletable attributes."""
        if len(node.targets) == 1 and isinstance(node.targets[0], ast.Attribute):
            target = node.targets[0]
            return self.visit_Assign(ast.copy_location(ast.Assign([ast.Attribute(target.value, target.attr, ast.Store())], ast.Constant(None)), node))
        return node


def lazy_cycles(build, trees, entry):
    """Module-level `import x` statements that close a cycle, as `x = _lazy('x')`, which write() makes a JS namespace
    import."""
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


def referenced_modules(tree):
    """The modules a tree imports, at module level or from functions (_module, _member, _lazy)."""
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and not node.level and node.module:
            yield node.module
        elif isinstance(node, ast.Import):
            yield from (a.name for a in node.names)
        elif isinstance(node, ast.Call) and getattr(node.func, 'id', None) in ('_member', '_module', '_lazy') and node.args \
                and isinstance(node.args[0], ast.Constant):
            yield node.args[0].value


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
        if is_module(build, module) and module_name(build, path) in trees and module.split('.')[0] != '_bpy':
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        for package in (module.rsplit('.', i)[0] for i in range(1, module.count('.') + 1)):
            os.makedirs(os.path.join(build, *package.split('.')), exist_ok=True)
            open(os.path.join(build, *package.split('.'), '__init__.py'), 'a').close()
        tree = trees.get(module) or ast.parse(f'# {module}: stubbed by tree.py; not at the boundary yet.\n')
        defined = {d for n in tree.body for d in transpile.defined_names(n)}
        missing = sorted(n for n in names - defined if not is_module(build, f'{module}.{n}'))
        tree.body += [ast.parse(f'{n} = None').body[0] for n in missing]
        trees[module] = tree
        if not os.path.exists(path):
            open(path, 'w').close()


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
                relative = os.path.relpath(path, build)
                tree = Imports(build, name, package, FILES.get(relative, '/blender/scripts/' + relative)).visit(tree)
                tree = ModuleAttributes(tree).visit(tree)
                trees[name] = transpile.TranscryptFixes().visit(ast.parse(ast.unparse(tree)))
    # The boundary first, then bpy, then the rest: Blender sets up _bpy before any script runs.
    boundary = {f.removesuffix('.py') for f in os.listdir(os.path.join(HERE, 'boundary'))} | set(BOUNDARY)
    first = lambda n: (0 if n.split('.')[0] in boundary else 1 if n.split('.')[0] == 'bpy' else 2, n)
    lazy_cycles(build, trees, sorted((n for n in trees if n != '_modules'), key=first))
    stub_boundary(build, trees)
    # Every module, stubs included: those only looked up from functions load here too, and first Transcrypt's library
    # modules the tree uses, which register like the others.
    library = sorted({m for tree in trees.values() for m in referenced_modules(tree) if m in TRANSCRYPT - {'__future__', 'typing'}})
    entry = library + sorted((n for n in trees if n != '_modules'), key=first)
    # Blender's startup (bpy.main(), called at the end of bpy's __init__, which loads the scripts) runs from the entry
    # module once every module has loaded: modules load ahead of their use here, not on import as in Python.
    trees['bpy'].body = [n for n in trees['bpy'].body if not (isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)
                                                               and isinstance(n.value.func, ast.Name) and n.value.func.id == 'main')]
    for name, tree in trees.items():
        source = ast.unparse(tree)
        if name != '_modules' and re.search(r'\b_(module|member|lazy|import|globals)\(', source):
            source = 'from _modules import _module, _member, _lazy, _import, _globals\n' + source
        source = (transpile.HELPERS if transpile.uses_helpers(source) else '') + source
        # Operator overloading for the tree's modules (a + b of lists), not for Transcrypt's, which assume JS operators;
        # with it, loops index their iterable, so iterators become lists (iconv, __i__).
        open(module_path(build, name), 'w').write("__pragma__('opov')\n__pragma__('iconv')\n" + source)
    # Aliased: Transcrypt names an imported module by its name without underscores, so _bpy_types and bpy_types collide.
    # Reversed: Transcrypt emits a module's imports last first.
    open(os.path.join(build, '__main__.py'), 'w').write(''.join(f'import {n} as _m{i}\n' for i, n in reversed(list(enumerate(entry))))
                                                       + f'_m{entry.index("bpy")}.main()\n')
    return entry


def compile_tree(build):
    result = subprocess.run([sys.executable, '-P', '-s', '-m', 'transcrypt', '-b', '-n', '-k', '-m', '__main__.py'], cwd=build,
                            capture_output=True, text=True, env={**os.environ, 'PYTHONHASHSEED': '0'})
    if 'Error while compiling' in result.stdout + result.stderr:
        sys.exit((result.stdout + result.stderr).split('Error while compiling')[-1])
    return os.path.join(build, '__target__')


# Bylonder's JS modules a boundary module imports, written in a pragma as this comment: Transcrypt would resolve an
# import statement in a pragma as a Python module.
JS_IMPORT = r'/\* js-import (\{[^}]*\}) from (\S+) \*/'


def forwarded(script, attributes):
    """The __py_setattr__ cases for imported names among a module's attributes that other modules assign: the module
    they come from sets them, and this module's live binding follows."""
    cases = ''
    for name in sorted(attributes):
        found = re.search(rf"^import \{{[^}}]*?\b(\w+) as {name}\b[^}}]*\}} from ('[^']*');$|^import \{{[^}}]*?\b{name}\b[^}}]*\}} from ('[^']*');$", script, flags=re.M)
        if found and not re.search(rf'^export var {name}\b', script, flags=re.M):
            source, path = found[1] or name, found[2] or found[3]
            script = f"import * as __source_{name}__ from {path};\n" + script
            cases += f"\t\tcase {name!r}: __source_{name}__.__py_setattr__ ({source!r}, value); break;\n"
    return script, cases


def reexport(script):
    """A module's imported names exported too, as in Python they are its attributes (bpy.path.extensions_image)."""
    exported = set(re.findall(r'^export (?:var|function|class) (\w+)', script, flags=re.M))
    exported |= {n.split(' as ')[-1].strip() for group in re.findall(r'^export \{([^}]*)\};', script, flags=re.M) for n in group.split(',')}
    imported = [n.split(' as ')[-1].strip() for group in re.findall(r"^import \{([^}]*)\} from '\./(?!org\.transcrypt)[^']*';", script, flags=re.M)
                for n in group.split(',')]
    missing = sorted(set(imported) - exported)
    return script + (f"\nexport {{{', '.join(missing)}}};\n" if missing else '')


def write(target, modules):
    """The modules, each registering itself in the module registry, into src/bl_py."""
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    for file in os.listdir(target):
        if not file.endswith('.js'):
            continue
        script = transpile.finish(file, open(os.path.join(target, file)).read())
        # Blender's RNA has a class named Object, which shadows JS's in the modules defining or importing it.
        script = re.sub(r'\bObject\.(defineProperty|defineProperties|getOwnPropertyNames|getOwnPropertyDescriptor|create|keys|assign|'
                        r'getPrototypeOf|setPrototypeOf|entries)\b', r'globalThis.Object.\1', script)
        # Imports closing a cycle as JS namespace imports, which JS allows in a cycle (Transcrypt does not): the
        # module's re-exports are live before its own code has run, as a partly run module is in Python.
        lazy_call = r"(?:_lazy \(|__call__ \(_lazy, null, )'([\w.]+)'\)"  # without and with operator overloading
        lazy = sorted(set(re.findall(lazy_call, script)))
        for i, module in enumerate(lazy):
            script = re.sub(lazy_call.replace(r"([\w.]+)", re.escape(module)), f'__cycle{i}__', script)
            script = f"import * as __cycle{i}__ from './{module}.js';\n" + script
        # Bylonder's JS modules the boundary imports (Transcrypt would look for an import in a pragma as Python).
        imports = re.findall(JS_IMPORT, script)
        script = ''.join(f"import {names} from '{path}';\n" for names, path in imports) + re.sub(JS_IMPORT, '', script)
        script = reexport(script)
        script, cases = forwarded(script, {attribute for module, attribute in ModuleAttributes.assigned if module == file[:-3]})
        variables = re.findall(r'^export var (\w+)', script, flags=re.M)
        script += ('\nexport function __py_setattr__ (key, value) {\n\tswitch (key) {\n'
                   + ''.join(f'\t\tcase {v!r}: {v} = value; break;\n' for v in variables) + cases
                   + "\t\tdefault: throw new Error (`module attribute ${key} cannot be set`);\n\t}\n}\n")
        name = file[:-3]
        if name in modules:
            # Registered first: a module imported in a cycle is used before it has run to its end, as in Python.
            script = f"import * as __self__ from './{file}';\n(globalThis.__py_modules ??= {{}})[{name!r}] = __self__;\n" + script
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
        bpy_types(build)
        modules = prepare(build)
        target = compile_tree(build)
        print(f'{len(modules)} modules compiled')
        if '--check' not in sys.argv:
            write(target, set(modules))


if __name__ == '__main__':
    main()
