"""Blender's UI scripts as JS modules: the scripts manifest.json names (paths may hold *), each with the classes and
functions its patterns match (* for all, ! to leave out) and what they use, and the names they import from Blender's
modules ("modules" in the manifest), taken from Blender's scripts at the port's tag and transpiled by Transcrypt
against Bylonder's bpy (bpy/ here) into src/bl_ui/.

usage: python3 -P tools/blender-ui/transpile.py   (needs `pip install transcrypt`; -P keeps the packages here, which
stand in for Python's own collections and os, out of this tool's imports)
"""
import ast
import fnmatch
import functools
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO, 'src', 'bl_ui')
BLENDER = 'https://projects.blender.org/api/v1/repos/blender/blender'
TAG = json.load(open(os.path.join(REPO, 'tools', 'blender-port', 'manifest.json')))['blender']


# Where Transcrypt's Python differs from what Blender's scripts use: (generated file, text, replacement, reason).
FORMAT = "str.format with a format spec ('{:s}', '{:.2f}'), which Transcrypt leaves unformatted"
PATCHES = [
    ('org.transcrypt.__runtime__.js', "return self.replace (/\\{(\\w*)\\}/g, function (match, key) {",
     "return self.replace (/\\{(\\w*)(?::([^}]*))?\\}/g, function (match, key, spec) {", FORMAT),
    ('org.transcrypt.__runtime__.js', "return args [key] === undefined ? match : str (args [key]);",
     "return args [key] === undefined ? match : __format_spec__ (args [key], spec);", FORMAT),
    ('org.transcrypt.__runtime__.js', "return str (args [index][key]);", "return __format_spec__ (args [index][key], spec);", FORMAT),
    ('org.transcrypt.__runtime__.js', "__setproperty__ (String.prototype, 'format', {",
     "var __format_spec__ = function (value, spec) {\n"
     "    var fixed = spec && /^\\.(\\d+)f$/.exec (spec);\n"
     "    return fixed ? Number (value).toFixed (+fixed [1]) : str (value);\n"
     "};\n"
     "__setproperty__ (String.prototype, 'format', {", FORMAT),
    # JS's % on numbers is C's fmod: the remainder with the dividend's sign.
    ('math.js', "export var expm1 = function (x) {", "export var fmod = function (x, y) {\n\treturn x % y;\n};\nexport var expm1 = function (x) {",
     "math.fmod, which Transcrypt's math lacks"),
]


def listing(folder):
    """The paths of the files in a Blender folder at the tag, cached."""
    cache = os.path.join(os.path.expanduser('~/.cache/bylonder/blender'), TAG, folder, '.listing.json')
    if not os.path.exists(cache):
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        url = f'{BLENDER}/contents/{urllib.parse.quote(folder)}?ref={TAG}'
        entries = json.loads(subprocess.run(['curl', '-sfL', url], capture_output=True, check=True).stdout)
        json.dump([entry['path'] for entry in entries if entry['type'] == 'file'], open(cache, 'w'))
    return json.load(open(cache))


def fetch(path):
    """A Blender file at the tag, cached."""
    cache = os.path.join(os.path.expanduser('~/.cache/bylonder/blender'), TAG, path)
    if not os.path.exists(cache):
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        url = f'{BLENDER}/raw/{urllib.parse.quote(path, safe="")}?ref={TAG}'
        text = subprocess.run(['curl', '-sfL', url], capture_output=True, check=True).stdout
        open(cache, 'wb').write(text)
    return open(cache).read()


# The modules Blender's scripts import that Bylonder has: its own (the packages here: bpy, mathutils, ...) and
# Transcrypt's math. Other modules come from Blender's scripts, taken as far as the importing code uses them.
LOCAL = {d for d in os.listdir(HERE) if os.path.exists(os.path.join(HERE, d, '__init__.py'))} | {'math'}


