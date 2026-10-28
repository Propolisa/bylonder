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
    ('org.transcrypt.__runtime__.js', "export function getattr (obj, name) {\n    return name in obj ? obj [name] : obj ['py_' + name];",
     "export function getattr (obj, name, py_default) {\n"
     "    if (arguments.length > 2 && (obj === null || obj === undefined || !(name in Object (obj) || 'py_' + name in Object (obj)))) {\n"
     "        return py_default;\n"
     "    }\n"
     "    return name in obj ? obj [name] : obj ['py_' + name];",
     "getattr's default, which Transcrypt's getattr ignores"),
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
    ('org.transcrypt.__runtime__.js', "        cls.__bases__ = bases;\n",
     "        cls.__bases__ = bases;\n"
     "        __classes__.push (cls);\n"
     "        cls.__subclasses__ = function () {return __classes__.filter (function (c) {return c.__bases__.includes (cls);});};\n",
     "type.__subclasses__, which Transcrypt's classes lack"),
    ('org.transcrypt.__runtime__.js', "py_metatype.__metaclass__ = py_metatype;\n",
     "py_metatype.__metaclass__ = py_metatype;\n"
     "var __classes__ = [];\n"
     "Object.getPrototypeOf (function* () {}).prototype.send = function (value) {\n"
     "    var result = this.next (value);\n"
     "    if (result.done) {\n"
     "        throw StopIteration ();\n"
     "    }\n"
     "    return result.value;\n"
     "};\n",
     "generator.send, which JS generators call next"),
    ('org.transcrypt.__runtime__.js', "var __classes__ = [];\n",
     "var __classes__ = [];\n"
     "String.prototype.title = function () {\n"
     "    return this.replace (/[a-z]+/gi, function (word) {return word [0].toUpperCase () + word.slice (1).toLowerCase ();});\n"
     "};\n",
     "str.title, which Transcrypt's str lacks"),
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


# The modules Blender's scripts import that Bylonder has: its bpy and mathutils (here), and Transcrypt's math; the
# packages here (Bylonder's versions of Python's and Blender's modules) and the scripts the manifest names, imported by
# their own names (bl_ui.space_toolsystem_common as space_toolsystem_common).
IMPORTABLE = {'bpy', 'mathutils', 'math'}
SCRIPTS = set()


def module_of(name):
    """The module Bylonder compiles for an imported name, or None when it has none."""
    package, _, rest = name.partition('.')
    if package in ('bl_ui', 'bl_operators') and rest in SCRIPTS:
        return rest
    return name if package in IMPORTABLE or package in SCRIPTS else None


def defined_name(node):
    """The name a module-level class, function or single-name assignment defines."""
    if isinstance(node, (ast.ClassDef, ast.FunctionDef)):
        return node.name
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        return node.targets[0].id
    return None


def is_main_guard(node):
    return isinstance(node, ast.If) and isinstance(node.test, ast.Compare) and getattr(node.test.left, 'id', None) == '__name__'


def importable(node):
    """The import with only what Bylonder has, its modules renamed to Bylonder's, or None."""
    if isinstance(node, ast.ImportFrom):
        module = node.module and module_of(node.module)
        return ast.ImportFrom(module=module, names=node.names, level=0) if module else None
    names = [alias for alias in node.names if module_of(alias.name) == alias.name]
    return ast.Import(names=names) if names else None


