"""Blender built as Blender builds itself, for wasm32: the compile commands of Blender's own CMake configure (a host
build directory configured with CMAKE_EXPORT_COMPILE_COMMANDS), each retargeted to wasm32-wasi with the module's
compatibility headers, grouped by the CMake library they belong to. Libraries on the far side of Bylonder's seams
(docs/blender-boundary.md: window system, GPU and drawing, Python's C API, Cycles, audio) are left out.

Usage: tools/blender-port/blender_build.py HOST_BUILD [--report FILE]   (HOST_BUILD: tools/blender-port/configure_host.sh)
  Compiles every other library, links them, and reports per library what does not compile and which symbols nothing
  defines: the seams Bylonder implements. JOBS=n compiles n sources at a time; SHARD=i/n compiles one in n libraries.
"""
import concurrent.futures
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import zlib

import wasm_module
import wasm_snapshot
import wasm_weaken
from wasm_module import WASM, demangle

# CMake targets on the far side of the seams, and Blender's generators and tests, matched against target names.
SEAMS = re.compile(r'^(bf_intern_ghost|bf_gpu|bf_draw|bf_python|bf_intern_cycles|cycles_|bf_intern_audaspace|audaspace|bf_imbuf_openexr'
                   r'|bf_intern_libmv|extern_glog|extern_ceres|bf_intern_mantaflow|bf_blendthumb|blender$|makesdna|makesrna|datatoc'
                   r'|msgfmt|.*_test|.*_tests|gtest|bf_intern_wayland|bf_intern_sky_gpu|.*_cpp_shaders_.*|shader_tool)')
# Host flags that have no meaning for wasm32 or name host paths.
DROP = re.compile(r'^(-DFMT_SHARED|-DWITH_TBB$|-DWITH_TBB=|-DEIGEN_HAS_TBB|-DWITH_OPENVDB_BLOSC|-DHAVE_EXECINFO_H|-DHAVE_MALLOC_STATS_H|-I/usr/|-isystem/usr/|-march=|-mtune=|-msse|-mavx|-mfpmath|-m64|-fPIC|-fopenmp|-pthread|-O\d|-g\d?$|-W|-pedantic|-fno-strict-overflow'
                  r'|-fmacro-prefix-map|-ffile-prefix-map|-fdiagnostics|-fcolor-diagnostics|-ffp-contract|-fno-trapping-math)')
# Sources built as a Blender with a window draws them, though the configure is headless: the interface, whose drawing
# the API records (its icons are registered only then, icons_init).
HEADED = re.compile(r'source/blender/editors/interface/')
# Sources whose Python path is kept: typed values are evaluated as expressions (BPY_run_string_as_number, which the
# module answers with Blender's Python-like expression evaluator, wasm/platform.cc), so their units apply.
PYTHON_EXPRESSIONS = re.compile(r'source/blender/editors/(util/numinput|space_text/text_ops)\.cc$')
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
    (FreeType, OpenSubdiv, OpenVDB, zstd) and Blender's renamed copies (blenfont as vfont_BLF_ for text objects, as the
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
    return archives


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
        # A host include directory given as two arguments (-isystem /usr/include/OpenImageIO).
        if arg in ('-I', '-isystem') and i + 2 < len(args) and args[i + 2].startswith('/usr/'):
            skip = True
            continue
        if arg == '-DWITH_HEADLESS' and HEADED.search(entry['file']):
            continue
        if arg == entry['file'] or arg.endswith(os.path.basename(entry['file'])) and os.path.isabs(arg) or DROP.match(arg) or arg == '-MD':
            continue
        keep.append(arg)
    if PYTHON_EXPRESSIONS.search(entry['file']):
        keep += ['-DWITH_PYTHON', '-I' + entry['file'].split('source/blender/')[0] + 'source/blender/python']
    compiler = 'clang' if args[0].endswith(('clang', 'cc', 'gcc')) and entry['file'].endswith('.c') else 'clang++'
    return [compiler, *extra, *keep, *FLAGS]