# The Blender modules outside the manifest's scripts that the scripts may import (manifest.json's "modules").
IMPORTS = json.load(open(os.path.join(HERE, 'manifest.json'))).get('modules', [])


def blender_module(module):
    """A Blender module's path for its dotted name (bl_ui.utils, rna_prop_ui, bpy_extras.node_utils), or None for
    Bylonder's own and the modules the build leaves out."""
    parts = module.split('.')
    if parts[0] in LOCAL or not any(fnmatch.fnmatchcase(module, p) for p in IMPORTS):
        return None
    return 'scripts/startup/' + '/'.join(parts) + '.py' if parts[0] == 'bl_ui' else 'scripts/modules/' + '/'.join(parts) + '.py'


def module_name(path):
    return os.path.basename(path)[:-3]


# The Blender modules the scripts import, by the flat name the build gives them: their paths.
SOURCES = {}


def flat(module):
    path = blender_module(module)
    if not path:
        return module
    SOURCES[module_name(path)] = path
    return module_name(path)


class FlatImports(ast.NodeTransformer):
    """Imports of Blender's modules as imports of the flat modules the build holds (bl_ui.utils as utils); `from bl_ui
    import anim` as `import anim`."""
    def visit_ImportFrom(self, node):
        module = ('bl_ui' + ('.' if node.module else '') if node.level else '') + (node.module or '')
        if module == 'bl_ui':
            return ast.Import(names=[ast.alias(flat('bl_ui.' + a.name), a.asname) for a in node.names])
        return ast.ImportFrom(module=flat(module), names=node.names, level=0)

    def visit_Import(self, node):
        return ast.Import(names=[ast.alias(flat(a.name), a.asname or (a.name if '.' in a.name and blender_module(a.name) else None))
                                 for a in node.names])


def taken(tree, patterns):
    """The module-level nodes matching patterns ('!' excludes) with what they use from the module, in its order."""
    match = lambda name, ps: any(fnmatch.fnmatchcase(name, p) for p in ps)
    defined = {defined_name(node): node for node in tree.body if defined_name(node)}
    exclude = [p[1:] for p in patterns if p.startswith('!')]
    wanted, todo = set(), [name for name in defined if match(name, patterns) and not match(name, exclude)]
    while todo:
        name = todo.pop()
        if name in wanted:
            continue
        wanted.add(name)
        todo += [n.id for n in ast.walk(defined[name]) if isinstance(n, ast.Name) and n.id in defined]
    return [node for node in tree.body if defined_name(node) in wanted]


@functools.cache
def exists(path):
    try:
        return bool(fetch(path))
    except subprocess.CalledProcessError:
        return False


def parse(path):
    """A Blender script's syntax tree with its imports of Blender's modules made flat, or None if Blender lacks it."""
    return FlatImports().visit(ast.parse(fetch(path))) if exists(path) else None


def requirements(tree, patterns, modules):
    """What the taken code imports from the build's modules: {module: names}. A module imported whole gives the
    attributes the code reads of it."""
    nodes = taken(tree, patterns)
    used = {n.id for node in nodes for n in ast.walk(node) if isinstance(n, ast.Name)}
    attributes = {(n.value.id, n.attr) for node in nodes for n in ast.walk(node)
                  if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name)}
    found = {}
    for node in tree.body + [n for node in nodes for n in ast.walk(node)]:
        if isinstance(node, ast.ImportFrom) and node.module in modules:
            found.setdefault(node.module, set()).update(a.name for a in node.names if (a.asname or a.name) in used)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name in modules and (alias.asname or alias.name) in used:
                    found.setdefault(alias.name, set()).update(attr for name, attr in attributes if name == (alias.asname or alias.name))
    return found