def extract(source, patterns):
    """The module's imports Bylonder has, then the classes and functions matching patterns with what they use from the
    module (constants too), in its order. The pattern '*' takes the whole module, its statements too."""
    tree = ast.parse(source)
    whole = patterns == ['*']
    defined = {defined_name(node): node for node in tree.body if defined_name(node)}
    wanted, todo = set(), [name for name in defined if any(fnmatch.fnmatchcase(name, p) for p in patterns)]
    while todo:
        name = todo.pop()
        if name in wanted:
            continue
        wanted.add(name)
        todo += [n.id for n in ast.walk(defined[name]) if isinstance(n, ast.Name) and n.id in defined]
    is_import = lambda node: isinstance(node, (ast.Import, ast.ImportFrom))
    nodes = [node for node in tree.body if not is_import(node) and not is_main_guard(node) and (whole or defined_name(node) in wanted)]
    imports = [i for i in (importable(node) for node in tree.body if is_import(node)) if i]
    # Only the imported names the taken code uses.
    used = {n.id for node in nodes for n in ast.walk(node) if isinstance(n, ast.Name)}
    for node in imports:
        node.names = [alias for alias in node.names if (alias.asname or alias.name).split('.')[0] in used]
    body = [node for node in imports if node.names] + nodes
    source = ast.unparse(ast.Module(body=hoist_imports(body), type_ignores=[]))
    module = TranscryptFixes().visit(class_scopes(ast.parse(source)))
    if re.search(r'\b_(merged|joined|formatted|ellipsis)\b', ast.unparse(module)):
        # Before the module's own code, which may use them as it loads.
        imports = sum(1 for node in module.body if isinstance(node, (ast.Import, ast.ImportFrom)))
        module.body[imports:imports] = ast.parse(HELPERS).body
    return ast.unparse(module)


def class_scope_loads(statement):
    """The names a class-body statement reads in the class's scope: all but those in function bodies and lambdas."""
    nodes = [statement]
    while nodes:
        node = nodes.pop()
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            yield node
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            nodes += node.decorator_list + node.args.defaults + [d for d in node.args.kw_defaults if d]
        elif not isinstance(node, (ast.Lambda, ast.ClassDef)) or node is statement:
            nodes += list(ast.iter_child_nodes(node))


def class_scopes(module):
    """Names a class body defines and later reads in its own scope (a tuple of tools built from others, a function a
    decorator gets), which Transcrypt compiles as module names, defined at module level before the class as
    _Class_name, and the class's own name for them assigned from those."""
    body = []
    for node in module.body:
        if not isinstance(node, ast.ClassDef):
            body.append(node)
            continue
        defined, hoisted = {}, {}
        for statement in node.body:
            for load in class_scope_loads(statement):
                if load.id in defined:
                    hoisted.setdefault(load.id, defined[load.id])
                    load.id = f'_{node.name}_{load.id}'
            name = defined_name(statement)
            if name:
                defined[name] = statement
        for name, statement in sorted(hoisted.items(), key=lambda item: node.body.index(item[1])):
            alias = f'_{node.name}_{name}'
            index = node.body.index(statement)
            if isinstance(statement, ast.FunctionDef):
                statement.decorator_list = [d for d in statement.decorator_list if getattr(d, 'id', None) != 'staticmethod']
                statement.name = alias
            else:
                statement.targets = [ast.Name(alias, ast.Store())]
            body.append(statement)
            node.body[index] = ast.Assign(targets=[ast.Name(name, ast.Store())], value=ast.Name(alias, ast.Load()), lineno=0)
        body.append(node)
    module.body = body
    return ast.parse(ast.unparse(module))


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
        if isinstance(node.func, ast.Name) and node.func.id == 'dict' and not node.args:
            # dict(a=1) as {'a': 1}: Transcrypt's dict keeps the keyword arguments' object, marked as keyword arguments,
            # so a function it is passed to takes it for its own.
            return self.visit_Dict(ast.Dict(keys=[ast.Constant(k.arg) if k.arg else None for k in node.keywords],
                                            values=[k.value for k in node.keywords]))
        if isinstance(node.func, ast.Name) and node.func.id == 'super':
            # super(Class, self) in Class's methods is super(), the only form Transcrypt compiles.
            node.args = []
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
        """del d[k], which Transcrypt compiles to a no-op with operator overloading, as d.pop(k); del of names, which
        only tidies a namespace and is a syntax error in an ES module, as nothing."""
        self.generic_visit(node)
        if all(isinstance(target, ast.Name) for target in node.targets):
            return ast.Pass()
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

    # Words ES modules reserve that Transcrypt does not rename.
    RESERVED = {'enum', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'static'}

    def visit_Name(self, node):
        """A variable named with a word JS reserves, renamed."""
        if node.id in self.RESERVED:
            node.id += '_'
        return node

    def visit_arg(self, node):
        if node.arg in self.RESERVED:
            node.arg += '_'
        return node

    def visit_If(self, node):
        """`if (x := value)`, which Transcrypt compiles wrong, as `x = value` before the if; in a chain of `and` (without
        an else), as nested ifs so the value is only taken when the operands before it hold."""
        if not any(isinstance(n, ast.NamedExpr) for n in ast.walk(node.test)):
            return self.generic_visit(node)
        if isinstance(node.test, ast.BoolOp) and isinstance(node.test.op, ast.And) and not node.orelse:
            first, *rest = node.test.values
            inner = ast.If(test=rest[0] if len(rest) == 1 else ast.BoolOp(op=ast.And(), values=rest), body=node.body, orelse=[])
            return self.visit_If(ast.If(test=first, body=[inner], orelse=[]))
        assigns = []

        class Hoist(ast.NodeTransformer):
            def visit_NamedExpr(self, named):
                assigns.append(ast.Assign(targets=[ast.Name(named.target.id, ast.Store())], value=named.value, lineno=0))
                return ast.Name(named.target.id, ast.Load())
        node.test = Hoist().visit(node.test)
        self.generic_visit(node)
        return [self.visit(a) for a in assigns] + [node]

    def visit_Compare(self, node):
        """`name in locals()`, which a module tests to tell a reload from its first load, as False: modules load once."""
        self.generic_visit(node)
        right = node.comparators[0]
        if isinstance(node.ops[0], ast.In) and isinstance(right, ast.Call) and getattr(right.func, 'id', None) == 'locals':
            return ast.Constant(False)
        return node

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


