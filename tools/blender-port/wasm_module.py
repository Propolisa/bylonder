"""WebAssembly modules: whole Blender libraries built with Clang's wasm32-wasi target, for state that lives in the
module (the edit-mode BMesh), where per-function units (wasm.py) would copy it at every call.

A module (manifest `modules`: output path under src/, its API files in wasm/, the library directories it draws on,
the libraries Blender builds against, Blender paths the source tree lacks, and Blender files outside it to build with
its API, `fetch`, such as the default theme):
- builds from a hard-linked copy of the Blender tree with the reviewed patches in wasm/patches applied;
- compiles every source of its libraries in parallel, cached by source, flags and patches (not by where the checkout
  or tree is, so worktrees share objects), and archives what builds; a source that does not build is not tried again
  until it or the flags change;
- links its API against the archives, so only what the API reaches is in the module. Functions still missing become
  imports, listed after the build: calling one throws (src/port/wasm.js), so a gap shows where it is reached. Data
  still missing fails the build, since it would read as zeros instead.

Usage: tools/blender-port/wasm_module.py SRC [MODULE]   (SRC: Blender sources of the manifest's tag)
"""
import concurrent.futures
import functools
import glob
import hashlib
import json
import operator
import os
import re
import shutil
import subprocess
import sys
import urllib.parse

import convert

HERE = os.path.dirname(os.path.abspath(__file__))
WASM = os.path.join(HERE, 'wasm')
# Header directories the editors' and RNA's sources include beyond those the converter parses with.
EDITOR_INCLUDES = ('blenloader', 'modifiers', 'modifiers/intern', 'modifiers/intern/lineart', 'sequencer', 'editors/include', 'editors/mesh', 'windowmanager', 'gpu', 'imbuf', 'blenfont', 'render', 'animrig', 'nodes',
                   'asset_system', 'draw', 'makesdna/intern', 'makesrna/intern', 'imbuf/movie', 'editors/transform')
BLENDER = 'https://projects.blender.org/api/v1/repos/blender/blender'


def fetch_blender_paths(root, paths, tag):
    """Blender files and directories the source tree lacks, from Blender's repository at the manifest's tag."""
    def fetch(path):
        listing = json.loads(subprocess.run(['curl', '-sfL', f'{BLENDER}/contents/{urllib.parse.quote(path)}?ref={tag}'],
                                            capture_output=True, check=True).stdout)
        for entry in listing if isinstance(listing, list) else [listing]:
            target = os.path.join(root, entry['path'])
            if entry['type'] == 'dir':
                fetch(entry['path'])
            elif not os.path.exists(target):
                os.makedirs(os.path.dirname(target), exist_ok=True)
                raw = f'{BLENDER}/raw/{urllib.parse.quote(entry["path"])}?ref={tag}'
                open(target, 'wb').write(subprocess.run(['curl', '-sfL', raw], capture_output=True, check=True).stdout)

    for path in paths:
        if not os.path.exists(os.path.join(root, path)):
            fetch(path)


def fetched_files(build, paths, tag):
    """Blender files outside the source tree's directories (data such as the default theme), fetched once into the
    build at the manifest's tag, so the tree and its objects stay as they are."""
    files = []
    for path in paths:
        target = os.path.join(build, 'fetched', tag, path)
        if not os.path.exists(target):
            os.makedirs(os.path.dirname(target), exist_ok=True)
            url = f'{BLENDER}/raw/{urllib.parse.quote(path, safe="")}?ref={tag}'
            open(target, 'wb').write(subprocess.run(['curl', '-sfL', url], capture_output=True, check=True).stdout)
        files.append(target)
    return files


