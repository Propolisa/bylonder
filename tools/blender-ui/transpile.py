"""Blender's UI scripts as JS modules: the classes manifest.json names (a trailing * matches a prefix), with the base
classes and module-level functions they use, taken from Blender's scripts at the port's tag and transpiled by
Transcrypt against Bylonder's bpy (bpy/ here) into src/bl_ui/.

usage: python3 tools/blender-ui/transpile.py   (needs `pip install transcrypt`)
"""
import ast
import fnmatch
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


def fetch(path):
    """A Blender file at the tag, cached."""
    cache = os.path.join(os.path.expanduser('~/.cache/bylonder/blender'), TAG, path)
    if not os.path.exists(cache):
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        url = f'{BLENDER}/raw/{urllib.parse.quote(path, safe="")}?ref={TAG}'
        open(cache, 'wb').write(subprocess.run(['curl', '-sfL', url], capture_output=True, check=True).stdout)
    return open(cache).read()


# The modules Blender's scripts import that Bylonder has: its bpy and mathutils (here), and Transcrypt's math.
IMPORTABLE = {'bpy', 'mathutils', 'math'}


def defined_name(node):
    """The name a module-level class, function or single-name assignment defines."""
    if isinstance(node, (ast.ClassDef, ast.FunctionDef)):
        return node.name
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        return node.targets[0].id
    return None


def extract(source, patterns):
    """The module's imports Bylonder has, then the classes and functions matching patterns with what they use from the
    module (constants too), in its order."""
    tree = ast.parse(source)
    defined = {defined_name(node): node for node in tree.body if defined_name(node)}
    wanted, todo = set(), [name for name in defined if any(fnmatch.fnmatchcase(name, p) for p in patterns)]
    while todo:
        name = todo.pop()
        if name in wanted:
            continue
        wanted.add(name)
        todo += [n.id for n in ast.walk(defined[name]) if isinstance(n, ast.Name) and n.id in defined]
    imports = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom))
               and all(alias.name.split('.')[0] in IMPORTABLE for alias in node.names if isinstance(node, ast.Import))
               and (not isinstance(node, ast.ImportFrom) or node.module.split('.')[0] in IMPORTABLE)]
    nodes = [node for node in tree.body if defined_name(node) in wanted]
    # Only the imported names the taken code uses.
    used = {n.id for node in nodes for n in ast.walk(node) if isinstance(n, ast.Name)}
    for node in imports:
        node.names = [alias for alias in node.names if (alias.asname or alias.name).split('.')[0] in used]
    body = [node for node in imports if node.names] + nodes
    source = ast.unparse(ast.Module(body=hoist_imports(body), type_ignores=[]))
    rewritten = ast.unparse(TranscryptFixes().visit(ast.parse(source)))
    return rewritten + (HELPERS if uses_helpers(rewritten) else '')


def uses_helpers(source):
    return re.search(r'\b_(merged|joined|formatted|ellipsis|property)\b', source) is not None


