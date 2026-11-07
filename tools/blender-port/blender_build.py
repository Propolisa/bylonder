"""Blender built as Blender builds itself, for wasm32: the compile commands of Blender's own CMake configure (a host
build directory configured with CMAKE_EXPORT_COMPILE_COMMANDS), each retargeted to wasm32-wasi with the module's
compatibility headers, grouped by the CMake library they belong to. Libraries on the far side of Bylonder's seams
(docs/blender-boundary.md: window system, GPU and drawing, Python's gpu module, Cycles, audio) are left out. Python is
the manifest's CPython and numpy, built for wasm32 (deps/), and its files ship beside the module (python_files).

Usage: tools/blender-port/blender_build.py HOST_BUILD [--report FILE]   (HOST_BUILD: tools/blender-port/configure_host.sh)
  Compiles every other library, links them, and reports per library what does not compile and which symbols nothing
  defines: the seams Bylonder implements. JOBS=n compiles n sources at a time; SHARD=i/n compiles one in n libraries.
"""
import concurrent.futures
import functools
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import zipfile
import zlib

import wasm_module
import wasm_snapshot
import wasm_weaken
from wasm_module import WASM, demangle

# CMake targets on the far side of the seams, and Blender's generators and tests, matched against target names.
SEAMS = re.compile(r'^(bf_intern_ghost|bf_gpu|bf_draw|bf_python_gpu|bf_intern_cycles|cycles_|bf_intern_audaspace|audaspace'
                   r'|bf_intern_libmv|extern_glog|extern_ceres|bf_intern_mantaflow|bf_blendthumb|blender$|makesdna|makesrna|datatoc'
                   r'|msgfmt|.*_test|.*_tests|gtest|bf_intern_wayland|bf_intern_sky_gpu|.*_cpp_shaders_.*|shader_tool)')
# Host flags that have no meaning for wasm32 or name host paths.
DROP = re.compile(r'^(-DFMT_SHARED|-DWITH_TBB$|-DWITH_TBB=|-DEIGEN_HAS_TBB|-DWITH_OPENVDB_BLOSC|-DHAVE_EXECINFO_H|-DHAVE_MALLOC_STATS_H|-I/usr/|-isystem/usr/|-march=|-mtune=|-msse|-mavx|-mfpmath|-m64|-fPIC|-fopenmp|-pthread|-O\d|-g\d?$|-W|-pedantic|-fno-strict-overflow'
                  r'|-fmacro-prefix-map|-ffile-prefix-map|-fdiagnostics|-fcolor-diagnostics|-ffp-contract|-fno-trapping-math)')
# Sources built as a Blender with a window draws them, though the configure is headless: the interface, whose drawing
# the API records (its icons are registered only then, icons_init).
HEADED = re.compile(r'source/blender/editors/interface/')
FLAGS = ['--target=wasm32-wasi', '-O2', '-DNDEBUG', '-DFMT_HEADER_ONLY', '-fignore-exceptions', '-D_WASI_EMULATED_PROCESS_CLOCKS',
         '-Wno-everything', '-isystem', os.path.join(WASM, 'include'), '-I' + os.path.join(WASM, 'fstream'), '-I' + os.path.join(WASM, 'storage'),
         '-I' + os.path.join(WASM, 'process'), '-include', os.path.join(WASM, 'compat.h'),
         # Before any source includes it inside a namespace (makesrna.cc), where WASI's unistd.h declarations then clash.
         '-include', 'sys/stat.h']


def module_inputs(host, out):
    """What the module build gives every source: the libraries Blender builds against, fetched at the versions Blender pins
    (wasm_module.dependencies) in place of the host's /usr/include, with Blender's tree and the module's spec."""
    spec = json.load(open(os.path.join(os.path.dirname(__file__), 'manifest.json')))['modules']['bmesh/bmesh.wasm']
    _, includes, _ = wasm_module.dependencies(out, spec['dependencies'])
    return os.path.realpath(os.path.join(host, '..', 'blender')), spec, includes


