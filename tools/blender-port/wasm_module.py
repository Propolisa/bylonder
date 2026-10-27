"""WebAssembly modules: whole Blender libraries built with Clang's wasm32-wasi target, for state that lives in the
module (the edit-mode BMesh), where per-function units (wasm.py) would copy it at every call.

A module (manifest `modules`: output path under src/, its API file in wasm/, and the library directories it draws on):
- builds from a hard-linked copy of the Blender tree with the reviewed patches in wasm/patches applied;
- compiles every source of its libraries in parallel, cached by source, flags and patches, and archives what builds;
- links its API against the archives, so only what the API reaches is in the module. Symbols still missing become
  imports, listed after the build: calling one throws (src/port/wasm.js), so a gap shows where it is reached.

Usage: tools/blender-port/wasm_module.py SRC [MODULE]   (SRC: Blender sources of the manifest's tag)
"""
import concurrent.futures
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys

import convert

HERE = os.path.dirname(os.path.abspath(__file__))
WASM = os.path.join(HERE, 'wasm')
# Header directories the editors' sources include beyond those the converter parses with.
EDITOR_INCLUDES = ('blenloader', 'editors/include', 'editors/mesh', 'windowmanager', 'gpu', 'imbuf', 'blenfont', 'render', 'animrig', 'nodes',
                   'asset_system', 'draw')


def patched_tree(root):
    """A hard-linked copy of root with the patches applied, made again when the patches change."""
    patches = sorted(glob.glob(os.path.join(WASM, 'patches', '*.patch')))
    digest = hashlib.sha1(b''.join(open(p, 'rb').read() for p in patches)).hexdigest()[:16]
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


def dependencies(tree, deps):
    """Libraries Blender builds against, at the versions Blender pins (build_files/build_environment/cmake/versions.cmake),
    cloned once into the tree; returns their include directories and a key of their versions."""
    includes = []
    for name, dep in sorted(deps.items()):
        path = os.path.join(tree, '.port-wasm', 'deps', f'{name}-{dep["tag"]}')
        if not os.path.exists(path):
            if 'sha256' in dep:  # An archive, checked against the hash Blender pins.
                data = subprocess.run(['curl', '-sfL', dep['url']], capture_output=True, check=True).stdout
                if hashlib.sha256(data).hexdigest() != dep['sha256']:
                    sys.exit(f'{name}: {dep["url"]} does not match its pinned hash')
                os.makedirs(path)
                subprocess.run(['tar', '-xz', '--strip-components=1', '-C', path], input=data, check=True)
            else:
                subprocess.run(['git', 'clone', '-q', '--depth', '1', '--branch', dep['tag'], dep['url'], path], check=True)
        includes.append(f'-I{os.path.join(path, dep.get("include", ""))}')
    return includes, ' '.join(f'{n}@{d["tag"]}' for n, d in sorted(deps.items()))


def flags(tree):
    return ['--target=wasm32-wasi', '-std=c++20', '-O2', '-DNDEBUG', '-DFMT_HEADER_ONLY', '-fignore-exceptions',
            '-Wno-c++11-narrowing', '-D_WASI_EMULATED_PROCESS_CLOCKS', '-isystem', os.path.join(WASM, 'include'),
            '-include', os.path.join(WASM, 'compat.h'), *convert.include_args(tree),
            *(f'-I{os.path.join(tree, "source/blender", d)}' for d in EDITOR_INCLUDES), f'-I{os.path.join(tree, "intern/guardedalloc/intern")}']


def compile_all(tree, sources, args, key):
    """Objects of the sources that build, by source; what does not build is left out (an archive member nothing needs)."""
    objects = os.path.join(tree, '.port-wasm', 'objects')
    os.makedirs(objects, exist_ok=True)
    common = hashlib.sha1((' '.join(args) + key + open(os.path.join(WASM, 'compat.h')).read()).encode()).hexdigest()

    def one(src):
        digest = hashlib.sha1((common + open(src, 'rb').read().hex()).encode()).hexdigest()[:16]
        obj = os.path.join(objects, f'{os.path.basename(src)}.{digest}.o')
        if os.path.exists(obj):
            return src, obj
        result = subprocess.run(['clang++', *args, '-c', src, '-o', obj], capture_output=True, text=True)
        return src, (obj if result.returncode == 0 else None)

    with concurrent.futures.ThreadPoolExecutor(os.cpu_count()) as pool:
        return dict(pool.map(one, sources))


def live_imports(path):
    """What the module still imports besides WASI: Blender symbols nothing in it defines."""
    script = ("const m = new WebAssembly.Module(require('fs').readFileSync(process.argv[1]));"
              "console.log(JSON.stringify(WebAssembly.Module.imports(m).filter((i) => i.module !== 'wasi_snapshot_preview1').map((i) => i.name)))")
    names = json.loads(subprocess.run(['node', '-e', script, path], capture_output=True, text=True, check=True).stdout)
    demangled = subprocess.run(['c++filt'], input='\n'.join(names), capture_output=True, text=True).stdout.split('\n')
    return sorted({d.split('(')[0] for d in demangled if d})


def build(root, name, spec):
    tree, patches = patched_tree(root)
    includes, versions = dependencies(tree, spec.get('dependencies', {}))
    args = includes + flags(tree)
    patches += versions
    archives = []
    for lib in spec['libraries']:
        sources = sorted(glob.glob(os.path.join(tree, lib, '*.c*'))) if os.path.isdir(os.path.join(tree, lib)) else [os.path.join(tree, lib)]
        objects = compile_all(tree, sources, args, patches)
        archive = os.path.join(tree, '.port-wasm', lib.replace('/', '_') + '.a')
        if os.path.exists(archive):
            os.remove(archive)
        subprocess.run([shutil.which('llvm-ar') or shutil.which('llvm-ar-18'), 'rcs', archive, *(o for o in objects.values() if o)], check=True)
        archives.append(archive)
        print(f'{lib}: {sum(1 for o in objects.values() if o)} of {len(objects)} sources build', file=sys.stderr)
    own = compile_all(tree, [os.path.join(WASM, spec['api']), os.path.join(WASM, 'platform.cc')], args, patches)
    failed = [src for src, obj in own.items() if obj is None]
    if failed:
        result = subprocess.run(['clang++', *args, '-c', failed[0], '-o', os.devnull], capture_output=True, text=True)
        sys.exit(f'{os.path.relpath(failed[0], convert.REPO)} does not build:\n{result.stderr}')
    out = os.path.join(convert.REPO, 'src', name)
    # Archives twice: a member one archive pulls in may need members of an archive listed before it.
    result = subprocess.run(['clang++', '--target=wasm32-wasi', '-O2', '-mexec-model=reactor', '-Wl,--gc-sections', '-Wl,--strip-all',
                             '-Wl,--allow-undefined', '-Wl,--export=malloc', '-Wl,--export=free', '-o', out, *own.values(),
                             *archives, *archives, '-lwasi-emulated-process-clocks'], capture_output=True, text=True)
    if result.returncode:
        sys.exit(f'{name}: link failed\n{result.stderr}')
    missing = live_imports(out)
    print(f'built src/{name}: {os.path.getsize(out)} bytes; {len(missing)} imports, which throw when called:\n  ' + '\n  '.join(missing), file=sys.stderr)


def main():
    root = sys.argv[1]
    modules = json.load(open(os.path.join(HERE, 'manifest.json')))['modules']
    for name, spec in modules.items():
        if len(sys.argv) < 3 or sys.argv[2] == name:
            build(root, name, spec)


if __name__ == '__main__':
    main()
