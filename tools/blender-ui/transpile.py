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


def finish(name, script):
    """A module as Transcrypt wrote it, with PATCHES and runtime.js applied."""
    for target, text, replacement, reason in PATCHES:
        if target == name:
            assert text in script, f'{name}: the patch for {reason} no longer applies'
            script = script.replace(text, replacement)
    if name == 'org.transcrypt.__runtime__.js':
        script += open(os.path.join(HERE, 'runtime.js')).read()
    # Keyword arguments reach a parameter Transcrypt renames (type as py_metatype, others with a py_ prefix) under
    # its Python name too, as they do when they come from a dict (**kwargs).
    script = re.sub(r"case 'py_(metatype|\w+)': var py_\1", lambda m: f"case '{'type' if m[1] == 'metatype' else m[1]}': case 'py_{m[1]}': var py_{m[1]}", script)
    # **kwargs collects keyword arguments under their Python names.
    script = re.sub(r"default: (\w+) \[(__attrib\d+__)\] = (__allkwargs\d+__) \[\2\]", r"default: \1 [__pyname__ (\2)] = \3 [\2]", script)
    if '__pyname__ (' in script and name != 'org.transcrypt.__runtime__.js':
        script = re.sub(r"^import \{(?=.*\} from './org\.transcrypt\.__runtime__\.js';$)", "import {__pyname__, ", script, count=1, flags=re.M)
    # Transcrypt dates its output; without the date a rerun gives the same files.
    return re.sub(r"^// Transcrypt'ed from Python, .*\n", '', script, flags=re.M)


def fetch(path):
    """A Blender file at the tag, cached."""
    cache = os.path.join(os.path.expanduser('~/.cache/bylonder/blender'), TAG, path)
    if not os.path.exists(cache):
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        url = f'{BLENDER}/raw/{urllib.parse.quote(path, safe="")}?ref={TAG}'
        body = subprocess.run(['curl', '-sfL', url], capture_output=True, check=True).stdout
        open(cache, 'wb').write(body)
    return open(cache).read()


# The modules Blender's scripts import that Bylonder has: its bpy and mathutils (here), and Transcrypt's math; and,
# imported in functions, all the packages here and Transcrypt's copy. The scripts the manifest names import each other
# from Blender's bl_ui package, here flat modules.
IMPORTABLE = {'bpy', 'mathutils', 'math'}
LOCAL_IMPORTABLE = {d for d in os.listdir(HERE) if os.path.exists(os.path.join(HERE, d, '__init__.py'))} | {'math', 'copy'}
SCRIPTS = {os.path.basename(path)[:-3] for path in json.load(open(os.path.join(HERE, 'manifest.json')))['scripts']}


def defined_names(node):
    """The names a module-level class, function or assignment to names (a = b = ...) defines."""
    if isinstance(node, (ast.ClassDef, ast.FunctionDef)):
        return [node.name]
    if isinstance(node, ast.Assign):
        return [t.id for t in node.targets if isinstance(t, ast.Name)]
    return []


def extract(source, patterns):
    """The module's imports Bylonder has, then the classes and functions matching patterns with what they use from the
    module (constants too), in its order."""
    tree = ast.parse(source)
    tree.body = [node for statement in tree.body for node in flat_imports(statement)]
    defined = {}
    for node in tree.body:
        for name in defined_names(node):
            defined.setdefault(name, []).append(node)
    wanted, todo = set(), [name for name in defined if any(fnmatch.fnmatchcase(name, p) for p in patterns)]
    while todo:
        name = todo.pop()
        if name in wanted:
            continue
        wanted.add(name)
        todo += [n.id for node in defined[name] for n in ast.walk(node) if isinstance(n, ast.Name) and n.id in defined]
    imports = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom))
               and all(alias.name.split('.')[0] in IMPORTABLE | SCRIPTS for alias in node.names if isinstance(node, ast.Import))
               and (not isinstance(node, ast.ImportFrom) or node.module.split('.')[0] in IMPORTABLE)]
    nodes = [node for node in tree.body if wanted.intersection(defined_names(node))]
    # Only the imported names the taken code uses.
    used = {n.id for node in nodes for n in ast.walk(node) if isinstance(n, ast.Name)}
    for node in imports:
        node.names = [alias for alias in node.names if (alias.asname or alias.name).split('.')[0] in used]
    body = [node for node in imports if node.names] + nodes
    source = ast.unparse(ast.Module(body=hoist_imports(body), type_ignores=[]))
    rewritten = ast.unparse(TranscryptFixes().visit(ast.parse(source)))
    # Before the code: module-level code may use them, and JS functions defined by assignment exist only once it ran.
    return (HELPERS if uses_helpers(rewritten) else '') + rewritten