def patched_tree(root):
    """A hard-linked copy of root with the patches applied, made again when the patches or the tree's paths change."""
    patches = sorted(glob.glob(os.path.join(WASM, 'patches', '*.patch')))
    paths = sorted(os.path.relpath(p, root) for p in glob.glob(os.path.join(root, '*/*/*')))
    digest = hashlib.sha1(b''.join(open(p, 'rb').read() for p in patches) + '\n'.join(paths).encode()).hexdigest()[:16]
    tree = os.path.abspath(root).rstrip('/') + '-wasm'
    stamp = os.path.join(tree, '.patches')
    if not (os.path.exists(stamp) and open(stamp).read() == digest):
        shutil.rmtree(tree, ignore_errors=True)
        subprocess.run(['cp', '-al', os.path.abspath(root), tree], check=True)
        for p in patches:
            # Patched files are written anew, so the originals they were linked to stay as they are.
            for line in open(p):
                if line.startswith('+++ b/'):
                    path = os.path.join(tree, line[6:].strip())
                    shutil.copyfile(path, path + '.orig')
                    os.replace(path + '.orig', path)
            result = subprocess.run(['patch', '-p1', '-s', '-d', tree, '-i', p], capture_output=True, text=True)
            if result.returncode:
                sys.exit(f'{os.path.basename(p)} does not apply to this Blender: {result.stdout}{result.stderr}')
        open(stamp, 'w').write(digest)
    return tree, digest


def dependencies(build, deps):
    """Libraries Blender builds against, at the versions Blender pins (build_files/build_environment/cmake/versions.cmake),
    fetched once; returns their directories, the include directories and a key of the versions of those every source
    sees. A `private` dependency is seen only by the libraries built from it or naming it in `uses` (library_flags)."""
    paths, includes = {}, []
    for name, dep in sorted(deps.items()):
        path = os.path.join(build, 'deps', f'{name}-{dep["tag"]}')
        if not os.path.exists(path):
            if 'sha256' in dep:  # An archive, checked against the hash Blender pins.
                data = subprocess.run(['curl', '-sfL', dep['url']], capture_output=True, check=True).stdout
                if hashlib.sha256(data).hexdigest() != dep['sha256']:
                    sys.exit(f'{name}: {dep["url"]} does not match its pinned hash')
                os.makedirs(path)
                subprocess.run(['tar', '-xz', '--strip-components=1', '-C', path], input=data, check=True)
            else:
                subprocess.run(['git', '-c', 'advice.detachedHead=false', 'clone', '-q', '--depth', '1', '--branch', dep['tag'], dep['url'], path],
                               check=True)
        for target, variables in dep.get('configure', {}).items():
            configure(os.path.join(path, target), variables)
        paths[name] = path
        if not dep.get('private'):
            includes.append(f'-I{os.path.join(path, dep.get("include", ""))}')
    return paths, includes, ' '.join(f'{n}@{d["tag"]}' for n, d in sorted(deps.items()) if not d.get('private'))


def library_flags(entry, tree, deps, spec):
    """What one library entry adds to its sources' arguments (the include directories of the private dependencies it is
    built from or `uses`, its own `includes` in Blender's tree, its `defines` and other `flags`), and to their cache key
    (those dependencies' versions)."""
    entry = entry if isinstance(entry, dict) else {}
    specs = spec.get('dependencies', {})
    used = [n for n in [entry.get('dependency'), *entry.get('uses', [])] if n and specs[n].get('private')]
    # An include under wasm/ is the module's own (wasm/fstream), the rest are Blender's.
    flags = ([f'-I{os.path.join(deps[n], specs[n].get("include", ""))}' for n in used]
             + [f'-I{os.path.join(HERE if d.startswith("wasm/") else tree, d)}' for d in entry.get('includes', [])]
             + [f'-D{d}' for d in entry.get('defines', [])] + entry.get('flags', []))
    key = ''.join(f'{n}@{specs[n]["tag"]}' for n in used)
    if 'rename' in entry:
        header = renamed_functions(tree, **entry['rename'])
        flags += ['-include', header]
        key += hashlib.sha1(open(header, 'rb').read()).hexdigest()
    return flags, key


def renamed_functions(tree, header, functions, prefix):
    """A header renaming the functions a header declares whose names start with `functions` (BLF_api.hh's BLF_) to
    `prefix` + name, so a library built with it (Blender's blenfont, for text objects) leaves those names to the
    module's own definitions (region-draw.cc's)."""
    text = open(os.path.join(tree, header)).read()
    macros = set(re.findall(r'#define\s+(\w+)', text))
    names = sorted(set(re.findall(rf'\b({re.escape(functions)}\w+)\s*\(', text)) - macros)
    out = os.path.join(tree + '-build', 'generated', prefix + os.path.basename(header))
    lines = ''.join(f'#define {name} {prefix}{name}\n' for name in names)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if not os.path.exists(out) or open(out).read() != lines:
        open(out, 'w').write(lines)
    return out