def module_archives(host, out):
    """The manifest's libraries the module build makes that Blender's build does not: those from outside Blender's tree
    (FreeType, OpenSubdiv, OpenVDB, zstd, and the built ones: CPython, numpy) and Blender's renamed copies (blenfont as vfont_BLF_ for text objects, as the
    interface's BLF_ functions are region-draw.cc's), compiled as the module build compiles them."""
    tree, spec, _ = module_inputs(host, out)
    deps, includes, versions = wasm_module.dependencies(out, spec['dependencies'])
    ar = shutil.which('llvm-ar') or shutil.which('llvm-ar-18')
    archives = []
    for entry in (e for e in spec['libraries'] if isinstance(e, dict) and ('dependency' in e or 'rename' in e)):
        extra, key = wasm_module.library_flags(entry, tree, deps, spec)
        built = [o for o in wasm_module.compile_all(out, wasm_module.library_sources(entry, tree, deps),
                                                    includes + wasm_module.flags(tree, spec) + extra, versions + key).values() if o]
        archive = os.path.join(out, 'archives', f'{entry.get("dependency", "renamed")}_{entry["path"].replace("/", "_")}.a')
        if os.path.exists(archive):
            os.remove(archive)
        subprocess.run([ar, 'rcs', archive, *built], check=True)
        archives.append(archive)
        print(f'{entry.get("dependency", "renamed")}/{entry["path"]}: {len(built)} sources', file=sys.stderr)
    return archives + wasm_module.dependency_archives(deps, spec['dependencies'])[0]


def target_flags(tree, spec, out):
    """What the manifest's `targets` add to a CMake target's sources: the private dependencies it `uses` and its
    `defines`, as for a library entry (wasm_module.library_flags), so only that target's sources build again."""
    deps, _, _ = wasm_module.dependencies(out, spec['dependencies'])
    return {target: wasm_module.library_flags(entry, tree, deps, spec)[0] for target, entry in spec.get('targets', {}).items()}


def target_of(output):
    """The CMake target an object belongs to: `.../CMakeFiles/<target>.dir/...`."""
    match = re.search(r'CMakeFiles/([^/]+)\.dir/', output)
    return match.group(1) if match else None


def wasm_command(entry, extra):
    """The entry's compiler, defines and include paths with the module's target and headers; `extra` comes first, so the
    wasm32 DNA tables replace the host's."""
    args = shlex.split(entry['command']) if 'command' in entry else entry['arguments']
    keep, skip = [], False
    for i, arg in enumerate(args[1:]):
        if skip:
            skip = False
            continue
        if arg in ('-o', '-c', '-MF', '-MT', '-MQ'):
            skip = arg != '-c'
            continue
        # A host include directory given as two arguments (-isystem /usr/include/OpenImageIO), or a dependency's in its
        # place (the host's Python headers, the module's CPython's).
        if arg in ('-I', '-isystem') and i + 2 < len(args) and args[i + 2].startswith(('/usr/', *HOST_INCLUDES)):
            skip = True
            keep += [f'-I{include}' for host, include in HOST_INCLUDES.items() if args[i + 2].startswith(host)]
            continue
        if arg == '-DWITH_HEADLESS' and HEADED.search(entry['file']):
            continue
        if arg == entry['file'] or arg.endswith(os.path.basename(entry['file'])) and os.path.isabs(arg) or DROP.match(arg) or arg == '-MD':
            continue
        keep.append(arg)
    compiler = 'clang' if args[0].endswith(('clang', 'cc', 'gcc')) and entry['file'].endswith('.c') else 'clang++'
    return [compiler, *extra, *keep, *FLAGS]


REPO = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
# The work directory (configure_host.sh's DIR), set by main.
# Blender's tree the build reads (main sets it).
BLENDER_TREE = None
WORK = {}
# Host include directories a dependency's headers stand in for (its `host_include`, where the configure found them), set
# by main.
HOST_INCLUDES = {}
SHIMS = wasm_module.own_headers()[:8]
FSTREAM = [os.path.join(WASM, name, 'fstream') for name in ('fstream', 'fstream-read')]


@functools.cache
def fstream_users(tree):
    """What brings the module's <fstream> (wasm/fstream) into a source: <fstream> itself and Blender's headers that
    include it, by the name a source includes them by."""
    names = {'<fstream>'}
    for root, _, files in os.walk(os.path.join(tree, 'source')):
        for name in files:
            if name.endswith(('.h', '.hh')) and '#include <fstream>' in open(os.path.join(root, name), errors='ignore').read():
                names.add(name)
    return frozenset(names)


def shim_key(source):
    """The module's <fstream> (with the reading half it includes), for a source that includes it, directly or through one of Blender's headers: a change
    to it builds that source again."""
    text = open(source, errors='ignore').read()
    users = fstream_users(BLENDER_TREE)
    if not any(f'include {name}' in text or f'/{name}"' in text or f'"{name}"' in text for name in users):
        return ''
    return hashlib.sha1(b''.join(open(path, 'rb').read() for path in FSTREAM)).hexdigest()[:8]


