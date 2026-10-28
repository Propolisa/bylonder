"""What tree.py compiles Blender's Python with: Blender's scripts at the port's tag (fetch, listing), rewritten where
Transcrypt compiles them wrong (TranscryptFixes, Walrus, class_scopes, HELPERS), and Transcrypt's output patched
where its runtime differs from Python's (PATCHES, runtime.js, finish).
"""
import ast
import functools
import json
import os
import re
import urllib.parse
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
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
    ('org.transcrypt.__runtime__.js', "    return py_typeof (any) == dict ? any.py_keys () : any;",
     "    if (py_typeof (any) == dict) return any.py_keys ();\n"
     "    return any == null || typeof any == 'string' || Array.isArray (any) || '__getitem__' in Object (any) ? any : Array.from (any);",
     "iterators (enumerate, zip, generators) in loops, which Transcrypt indexes with operator overloading"),
    ('org.transcrypt.__runtime__.js', "                        return target.__getattr__ (name);",
     "                        return target.__getattr__ ? target.__getattr__ (name) : result;",
     "the attribute proxy of a class with __setattr__ but no __getattr__ (Blender's Operator)"),
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


def finish(name, script):
    """A module as Transcrypt wrote it, with PATCHES and runtime.js applied."""
    for target, text, replacement, reason in PATCHES:
        if target == name:
            assert text in script, f'{name}: the patch for {reason} no longer applies'
            script = script.replace(text, replacement)
    if name == 'org.transcrypt.__runtime__.js':
        # Methods are getters; assigning one (a class's draw, as Menu.append wraps it) sets the attribute, as in Python.
        script = re.sub(r'\b((?:globalThis\.)?Object\.defineProperty \(cls, attrib, )descrip\);', r'\1__settable__ (attrib, descrip));', script)
        # Operator overloading's dunder lookups, for None too (typeof null is 'object').
        script = re.sub(r"typeof (\w+) == 'object' && '(__\w+__)' in \1\b", r"typeof \1 == 'object' && \1 !== null && '\2' in \1", script)
        script += open(os.path.join(HERE, 'runtime.js')).read()
    # Keyword arguments reach a parameter Transcrypt renames (type as py_metatype, others with a py_ prefix) under
    # its Python name too, as they do when they come from a dict (**kwargs).
    script = re.sub(r"case 'py_(metatype|\w+)': var py_\1", lambda m: f"case '{'type' if m[1] == 'metatype' else m[1]}': case 'py_{m[1]}': var py_{m[1]}", script)
    # The keyword arguments check, for a last argument without Object's prototype too (a module's namespace).
    script = re.sub(r'((?:arguments \[__ilastarg\d+__\])|\b\w+)\.hasOwnProperty \("__kwargtrans__"\)', r'globalThis.Object.hasOwn (\1, "__kwargtrans__")', script)
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


def listing(path):
    """The Python files under a directory of Blender's repository at the tag, cached."""
    cache = os.path.join(os.path.expanduser('~/.cache/bylonder/blender'), TAG, path, '.listing.json')
    if os.path.exists(cache):
        return json.load(open(cache))
    url = f'{BLENDER}/contents/{path.replace("/", "%2F")}?ref={TAG}'
    entries = json.loads(subprocess.run(['curl', '-sfL', url], capture_output=True, check=True).stdout)
    files = [e['path'] for e in entries if e['type'] == 'file' and e['name'].endswith('.py')]
    for d in (e['path'] for e in entries if e['type'] == 'dir'):
        files += listing(d)
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    json.dump(files, open(cache, 'w'))
    return files


@functools.cache
def exists(path):
    try:
        return bool(fetch(path))
    except subprocess.CalledProcessError:
        return False


def defined_names(node):
    """The names a module-level class, function or assignment to names (a = b = ...) defines."""
    if isinstance(node, (ast.ClassDef, ast.FunctionDef)):
        return [node.name]
    if isinstance(node, ast.Assign):
        return [t.id for t in node.targets if isinstance(t, ast.Name)]
    return []


is_import = lambda node: isinstance(node, (ast.Import, ast.ImportFrom))


def class_scope_loads(statement):
    """The names a class-body statement reads in the class's scope: all but those in function bodies and lambdas."""
    nodes = [statement]
    while nodes:
        node = nodes.pop()
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            yield node
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            # @x.setter names the property, which Transcrypt compiles in the class.
            accessor = lambda d: isinstance(d, ast.Attribute) and d.attr in ('setter', 'getter', 'deleter')
            nodes += [d for d in node.decorator_list if not accessor(d)] + node.args.defaults + [d for d in node.args.kw_defaults if d]
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
            for name in defined_names(statement):
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


