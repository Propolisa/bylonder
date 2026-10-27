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


def extract(source, patterns):
    """The module's bpy imports, then the classes matching patterns with what they use from the module, in its order."""
    tree = ast.parse(source)
    defined = {node.name: node for node in tree.body if isinstance(node, (ast.ClassDef, ast.FunctionDef))}
    wanted, todo = set(), [name for name in defined if any(fnmatch.fnmatchcase(name, p) for p in patterns)]
    while todo:
        name = todo.pop()
        if name in wanted:
            continue
        wanted.add(name)
        todo += [n.id for n in ast.walk(defined[name]) if isinstance(n, ast.Name) and n.id in defined]
    imports = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom))
               and all(alias.name.split('.')[0] == 'bpy' for alias in node.names if isinstance(node, ast.Import))
               and (not isinstance(node, ast.ImportFrom) or node.module.split('.')[0] == 'bpy')]
    nodes = [node for node in tree.body if getattr(node, 'name', None) in wanted]
    # Only the imported names the taken code uses.
    used = {n.id for node in nodes for n in ast.walk(node) if isinstance(n, ast.Name)}
    for node in imports:
        node.names = [alias for alias in node.names if (alias.asname or alias.name).split('.')[0] in used]
    body = [node for node in imports if node.names] + nodes
    return ast.unparse(ast.Module(body=hoist_imports(body), type_ignores=[]))


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
            result = subprocess.run([sys.executable, '-I', '-m', 'transcrypt', '-b', '-n', '-k', *flags, '-m', module], cwd=build,
                                    capture_output=True, text=True)
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
            # Transcrypt dates its output; without the date a rerun gives the same files.
            script = re.sub(r"^// Transcrypt'ed from Python, .*\n", '', script, flags=re.M)
            header = f'// Generated by tools/blender-ui/transpile.py from Blender {TAG}; do not edit.\n'
            open(os.path.join(OUT, name), 'w').write(header + script)
            print('wrote', os.path.relpath(os.path.join(OUT, name), REPO))

if __name__ == '__main__':
    main()