def compile_one(objects, entry, extra):
    command = wasm_command(entry, extra)
    source = entry['file'] if os.path.isabs(entry['file']) else os.path.join(entry['directory'], entry['file'])
    if not os.path.exists(source):
        return source, None, 'generated source missing'
    # Keyed without where the checkout and the work directory are, so objects compiled elsewhere (CI) are found here.
    # The work directory first: CI's is inside the checkout.
    stable = ' '.join(command)
    for work, token in WORK.items():
        stable = stable.replace(work, token)
    stable = stable.replace(REPO, '$REPO')
    digest = hashlib.sha1((stable + open(source, 'rb').read().hex() + shim_key(source)).encode()).hexdigest()[:16]
    obj = os.path.join(objects, f'{os.path.basename(source)}.{digest}.o')
    if os.path.exists(obj):
        return source, obj, None
    # A failure is tried again when the module's own headers (compat.h, wasm/include) change.
    failed = f'{obj}.{SHIMS}.failed'
    if os.path.exists(failed):
        return source, None, open(failed).read()
    result = subprocess.run([*command, '-c', source, '-o', obj], cwd=entry['directory'], capture_output=True, text=True)
    if result.returncode:
        open(failed, 'w').write(result.stderr[-4000:])
        return source, None, result.stderr[-4000:]
    return source, obj, None


WASI_RUN = ("const { WASI } = require('node:wasi'); const fs = require('node:fs');"
            "const wasi = new WASI({ version: 'preview1', args: process.argv.slice(1), env: process.env, preopens: { '/': '/' }, returnOnExit: true });"
            "const instance = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(process.argv[1])), { wasi_snapshot_preview1: wasi.wasiImport,"
            " env: new Proxy({}, { get: (_, name) => () => { throw new Error(name); } }) });"
            "process.exitCode = wasi.start(instance);")


def wasm_tool(host, out, name, libraries, by_any, extra, link=True):
    """One of Blender's build tools (makesrna) built for wasm32 and run by Node's WASI, so what it generates is laid out
    for the module's platform: its own target's objects and the libraries it links. Without `link`, the archive of them
    (for wasm_module.sdna's makesdna)."""
    objects = os.path.join(out, 'objects')
    # Tools read Blender's sources: their <fstream> reads files through WASI's stdio.
    extra = ['-I' + os.path.join(WASM, 'fstream-read'), *extra]
    with concurrent.futures.ThreadPoolExecutor(int(os.environ.get('JOBS', os.cpu_count()))) as pool:
        done = list(pool.map(lambda e: compile_one(objects, e, extra), [e for t in [name, *libraries] for e in by_any.get(t, [])]))
    built = [o for _, o, _ in done if o]
    for source, _, error in done:
        if error:
            print(f'{name}: {os.path.basename(source)} left out: {first_error(error)}', file=sys.stderr)
    if not link:
        archive = os.path.join(out, 'archives', 'tool-' + name + '.a')
        os.makedirs(os.path.dirname(archive), exist_ok=True)
        if os.path.exists(archive):
            os.remove(archive)
        subprocess.run([shutil.which('llvm-ar') or shutil.which('llvm-ar-18'), 'rcs', archive, *built], check=True)
        return [archive]
    # With the module's platform functions (thread-local destructors, allocation), as wasm_module.sdna builds makesdna.
    platform = os.path.join(objects, 'platform.o')
    tree, spec, includes = module_inputs(host, out)
    subprocess.run(['clang++', *includes, *wasm_module.flags(tree, spec), '-c', os.path.join(WASM, 'platform.cc'), '-o', platform], check=True)
    tool = os.path.join(out, name + '.wasm')
    subprocess.run(['clang++', '--target=wasm32-wasi', *built, platform, '-lwasi-emulated-process-clocks', '-lwasi-emulated-mman', '-Wl,--allow-undefined', '-o', tool], check=True)
    return tool


