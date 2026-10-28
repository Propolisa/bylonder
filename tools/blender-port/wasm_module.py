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
import glob
import hashlib
import json
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
    # The module's own include directories' headers (wasm/fstream), so a change to one builds its users again.
    for d in entry.get('includes', []):
        if d.startswith('wasm/'):
            key += hashlib.sha1(b''.join(open(p, 'rb').read() for p in sorted(glob.glob(os.path.join(HERE, d, '**'), recursive=True))
                                         if os.path.isfile(p))).hexdigest()[:8]
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


def rna_prototypes(build, args, referenced):
    """generated/rna_prototypes.cc: a definition for each RNA type pointer RNA_prototypes.hh declares (generated from
    Blender's build by tools/blender-reference/rna-prototypes.py), pointing at a type named as Blender names it, and for
    each RNA property it declares that the module's sources refer to (`referenced`, data_references). Code without
    Blender's RNA runtime only compares and stores these."""
    import clang.cindex as ci
    header = os.path.join(HERE, 'include', 'RNA_prototypes.hh')
    tu = ci.Index.create().parse(header, args=['-x', 'c++', '-std=c++20'], options=ci.TranslationUnit.PARSE_SKIP_FUNCTION_BODIES)
    names = [c.spelling for c in tu.cursor.walk_preorder() if c.kind == ci.CursorKind.VAR_DECL and c.spelling.startswith('RNA_')]
    namespace = next((c.spelling for c in tu.cursor.get_children() if c.kind == ci.CursorKind.NAMESPACE), None)
    lines = ['#include "operator-properties.hh"', '', f'namespace {namespace} {{' if namespace else '']
    lines += [f'static StructRNA {n}_type{{"{n[4:]}"}};\nStructRNA *{n} = &{n}_type;' for n in names]
    properties = [c.spelling for c in tu.cursor.walk_preorder() if c.kind == ci.CursorKind.VAR_DECL and c.spelling.startswith('rna_')
                  and '::'.join(filter(None, [namespace, c.spelling])) in referenced]
    lines += [f'static PropertyRNA {n}_property{{"{n.split("_", 2)[-1]}"}};\nPropertyRNA &{n} = {n}_property;' for n in properties]
    path = os.path.join(build, 'generated', 'rna_prototypes.cc')
    text = '\n'.join(lines + (['}'] if namespace else [])) + '\n'
    if not os.path.exists(path) or open(path).read() != text:
        open(path, 'w').write(text)
    return path


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
            lines.append(f'DNA_FIELD(RNA_{struct}, "{name}", {kinds[prop["type"]]}, {length}, {field["offset"]}, {field["size"]}, \'{kind}\', '
                         f'{str(field.get("signed", False)).lower()}, {field.get("bit", 0)}LL, {str("bitset" in field).lower()}, '
                         f'{str(field.get("negative", False)).lower()})')
    # Structs whose properties dna-outliner.json describes whole (type, icon), with DNA_ICON(struct type, identifier,
    # icon, consecutive) for those that have an icon.
    for struct, info in json.load(open(os.path.join(makesrna, 'dna-outliner.json'))).items():
        for name, field in info['properties'].items():
            if field.get('type') not in kinds or field['kind'] == 'struct' or (field.get('bitset') is not None):
                continue
            length = 0 if field.get('type') == 'STRING' else field.get('length', 0)
            kind = 's' if field['type'] == 'STRING' else field['kind'][0]
            lines.append(f'DNA_FIELD(RNA_{struct}, "{name}", {kinds[field["type"]]}, {length}, {field["offset"]}, {field["size"]}, \'{kind}\', '
                         f'{str(field.get("signed", False)).lower()}, {field.get("bit", 0)}LL, false, '
                         f'{str(field.get("negative", False)).lower()})')
            if field.get('icon'):
                lines.append(f'DNA_ICON(RNA_{struct}, "{name}", {field["icon"]}, {field.get("consecutive", 0)})')
    path = os.path.join(build, 'generated', 'rna_dna_fields.inc')
    text = '\n'.join(lines) + '\n'
    if not os.path.exists(path) or open(path).read() != text:
        open(path, 'w').write(text)
    return text


def own_headers():
    """The module's own headers (wasm/*.hh and wasm/include), which its sources include: a change to them rebuilds them."""
    paths = sorted(glob.glob(os.path.join(WASM, '*.h*')) + glob.glob(os.path.join(WASM, 'include', '**', '*'), recursive=True))
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


