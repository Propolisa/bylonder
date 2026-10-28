"""Blender built as Blender builds itself, for wasm32: the compile commands of Blender's own CMake configure (a host
build directory configured with CMAKE_EXPORT_COMPILE_COMMANDS), each retargeted to wasm32-wasi with the module's
compatibility headers, grouped by the CMake library they belong to. Libraries on the far side of Bylonder's seams
(docs/blender-boundary.md: window system, GPU and drawing, Python's C API, Cycles, audio and video) are left out.

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
from wasm_module import WASM, demangle

# CMake targets on the far side of the seams, and Blender's generators and tests, matched against target names.
SEAMS = re.compile(r'^(bf_intern_ghost|bf_gpu|bf_draw|bf_python|bf_intern_cycles|cycles_|bf_intern_audaspace|audaspace|bf_imbuf_movie'
                   r'|bf_intern_libmv|extern_glog|extern_ceres|bf_intern_mantaflow|bf_blendthumb|blender$|makesdna|makesrna|datatoc'
                   r'|msgfmt|.*_test|.*_tests|gtest|bf_intern_wayland|bf_intern_sky_gpu)')
# Host flags that have no meaning for wasm32 or name host paths.
DROP = re.compile(r'^(-DFMT_SHARED|-DHAVE_EXECINFO_H|-DHAVE_MALLOC_STATS_H|-I/usr/|-isystem/usr/|-march=|-mtune=|-msse|-mavx|-mfpmath|-m64|-fPIC|-fopenmp|-pthread|-O\d|-g\d?$|-W|-pedantic|-fno-strict-overflow'
                  r'|-fmacro-prefix-map|-ffile-prefix-map|-fdiagnostics|-fcolor-diagnostics|-ffp-contract|-fno-trapping-math)')
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
        if arg == entry['file'] or arg.endswith(os.path.basename(entry['file'])) and os.path.isabs(arg) or DROP.match(arg) or arg == '-MD':
            continue
        keep.append(arg)
    compiler = 'clang' if args[0].endswith(('clang', 'cc', 'gcc')) and entry['file'].endswith('.c') else 'clang++'
    return [compiler, *extra, *keep, *FLAGS]


def compile_one(objects, entry, extra):
    command = wasm_command(entry, extra)
    source = entry['file'] if os.path.isabs(entry['file']) else os.path.join(entry['directory'], entry['file'])
    if not os.path.exists(source):
        return source, None, 'generated source missing'
    digest = hashlib.sha1((' '.join(command) + open(source, 'rb').read().hex()).encode()).hexdigest()[:16]
    obj = os.path.join(objects, f'{os.path.basename(source)}.{digest}.o')
    if os.path.exists(obj):
        return source, obj, None
    if os.path.exists(obj + '.failed'):
        return source, None, open(obj + '.failed').read()
    result = subprocess.run([*command, '-c', source, '-o', obj], cwd=entry['directory'], capture_output=True, text=True)
    if result.returncode:
        open(obj + '.failed', 'w').write(result.stderr[-4000:])
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
    subprocess.run(['clang++', '--target=wasm32-wasi', *built, platform, '-lwasi-emulated-process-clocks', '-Wl,--allow-undefined', '-o', tool], check=True)
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


def first_error(stderr):
    return next((line for line in (stderr or '').splitlines() if 'error:' in line), (stderr or '').strip()[:200])


def main():
    host = os.path.abspath(sys.argv[1])
    # The module build's directory: its fetched dependencies and its wasm32 makesdna output (wasm_module.sdna).
    _, _, includes = module_inputs(host, out)
    extra = [f'-I{os.path.join(out, "generated", "sdna")}', *includes]
    report = sys.argv[sys.argv.index('--report') + 1] if '--report' in sys.argv else os.path.join(host, '..', 'seam-report.json')
    out = os.path.join(host, '..', 'wasm-build')
    objects = os.path.join(out, 'objects')
    os.makedirs(objects, exist_ok=True)
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
    # Everything linked as one reactor with every symbol kept, so each library's unresolved symbols show.
    link = ['clang++', '--target=wasm32-wasi', '-mexec-model=reactor', '-Wl,--whole-archive', *archives, '-Wl,--no-whole-archive',
            '-lwasi-emulated-process-clocks', '-Wl,--error-limit=0', '-Wl,--warn-unresolved-symbols', '-Wl,--allow-undefined',
            '-o', os.path.join(out, 'blender-all.wasm')]
    result = subprocess.run(link, capture_output=True, text=True)
    unresolved = sorted({line.split('undefined symbol: ')[-1].strip() for line in result.stderr.splitlines() if 'undefined symbol: ' in line})
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
    }, open(report, 'w'), indent=1)
    total = sum(len(d) for d in results.values())
    compiled = sum(1 for d in results.values() for _, o, _ in d if o)
    print(f'{compiled} of {total} sources compile; link exit {result.returncode}; {len(names)} unresolved symbols; report {report}', file=sys.stderr)


if __name__ == '__main__':
    main()