def generate(host, out, missing, by_any, extra):
    """Blender's generated sources, by the commands its build runs (ninja -t commands), with makesrna built for wasm32 and
    datatoc built for the host (it has no dependencies). makesdna is the module build's (wasm_module.sdna, which pads
    Blender's DNA for wasm32), built from this build's blenlib."""
    tree, spec, includes = module_inputs(host, out)
    blenlib = wasm_tool(host, out, 'bf_blenlib', ['bf_intern_guardedalloc', 'bf_intern_clog'], by_any, extra, link=False)
    wasm_module.sdna(tree, out, includes + wasm_module.flags(tree, spec), blenlib)
    for file in ('dna.cc', 'dna_struct_ids.cc', 'dna_verify.cc', 'dna_defaults.cc'):
        shutil.copy(os.path.join(out, 'generated', 'sdna', file), os.path.join(host, 'source/blender/makesdna/intern', file))
    datatoc = os.path.join(out, 'datatoc')
    if not os.path.exists(datatoc):
        subprocess.run(['clang++', '-O2', os.path.join(host, '..', 'blender', 'source/blender/datatoc/datatoc.cc'), '-o', datatoc], check=True)
    makesrna = None
    for path in missing:
        if os.path.exists(path):
            continue
        command = subprocess.run(['ninja', '-C', host, '-t', 'commands', os.path.relpath(path, host)], capture_output=True, text=True).stdout.strip().splitlines()[-1]
        if 'bin/shader_tool' in command or path.endswith('.glsl.c') or '.hh.c' in path:
            continue  # GPU shaders: the GPU module is a seam.
        if 'bin/makesrna' in command:
            makesrna = makesrna or wasm_tool(host, out, 'makesrna', ['bf_dna', 'bf_dna_blenlib', 'bf_dna_defaults', 'bf_intern_guardedalloc'], by_any, extra)
            command = command.replace(os.path.join(host, 'bin/makesrna'), f'node -e "{WASI_RUN}" {makesrna}')
        command = command.replace(os.path.join(host, 'bin/datatoc'), datatoc)
        result = subprocess.run(command, shell=True, cwd=host, capture_output=True, text=True)
        if result.returncode:
            print(f'{os.path.relpath(path, host)}: generator failed\n{result.stdout[-1500:]}{result.stderr[-1500:]}', file=sys.stderr)


# The module build's own sources that stand in for what this build compiles from Blender: RNA's runtime (its generated
# definitions and rna_access).
STAND_INS = {'operator-properties.cc', 'rna-fcurve.cc', 'rna-space.cc'}


# Blender headers a source of the API compiles without, by source: each is an empty header in its place (a clang file
# overlay), the source defining what it needs of it. armature-draw.cc compiles Blender's overlay_armature.cc (and
# relations-draw.cc its overlay_relation.hh) with
# stand-ins for the draw manager that header brings.
OVERLAY_STAND_INS = {'armature-draw.cc': ['source/blender/draw/engines/overlay/overlay_armature.hh'],
                     'relations-draw.cc': ['source/blender/draw/engines/overlay/overlay_base.hh']}


def stand_ins(tree, out, source):
    """The clang arguments that put an empty header in place of each header OVERLAY_STAND_INS names for a source."""
    headers = OVERLAY_STAND_INS.get(os.path.basename(source))
    if not headers:
        return []
    empty = os.path.join(out, 'generated', 'stand-in.hh')
    open(empty, 'w').close()
    overlay = os.path.join(out, 'generated', os.path.basename(source) + '.overlay.json')
    roots = [{'name': os.path.dirname(os.path.join(tree, h)), 'type': 'directory',
              'contents': [{'name': os.path.basename(h), 'type': 'file', 'external-contents': empty}]} for h in headers]
    json.dump({'version': 0, 'roots': roots}, open(overlay, 'w'))
    return ['-ivfsoverlay', overlay]


def glue(host, out, entries, extra):
    """Bylonder's API over Blender (the module build's `api` sources, without its stand-ins), compiled against Blender's
    own headers as this build has them: every include directory Blender's sources use, the generated operator table
    (wasm_module.operator_table) and the module's headers."""
    tree, spec, includes = module_inputs(host, out)
    directories = list(dict.fromkeys(a for e in entries for a in wasm_command(e, [])[1:] if a.startswith('-I')))
    generated = os.path.join(out, 'generated')
    args = [*extra, '-std=c++20', f'-I{generated}', f'-I{WASM}', *directories,
            *(f'-I{os.path.join(tree, "source/blender", d)}' for d in wasm_module.EDITOR_INCLUDES), *(f'-I{os.path.join(tree, os.path.dirname(p))}' for p in spec.get('operators', []))]
    wasm_module.operator_table(tree, out, args + FLAGS, spec)
    sources = [os.path.join(WASM, f) for f in [*spec['api'], 'rna-runtime.cc', 'platform.cc', 'ghost-paths.cc', 'draw-seam.cc'] if f not in STAND_INS]
    entry = lambda src: {'directory': host, 'file': src, 'command': ' '.join(['clang++', *args, *stand_ins(tree, out, src), '-c', src])}
    objects = os.path.join(out, 'objects')
    with concurrent.futures.ThreadPoolExecutor(int(os.environ.get('JOBS', os.cpu_count()))) as pool:
        return list(pool.map(lambda src: compile_one(objects, entry(src), []), sources))