# Where wasm32 pads a DNA struct that Blender's own layout, made for 64-bit pointers, does not: wasm32 aligns a 64-bit
# member to 8 bytes after a run of 4-byte pointers, and the struct's size to 8 then. makesdna reads its headers with a
# pointer there (before or after a member), which on wasm32 is the 4 bytes Clang pads (and on 64-bit keeps the layout
# makesdna checks), so the SDNA describes the module's memory; a .blend reader skips the members.
WASM32_PADS = {'DNA_scene_types.h': [('  struct CustomData_MeshMasks customdata_mask;', 'before'), ('  bke::SceneRuntime *runtime = nullptr;', 'after')]}


def sdna(tree, build, args, archives):
    """makesdna's output for the module's target (generated/sdna): Blender's DNA as the .blend writer records it (dna.cc),
    the struct ids BLO_write_struct takes (dna_struct_ids.cc) and the check of every struct's size and member offsets
    against Clang's layout (dna_verify.cc). makesdna lays structs out for the platform it runs on, so it is built for
    wasm32 too, from the module's archives, and run by Node's WASI. Returns the sources to build with the module."""
    out = os.path.join(build, 'generated', 'sdna')
    os.makedirs(out, exist_ok=True)
    makesdna = os.path.join(tree, 'source/blender/makesdna')
    listing = open(os.path.join(tree, 'source/blender/CMakeLists.txt')).read()
    headers = re.findall(r'/makesdna/(DNA_\w+\.h)', listing[listing.index('set(SRC_DNA_INC'):listing.index('set(SRC_DNA_OTHER_INC')])
    includes = {'dna_includes_all.h': ''.join(f'#include "{h}"\n' for h in headers),
                'dna_includes_as_strings.h': ''.join(f'\t"{h}",\n' for h in headers)}
    for file, text in includes.items():
        path = os.path.join(out, file)
        if not os.path.exists(path) or open(path).read() != text:
            open(path, 'w').write(text)
    sources = [os.path.join(makesdna, 'intern', f) for f in ('makesdna.cc', 'dna_parse.cc', 'dna_utils.cc')]
    digest = hashlib.sha1(b''.join(open(p, 'rb').read() for p in [*sources, *(os.path.join(makesdna, h) for h in headers)])
                          + ' '.join(args).encode() + json.dumps(WASM32_PADS).encode()).hexdigest()[:16]
    # The headers makesdna reads, with the pads.
    padded = os.path.join(out, 'headers')
    os.makedirs(padded, exist_ok=True)
    for path in glob.glob(os.path.join(makesdna, '*.h')) + glob.glob(os.path.join(makesdna, '*.hh')):
        text = open(path).read()
        for i, (member, where) in enumerate(WASM32_PADS.get(os.path.basename(path), [])):
            assert text.count(member + '\n') == 1, f'{os.path.basename(path)}: {member.strip()} is not where it was'
            pad = f'  void *_pad_wasm32_{i};\n'
            text = text.replace(member + '\n', pad + member + '\n' if where == 'before' else member + '\n' + pad)
        target = os.path.join(padded, os.path.basename(path))
        if not os.path.exists(target) or open(target).read() != text:
            open(target, 'w').write(text)
    outputs = [os.path.join(out, f) for f in ('dna.cc', 'dna_type_offsets.h', 'dna_verify.cc', 'dna_struct_ids.cc', 'dna_defaults.cc')]
    stamp = os.path.join(out, '.digest')
    if not (os.path.exists(stamp) and open(stamp).read() == digest and all(map(os.path.exists, outputs))):
        tool_args = [f'-I{os.path.join(WASM, "fstream-read")}', *args, f'-I{out}', f'-I{os.path.join(makesdna, "intern")}']
        # With the module's platform functions (allocation, thread-local destructors).
        objects = compile_all(build, [*sources, os.path.join(WASM, 'platform.cc')], tool_args, digest)
        if not all(objects.values()):
            failed = next(s for s, o in objects.items() if not o)
            result = subprocess.run(['clang++', *tool_args, '-c', failed, '-o', os.devnull],
                                    capture_output=True, text=True)
            sys.exit(f'makesdna does not build:\n{result.stderr}')
        tool = os.path.join(out, 'makesdna.wasm')
        link = subprocess.run(['clang++', '--target=wasm32-wasi', '-O2', *objects.values(), *archives, *archives, '-lwasi-emulated-process-clocks',
                               '-Wl,--allow-undefined', '-o', tool], capture_output=True, text=True)
        if link.returncode:
            sys.exit(f'makesdna does not link:\n{link.stderr}')
        script = ("const { WASI } = require('node:wasi'); const fs = require('node:fs');"
                  "const wasi = new WASI({ version: 'preview1', args: ['makesdna', ...process.argv.slice(2)], preopens: { '/': '/' }, returnOnExit: true });"
                  "const instance = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(process.argv[1])), { wasi_snapshot_preview1: wasi.wasiImport,"
                  " env: new Proxy({}, { get: (_, name) => () => { throw new Error(name); } }) });"
                  "process.exitCode = wasi.start(instance);")
        run = subprocess.run(['node', '-e', script, tool, *outputs, padded + '/'], capture_output=True, text=True)
        if run.returncode:
            sys.exit(f'makesdna failed:\n{run.stdout}{run.stderr}')
        open(stamp, 'w').write(digest)
    return [outputs[0], outputs[2], outputs[3], os.path.join(makesdna, 'intern', 'dna_genfile.cc')]