def uses_helpers(source):
    return re.search(r'\b_(merged|joined|formatted|ellipsis|property|new_object|super_classmethod)\b', source) is not None


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
        # The module's functions and its property declarations by name (rna_path_prop = StringProperty(...)), which
        # class bodies use by name.
        self.functions = {n.name for n in node.body if isinstance(n, ast.FunctionDef)}
        self.properties = {t.id for n in node.body if isinstance(n, ast.Assign) and isinstance(n.value, ast.Call) for t in n.targets if isinstance(t, ast.Name)}
        node = Walrus().lower_module(class_scopes(node))
        self.generic_visit(node)
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
        if isinstance(node.func, ast.Name) and node.func.id == 'dict' and not node.args:
            # dict(a=1) as {'a': 1}: Transcrypt's dict keeps the keyword arguments' object, marked as keyword arguments,
            # so a function it is passed to takes it for its own.
            return self.visit_Dict(ast.Dict(keys=[ast.Constant(k.arg) if k.arg else None for k in node.keywords],
                                            values=[k.value for k in node.keywords]))
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
        if isinstance(node.func, ast.Name) and node.func.id == 'next' and node.args and isinstance(node.args[0], ast.ListComp):
            # next() of a generator expression, which is a list here (visit_GeneratorExp): of an iterator over it.
            node.args[0] = ast.Call(func=ast.Name('iter', ast.Load()), args=[node.args[0]], keywords=[])
        if isinstance(node.func, ast.Name) and node.func.id == 'zip':
            # zip's strict only checks lengths, and Transcrypt's zip takes it for an iterable.
            node.keywords = [k for k in node.keywords if k.arg != 'strict']
        if not any(k.arg is None for k in node.keywords):
            return node
        merged = ast.Dict(keys=[ast.Constant(k.arg) if k.arg else None for k in node.keywords], values=[k.value for k in node.keywords])
        node.keywords = [ast.keyword(arg=None, value=ast.Call(func=ast.Name('_merged', ast.Load()), args=self.visit_Dict(merged).args
                                                                if None in merged.keys else [merged], keywords=[]))]
        return node

    def visit_Subscript(self, node):
        """A builtin type subscripted (dict[str, int], a type alias) is the type: Transcrypt's types are not generic."""
        self.generic_visit(node)
        generic = isinstance(node.value, ast.Name) and node.value.id in ('dict', 'list', 'tuple', 'set', 'frozenset', 'type')
        return node.value if generic and isinstance(node.ctx, ast.Load) else node

    starred_temporaries = 0

    def unpacked(self, target, value):
        """Assignments unpacking value into target, a tuple or list with a starred name (a, *rest), by index and slice."""
        if not (isinstance(target, (ast.Tuple, ast.List)) and any(isinstance(e, ast.Starred) or self.has_starred(e) for e in target.elts)):
            return [ast.Assign([target], value, lineno=0)]
        TranscryptFixes.starred_temporaries += 1
        temporary = f'_unpacked{TranscryptFixes.starred_temporaries}'
        out = [ast.Assign([ast.Name(temporary, ast.Store())], ast.Call(ast.Name('list', ast.Load()), [value], []), lineno=0)]
        star = next((i for i, e in enumerate(target.elts) if isinstance(e, ast.Starred)), None)
        after = len(target.elts) - star - 1 if star is not None else 0
        # Indices from the end as len() - k: a negative index is a JS property without operator overloading.
        from_end = lambda k: ast.BinOp(ast.Call(ast.Name('len', ast.Load()), [ast.Name(temporary, ast.Load())], []), ast.Sub(), ast.Constant(k))
        for i, element in enumerate(target.elts):
            if isinstance(element, ast.Starred):
                stop = from_end(after) if after else None
                item = ast.Call(ast.Name('list', ast.Load()), [ast.Subscript(ast.Name(temporary, ast.Load()), ast.Slice(ast.Constant(i), stop), ast.Load())], [])
                element = element.value
            else:
                index = ast.Constant(i) if star is None or i < star else from_end(len(target.elts) - i)
                item = ast.Subscript(ast.Name(temporary, ast.Load()), index, ast.Load())
            out += self.unpacked(element, item)
        return out

    @staticmethod
    def has_starred(node):
        return any(isinstance(n, ast.Starred) for n in ast.walk(node)) if isinstance(node, (ast.Tuple, ast.List)) else False

    def visit_Assign(self, node):
        """Starred unpacking (a, *rest = value), which Transcrypt compiles wrong with operator overloading, by index; and
        assignments to __doc__, which do nothing for the UI and fail on Transcrypt's method accessors, dropped."""
        self.generic_visit(node)
        if any(isinstance(t, ast.Attribute) and t.attr == '__doc__' for t in node.targets):
            return None
        if len(node.targets) == 1 and self.has_starred(node.targets[0]):
            return [ast.fix_missing_locations(ast.copy_location(n, node)) for n in self.unpacked(node.targets[0], node.value)]
        return node

    def visit_For(self, node):
        """A for loop's starred target (for i, (a, *rest) in ...) unpacked in its body."""
        self.generic_visit(node)
        if self.has_starred(node.target):
            TranscryptFixes.starred_temporaries += 1
            item = f'_item{TranscryptFixes.starred_temporaries}'
            node.body = self.unpacked(node.target, ast.Name(item, ast.Load())) + node.body
            node.target = ast.Name(item, ast.Store())
            ast.fix_missing_locations(node)
        return node

    def visit_Lambda(self, node):
        """Defaults evaluated where the lambda is made, as Python does (lambda x=x: ..., capturing a loop's value);
        Transcrypt evaluates them at each call: bound by an enclosing lambda called with them at once."""
        self.generic_visit(node)
        defaults = node.args.defaults
        if all(isinstance(d, ast.Constant) for d in defaults):
            return node
        TranscryptFixes.starred_temporaries += 1
        names = [f'_default{TranscryptFixes.starred_temporaries}_{i}' for i in range(len(defaults))]
        node.args.defaults = [ast.Name(n, ast.Load()) for n in names]
        outer = ast.Lambda(ast.arguments(posonlyargs=[], args=[ast.arg(n) for n in names], kwonlyargs=[], kw_defaults=[], defaults=[]), node)
        return ast.fix_missing_locations(ast.copy_location(ast.Call(outer, defaults, []), node))

    def visit_Compare(self, node):
        """Blender's reload idiom, `"name" in locals()`, is False: modules load once."""
        self.generic_visit(node)
        reload = (len(node.ops) == 1 and isinstance(node.ops[0], ast.In) and isinstance(node.comparators[0], ast.Call)
                  and getattr(node.comparators[0].func, 'id', None) == 'locals')
        return ast.copy_location(ast.Constant(False), node) if reload else node

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

    def __init__(self):
        self.scopes, self.classes = [], []

    def visit_FunctionDef(self, node):
        """super().f(...) in a classmethod, which Transcrypt calls with an undefined self, as the base's f bound to cls."""
        self.scopes.append('function')
        self.generic_visit(node)
        self.scopes.pop()
        if self.classes and any(getattr(d, 'id', None) == 'classmethod' for d in node.decorator_list) and node.args.args:
            cls = node.args.args[0].arg
            for call in ast.walk(node):
                if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Call) \
                        and getattr(call.func.value.func, 'id', None) == 'super':
                    call.func = ast.Call(ast.Name('_super_classmethod', ast.Load()),
                                         [ast.Name(self.classes[-1], ast.Load()), ast.Name(cls, ast.Load()), ast.Constant(call.func.attr)], [])
        return node

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        self.scopes.append('class')
        self.classes.append(node.name)
        node = self.builtin_bases(self.dataclass(node))
        self.classes.pop()
        self.scopes.pop()
        return self.class_body(node)

    def class_body(self, node):
        """A class body's annotations as Transcrypt can compile them: with a value, assignments; property declarations (how
        Blender's classes declare their properties) as the __annotations__ dict Blender reads them from, after the
        class; other hints dropped. Returns the class and what follows it."""
        node.body = [ast.copy_location(ast.Assign(targets=[s.target], value=s.value), s) if isinstance(s, ast.AnnAssign) and s.value is not None else s
                     for s in node.body]
        # A module function assigned in the body (execute = execute_context_assign) is a method in Python; Transcrypt
        # binds self only to methods defined in the body, so it is one that calls the function.
        node.body = [ast.copy_location(ast.parse(f'def {s.targets[0].id}(self, *args, **kwargs):\n    return {s.value.id}(self, *args, **kwargs)').body[0], s)
                     if isinstance(s, ast.Assign) and len(s.targets) == 1 and isinstance(s.targets[0], ast.Name) and isinstance(s.value, ast.Name)
                     and s.value.id in getattr(self, 'functions', ()) else s for s in node.body]
        hints = [s for s in node.body if isinstance(s, ast.AnnAssign)]
        node.body = [s for s in node.body if s not in hints]
        own = {d for s in node.body for d in defined_names(s)}
        attribute = lambda name, ctx: ast.Attribute(ast.Name(node.name, ast.Load()), name, ctx)

        class Qualify(ast.NodeTransformer):
            def visit_Name(self, name):
                return attribute(name.id, ast.Load()) if name.id in own and isinstance(name.ctx, ast.Load) else name
        after = []
        # Blender registers the annotations that are property declarations (calls such as BoolProperty(...)); after the
        # class, as Python 3.14 evaluates annotations (PEP 649): they may name the class, and its own names.
        declared = lambda a: isinstance(a, ast.Call) or (isinstance(a, ast.Name) and a.id in getattr(self, 'properties', ()))
        annotated = [s for s in hints if isinstance(s.target, ast.Name) and declared(s.annotation)]
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
        """JS's reserved words as names with a trailing _; Ellipsis by its name, as ... is."""
        if node.id == 'Ellipsis' and isinstance(node.ctx, ast.Load):
            return ast.copy_location(ast.Name('_ellipsis', ast.Load()), node)
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
        """The Ellipsis literal (...), which Transcrypt lacks, as a sentinel (one registered symbol for every module), and
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


_ellipsis = __pragma__('js', '{}', 'Symbol.for ("Ellipsis")')


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


def _super_classmethod(owner, cls, method):
    return __pragma__('js', '{}', 'owner.__bases__.map((base) => Object.getOwnPropertyDescriptor(base, method)).filter(Boolean).map((d) => (d.get ? d.get.call(cls) : d.value))[0]')
'''