def datatoc(build, paths, tag):
    """generated/datatoc.cc: each of Blender's data files (fetched into the build, outside the source tree) embedded as
    Blender's datatoc embeds it (datatoc_bfont_pfb, datatoc_bfont_pfb_size)."""
    root = os.path.join(build, 'datatoc')
    fetch_blender_paths(root, paths, tag)
    lines = []
    for path in paths:
        name = 'datatoc_' + re.sub(r'\W', '_', os.path.basename(path))
        data = open(os.path.join(root, path), 'rb').read()
        lines += [f'extern const int {name}_size = {len(data)};',
                  f'extern const char {name}[] = {{' + ','.join(str(b if b < 128 else b - 256) for b in data) + ',0};']
    out = os.path.join(build, 'generated', 'datatoc.cc')
    text = '\n'.join(lines) + '\n'
    if not os.path.exists(out) or open(out).read() != text:
        open(out, 'w').write(text)
    return out


def configure(target, variables):
    """A header CMake would configure from target.in: ${NAME} replaced (empty when not given, as CMake leaves an unset
    variable), `#cmakedefine NAME` lines left undefined."""
    text = re.sub(r'\$\{(\w+)\}', lambda m: str(variables.get(m[1], '')), open(target + '.in').read())
    text = re.sub(r'^#cmakedefine (\w+).*$', r'/* #undef \1 */', text, flags=re.M)
    if not os.path.exists(target) or open(target).read() != text:
        open(target, 'w').write(text)


def flags(tree, spec):
    """Clang's arguments for the module's sources, with its Blender build options (`defines`) and the header directories
    outside source/blender it includes (`includes`)."""
    return [*(f'-D{d}' for d in spec.get('defines', [])), *(f'-I{os.path.join(tree, d)}' for d in spec.get('includes', [])),'--target=wasm32-wasi', '-std=c++20', '-O2', '-DNDEBUG', '-DFMT_HEADER_ONLY', '-fignore-exceptions',
            '-Wno-c++11-narrowing', '-D_WASI_EMULATED_PROCESS_CLOCKS', '-isystem', os.path.join(WASM, 'include'),
            '-include', os.path.join(WASM, 'compat.h'), *convert.include_args(tree),
            *(f'-I{os.path.join(tree, "source/blender", d)}' for d in EDITOR_INCLUDES), f'-I{os.path.join(tree, "intern/guardedalloc/intern")}']


def operator_table(tree, build, args, spec):
    """generated/operators.inc: OPERATOR(name) for each operator registration function (`void MESH_OT_x(wmOperatorType *)`)
    the module's operator headers declare, or its operator sources define, as Clang parses them, so operators Blender builds
    out (WITH_FREESTYLE) are not listed."""
    import clang.cindex as ci
    names = []
    for path in spec.get('operators', []):
        tu = ci.Index.create().parse(os.path.join(tree, path), args=[a for a in args if a.startswith(('-I', '-D', '-std', '-isystem'))]
                                     + ['-x', 'c++', '--target=wasm32-wasi'], options=ci.TranslationUnit.PARSE_SKIP_FUNCTION_BODIES)
        names += [c.spelling for c in tu.cursor.walk_preorder() if c.kind == ci.CursorKind.FUNCTION_DECL
                  and c.location.file and c.location.file.name.endswith(path) and '_OT_' in c.spelling
                  and [t.spelling for t in c.type.argument_types()] == ['wmOperatorType *']]
    generated = os.path.join(build, 'generated')
    os.makedirs(generated, exist_ok=True)
    path = os.path.join(generated, 'operators.inc')
    text = ''.join(f'OPERATOR({n})\n' for n in dict.fromkeys(names))
    if not os.path.exists(path) or open(path).read() != text:
        open(path, 'w').write(text)
    return generated, text