_ellipsis = ['...']


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


def take_imports(function):
    """The imports anywhere in a function's statements, taken out of them."""
    taken = []
    for node in ast.walk(function):
        for field in ('body', 'orelse', 'finalbody'):
            statements = getattr(node, field, None)
            if not isinstance(statements, list) or not statements or not isinstance(statements[0], ast.stmt):
                continue
            taken += [s for s in statements if isinstance(s, (ast.Import, ast.ImportFrom))]
            setattr(node, field, [s for s in statements if not isinstance(s, (ast.Import, ast.ImportFrom))] or
                    ([] if field != 'body' else [ast.Pass()]))
    return taken


def hoist_imports(body):
    """Function-local imports (methods' too) moved to the module, merged: Transcrypt emits each as an ES import, and
    two of one module are a syntax error. Those of modules Bylonder lacks are left out."""
    names, modules = {}, {}
    for function in (node for node in ast.walk(ast.Module(body=body, type_ignores=[])) if isinstance(node, ast.FunctionDef)):
        for statement in filter(None, map(importable, take_imports(function))):
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
        # Bylonder's versions of the modules Blender's scripts import: Blender's (bpy, mathutils, ...), the packages
        # here, and Python's that Transcrypt lacks (collections), in boundary/, apart so they do not shadow Python's own.
        for folder in (HERE, os.path.join(HERE, 'boundary')):
            for package in (d for d in os.listdir(folder) if os.path.exists(os.path.join(folder, d, '__init__.py'))):
                shutil.copytree(os.path.join(folder, package), os.path.join(build, package))
                SCRIPTS.add(package)
        open(os.path.join(build, 'bpy', '_rna.py'), 'w').write(rna_module())
        modules = []
        SCRIPTS.update(os.path.basename(path)[:-3] for path in manifest['scripts'])
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