def extract(tree, patterns, modules):
    """The module's imports the build has, then the classes and functions matching patterns with what they use from
    the module (constants too), in its order."""
    importable = lambda name: name.split('.')[0] in LOCAL or name in modules
    imports = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom))
               and all(importable(alias.name) for alias in node.names if isinstance(node, ast.Import))
               and (not isinstance(node, ast.ImportFrom) or importable(node.module))]
    nodes = taken(tree, patterns)
    # Only the imported names the taken code uses.
    used = {n.id for node in nodes for n in ast.walk(node) if isinstance(n, ast.Name)}
    for node in imports:
        node.names = [alias for alias in node.names if (alias.asname or alias.name).split('.')[0] in used]
    body = [node for node in imports if node.names] + nodes
    source = ast.unparse(ast.Module(body=hoist_imports(body, importable), type_ignores=[]))
    rewritten = ast.unparse(ast.fix_missing_locations(TranscryptFixes().visit(ast.parse(source))))
    return rewritten + (HELPERS if rewritten != source else '')


def closure(scripts):
    """The scripts to build, {module: (path, patterns, flags)}: the manifest's, and the Blender modules they import with
    the names they use, until nothing more is needed."""
    modules = {module_name(path): (path, list(patterns), flags) for path, (patterns, flags) in scripts.items()}
    trees, changed = {}, True
    while changed:
        changed = False
        for module, (path, patterns, flags) in list(modules.items()):
            if path not in trees:
                trees[path] = parse(path)
            if trees[path] is None:
                continue
            candidates = set(modules) | {name for name in SOURCES if exists(SOURCES[name])}
            for target, names in requirements(trees[path], patterns, candidates).items():
                if target not in modules:
                    modules[target] = (SOURCES[target], [], flags)
                    changed = True
                missing = sorted(names - set(modules[target][1]))
                if missing:
                    modules[target][1].extend(missing)
                    changed = True
    return {module: entry for module, entry in modules.items() if trees.get(entry[0]) is not None}, trees


def defined_name(node):
    """The name a module-level class, function or single-name assignment defines."""
    if isinstance(node, (ast.ClassDef, ast.FunctionDef)):
        return node.name
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        return node.targets[0].id
    return None




