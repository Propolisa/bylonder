"""Lists the module's sources that include a header from the host's /usr/include or /usr/local/include (other than the
WASI sysroot's): a header of a different library version than the one the module links, which compiles and links and
then misbehaves (an OpenColorIO 2.1 symbol in a module of OpenColorIO 2.5). Preprocesses each source as the module
build compiles it (blender_build.py, with the manifest's per-target flags) and reads its dependencies.

usage: python3 tools/blender-port/host_headers.py HOST_BUILD   (exit status 1 when a source includes a host header)
"""
import concurrent.futures
import json
import os
import re
import subprocess
import sys

import blender_build as b

# The sysroot's headers and Clang's own are the module's; anything else under these is the host's.
HOST = re.compile(r'^/usr/(local/)?include/(?!wasm32-wasi/)')


def host_headers(command, source, directory):
    result = subprocess.run([*command, '-M', '-MG', source], cwd=directory, capture_output=True, text=True)
    paths = result.stdout.replace('\\\n', ' ').split()[1:]
    return sorted({os.path.normpath(os.path.join(directory, p)) for p in paths if HOST.match(os.path.normpath(os.path.join(directory, p)))})


def main():
    host = os.path.abspath(sys.argv[1])
    b.BLENDER_TREE = os.path.realpath(os.path.join(host, '..', 'blender'))
    out = os.path.join(host, '..', 'wasm-build')
    tree, spec, includes = b.module_inputs(host, out)
    extra = [f'-I{os.path.join(out, "generated", "sdna")}', *includes]
    own = b.target_flags(tree, spec, out)
    entries = [e for e in json.load(open(os.path.join(host, 'compile_commands.json'))) if b.target_of(e.get('output') or e['command'])]
    entries = [e for e in entries if not b.SEAMS.match(b.target_of(e.get('output') or e['command']))]

    def check(entry):
        target = b.target_of(entry.get('output') or entry['command'])
        source = entry['file'] if os.path.isabs(entry['file']) else os.path.join(entry['directory'], entry['file'])
        return target, source, host_headers(b.wasm_command(entry, extra + own.get(target, [])), source, entry['directory'])

    leaks = {}
    with concurrent.futures.ThreadPoolExecutor(int(os.environ.get('JOBS', 2))) as pool:
        for target, source, headers in pool.map(check, entries):
            if headers:
                leaks.setdefault(target, {})[os.path.relpath(source, b.BLENDER_TREE)] = headers
    for target, sources in sorted(leaks.items()):
        print(f'{target}: {len(sources)} sources')
        for source, headers in sorted(sources.items()):
            print(f'  {source}: {", ".join(sorted({h.split("/include/")[1].split("/")[0] for h in headers}))}')
    sys.exit(1 if leaks else 0)


if __name__ == '__main__':
    main()
