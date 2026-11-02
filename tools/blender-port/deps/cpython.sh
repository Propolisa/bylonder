#!/usr/bin/env bash
# CPython for wasm32-wasi, with CPython's own WASI support (Tools/wasm/config.site-wasm32-wasi) on the module's
# toolchain (clang 18, the system wasi-libc), the host's python3.13 as the build Python. zlib (zipimport, zipfile) and
# expat (pyexpat) are the module's own (manifest zlib and expat), which the module links once; CPython's own links
# here (configure's checks, the interpreter make links) use them built here.
# Usage: deps/cpython.sh PYTHON_SOURCE ZLIB_SOURCE EXPAT_SOURCE BUILD   (BUILD gets libpython3.13.a and pyconfig.h)
set -euo pipefail
SRC=$(realpath "$1")
ZLIB=$(realpath "$2")
EXPAT=$(realpath "$3/expat/lib")
mkdir -p "$4/zlib" "$4/expat"
BUILD=$(realpath "$4")
TOOLS=$(dirname "$(realpath "$0")")
export CC="$TOOLS/clang-wasi" CPP="$TOOLS/clang-wasi -E" AR=llvm-ar-18 RANLIB=llvm-ranlib-18

cd "$BUILD/zlib"
for c in "$ZLIB"/*.c; do "$CC" -O2 -DHAVE_UNISTD_H -c "$c" -o "$(basename "$c" .c).o"; done
rm -f ../libz.a && $AR rcs ../libz.a ./*.o
cd "$BUILD/expat"
for c in xmlparse xmlrole xmltok; do "$CC" -O2 -DXML_STATIC -I"$EXPAT" -c "$EXPAT/$c.c" -o "$c.o"; done
rm -f ../libexpat.a && $AR rcs ../libexpat.a ./*.o

cd "$BUILD"
# The host's libraries are not the target's.
export PKG_CONFIG_PATH= PKG_CONFIG_LIBDIR=/nonexistent
export CONFIG_SITE="$SRC/Tools/wasm/config.site-wasm32-wasi $TOOLS/config.site-cpython"
export CFLAGS="-O2 -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_GETPID"
export OPT="-DNDEBUG"
export LDFLAGS="-lwasi-emulated-process-clocks -lwasi-emulated-signal -lwasi-emulated-getpid"
export ZLIB_CFLAGS="-I$ZLIB" ZLIB_LIBS="$BUILD/libz.a" LIBEXPAT_CFLAGS="-I$EXPAT -DXML_STATIC" LIBEXPAT_LDFLAGS="$BUILD/libexpat.a"
if [ ! -f Makefile ]; then
  "$SRC/configure" --host=wasm32-unknown-wasi --build=x86_64-pc-linux-gnu --with-build-python=python3.13 \
    --prefix="$BUILD/prefix" --disable-test-modules --without-ensurepip --with-system-expat >configure.log
fi
make -j"${JOBS:-4}" libpython3.13.a pybuilddir.txt >make.log 2>&1
# Headers and sysconfig data in the prefix, for extension modules built against this Python (numpy).
make inclinstall libainstall >>make.log 2>&1
