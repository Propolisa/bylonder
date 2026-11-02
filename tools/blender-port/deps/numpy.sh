#!/usr/bin/env bash
# numpy for wasm32-wasi, by numpy's own meson build (its vendored meson) as a cross build against deps/cpython.sh's
# Python. wasm32-wasi has no shared libraries: each extension module is linked as its shared library would be, into one
# object whose definitions are its own but its PyInit function, and numpy_inittab lists them by package name for
# PyImport_ExtendInittab (CPython's BuiltinImporter finds dotted names). The build Python is the host's python3.13 seeing
# the target's sysconfig, as CPython's own cross builds run it; Cython is at Blender's pin (versions.cmake).
# Usage: deps/numpy.sh NUMPY_SOURCE CPYTHON_BUILD BUILD   (BUILD gets libnumpy.a and site/numpy)
set -euo pipefail
SRC=$(realpath "$1")
PY=$(realpath "$2")
mkdir -p "$3"
BUILD=$(realpath "$3")
TOOLS=$(dirname "$(realpath "$0")")
cd "$BUILD"

if [ ! -x venv/bin/cython ]; then
  python3.13 -m venv venv
  venv/bin/pip install -q cython==3.0.11
fi
cat >python <<EOF
#!/bin/sh
_PYTHON_HOST_PLATFORM=wasi-wasm32 _PYTHON_SYSCONFIGDATA_NAME=_sysconfigdata__wasi_wasm32-wasi \
PYTHONPATH=$PY/$(cat "$PY/pybuilddir.txt") exec python3.13 "\$@"
EOF
chmod +x python
cat >cross.ini <<EOF
[binaries]
c = ['$TOOLS/clang-wasi']
cpp = ['$TOOLS/clang-wasi', '-fignore-exceptions', '-isystem', '$TOOLS/../wasm/include']
ar = 'llvm-ar-18'
python = '$BUILD/python'
cython = '$BUILD/venv/bin/cython'
[host_machine]
system = 'wasi'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'
[properties]
needs_exe_wrapper = true
longdouble_format = 'IEEE_QUAD_LE'
EOF
printf "[binaries]\ncython = '%s'\n" "$BUILD/venv/bin/cython" >native.ini

if [ ! -f out/build.ninja ]; then
  python3.13 "$SRC/vendored-meson/meson/meson.py" setup out "$SRC" --cross-file cross.ini --native-file native.ini \
    --buildtype=release -Doptimization=2 -Db_ndebug=true -Dallow-noblas=true -Dblas=none -Dlapack=none \
    -Ddisable-threading=true -Ddisable-optimization=true -Ddisable-highway=true -Ddisable-svml=true -Dcpu-baseline=none \
    -Dcpu-dispatch=none >setup.log
fi
EXTENSIONS=$(ninja -C out -t targets all | grep -o '^numpy/[^:]*\.so:' | tr -d : | grep -v '_tests\|_simd\|_dummy')
inputs() { ninja -C out -t commands "$1" | tail -1 | tr ' ' '\n' | grep '\.[oa]$'; }
ninja -C out -j"${JOBS:-4}" $(for so in $EXTENSIONS; do inputs "$so"; done | sort -u) >ninja.log
rm -rf modules libnumpy.a && mkdir modules
for so in $EXTENSIONS; do
  name=$(basename "$so" | cut -d. -f1)
  objects=$(inputs "$so")
  (cd out && wasm-ld-18 -r -o "../modules/$name.o" $objects)
  python3 "$TOOLS/../wasm_weaken.py" "modules/$name.o" PyInit_
  echo "PyObject *PyInit_$name(void);" >>modules/inittab.h
  echo "{\"$(dirname "$so" | tr / .).$name\", PyInit_$name}," >>modules/inittab.inc
done
printf '#include <Python.h>\n#include "inittab.h"\nstruct _inittab numpy_inittab[] = {\n#include "inittab.inc"\n{0, 0}};\n' >modules/inittab.c
"$TOOLS/clang-wasi" -O2 -I"$PY/prefix/include/python3.13" -c modules/inittab.c -o modules/inittab.o
llvm-ar-18 rcs libnumpy.a modules/*.o

# What meson would install of the package's Python (its introspection: files and whole directories), without tests.
python3.13 - "$SRC/vendored-meson/meson/meson.py" out site <<'PY'
import json, os, re, shutil, subprocess, sys
meson, out, site = sys.argv[1:]
installed = json.loads(subprocess.run([sys.executable, meson, 'introspect', '--installed', out], capture_output=True, text=True, check=True).stdout)
shutil.rmtree(site, ignore_errors=True)
for source, target in ((s, t) for s, t in installed.items() if re.search('-packages/', t)):
    target = os.path.join(site, re.split('-packages/', target, maxsplit=1)[1])
    walk = os.walk(source) if os.path.isdir(source) else [(os.path.dirname(source), [], [os.path.basename(source)])]
    for root, _, names in walk:
        for name in (n for n in names if n.endswith('.py') and '/tests' not in root):
            path = os.path.join(root, name)
            dest = os.path.join(target, os.path.relpath(path, source)) if os.path.isdir(source) else target
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy(path, dest)
PY