def rna_prototypes(build, args):
    """generated/rna_prototypes.cc: a definition for each RNA type pointer RNA_prototypes.hh declares (generated from
    Blender's build by tools/blender-reference/rna-prototypes.py), pointing at a type named as Blender names it, and
    the list of them (rna_types). Code without Blender's RNA runtime only compares and stores these pointers."""
    import clang.cindex as ci
    header = os.path.join(HERE, 'include', 'RNA_prototypes.hh')
    tu = ci.Index.create().parse(header, args=['-x', 'c++', '-std=c++20'], options=ci.TranslationUnit.PARSE_SKIP_FUNCTION_BODIES)
    names = [c.spelling for c in tu.cursor.walk_preorder() if c.kind == ci.CursorKind.VAR_DECL and c.spelling.startswith('RNA_')]
    namespace = next((c.spelling for c in tu.cursor.get_children() if c.kind == ci.CursorKind.NAMESPACE), None)
    lines = ['#include "operator-properties.hh"', '', f'namespace {namespace} {{' if namespace else '']
    lines += [f'static StructRNA {n}_type{{"{n[4:]}"}};\nStructRNA *{n} = &{n}_type;' for n in names]
    # All of them, for finding one by name (rna_struct_find).
    lines += ['extern StructRNA **const rna_types[] = {' + ''.join(f'&{n}, ' for n in names) + 'nullptr};']
    path = os.path.join(build, 'generated', 'rna_prototypes.cc')
    text = '\n'.join(lines + (['}'] if namespace else [])) + '\n'
    if not os.path.exists(path) or open(path).read() != text:
        open(path, 'w').write(text)
    return path


def rna_funcs(build):
    """generated/rna_<file>_funcs.inc, for each RNA file whose runtime part the module compiles (wasm/rna-<file>.cc):
    RNA_FUNC(struct type, identifier, property type, member, function) for each RNA function it gives a property
    (dna-fcurve.json, dna-anim.json: modifier_dna.py), for the module's properties: get, set and range functions by the
    property's type, an array's or a string's length, and updates (with the context for PROP_CONTEXT_UPDATE);
    RNA_ARRAY(struct type, identifier, property type, length) for the arrays that have no DNA field; and
    RNA_BASE(struct type, base type) for the structs that inherit their base's properties."""
    types = {'BOOLEAN': 'PROP_BOOLEAN', 'INT': 'PROP_INT', 'FLOAT': 'PROP_FLOAT', 'ENUM': 'PROP_ENUM', 'STRING': 'PROP_STRING'}
    texts = []
    for name, source in (('fcurve', 'dna-fcurve.json'), ('space', 'dna-anim.json')):
        lines = []
        for struct, info in json.load(open(os.path.join(convert.REPO, 'src', 'makesrna', source))).items():
            if info.get('base'):
                lines.append(f'RNA_BASE(RNA_{struct}, RNA_{info["base"]})')
            for identifier, prop in info['properties'].items():
                funcs, kind = prop.get('funcs') or {}, prop.get('type')
                if kind not in types:
                    continue
                array = kind == 'FLOAT' and ('length' in funcs or prop.get('length') or prop.get('array'))
                scalar = kind.lower()
                members = {'get': 'float_get_array' if array else scalar + '_get', 'set': 'float_set_array' if array else scalar + '_set',
                           'length': 'string_length' if kind == 'STRING' else 'length', 'update': 'update', 'update_context': 'update_context',
                           **({'range': scalar + '_range'} if kind in ('INT', 'FLOAT') else {})}
                if prop.get('array') and 'offset' not in prop:
                    lines.append(f'RNA_ARRAY(RNA_{struct}, "{identifier}", {types[kind]}, {prop["array"]})')
                lines += [f'RNA_FUNC(RNA_{struct}, "{identifier}", {types[kind]}, {members[role]}, {func})'
                          for role, func in funcs.items() if role in members]
        path = os.path.join(build, 'generated', f'rna_{name}_funcs.inc')
        text = '\n'.join(lines) + '\n'
        if not os.path.exists(path) or open(path).read() != text:
            open(path, 'w').write(text)
        texts.append(text)
    return ''.join(texts)


