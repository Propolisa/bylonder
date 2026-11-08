#!/usr/bin/env bash
# FFTW 3 in single precision (libfftw3f, as Blender's builds use it: the compositor's Fog Glow and Convolve) for
# wasm32-wasi, as released, by FFTW's own configure on the module's toolchain, without its threads library (the module
# runs on one thread: wasm/fftw-threads.cc).
# Usage: deps/fftw.sh FFTW_SOURCE BUILD   (BUILD gets libfftw3f.a and include/fftw3.h)
set -euo pipefail
SRC=$(realpath "$1")
mkdir -p "$2"
BUILD=$(realpath "$2")
TOOLS=$(dirname "$(realpath "$0")")
export CC="$TOOLS/clang-wasi" AR=llvm-ar-18 RANLIB=llvm-ranlib-18 CFLAGS="-O2"

cd "$BUILD"
if [ ! -f Makefile ]; then
  # FFTW's config.sub predates wasm32: a 32-bit host name keeps configure cross-compiling (nothing run) on clang-wasi.
  "$SRC/configure" --host=i686-pc-linux-gnu --build=x86_64-pc-linux-gnu --enable-float --enable-static --disable-shared \
    --disable-fortran --disable-doc --disable-threads --prefix="$BUILD/prefix" >configure.log
fi
make -j"${JOBS:-4}" >make.log 2>&1
make install >>make.log 2>&1

cp prefix/lib/libfftw3f.a libfftw3f.a
rm -rf include && cp -r prefix/include include