def uses_helpers(source):
    return re.search(r'\b_(merged|joined|formatted|ellipsis|property|new_object)\b', source) is not None


class Walrus:
    """Assignment expressions (x := v), which Transcrypt compiles wrong, as assignments in Python's evaluation order:
    before the statement, in temporaries for the short-circuited operands of and/or, or (in a comprehension's
    condition) as `for x in [v]`."""
    SCOPES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)
    COMPREHENSIONS = (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)

    def __init__(self):
        self.temporaries = 0

    @staticmethod
    def has(node):
        return any(isinstance(n, ast.NamedExpr) for n in ast.walk(node))

    def lower_module(self, tree):
        for node in ast.walk(tree):
            if isinstance(node, self.COMPREHENSIONS):
                self.comprehension(node)
        for node in list(ast.walk(tree)):
            for field in ('body', 'orelse', 'finalbody'):
                statements = getattr(node, field, None)
                if isinstance(statements, list) and statements and isinstance(statements[0], ast.stmt):
                    setattr(node, field, [lowered for s in statements for lowered in self.statement(s)])
        return tree

    def comprehension(self, node):
        for generator in list(node.generators):
            for index, condition in enumerate(generator.ifs):
                named = [n for n in ast.walk(condition) if isinstance(n, ast.NamedExpr)]
                if not named:
                    continue
                at = node.generators.index(generator) + 1
                kept, generator.ifs = generator.ifs[index:], generator.ifs[:index]
                for n in named:
                    node.generators.insert(at, ast.comprehension(target=ast.Name(n.target.id, ast.Store()),
                                                                 iter=ast.List([n.value], ast.Load()), ifs=[], is_async=0))
                    at += 1
                node.generators[at - 1].ifs = [self.replace_named(c) for c in kept]
                break

    @staticmethod
    def replace_named(node):
        class Replace(ast.NodeTransformer):
            def visit_NamedExpr(self, n):
                return ast.copy_location(ast.Name(n.target.id, ast.Load()), n)
        return Replace().visit(node)

    def statement(self, node):
        fields = {ast.If: 'test', ast.While: 'test', ast.Return: 'value', ast.Expr: 'value', ast.Assign: 'value',
                  ast.AugAssign: 'value', ast.AnnAssign: 'value', ast.For: 'iter'}
        field = fields.get(type(node))
        value = getattr(node, field, None) if field else None
        if value is None or not self.has(value):
            return [node]
        before, lowered = self.expression(value)
        setattr(node, field, lowered)
        if isinstance(node, ast.While):
            node.test = ast.Constant(True)
            node.body = before + [ast.If(ast.UnaryOp(ast.Not(), lowered), [ast.Break()], [])] + node.body
            return [node]
        return before + [node]

    def temporary(self):
        self.temporaries += 1
        return f'_walrus{self.temporaries}'

    def assign(self, name, value):
        return ast.Assign([ast.Name(name, ast.Store())], value, lineno=0)

    def expression(self, node):
        """(statements, expression): the statements run node's assignments; the expression gives its value."""
        if not self.has(node) or isinstance(node, self.SCOPES + self.COMPREHENSIONS):
            return [], node
        if isinstance(node, ast.NamedExpr):
            before, value = self.expression(node.value)
            return before + [self.assign(node.target.id, value)], ast.Name(node.target.id, ast.Load())
        if isinstance(node, ast.BoolOp) and any(self.has(v) for v in node.values[1:]):
            result = self.temporary()
            before, first = self.expression(node.values[0])
            statements = before + [self.assign(result, first)]
            for operand in node.values[1:]:
                pending = ast.Name(result, ast.Load())
                test = pending if isinstance(node.op, ast.And) else ast.UnaryOp(ast.Not(), pending)
                inner, value = self.expression(operand)
                statements.append(ast.If(test, inner + [self.assign(result, value)], []))
            return statements, ast.Name(result, ast.Load())
        if isinstance(node, ast.IfExp) and (self.has(node.body) or self.has(node.orelse)):
            result = self.temporary()
            before, test = self.expression(node.test)
            body, value = self.expression(node.body)
            orelse, other = self.expression(node.orelse)
            return before + [ast.If(test, body + [self.assign(result, value)], orelse + [self.assign(result, other)])], \
                ast.Name(result, ast.Load())
        statements = []
        for field, value in ast.iter_fields(node):
            if isinstance(value, ast.expr):
                before, lowered = self.expression(value)
                statements += before
                setattr(node, field, lowered)
            elif isinstance(value, list):
                for index, item in enumerate(value):
                    if isinstance(item, ast.expr):
                        before, value[index] = self.expression(item)
                        statements += before
        return statements, node