def demangle(names):
    return subprocess.run(['c++filt'], input='\n'.join(names), capture_output=True, text=True).stdout.split('\n')[:len(names)]


def live_imports(path):
    """What the module still imports besides WASI: Blender functions nothing in it defines."""
    script = ("const m = new WebAssembly.Module(require('fs').readFileSync(process.argv[1]));"
              "console.log(JSON.stringify(WebAssembly.Module.imports(m).filter((i) => i.module !== 'wasi_snapshot_preview1').map((i) => i.name)))")
    names = json.loads(subprocess.run(['node', '-e', script, path], capture_output=True, text=True, check=True).stdout)
    return sorted({d.split('(')[0] for d in demangle(names)})


def data_references(objects):
    """The data the objects refer to without defining (`O` and `*UND*` in their symbol tables), demangled as wasm-ld
    names it."""
    objdump = shutil.which('llvm-objdump') or shutil.which('llvm-objdump-18')
    data = set()
    for obj in objects:
        for line in subprocess.run([objdump, '-t', '-C', obj], capture_output=True, text=True).stdout.splitlines():
            fields = line.split(None, 3)
            if len(fields) == 4 and fields[1] == 'O' and fields[2] == '*UND*':
                data.add(fields[3])
    return data


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
        # Archives are per module: modules sharing the build (and objects) may be linked at the same time.
        archive = os.path.join(out_dir, 'archives', name.replace('/', '_'), lib.replace('/', '_') + '.a')
        os.makedirs(os.path.dirname(archive), exist_ok=True)
        if os.path.exists(archive):
            os.remove(archive)
        subprocess.run([shutil.which('llvm-ar') or shutil.which('llvm-ar-18'), 'rcs', archive, *built], check=True)
        archives.append(archive)
        members += built
        print(f'{lib}: {len(built)} of {len(objects)} sources build', file=sys.stderr)
    # The module's own files also see wasm/, the generated operator table and the operators' editors' headers; Blender's
    # sources need none of them.
    own_args = args + [f'-I{generated}', f'-I{os.path.join(generated, "sdna")}', f'-I{os.path.join(tree, "source/blender/makesdna/intern")}', f'-I{WASM}', *(f'-I{os.path.join(tree, os.path.dirname(p))}' for p in spec.get('operators', []))]
    dna = sdna(tree, out_dir, args, archives) if spec.get('sdna') else []
    referenced = data_references(members)
    # As Blender builds its DNA library (makesdna/intern/CMakeLists.txt).
    own_args += ['-DWITH_DNA_GHASH'] if dna else []
    own = compile_all(out_dir, [os.path.join(WASM, f) for f in [*spec['api'], 'platform.cc']] + [rna_prototypes(out_dir, args, referenced)] + dna
                      + fetched_files(out_dir, spec.get('fetch', []), tag)
                      + ([datatoc(out_dir, spec['datatoc'], tag)] if spec.get('datatoc') else []),
                      own_args, patches + operators + rna_dna_fields(out_dir) + own_headers())
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
    data = sorted((referenced | data_references(own.values())) & unresolved)
    if data:
        sys.exit(f'{name}: data nothing defines, which would read as zeros:\n  ' + '\n  '.join(data))
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