def first_error(stderr):
    return next((line for line in (stderr or '').splitlines() if 'error:' in line), (stderr or '').strip()[:200])


def main():
    host = os.path.abspath(sys.argv[1])
    global BLENDER_TREE
    BLENDER_TREE = os.path.realpath(os.path.join(host, '..', 'blender'))
    WORK[os.path.realpath(os.path.join(host, '..'))] = '$WORK'
    WORK[os.path.dirname(host)] = '$WORK'
    report = sys.argv[sys.argv.index('--report') + 1] if '--report' in sys.argv else os.path.join(host, '..', 'seam-report.json')
    out = os.path.join(host, '..', 'wasm-build')
    objects = os.path.join(out, 'objects')
    os.makedirs(objects, exist_ok=True)
    # Every source sees the fetched dependencies and the wasm32 DNA tables (wasm_module.sdna, made in generate()).
    tree, spec, includes = module_inputs(host, out)
    extra = [f'-I{os.path.join(out, "generated", "sdna")}', *includes]
    deps, _, _ = wasm_module.dependencies(out, spec['dependencies'])
    cache = open(os.path.join(host, 'CMakeCache.txt')).read()
    for name, dep in spec['dependencies'].items():
        if 'host_include' in dep:
            HOST_INCLUDES[re.search(rf'^{dep["host_include"]}:PATH=(.*)$', cache, re.M)[1]] = os.path.join(deps[name], dep['include'])
    own = target_flags(tree, spec, out)
    # A precompiled header's entry (cmake_pch) makes no object.
    entries = [e for e in json.load(open(os.path.join(host, 'compile_commands.json')))
               if target_of(e['output'] if 'output' in e else e['command']) and 'cmake_pch' not in e['file']]
    by_any = {}
    for entry in entries:
        by_any.setdefault(target_of(entry.get('output') or entry['command']), []).append(entry)
    source_of = lambda e: e['file'] if os.path.isabs(e['file']) else os.path.join(e['directory'], e['file'])
    generate(host, out, [source_of(e) for e in entries if not os.path.exists(source_of(e))], by_any, extra)
    # Sources of the seams' libraries the module compiles as Blender does (the manifest's `seam_sources`, paths under
    # source/blender, a directory's with it): Blender's mesh draw extraction on its dummy GPU backend (draw-mesh.cc).
    kept = [f'/source/blender/{path}' for path in spec.get('seam_sources', [])]
    compiled = lambda target, e: not SEAMS.match(target) or any(path in source_of(e) for path in kept)
    by_target = {t: [e for e in group if compiled(t, e)] for t, group in by_any.items()}
    by_target = {t: group for t, group in by_target.items() if group}
    # SHARD=i/n compiles every n-th library only (CI jobs in parallel; the link job then finds all objects cached).
    shard = os.environ.get('SHARD')
    if shard:
        i, n = map(int, shard.split('/'))
        by_target = {t: g for t, g in by_target.items() if zlib.crc32(t.encode()) % n == i}
    print(f'{sum(map(len, by_target.values()))} sources in {len(by_target)} libraries', file=sys.stderr)
    # The header Blender's build writes as it builds (the configure does not): the checkout's hash, which saved files carry.
    subprocess.run(['cmake', '--build', host, '--target', 'buildinfo'], check=True, capture_output=True)
    results = {}
    with concurrent.futures.ThreadPoolExecutor(int(os.environ.get("JOBS", os.cpu_count()))) as pool:
        for target, group in sorted(by_target.items()):
            done = list(pool.map(lambda e: compile_one(objects, e, extra + own.get(target, [])), group))
            results[target] = done
            failed = [s for s, o, _ in done if not o]
            print(f'{target}: {len(done) - len(failed)} of {len(done)} compile', file=sys.stderr, flush=True)
    if shard:
        return
    archives = []
    ar = shutil.which('llvm-ar') or shutil.which('llvm-ar-18')
    for target, done in results.items():
        built = [o for _, o, _ in done if o]
        if built:
            archive = os.path.join(out, 'archives', target + '.a')
            os.makedirs(os.path.dirname(archive), exist_ok=True)
            if os.path.exists(archive):
                os.remove(archive)
            subprocess.run([ar, 'rcs', archive, *built], check=True)
            archives.append(archive)
    module_libraries = module_archives(host, out)
    archives += module_libraries
    # Everything linked as one reactor with every symbol kept, so each library's unresolved symbols show.
    link = ['clang++', '--target=wasm32-wasi', '-mexec-model=reactor', '-Wl,--whole-archive', *archives, '-Wl,--no-whole-archive',
            '-lwasi-emulated-process-clocks', '-lwasi-emulated-mman', '-lwasi-emulated-signal', '-Wl,--error-limit=0', '-Wl,--warn-unresolved-symbols', '-Wl,--allow-undefined',
            '-o', os.path.join(out, 'blender-all.wasm')]
    result = subprocess.run(link, capture_output=True, text=True)
    unresolved = sorted({line.split('undefined symbol: ')[-1].strip() for line in result.stderr.splitlines() if 'undefined symbol: ' in line})
    # Symbols two libraries define (each line: the symbol, then where each definition is).
    duplicates = sorted({line.split('duplicate symbol: ')[-1].strip() for line in result.stderr.splitlines() if 'duplicate symbol: ' in line})
    names = demangle(unresolved)
    by_prefix = {}
    for name in names:
        prefix = re.sub(r'^blender::', '', name.split('(')[0]).split('::')[0].split('_')[0]
        by_prefix.setdefault(prefix, []).append(name)
    wasm = os.path.join(out, 'blender-all.wasm')
    json.dump({
        'libraries': {t: {'sources': len(d), 'compiled': sum(1 for _, o, _ in d if o),
                          'failed': {os.path.relpath(s, host + '/..'): first_error(e) for s, o, e in d if not o}} for t, d in results.items()},
        'link': result.returncode, 'size': os.path.getsize(wasm) if os.path.exists(wasm) else None,
        'unresolved': len(names), 'unresolved_by_prefix': dict(sorted(by_prefix.items(), key=lambda kv: -len(kv[1]))),
        'duplicates': demangle(duplicates) if duplicates else [],
        'link_errors': [line for line in result.stderr.splitlines() if 'error' in line and 'undefined symbol' not in line][:200],
    }, open(report, 'w'), indent=1)
    total = sum(len(d) for d in results.values())
    compiled = sum(1 for d in results.values() for _, o, _ in d if o)
    print(f'{compiled} of {total} sources compile; link exit {result.returncode}; {len(names)} unresolved symbols; report {report}', file=sys.stderr)
    link_module(host, out, entries, extra, archives, module_libraries)