class TranscryptFixes(ast.NodeTransformer):
    """Python Transcrypt compiles wrong, rewritten to what it compiles right, with the helpers HELPERS defines."""
    def visit_Module(self, node):
        self.generic_visit(Walrus().lower_module(node))
        return node

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
        if isinstance(node.func, ast.Name) and node.func.id == 'super':
            node.func._called = True
        self.generic_visit(node)
        if isinstance(node.func, ast.Name) and node.func.id == 'super':
            # super(Class, self) in Class's methods is super(), the only form Transcrypt compiles, and only to reach a
            # method: the super object itself has no JS equivalent.
            node.args = []
            if not getattr(node, '_method', False):
                return ast.Constant(None)
        if isinstance(node.func, ast.Name) and node.func.id == 'property' and self.scopes and self.scopes[-1] != 'class':
            # Transcrypt compiles property() only in a class body; elsewhere it is the runtime's property, by
            # another name.
            node.func = ast.Name('_property', ast.Load())
        if isinstance(node.func, ast.Name) and node.func.id == 'type' and len(node.args) == 3:
            # type(name, bases, attributes), a new class, as Transcrypt's metaclass makes one.
            return ast.Call(func=ast.Attribute(ast.Name('type', ast.Load()), '__new__', ast.Load()), args=[ast.Name('type', ast.Load()), *node.args], keywords=[])
        if isinstance(node.func, ast.Name) and node.func.id == 'object' and not node.args and not node.keywords:
            # object(), a sentinel, which Transcrypt's object cannot make: a new JS object, as unique.
            return ast.Call(ast.Name('_new_object', ast.Load()), [], [])
        if isinstance(node.func, ast.Name) and node.func.id == 'zip':
            # zip's strict only checks lengths, and Transcrypt's zip takes it for an iterable.
            node.keywords = [k for k in node.keywords if k.arg != 'strict']
        if not any(k.arg is None for k in node.keywords):
            return node
        merged = ast.Dict(keys=[ast.Constant(k.arg) if k.arg else None for k in node.keywords], values=[k.value for k in node.keywords])
        node.keywords = [ast.keyword(arg=None, value=ast.Call(func=ast.Name('_merged', ast.Load()), args=self.visit_Dict(merged).args
                                                                if None in merged.keys else [merged], keywords=[]))]
        return node

    def visit_Assign(self, node):
        """Assignments to __doc__, which do nothing for the UI and fail on Transcrypt's method accessors, dropped."""
        self.generic_visit(node)
        return None if any(isinstance(t, ast.Attribute) and t.attr == '__doc__' for t in node.targets) else node

    def visit_Subscript(self, node):
        """A builtin type subscripted (dict[str, int], a type alias) is the type: Transcrypt's types are not generic."""
        self.generic_visit(node)
        generic = isinstance(node.value, ast.Name) and node.value.id in ('dict', 'list', 'tuple', 'set', 'frozenset', 'type')
        return node.value if generic and isinstance(node.ctx, ast.Load) else node

    def visit_Compare(self, node):
        """Blender's reload idiom, `"name" in locals()`, is False: modules load once."""
        self.generic_visit(node)
        reload = (len(node.ops) == 1 and isinstance(node.ops[0], ast.In) and isinstance(node.comparators[0], ast.Call)
                  and getattr(node.comparators[0].func, 'id', None) == 'locals')
        return ast.copy_location(ast.Constant(False), node) if reload else node

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
        node = self.builtin_bases(self.dataclass(node))
        self.scopes.pop()
        return self.class_body(node)

    @staticmethod
    def class_body(node):
        """A class body as Transcrypt can compile it: annotations with a value as assignments; property declarations (how
        Blender's classes declare their properties) as the __annotations__ dict Blender reads them from, other hints
        dropped; and assignments using the body's earlier names after the class, as Python runs a class body in order
        and Transcrypt makes it one object literal. Returns the class and what follows it."""
        node.body = [ast.copy_location(ast.Assign(targets=[s.target], value=s.value), s) if isinstance(s, ast.AnnAssign) and s.value is not None else s
                     for s in node.body]
        hints = [s for s in node.body if isinstance(s, ast.AnnAssign)]
        node.body = [s for s in node.body if s not in hints]
        own = {d for s in node.body for d in defined_names(s)}
        attribute = lambda name, ctx: ast.Attribute(ast.Name(node.name, ast.Load()), name, ctx)

        class Qualify(ast.NodeTransformer):
            def visit_Name(self, name):
                return attribute(name.id, ast.Load()) if name.id in own and isinstance(name.ctx, ast.Load) else name
        # Transcrypt compiles a property() of the body's methods itself.
        uses = lambda statement, names: not (isinstance(statement.value, ast.Call) and getattr(statement.value.func, 'id', None) == 'property') \
            and any(isinstance(n, ast.Name) and n.id in names for n in ast.walk(statement.value))
        body, after, earlier = [], [], set()
        for statement in node.body:
            if isinstance(statement, ast.Assign) and len(statement.targets) == 1 and isinstance(statement.targets[0], ast.Name) \
                    and uses(statement, earlier):
                after.append(ast.copy_location(ast.Assign([attribute(statement.targets[0].id, ast.Store())], Qualify().visit(statement.value)), statement))
            else:
                body.append(statement)
            earlier.update(defined_names(statement))
        node.body = body or [ast.Pass()]
        # Blender registers the annotations that are property declarations (calls such as BoolProperty(...)); after the
        # class, as Python 3.14 evaluates annotations (PEP 649): they may name the class, and its own names.
        annotated = [s for s in hints if isinstance(s.target, ast.Name) and isinstance(s.annotation, ast.Call)]
        if annotated:
            after.append(ast.copy_location(ast.Assign([attribute('__annotations__', ast.Store())], ast.Dict(
                keys=[ast.Constant(s.target.id) for s in annotated], values=[Qualify().visit(s.annotation) for s in annotated])), node))
        return [ast.fix_missing_locations(n) for n in [node, *after]]

    def visit_AnnAssign(self, node):
        """Other annotations: an assignment, or nothing without a value."""
        self.generic_visit(node)
        if self.scopes and self.scopes[-1] == 'class':
            return node
        return ast.copy_location(ast.Assign(targets=[node.target], value=node.value), node) if node.value is not None else None

    @staticmethod
    def builtin_bases(node):
        """Builtin containers as bases (class C(dict)), which Transcrypt cannot subclass, dropped: the class keeps its own
        methods only."""
        node.bases = [b for b in node.bases if not (isinstance(b, ast.Name) and b.id in ('dict', 'list', 'set', 'tuple'))]
        return node

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

    # Python names JS reserves that Transcrypt does not rename (it renames case, default, new, switch and others to
    # py_*), renamed alike wherever they are names: variables, parameters and keyword arguments.
    JS_RESERVED = {'private', 'protected', 'public', 'package', 'interface', 'implements', 'static', 'let', 'var', 'super',
                   'enum', 'await', 'void', 'typeof', 'instanceof', 'function', 'this', 'delete', 'catch', 'throw', 'const',
                   'debugger', 'do', 'extends', 'export'}

    def visit_Name(self, node):
        if node.id in self.JS_RESERVED and not (node.id == 'super' and isinstance(node.ctx, ast.Load) and getattr(node, '_called', False)):
            node.id += '_'
        return node

    def visit_arg(self, node):
        if node.arg in self.JS_RESERVED:
            node.arg += '_'
        return node

    def visit_keyword(self, node):
        self.generic_visit(node)
        if node.arg in self.JS_RESERVED:
            node.arg += '_'
        return node

    def visit_Match(self, node):
        """match statements, which Transcrypt cannot compile, as an if/elif chain on the subject."""
        self.generic_visit(node)
        subject = ast.Name('_match_subject', ast.Load())
        chain = None
        for case in reversed(node.cases):
            test, binds = self.pattern(case.pattern, subject)
            if case.guard is not None:
                test = ast.BoolOp(ast.And(), [test, case.guard]) if not (isinstance(test, ast.Constant) and test.value is True) else case.guard
            body = binds + case.body
            if isinstance(test, ast.Constant) and test.value is True and not binds and chain is None:
                chain = body
                continue
            chain = [ast.If(test=test, body=body, orelse=chain or [])]
        out = [ast.Assign(targets=[ast.Name('_match_subject', ast.Store())], value=node.subject)] + (chain or [])
        return [ast.fix_missing_locations(ast.copy_location(n, node)) for n in out]

    def pattern(self, pattern, subject):
        """A test of the subject and the assignments of the names the pattern captures."""
        true = ast.Constant(True)
        if isinstance(pattern, ast.MatchValue):
            return ast.Compare(subject, [ast.Eq()], [pattern.value]), []
        if isinstance(pattern, ast.MatchSingleton):
            return ast.Compare(subject, [ast.Is()], [ast.Constant(pattern.value)]), []
        if isinstance(pattern, ast.MatchAs):
            test, binds = self.pattern(pattern.pattern, subject) if pattern.pattern else (true, [])
            if pattern.name:
                binds = binds + [ast.Assign(targets=[ast.Name(pattern.name, ast.Store())], value=subject)]
            return test, binds
        if isinstance(pattern, ast.MatchOr):
            return ast.BoolOp(ast.Or(), [self.pattern(p, subject)[0] for p in pattern.patterns]), []
        if isinstance(pattern, ast.MatchSequence):
            tests = [ast.Call(ast.Name('isinstance', ast.Load()), [subject, ast.Tuple([ast.Name('list', ast.Load()), ast.Name('tuple', ast.Load())], ast.Load())], []),
                     ast.Compare(ast.Call(ast.Name('len', ast.Load()), [subject], []), [ast.Eq()], [ast.Constant(len(pattern.patterns))])]
            binds = []
            for i, p in enumerate(pattern.patterns):
                test, bound = self.pattern(p, ast.Subscript(subject, ast.Constant(i), ast.Load()))
                if not (isinstance(test, ast.Constant) and test.value is True):
                    tests.append(test)
                binds += bound
            return ast.BoolOp(ast.And(), tests), binds
        if isinstance(pattern, ast.MatchClass):
            return ast.Call(ast.Name('isinstance', ast.Load()), [subject, pattern.cls], []), []
        raise NotImplementedError(f'match pattern {ast.dump(pattern)[:80]}')

    def visit_Constant(self, node):
        """The Ellipsis literal (...), which Transcrypt lacks, as a sentinel object (identity holds within a module), and
        bytes literals, which it escapes wrong, as bytes of their values."""
        if node.value is Ellipsis:
            return ast.Name('_ellipsis', ast.Load())
        if isinstance(node.value, bytes):
            return ast.Call(ast.Name('bytes', ast.Load()), [ast.List([ast.Constant(b) for b in node.value], ast.Load())], [])
        return node

    def visit_Attribute(self, node):
        if isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and node.value.func.id == 'super':
            node.value._method = True
        self.generic_visit(node)
        return node

    def visit_GeneratorExp(self, node):
        """A generator expression, which Transcrypt makes an iterator that tuple() and list() read as empty, as a list."""
        self.generic_visit(node)
        return ast.ListComp(elt=node.elt, generators=node.generators)

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