class TranscryptFixes(ast.NodeTransformer):
    """Python Transcrypt compiles wrong, rewritten to what it compiles right, with the helpers HELPERS defines."""
    classes = []

    def visit_ClassDef(self, node):
        self.classes.append(node.name)
        self.generic_visit(node)
        self.classes.pop()
        return node

    def visit_FunctionDef(self, node):
        """super().f(...) in a classmethod, which Transcrypt calls with an undefined self, as the base's f bound to cls."""
        self.generic_visit(node)
        if self.classes and any(isinstance(d, ast.Name) and d.id == 'classmethod' for d in node.decorator_list) and node.args.args:
            cls = node.args.args[0].arg
            for call in ast.walk(node):
                if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Call) \
                        and isinstance(call.func.value.func, ast.Name) and call.func.value.func.id == 'super':
                    call.func = ast.Call(ast.Name('_super_classmethod', ast.Load()),
                                         [ast.Name(self.classes[-1], ast.Load()), ast.Name(cls, ast.Load()), ast.Constant(call.func.attr)], [])
        return node

    def hoist_named(self, node, field):
        """x := y in an if or return, which Transcrypt compiles wrong, as an assignment before it."""
        assignments = []
        class Named(ast.NodeTransformer):
            def visit_NamedExpr(self, named):
                self.generic_visit(named)
                assignments.append(ast.Assign([ast.Name(named.target.id, ast.Store())], named.value))
                return ast.Name(named.target.id, ast.Load())
            def visit_Lambda(self, other):
                return other
            visit_ListComp = visit_SetComp = visit_DictComp = visit_GeneratorExp = visit_Lambda
        setattr(node, field, Named().visit(getattr(node, field)))
        return assignments + [node] if assignments else node

    def visit_If(self, node):
        self.generic_visit(node)
        return self.hoist_named(node, 'test')

    def visit_Return(self, node):
        self.generic_visit(node)
        return self.hoist_named(node, 'value') if node.value else node
    def visit_Dict(self, node):
        self.generic_visit(node)
        if None not in node.keys:
            return node
        parts, run = [], ast.Dict(keys=[], values=[])
        for key, value in zip(node.keys, node.values):
            if key is None:
                parts += [run, value] if run.keys else [value]
                run = ast.Dict(keys=[], values=[])
            else:
                run.keys.append(key)
                run.values.append(value)
        parts += [run] if run.keys else []
        return ast.Call(func=ast.Name('_merged', ast.Load()), args=parts, keywords=[])

    def visit_List(self, node):
        self.generic_visit(node)
        if not any(isinstance(e, ast.Starred) for e in node.elts):
            return node
        parts, run = [], []
        for element in node.elts:
            if isinstance(element, ast.Starred):
                parts += ([ast.List(elts=run, ctx=ast.Load())] if run else []) + [element.value]
                run = []
            else:
                run.append(element)
        parts += [ast.List(elts=run, ctx=ast.Load())] if run else []
        return ast.Call(func=ast.Name('_joined', ast.Load()), args=parts, keywords=[])

    visit_Tuple = visit_List

    def visit_Call(self, node):
        """f(a=1, **b) as f(**_merged({'a': 1}, b)): Transcrypt compiles the mix wrong, and marks the dict it unpacks,
        which may be shared, as keyword arguments."""
        self.generic_visit(node)
        if isinstance(node.func, ast.Name) and node.func.id == 'zip':
            # zip's strict only checks lengths, and Transcrypt's zip takes it for an iterable.
            node.keywords = [k for k in node.keywords if k.arg != 'strict']
        if not any(k.arg is None for k in node.keywords):
            return node
        merged = ast.Dict(keys=[ast.Constant(k.arg) if k.arg else None for k in node.keywords], values=[k.value for k in node.keywords])
        node.keywords = [ast.keyword(arg=None, value=ast.Call(func=ast.Name('_merged', ast.Load()), args=self.visit_Dict(merged).args
                                                                if None in merged.keys else [merged], keywords=[]))]
        return node

    def visit_Match(self, node):
        """match, which Transcrypt lacks, as if and elif on the subject (value, or and sequence patterns, and _)."""
        self.generic_visit(node)
        subject = ast.Name('_subject', ast.Load())
        def test(pattern, value):
            if isinstance(pattern, ast.MatchValue):
                return ast.Compare(value, [ast.Eq()], [pattern.value])
            if isinstance(pattern, ast.MatchOr):
                return ast.BoolOp(ast.Or(), [test(p, value) for p in pattern.patterns])
            if isinstance(pattern, ast.MatchSequence):
                is_sequence = ast.Call(ast.Name('isinstance', ast.Load()), [value, ast.Tuple([ast.Name('list', ast.Load()), ast.Name('tuple', ast.Load())], ast.Load())], [])
                length = ast.Compare(ast.Call(ast.Name('len', ast.Load()), [value], []), [ast.Eq()], [ast.Constant(len(pattern.patterns))])
                items = [test(p, ast.Subscript(value, ast.Constant(i), ast.Load())) for i, p in enumerate(pattern.patterns)]
                return ast.BoolOp(ast.And(), [is_sequence, length, *items])
            assert isinstance(pattern, ast.MatchAs) and pattern.pattern is None and pattern.name is None, ast.dump(pattern)
            return ast.Constant(True)
        chain = None
        for case in reversed(node.cases):
            chain = [ast.If(test(case.pattern, subject), case.body, chain or [])]
        return [ast.Assign([ast.Name('_subject', ast.Store())], node.subject), *(chain or [])]

    def visit_Delete(self, node):
        """del d[k], which Transcrypt compiles to a no-op with operator overloading, as d.pop(k)."""
        self.generic_visit(node)
        if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Subscript) or isinstance(node.targets[0].slice, ast.Slice):
            return node
        target = node.targets[0]
        return ast.Expr(ast.Call(func=ast.Attribute(target.value, 'pop', ast.Load()), args=[target.slice], keywords=[]))

    def visit_JoinedStr(self, node):
        """f-strings, which Transcrypt mis-parses with brace escapes ({{), as ''.join of their parts."""
        self.generic_visit(node)
        parts = [value if isinstance(value, ast.Constant) else ast.Call(
            func=ast.Name('_formatted', ast.Load()),
            args=[value.value, ast.Constant(chr(value.conversion) if value.conversion > 0 else ''), value.format_spec or ast.Constant('')],
            keywords=[]) for value in node.values]
        return ast.Call(func=ast.Attribute(ast.Constant(''), 'join', ast.Load()), args=[ast.List(elts=parts, ctx=ast.Load())], keywords=[])

    def visit_comprehension(self, node):
        """Comprehensions loop by index up to len(), which is 0 for iterators (enumerate, zip, generators): the
        iterable as a list."""
        self.generic_visit(node)
        if isinstance(node.iter, ast.Call):
            node.iter = ast.Call(func=ast.Name('list', ast.Load()), args=[node.iter], keywords=[])
        return node