class TranscryptFixes(ast.NodeTransformer):
    """Python Transcrypt compiles wrong, rewritten to what it compiles right, with the helpers HELPERS defines."""
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
        if not isinstance(node.ctx, ast.Load) or not any(isinstance(e, ast.Starred) for e in node.elts):
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
        if isinstance(node.func, ast.Name) and node.func.id == 'super':
            # super(Class, self) in Class's methods is super(), the only form Transcrypt compiles.
            node.args = []
        if isinstance(node.func, ast.Name) and node.func.id == 'property' and self.scopes and self.scopes[-1] != 'class':
            # Transcrypt compiles property() only in a class body; elsewhere it is the runtime's property, by
            # another name.
            node.func = ast.Name('_property', ast.Load())
        if isinstance(node.func, ast.Name) and node.func.id == 'zip':
            # zip's strict only checks lengths, and Transcrypt's zip takes it for an iterable.
            node.keywords = [k for k in node.keywords if k.arg != 'strict']
        if not any(k.arg is None for k in node.keywords):
            return node
        merged = ast.Dict(keys=[ast.Constant(k.arg) if k.arg else None for k in node.keywords], values=[k.value for k in node.keywords])
        node.keywords = [ast.keyword(arg=None, value=ast.Call(func=ast.Name('_merged', ast.Load()), args=self.visit_Dict(merged).args
                                                                if None in merged.keys else [merged], keywords=[]))]
        return node

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

    def __init__(self):
        self.scopes = []

    def visit_FunctionDef(self, node):
        self.scopes.append('function')
        self.generic_visit(node)
        self.scopes.pop()
        return node

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        self.scopes.append('class')
        node = self.dataclass(node)
        self.scopes.pop()
        return self.annotations(node)

    @staticmethod
    def annotations(node):
        """Annotations without a value in a class body (how Blender's classes declare their properties), which
        Transcrypt cannot compile, as the __annotations__ dict Blender reads them from."""
        node.body = [ast.Assign(targets=[s.target], value=s.value) if isinstance(s, ast.AnnAssign) and s.value is not None else s
                     for s in node.body]
        annotated = [s for s in node.body if isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name)]
        if not annotated:
            return ast.fix_missing_locations(node)
        node.body = [s for s in node.body if s not in annotated]
        node.body.insert(0, ast.Assign(targets=[ast.Name('__annotations__', ast.Store())], value=ast.Dict(
            keys=[ast.Constant(s.target.id) for s in annotated], values=[s.annotation for s in annotated])))
        return ast.fix_missing_locations(node)

    def visit_AnnAssign(self, node):
        """Other annotations: an assignment, or nothing without a value."""
        self.generic_visit(node)
        if self.scopes and self.scopes[-1] == 'class':
            return node
        return ast.Assign(targets=[node.target], value=node.value) if node.value is not None else None

    def dataclass(self, node):
        """@dataclass classes, which Transcrypt cannot compile, as classes with the __init__ dataclasses would make from
        the annotated fields (defaults and field(default_factory=...) included)."""
        self.generic_visit(node)
        names = lambda d: d.id if isinstance(d, ast.Name) else d.attr if isinstance(d, ast.Attribute) else names(d.func) if isinstance(d, ast.Call) else ''
        if not any(names(d) == 'dataclass' for d in node.decorator_list):
            return node
        node.decorator_list = [d for d in node.decorator_list if names(d) != 'dataclass']
        fields, body = [], []
        for statement in node.body:
            if isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name):
                fields.append((statement.target.id, statement.value))
            elif not (isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Constant)):
                body.append(statement)
        args, assigns = [], []
        for name, default in fields:
            factory = isinstance(default, ast.Call) and names(default.func) == 'field' and next(
                (k.value for k in default.keywords if k.arg == 'default_factory'), None)
            value = next((k.value for k in default.keywords if k.arg == 'default'), None) if isinstance(default, ast.Call) and names(default.func) == 'field' else default
            args.append((name, ast.Constant(None) if factory else value))
            assigns.append(ast.parse(f'self.{name} = {name}').body[0] if not factory else
                           ast.parse(f'self.{name} = {name} if {name} is not None else {ast.unparse(factory)}()').body[0])
        required = [a for a in args if a[1] is None]
        optional = [a for a in args if a[1] is not None]
        init = ast.FunctionDef(name='__init__', args=ast.arguments(
            posonlyargs=[], args=[ast.arg('self')] + [ast.arg(n) for n, _ in required + optional], kwonlyargs=[], kw_defaults=[],
            defaults=[d for _, d in optional]), body=assigns or [ast.Pass()], decorator_list=[], returns=None, type_params=[])
        node.body = [init] + body
        return ast.fix_missing_locations(node)

    def visit_With(self, node):
        """with x as (a, b), which Transcrypt cannot compile, as with x as tmp, then a, b = tmp."""
        self.generic_visit(node)
        unpack = []
        for i, item in enumerate(node.items):
            if isinstance(item.optional_vars, (ast.Tuple, ast.List)):
                name = f'_with{i}'
                unpack.append(ast.Assign(targets=[item.optional_vars], value=ast.Name(name, ast.Load())))
                item.optional_vars = ast.Name(name, ast.Store())
        node.body = unpack + node.body
        return ast.fix_missing_locations(node)

    def visit_Constant(self, node):
        """The Ellipsis literal (...), which Transcrypt lacks, as a sentinel object (identity holds within a module)."""
        return ast.Name('_ellipsis', ast.Load()) if node.value is Ellipsis else node

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


_ellipsis = __pragma__('js', '{}', 'Symbol ("Ellipsis")')


def _property(fget=None, fset=None, fdel=None, doc=None):
    return __pragma__('js', '{}', 'property(fget, fset)')


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
'''


def hoist_imports(body):
    """Function-local imports (methods' too) moved to the module, merged: Transcrypt emits each as an ES import, and
    two of one module are a syntax error."""
    names, modules = {}, {}
    for function in (node for node in ast.walk(ast.Module(body=body, type_ignores=[])) if isinstance(node, ast.FunctionDef)):
        local = [s for s in function.body if isinstance(s, (ast.Import, ast.ImportFrom))]
        function.body = [s for s in function.body if s not in local] or [ast.Pass()]
        for statement in local:
            if isinstance(statement, ast.Import):
                modules.update((alias.name, alias) for alias in statement.names)
            else:
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
        modules = []
        for path, spec in manifest['scripts'].items():
            # A script's names, or {names, flags}: Transcrypt options for its Python (-o for operator overloading).
            patterns, flags = (spec['names'], spec['flags']) if isinstance(spec, dict) else (spec, [])
            module = os.path.basename(path)
            open(os.path.join(build, module), 'w').write(extract(fetch(path), patterns))
            modules.append((module, flags))
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