def wrapped(objects):
    """Blender's functions the module's API wraps: each one an API file defines as __wrap_<symbol> (ui-tree.cc's layout
    resolve, platform.cc's thread pool, python.cc's calls into Python before it starts)."""
    nm = shutil.which('llvm-nm') or shutil.which('llvm-nm-18')
    names = subprocess.run([nm, '--defined-only', '--just-symbol-name', *objects], capture_output=True, text=True, check=True).stdout
    return sorted({name.removeprefix('__wrap_') for name in names.split() if name.startswith('__wrap_')})


NULL_DATA = os.path.join(WASM, 'null-data.txt')
# Libraries whose Blender definitions the API's seam implementations replace (window manager, UI layout and drawing,
# fonts, video, Grease Pencil's offscreen rendering); everywhere else Blender's definition wins over the API's stand-in.
SEAM_LIBRARIES = {'bf_blenfont', 'bf_editor_interface', 'bf_editor_screen', 'bf_windowmanager', 'bf_imbuf_movie', 'bf_editor_grease_pencil'}


def link_module(host, out, entries, extra, archives, module_libraries):
    """The module the app loads (src/bmesh/bmesh.wasm's exports): Bylonder's API (glue) with Blender's libraries.
    Where both define a symbol, the loser's definition is made weak (wasm_weaken.py): the module build's own libraries
    (module_archives) win, the API wins in SEAM_LIBRARIES, Blender everywhere else. Each one is listed (wasm-build/replaced.json), so the API's stand-ins can go one by one."""
    built = glue(host, out, entries, extra)
    tree, spec, _ = module_inputs(host, out)
    deps, _, _ = wasm_module.dependencies(out, spec['dependencies'])
    dependency_archives, dependency_flags = wasm_module.dependency_archives(deps, spec['dependencies'])
    failed = [(s, e) for s, o, e in built if not o]
    if failed:
        sys.exit('\n'.join(f'{os.path.basename(s)} does not build: {first_error(e)}' for s, e in failed))
    module = os.path.join(out, 'bylonder-raw.wasm')
    ar = shutil.which('llvm-ar') or shutil.which('llvm-ar-18')
    linked = os.path.join(out, 'module-archives')
    shutil.rmtree(linked, ignore_errors=True)
    os.makedirs(linked)
    api = [shutil.copy(o, os.path.join(linked, f'api-{i}-{os.path.basename(o)}')) for i, (_, o, _) in enumerate(built)]
    # The built dependencies' archives are read once, after Blender's (which are read twice, for their cycles): a
    # partially linked object read twice would be loaded twice.
    dependencies = [shutil.copy(a, linked) for a in dependency_archives]
    copies = [shutil.copy(a, linked) for a in archives if a not in dependency_archives]
    # Renamed copies replace Blender's definitions, so they are linked whole: an archive member is not pulled in for a
    # symbol something already defines.
    renamed = [c for c in copies if os.path.basename(c).startswith('renamed_')]
    replaced = {'blender': {}, 'api': {}}
    while True:
        link = ['clang++', '--target=wasm32-wasi', '-O2', '-mexec-model=reactor', '-Wl,--gc-sections', '-Wl,--error-limit=0',
                '-Wl,-z,stack-size=8388608', '-Wl,--stack-first', '-Wl,--export=malloc', '-Wl,--export=free',
                *(f'-Wl,--wrap={w}' for w in wrapped(api)), *api, '-Wl,--whole-archive', *renamed, '-Wl,--no-whole-archive', *copies, *copies, *dependencies, '-lwasi-emulated-process-clocks', '-lwasi-emulated-mman',
                '-lwasi-emulated-signal', '-lwasi-emulated-getpid', *dependency_flags,
                # Undefined functions are imports, which throw when called; undefined data fails the link, as it would read
                # as null, unless null-data.txt names it.
                '-Wl,--import-undefined', '-Wl,--unresolved-symbols=report-all', f'-Wl,--allow-undefined-file={NULL_DATA}', '-o', module]
        result = subprocess.run(link, capture_output=True, text=True)
        losers = duplicate_losers(result.stderr, {os.path.basename(a) for a in module_libraries})
        if not losers:
            break
        changed = False
        for (path, member), names in losers.items():
            # Weakening settles Blender against the API's seams; a built dependency's definitions are its own.
            if os.path.basename(path) in map(os.path.basename, dependency_archives):
                sys.exit(f'module link: {os.path.basename(path)}({member}) defines what something else defines: {sorted(names)[:5]}')
            done = wasm_weaken.weaken_member(ar, path, member, names) if member else wasm_weaken.weaken_object(path, names)
            changed |= bool(done)
            side, where = ('blender', f'{os.path.basename(path)}({member})') if member else ('api', os.path.basename(path))
            replaced[side].setdefault(where, []).extend(demangle(sorted(done)))
        if not changed:
            sys.exit(f'module link: duplicates left that no definition can yield:\n{result.stderr[-3000:]}')
    json.dump({side: dict(sorted(v.items())) for side, v in replaced.items()}, open(os.path.join(out, 'replaced.json'), 'w'), indent=1)
    if result.returncode:
        sys.exit(f'module link failed:\n{result.stderr[-3000:]}')
    invalid = subprocess.run(['node', '-e', 'new WebAssembly.Module(require("fs").readFileSync(process.argv[1]))', module], capture_output=True, text=True)
    if invalid.returncode:
        sys.exit(f'module link made an invalid module: {next(l for l in invalid.stderr.splitlines() if "Error" in l)}')
    missing = wasm_module.live_imports(module)
    print(f'{module}: {os.path.getsize(module)} bytes; API wins {sum(map(len, replaced["blender"].values()))} symbols, '
          f'Blender {sum(map(len, replaced["api"].values()))} (replaced.json); {len(missing)} imports, which throw when called',
          file=sys.stderr)
    # The module the app loads starts initialized (wasm_snapshot.py): Blender's RNA and node types are in its data.
    wasm_snapshot.snapshot(module, os.path.join(out, 'bylonder.wasm'), named=os.path.join(out, 'bylonder-names.wasm'))
    install(os.path.join(out, 'bylonder.wasm'), python_files(out, tree, deps))