HELPERS = '''
def _merged(*dicts):
    result = {}
    for d in dicts:
        result.update(d)
    return result


def _formatted(value, conversion, spec):
    if conversion == 'r':
        value = repr(value)
    elif conversion == 's':
        value = str(value)
    return ('{:' + spec + '}').format(value) if spec else str(value)


def _joined(*lists):
    result = []
    for items in lists:
        result.extend(list(items))
    return result


def _super_classmethod(owner, cls, method):
    return __pragma__('js', '{}', 'owner.__bases__.map((base) => Object.getOwnPropertyDescriptor(base, method)).filter(Boolean).map((d) => (d.get ? d.get.call(cls) : d.value))[0]')
'''


def hoist_imports(body, importable):
    """Function-local imports (methods' too) of modules the build has moved to the module, merged: Transcrypt emits
    each as an ES import, and two of one module are a syntax error."""
    names, modules = {}, {}
    blocks = [(node, field) for function in ast.walk(ast.Module(body=body, type_ignores=[])) if isinstance(function, ast.FunctionDef)
              for node in ast.walk(function) for field in ('body', 'orelse', 'finalbody', 'handlers')
              if isinstance(getattr(node, field, None), list) and node is not function or field == 'body' and node is function]
    for node, field in blocks:
        statements = getattr(node, field)
        local = [s for s in statements if isinstance(s, (ast.Import, ast.ImportFrom))]
        if not local:
            continue
        setattr(node, field, [s for s in statements if s not in local] or ([ast.Pass()] if field == 'body' else []))
        for statement in local:
            if isinstance(statement, ast.Import):
                statement.names = [alias for alias in statement.names if importable(alias.name)]
                modules.update((alias.name, alias) for alias in statement.names)
            elif importable(statement.module):
                names.setdefault(statement.module, {}).update((alias.name, alias) for alias in statement.names)
    hoisted = ([ast.Import(names=list(modules.values()))] if modules else []) + \
        [ast.ImportFrom(module=module, names=list(aliases.values()), level=0) for module, aliases in names.items()]
    return [node for node in body if isinstance(node, (ast.Import, ast.ImportFrom))] + hoisted + \
        [node for node in body if not isinstance(node, (ast.Import, ast.ImportFrom))]