def rna_dna_fields(build):
    """generated/rna_dna_fields.inc: DNA_FIELD(struct type, identifier, type, array length, where it is stored) for each
    modifier property, from src/makesrna/rna-modifiers.json (Blender's RNA) and dna-modifiers.json (its DNA fields,
    modifier_dna.py), and for each property of the structs dna-outliner.json describes, for the RNA getters and setters
    to read and write their DNA."""
    makesrna = os.path.join(convert.REPO, 'src', 'makesrna')
    rna = json.load(open(os.path.join(makesrna, 'rna-modifiers.json')))
    dna = json.load(open(os.path.join(makesrna, 'dna-modifiers.json')))
    declared = open(os.path.join(HERE, 'include', 'RNA_prototypes.hh')).read()
    kinds = {'BOOLEAN': 'PROP_BOOLEAN', 'INT': 'PROP_INT', 'FLOAT': 'PROP_FLOAT', 'ENUM': 'PROP_ENUM', 'POINTER': 'PROP_POINTER', 'STRING': 'PROP_STRING'}
    # A string's size is its char array's, which RNA's set writes at most.
    size = lambda field: field.get('length', field['size']) if field['kind'] == 'int' and field['size'] == 1 and field.get('length') else field['size']
    lines = []
    for info in rna['types'].values():
        struct = info['struct']
        if f'RNA_{struct};' not in declared or struct not in dna:
            continue
        props, fields = {**rna['Modifier'], **info['properties']}, {**dna['Modifier']['properties'], **dna[struct]['properties']}
        for name, prop in props.items():
            field = fields.get(name)
            if not field or prop['type'] not in kinds or field['kind'] == 'struct':
                continue
            length = len(prop['default']) if isinstance(prop.get('default'), list) and prop['type'] != 'ENUM' else 0
            kind = 's' if prop['type'] == 'STRING' else field['kind'][0]
            lines.append(f'DNA_FIELD(RNA_{struct}, "{name}", {kinds[prop["type"]]}, {length}, {field["offset"]}, {size(field)}, \'{kind}\', '
                         f'{str(field.get("signed", False)).lower()}, {field.get("bit", 0)}LL, {str("bitset" in field).lower()}, '
                         f'{str(field.get("negative", False)).lower()})')
    # Structs whose properties dna-outliner.json, dna-anim.json and dna-fcurve.json describe whole (type, icon), with DNA_ICON(struct
    # type, identifier, icon, consecutive) for those that have an icon.
    # An enum stored as some bits of its field (RNA_def_property_enum_bitflag_sdna) is masked by its items' values.
    bits = lambda field: functools.reduce(operator.or_, (v for v, _ in field.get('items', [])), 0) if field.get('bitflag') else field.get('bit', 0)
    described = {k: v for name in ('dna-outliner.json', 'dna-anim.json', 'dna-fcurve.json') for k, v in json.load(open(os.path.join(makesrna, name))).items()}
    for struct, info in described.items():
        for name, field in info['properties'].items():
            # Dynamic arrays (pointers to values) are read through their RNA functions (rna_funcs), or not at all.
            dynamic = field.get('kind') == 'pointer' and field.get('type') != 'POINTER'
            if field.get('type') not in kinds or 'offset' not in field or field['kind'] == 'struct' or field.get('bitset') is not None or dynamic:
                continue
            length = 0 if field.get('type') == 'STRING' else field.get('length', 0)
            kind = 's' if field['type'] == 'STRING' else field['kind'][0]
            lines.append(f'DNA_FIELD(RNA_{struct}, "{name}", {kinds[field["type"]]}, {length}, {field["offset"]}, {size(field)}, \'{kind}\', '
                         f'{str(field.get("signed", False)).lower()}, {bits(field)}LL, false, '
                         f'{str(field.get("negative", False)).lower()}, {info.get("from", -1)})')
            if field.get('icon'):
                lines.append(f'DNA_ICON(RNA_{struct}, "{name}", {field["icon"]}, {field.get("consecutive", 0)})')
    path = os.path.join(build, 'generated', 'rna_dna_fields.inc')
    text = '\n'.join(lines) + '\n'
    if not os.path.exists(path) or open(path).read() != text:
        open(path, 'w').write(text)
    return text


def own_headers():
    """The module's own headers (wasm/*.hh, wasm/include and wasm/fstream), which its sources and some of Blender's
    include: a change to them rebuilds them."""
    paths = sorted(glob.glob(os.path.join(WASM, '*.h*')) + glob.glob(os.path.join(WASM, 'include', '**', '*'), recursive=True)
                   + glob.glob(os.path.join(WASM, 'fstream', '*')))
    return hashlib.sha1(b''.join(open(p, 'rb').read() for p in paths if os.path.isfile(p))).hexdigest()