def _new_object():
    return __pragma__('js', '{}', '{}')


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


def flat_imports(node):
    """from bl_ui import x as import x: the scripts the manifest names are flat modules."""
    if isinstance(node, ast.ImportFrom) and node.module == 'bl_ui':
        return [ast.Import(names=[alias]) for alias in node.names]
    return [node]


def hoist_imports(body):
    """Function-local imports (methods' too) moved to the module, merged: Transcrypt emits each as an ES import, and
    two of one module are a syntax error. Those of modules Bylonder lacks are dropped: the code that needs them
    raises when it runs."""
    names, modules = {}, {}
    for function in (node for node in ast.walk(ast.Module(body=body, type_ignores=[])) if isinstance(node, ast.FunctionDef)):
        local = [s for s in function.body if isinstance(s, (ast.Import, ast.ImportFrom))]
        function.body = [s for s in function.body if s not in local] or [ast.Pass()]
        root = lambda statement: (statement.names[0].name if isinstance(statement, ast.Import) else statement.module).split('.')[0]
        for statement in (s for s in local if root(s) in LOCAL_IMPORTABLE | SCRIPTS):
            if isinstance(statement, ast.Import):
                modules.update((alias.name, alias) for alias in statement.names)
            else:
                names.setdefault(statement.module, {}).update((alias.name, alias) for alias in statement.names)
    hoisted = ([ast.Import(names=list(modules.values()))] if modules else []) + \
        [ast.ImportFrom(module=module, names=list(aliases.values()), level=0) for module, aliases in names.items()]
    return [node for node in body if isinstance(node, (ast.Import, ast.ImportFrom))] + hoisted + \
        [node for node in body if not isinstance(node, (ast.Import, ast.ImportFrom))]