def rna_module():
    """bpy/_rna.py: the RNA the scripts read when they load (Modifier's type enum), from src/makesrna/rna-modifiers.json."""
    modifiers = json.load(open(os.path.join(REPO, 'src', 'makesrna', 'rna-modifiers.json')))
    items = ',\n    '.join(f'_Item({t!r}, {d["name"]!r}, {d["icon"]!r}, {d["description"]!r})' for t, d in modifiers['types'].items())
    return f'''# Generated by transpile.py from src/makesrna/rna-modifiers.json.
class _Item:
    def __init__(self, identifier, name, icon, description):
        self.identifier, self.name, self.icon, self.description = identifier, name, icon, description


class _Property:
    def __init__(self, items):
        self.enum_items = self.enum_items_static = items
        self.translation_context = '*'


class _Struct:
    def __init__(self, properties):
        self.properties = properties


Modifier = _Struct({{'type': _Property([
    {items}])}})
'''


def main():
    manifest = json.load(open(os.path.join(HERE, 'manifest.json')))
    with tempfile.TemporaryDirectory() as build:
        # Bylonder's versions of the modules Blender's scripts import (bpy, mathutils, ...): the packages here.
        for package in (d for d in os.listdir(HERE) if os.path.exists(os.path.join(HERE, d, '__init__.py'))):
            shutil.copytree(os.path.join(HERE, package), os.path.join(build, package))
        open(os.path.join(build, 'bpy', '_rna.py'), 'w').write(rna_module())
        # A script's names, or {names, flags}: Transcrypt options for its Python (-o for operator overloading, -t for
        # Python's truth values). A path with * names every script it matches in Blender's folder.
        scripts = {}
        for pattern, spec in manifest['scripts'].items():
            entry = (spec['names'], spec['flags']) if isinstance(spec, dict) else (spec, [])
            for path in (fnmatch.filter(listing(os.path.dirname(pattern)), pattern) if '*' in pattern else [pattern]):
                scripts[path] = entry
        built, _ = closure(scripts)
        modules = []
        for module, (path, patterns, flags) in built.items():
            open(os.path.join(build, module + '.py'), 'w').write(extract(parse(path), patterns, set(built)))
            modules.append((module + '.py', flags))
        # Transcrypt rebuilds its target folder on each run (-b), so each module's output is collected as it is made.
        # A module with options keeps only its own output and the modules no other one has: the runtime and library
        # modules the others share keep the default compile.
        outputs = {}
        for module, flags in sorted(modules, key=lambda m: bool(m[1])):
            # A fixed hash seed keeps Transcrypt's export order, and so its output, the same on every run.
            result = subprocess.run([sys.executable, '-P', '-s', '-m', 'transcrypt', '-b', '-n', '-k', *flags, '-m', module], cwd=build,
                                    capture_output=True, text=True, env={**os.environ, 'PYTHONHASHSEED': '0'})
            if result.returncode:
                sys.exit(result.stdout + result.stderr)
            target = os.path.join(build, '__target__')
            for name in os.listdir(target):
                if name.endswith('.js') and (not flags or name == module.replace('.py', '.js') or name not in outputs):
                    outputs[name] = open(os.path.join(target, name)).read()
        os.makedirs(OUT, exist_ok=True)
        for name, script in outputs.items():
            for target, text, replacement, reason in PATCHES:
                if target == name:
                    assert text in script, f'{name}: the patch for {reason} no longer applies'
                    script = script.replace(text, replacement)
            # Keyword arguments reach a parameter Transcrypt renames (type as py_metatype, others with a py_ prefix) under
            # its Python name too, as they do when they come from a dict (**kwargs).
            script = re.sub(r"case 'py_(metatype|\w+)': var py_\1", lambda m: f"case '{'type' if m[1] == 'metatype' else m[1]}': case 'py_{m[1]}': var py_{m[1]}", script)
            # Transcrypt dates its output; without the date a rerun gives the same files.
            script = re.sub(r"^// Transcrypt'ed from Python, .*\n", '', script, flags=re.M)
            header = f'// Generated by tools/blender-ui/transpile.py from Blender {TAG}; do not edit.\n'
            open(os.path.join(OUT, name), 'w').write(header + script)
            print('wrote', os.path.relpath(os.path.join(OUT, name), REPO))

if __name__ == '__main__':
    main()