REPO = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
# The work directory (configure_host.sh's DIR), set by main.
WORK = {}
SHIMS = wasm_module.own_headers()[:8]


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
    digest = hashlib.sha1((stable + open(source, 'rb').read().hex()).encode()).hexdigest()[:16]
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
    entry = lambda src: {'directory': host, 'file': src, 'command': ' '.join(['clang++', *args, '-c', src])}
    objects = os.path.join(out, 'objects')
    with concurrent.futures.ThreadPoolExecutor(int(os.environ.get('JOBS', os.cpu_count()))) as pool:
        return list(pool.map(lambda src: compile_one(objects, entry(src), []), sources))


def first_error(stderr):
    return next((line for line in (stderr or '').splitlines() if 'error:' in line), (stderr or '').strip()[:200])


def main():
    host = os.path.abspath(sys.argv[1])
    WORK[os.path.realpath(os.path.join(host, '..'))] = '$WORK'
    WORK[os.path.dirname(host)] = '$WORK'
    report = sys.argv[sys.argv.index('--report') + 1] if '--report' in sys.argv else os.path.join(host, '..', 'seam-report.json')
    out = os.path.join(host, '..', 'wasm-build')
    objects = os.path.join(out, 'objects')
    os.makedirs(objects, exist_ok=True)
    # Every source sees the fetched dependencies and the wasm32 DNA tables (wasm_module.sdna, made in generate()).
    _, _, includes = module_inputs(host, out)
    extra = [f'-I{os.path.join(out, "generated", "sdna")}', *includes]
    entries = [e for e in json.load(open(os.path.join(host, 'compile_commands.json'))) if target_of(e['output'] if 'output' in e else e['command'])]
    by_any = {}
    for entry in entries:
        by_any.setdefault(target_of(entry.get('output') or entry['command']), []).append(entry)
    source_of = lambda e: e['file'] if os.path.isabs(e['file']) else os.path.join(e['directory'], e['file'])
    generate(host, out, [source_of(e) for e in entries if not os.path.exists(source_of(e))], by_any, extra)
    by_target = {t: group for t, group in by_any.items() if not SEAMS.match(t)}
    # SHARD=i/n compiles every n-th library only (CI jobs in parallel; the link job then finds all objects cached).
    shard = os.environ.get('SHARD')
    if shard:
        i, n = map(int, shard.split('/'))
        by_target = {t: g for t, g in by_target.items() if zlib.crc32(t.encode()) % n == i}
    print(f'{sum(map(len, by_target.values()))} sources in {len(by_target)} libraries', file=sys.stderr)
    results = {}
    with concurrent.futures.ThreadPoolExecutor(int(os.environ.get("JOBS", os.cpu_count()))) as pool:
        for target, group in sorted(by_target.items()):
            done = list(pool.map(lambda e: compile_one(objects, e, extra), group))
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
            '-lwasi-emulated-process-clocks', '-lwasi-emulated-mman', '-Wl,--error-limit=0', '-Wl,--warn-unresolved-symbols', '-Wl,--allow-undefined',
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


# Bylonder's own path resolution for its custom properties (rna-runtime.cc).
WRAPPED = ['_ZN7blender2ui20block_layout_resolveEPNS0_5BlockE']


# Libraries whose Blender definitions the API's seam implementations replace (window manager, UI layout and drawing,
# fonts); everywhere else Blender's definition wins over the API's stand-in.
SEAM_LIBRARIES = {'bf_blenfont', 'bf_editor_interface', 'bf_editor_screen', 'bf_windowmanager'}
# The API's seam implementations in other libraries (each a port-override in tools/blender-port/wasm), which win too:
# what Bylonder's own editor does in Blender's place.
SEAM_FUNCTIONS = set()