def compiler(src, args):
    """Clang for a source: a C source (FreeType's, curve_fit_nd's) as C, the rest as C++20."""
    if src.endswith('.c'):
        return ['clang', *(a for a in args if a not in ('-std=c++20', '-fignore-exceptions', '-Wno-c++11-narrowing'))]
    return ['clang++', *args]


def compile_all(build, sources, args, key):
    """Objects of the sources that build, by source; what does not build is left out (an archive member nothing needs)."""
    objects = os.path.join(build, 'objects')
    os.makedirs(objects, exist_ok=True)
    # Keyed without the checkout's and tree's paths, so worktrees can share objects.
    stable = ' '.join(args).replace(build, '$BUILD').replace(build.removesuffix('-build'), '$TREE').replace(convert.REPO, '$REPO')
    common = hashlib.sha1((stable + key + open(os.path.join(WASM, 'compat.h')).read()).encode()).hexdigest()
    # A source that does not build is not tried again until it, the flags or the module's own headers change.
    failed = f'.{own_headers()[:8]}.failed'

    def one(src):
        digest = hashlib.sha1((common + open(src, 'rb').read().hex()).encode()).hexdigest()[:16]
        obj = os.path.join(objects, f'{os.path.basename(src)}.{digest}.o')
        if os.path.exists(obj):
            return src, obj
        if os.path.exists(obj + failed):
            return src, None
        result = subprocess.run([*compiler(src, args), '-c', src, '-o', obj], capture_output=True, text=True)
        if result.returncode:
            open(obj + failed, 'w').write(result.stderr)
        return src, (obj if result.returncode == 0 else None)

    with concurrent.futures.ThreadPoolExecutor(os.cpu_count()) as pool:
        return dict(pool.map(one, sources))


def demangle(names):
    return subprocess.run(['c++filt'], input='\n'.join(names), capture_output=True, text=True).stdout.split('\n')[:len(names)]


def live_imports(path):
    """What the module still imports besides WASI: Blender functions nothing in it defines."""
    script = ("const m = new WebAssembly.Module(require('fs').readFileSync(process.argv[1]));"
              "console.log(JSON.stringify(WebAssembly.Module.imports(m).filter((i) => i.module !== 'wasi_snapshot_preview1').map((i) => i.name)))")
    names = json.loads(subprocess.run(['node', '-e', script, path], capture_output=True, text=True, check=True).stdout)
    return sorted({d.split('(')[0] for d in demangle(names)})


def undefined_data(unresolved, objects):
    """The unresolved symbols the objects refer to as data (`O` in their symbol tables)."""
    objdump = shutil.which('llvm-objdump') or shutil.which('llvm-objdump-18')
    data = set()
    for obj in objects:
        for line in subprocess.run([objdump, '-t', obj], capture_output=True, text=True).stdout.splitlines():
            fields = line.split()
            if len(fields) >= 4 and fields[-2] == '*UND*' and fields[1] == 'O' and fields[-1] in unresolved:
                data.add(fields[-1])
    return sorted(data)