def node_types():
    """Blender's shader and compositor node types (src/nodes/blender/node-types.json): idname to name and enums."""
    types = json.load(open(os.path.join(REPO, 'src', 'nodes', 'blender', 'node-types.json')))
    return {idname: node for tree in ('shader', 'compositor') for idname, node in types[tree].items()}


def rna_module():
    """bpy/_rna.py: the RNA the scripts read when they load (Modifier's type enum, from src/makesrna/rna-modifiers.json)
    or draw (node types' names and enums, from node_types())."""
    modifiers = json.load(open(os.path.join(REPO, 'src', 'makesrna', 'rna-modifiers.json')))
    items = ',\n    '.join(f'_Item({t!r}, {d["name"]!r}, {d["icon"]!r}, {d["description"]!r})' for t, d in modifiers['types'].items())
    enum = lambda p: '_Property([' + ', '.join(f'_Item({i!r}, {n!r}, \'\', {d!r})' for i, n, d in p['items']) + '])'
    nodes = ',\n    '.join(f'{idname!r}: _Node({node["name"]!r}, {{' + ', '.join(f'{k!r}: {enum(p)}' for k, p in node['properties'].items() if p['type'] == 'ENUM') + '})'
                           for idname, node in node_types().items())
    return f'''# Generated by transpile.py from src/makesrna/rna-modifiers.json and src/nodes/blender/node-types.json.
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


class _Node(_Struct):
    def __init__(self, name, properties):
        _Struct.__init__(self, properties)
        self.name, self.translation_context, self.bl_rna = name, '*', self


nodes = {{
    {nodes}}}
'''


def main():
    manifest = json.load(open(os.path.join(HERE, 'manifest.json')))
    with tempfile.TemporaryDirectory() as build:
        # Bylonder's versions of the modules Blender's scripts import (bpy, mathutils, ...): the packages here.
        for package in (d for d in os.listdir(HERE) if os.path.exists(os.path.join(HERE, d, '__init__.py'))):
            shutil.copytree(os.path.join(HERE, package), os.path.join(build, package))
        open(os.path.join(build, 'bpy', '_rna.py'), 'w').write(rna_module())
        # Node types as bpy.types has them, for the scripts that look one up by name (getattr(bpy.types, idname)).
        open(os.path.join(build, 'bpy', 'types.py'), 'a').write(''.join(f'\n{idname} = _rna.nodes[{idname!r}]' for idname in node_types()))
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
            script = finish(name, script)
            header = f'// Generated by tools/blender-ui/transpile.py from Blender {TAG}; do not edit.\n'
            open(os.path.join(OUT, name), 'w').write(header + script)
            print('wrote', os.path.relpath(os.path.join(OUT, name), REPO))

if __name__ == '__main__':
    main()