def link_module(host, out, entries, extra, archives, module_libraries):
    """The module the app loads (src/bmesh/bmesh.wasm's exports): Bylonder's API (glue) with Blender's libraries.
    Where both define a symbol, the loser's definition is made weak (wasm_weaken.py): the module build's own libraries
    (module_archives) win, the API wins in SEAM_LIBRARIES, Blender everywhere else. Each one is listed (wasm-build/replaced.json), so the API's stand-ins can go one by one."""
    built = glue(host, out, entries, extra)
    failed = [(s, e) for s, o, e in built if not o]
    if failed:
        sys.exit('\n'.join(f'{os.path.basename(s)} does not build: {first_error(e)}' for s, e in failed))
    module = os.path.join(out, 'bylonder-raw.wasm')
    ar = shutil.which('llvm-ar') or shutil.which('llvm-ar-18')
    linked = os.path.join(out, 'module-archives')
    shutil.rmtree(linked, ignore_errors=True)
    os.makedirs(linked)
    api = [shutil.copy(o, os.path.join(linked, f'api-{i}-{os.path.basename(o)}')) for i, (_, o, _) in enumerate(built)]
    copies = [shutil.copy(a, linked) for a in archives]
    # Renamed copies replace Blender's definitions, so they are linked whole: an archive member is not pulled in for a
    # symbol something already defines.
    renamed = [c for c in copies if os.path.basename(c).startswith('renamed_')]
    strip = [] if os.environ.get('WASM_NAMES') else ['-Wl,--strip-all']
    replaced = {'blender': {}, 'api': {}}
    while True:
        link = ['clang++', '--target=wasm32-wasi', '-O2', '-mexec-model=reactor', '-Wl,--gc-sections', *strip, '-Wl,--error-limit=0',
                '-Wl,-z,stack-size=8388608', '-Wl,--stack-first', '-Wl,--export=malloc', '-Wl,--export=free',
                *(f'-Wl,--wrap={w}' for w in WRAPPED), *api, '-Wl,--whole-archive', *renamed, '-Wl,--no-whole-archive', *copies, *copies, '-lwasi-emulated-process-clocks', '-lwasi-emulated-mman',
                '-Wl,--allow-undefined', '-o', module]
        result = subprocess.run(link, capture_output=True, text=True)
        losers = duplicate_losers(result.stderr, {os.path.basename(a) for a in module_libraries})
        if not losers:
            break
        changed = False
        for (path, member), names in losers.items():
            done = wasm_weaken.weaken_member(ar, path, member, names) if member else wasm_weaken.weaken_object(path, names)
            changed |= bool(done)
            side, where = ('blender', f'{os.path.basename(path)}({member})') if member else ('api', os.path.basename(path))
            replaced[side].setdefault(where, []).extend(demangle(sorted(done)))
        if not changed:
            sys.exit(f'module link: duplicates left that no definition can yield:\n{result.stderr[-3000:]}')
    json.dump({side: dict(sorted(v.items())) for side, v in replaced.items()}, open(os.path.join(out, 'replaced.json'), 'w'), indent=1)
    if result.returncode:
        sys.exit(f'module link failed:\n{result.stderr[-3000:]}')
    missing = wasm_module.live_imports(module)
    print(f'{module}: {os.path.getsize(module)} bytes; API wins {sum(map(len, replaced["blender"].values()))} symbols, '
          f'Blender {sum(map(len, replaced["api"].values()))} (replaced.json); {len(missing)} imports, which throw when called',
          file=sys.stderr)
    # The module the app loads starts initialized (wasm_snapshot.py): Blender's RNA and node types are in its data.
    wasm_snapshot.snapshot(module, os.path.join(out, 'bylonder.wasm'))


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
            seam = library in SEAM_LIBRARIES or symbol.split('(')[0] in SEAM_FUNCTIONS
            loser = members[0] if seam else objects[0]
        else:
            loser = places[1]
        losers.setdefault(loser, set()).add(symbol)
    return losers


if __name__ == '__main__':
    main()