def build(root, name, spec, tag):
    fetch_blender_paths(root, spec.get('blender_paths', []), tag)
    tree, patches = patched_tree(root)
    out_dir = tree + '-build'
    deps, includes, versions = dependencies(out_dir, spec.get('dependencies', {}))
    args = includes + flags(tree, spec)
    patches += versions
    generated, operators = operator_table(tree, out_dir, args, spec)
    archives, members = [], []
    for entry in spec['libraries']:
        # A library is a directory or a file, or {path, exclude, sources, dependency, uses, includes, defines, rename}: a
        # directory without some of its files, or some files of it, in Blender's tree or in a dependency's, whose sources
        # also see header directories (library_flags).
        spec_lib = entry if isinstance(entry, dict) else {'path': entry}
        lib, exclude = spec_lib['path'], set(spec_lib.get('exclude', []))
        base = deps[spec_lib['dependency']] if 'dependency' in spec_lib else tree
        sources = sorted(glob.glob(os.path.join(base, lib, '*.c*'))) if os.path.isdir(os.path.join(base, lib)) else [os.path.join(base, lib)]
        sources = [s for s in sources if os.path.basename(s) not in exclude]
        if 'sources' in spec_lib:
            sources = [os.path.join(base, lib, f) for f in spec_lib['sources']]
        extra, key = library_flags(spec_lib, tree, deps, spec)
        objects = compile_all(out_dir, [s for s in sources if not s.endswith('_test.cc')], args + extra, patches + key)
        built = [o for o in objects.values() if o]
        archive = os.path.join(out_dir, lib.replace('/', '_') + '.a')
        if os.path.exists(archive):
            os.remove(archive)
        subprocess.run([shutil.which('llvm-ar') or shutil.which('llvm-ar-18'), 'rcs', archive, *built], check=True)
        archives.append(archive)
        members += built
        print(f'{lib}: {len(built)} of {len(objects)} sources build', file=sys.stderr)
    # The module's own files also see wasm/, the generated operator table and the operators' editors' headers; Blender's
    # sources need none of them.
    own_args = args + [f'-I{generated}', f'-I{WASM}', *(f'-I{os.path.join(tree, os.path.dirname(p))}' for p in spec.get('operators', []))]
    own = compile_all(out_dir, [os.path.join(WASM, f) for f in [*spec['api'], 'platform.cc']] + [rna_prototypes(out_dir, args)]
                      + fetched_files(out_dir, spec.get('fetch', []), tag)
                      + ([datatoc(out_dir, spec['datatoc'], tag)] if spec.get('datatoc') else []),
                      own_args, patches + operators + rna_dna_fields(out_dir) + rna_funcs(out_dir) + own_headers())
    failed = [src for src, obj in own.items() if obj is None]
    if failed:
        result = subprocess.run(['clang++', *own_args, '-c', failed[0], '-o', os.devnull], capture_output=True, text=True)
        sys.exit(f'{os.path.relpath(failed[0], convert.REPO)} does not build:\n{result.stderr}')
    out = os.path.join(convert.REPO, 'src', name)
    # Archives twice: a member one archive pulls in may need members of an archive listed before it.
    # WASM_NAMES=1 keeps function names, for profiles and stacks while debugging.
    strip = [] if os.environ.get('WASM_NAMES') else ['-Wl,--strip-all']
    # Blender's code expects a thread's stack (wasm-ld's default is 64 KiB), placed first so that overflowing it traps
    # instead of writing over the module's data.
    link = ['clang++', '--target=wasm32-wasi', '-O2', '-mexec-model=reactor', '-Wl,--gc-sections', *strip, '-Wl,--error-limit=0',
            '-Wl,-z,stack-size=8388608', '-Wl,--stack-first',
            '-Wl,--export=malloc', '-Wl,--export=free', *own.values(), *archives, *archives, '-lwasi-emulated-process-clocks']
    # A dry link names every unresolved symbol, for the data check; the module itself imports missing functions by name.
    check = subprocess.run([*link, '-Wl,--warn-unresolved-symbols', '-o', os.devnull], capture_output=True, text=True)
    unresolved = {line.split('undefined symbol: ')[-1] for line in check.stderr.splitlines() if 'undefined symbol: ' in line}
    data = undefined_data(unresolved, [*own.values(), *members])
    if data:
        sys.exit(f'{name}: data nothing defines, which would read as zeros:\n  ' + '\n  '.join(demangle(data)))
    result = subprocess.run([*link, '-Wl,--allow-undefined', '-o', out], capture_output=True, text=True)
    if result.returncode:
        sys.exit(f'{name}: link failed\n{result.stderr}')
    missing = live_imports(out)
    print(f'built src/{name}: {os.path.getsize(out)} bytes, {operators.count(chr(10))} operators; {len(missing)} imports, which throw when '
          f'called:\n  ' + '\n  '.join(missing), file=sys.stderr)


def main():
    root = sys.argv[1]
    manifest = json.load(open(os.path.join(HERE, 'manifest.json')))
    for name, spec in manifest['modules'].items():
        if len(sys.argv) < 3 or sys.argv[2] == name:
            build(root, name, spec, manifest['blender'])


if __name__ == '__main__':
    main()