# What Python's library ships without: tests, and the GUI toolkits and tools a browser has no use for.
PYTHON_EXCLUDED = re.compile(r'^(test|idlelib|tkinter|turtledemo|ensurepip|lib2to3|pydoc_data|venv|__phello__)/|/tests?/')
# Blender's scripts in CPython: its modules, its startup packages as modules (the interface they define is the
# transpiled tree's), its core add-ons and presets; and Bylonder's startup script (python/startup).
# Blender's scripts by the zip that ships them and their place in it: its startup packages as modules (the tree registers
# the interface), and its core add-ons (glTF, FBX, BVH, SVG, ...) in their own zip.
SCRIPT_ZIPS = {'scripts.zip': {'modules': 'modules', 'startup': 'modules', 'presets': 'presets'}, 'addons.zip': {'addons_core': 'addons_core'}}


def python_files(out, tree, deps):
    """The files Python reads at its start (src/python/python.js puts them in the module's file system): python313.zip,
    CPython's library and numpy, which zipimport reads in place (compiled, with their sources for tracebacks), and
    scripts.zip, Blender's scripts and Bylonder's startup script, and addons.zip, Blender's core add-ons, both unpacked at
    Blender's system scripts directory."""
    python, library = os.path.join(out, 'python'), os.path.join(out, 'python', 'lib')
    shutil.rmtree(library, ignore_errors=True)
    for root in (os.path.join(deps['cpython'].removesuffix('-build'), 'Lib'), os.path.join(deps['numpy'], 'site')):
        for directory, _, names in os.walk(root):
            for name in (n for n in names if n.endswith('.py')):
                relative = os.path.relpath(os.path.join(directory, name), root)
                if not PYTHON_EXCLUDED.search(relative):
                    os.makedirs(os.path.dirname(os.path.join(library, relative)), exist_ok=True)
                    shutil.copy(os.path.join(directory, name), os.path.join(library, relative))
    # Compiled by the build's Python (deps/cpython.sh's), next to their sources, which name them by their path in the zip.
    subprocess.run(['python3.13', '-m', 'compileall', '-q', '-b', '-s', library, library], check=True)
    with zipfile.ZipFile(os.path.join(python, 'python313.zip'), 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for directory, _, names in os.walk(library):
            for name in sorted(names):
                archive.write(os.path.join(directory, name), os.path.relpath(os.path.join(directory, name), library))
    own = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'python')
    for zip_name, places in SCRIPT_ZIPS.items():
        folders = [(os.path.join(tree, 'scripts', folder), target) for folder, target in places.items()]
        with zipfile.ZipFile(os.path.join(python, zip_name), 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for folder, target in folders + ([(own, '')] if zip_name == 'scripts.zip' else []):
                for directory, _, names in os.walk(folder):
                    for name in sorted(names):
                        if '__pycache__' not in directory:
                            path = os.path.join(directory, name)
                            archive.write(path, os.path.join(target, os.path.relpath(path, folder)))
    return [os.path.join(python, name) for name in ('python313.zip', *SCRIPT_ZIPS)]


def install(module, files):
    """The checkout's module and the files it reads become this build; without scripts/module.mjs's key it is a local
    build, which a fetch keeps."""
    target = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'bmesh', 'bmesh.wasm')
    shutil.copy(module, target)
    for path in files:
        shutil.copy(path, os.path.dirname(target))
    if os.path.exists(target + '.key'):
        os.remove(target + '.key')


def duplicate_losers(stderr, preferred):
    """{(file, archive member or None): symbols} whose definitions should yield, from wasm-ld's "duplicate symbol: S"
    lines, each followed by ">>> defined in" both places."""
    losers, lines = {}, stderr.splitlines()
    for i, line in enumerate(lines):
        if 'duplicate symbol: ' not in line:
            continue
        places = [re.match(r'>>> defined in (\S+?)(?:\((\S+)\))?$', where.strip()) for where in lines[i + 1:i + 3]]
        places = [(m.group(1), m.group(2)) for m in places if m]
        if len(places) != 2:
            continue
        members = [p for p in places if p[1]]
        objects = [p for p in places if not p[1]]
        own = [p for p in places if os.path.basename(p[0]) in preferred]
        symbol = line.split('duplicate symbol: ')[-1].strip()
        if len(own) == 1:
            loser = next(p for p in places if p not in own)
        elif objects and members:
            library = os.path.basename(members[0][0]).removesuffix('.a')
            seam = library in SEAM_LIBRARIES
            loser = members[0] if seam else objects[0]
        else:
            loser = places[1]
        losers.setdefault(loser, set()).add(symbol)
    return losers


if __name__ == '__main__':
    main()
