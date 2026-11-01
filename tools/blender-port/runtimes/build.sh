#!/bin/bash
# The C++ runtime of a module with WebAssembly exception handling (-fwasm-exceptions): LLVM's libc++ and libc++abi at
# the compiler's version, built for wasm32-wasi with exceptions on, and libunwind's Unwind-wasm.c, installed into
# WORK/sysroot (include/c++/v1, lib). Ubuntu's wasm32 libc++ is built with exceptions off (no __cxa_throw), so it cannot
# be used. llvm-wasm-eh.patch backports LLVM 19's fix of __cxa_init_primary_exception for WebAssembly to 18.1.3.
# Not used by the module build yet: the batched full recompile switches to it.
#
# usage: tools/blender-port/runtimes/build.sh WORK   (needs clang-18, llvm-18, cmake, ninja)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mkdir -p "$1" && cd "$1" && pwd)
TAG=llvmorg-18.1.3
cd "$WORK"
if [ ! -d llvm ]; then
  git clone -q --depth 1 --branch $TAG --filter=blob:none --sparse https://github.com/llvm/llvm-project.git llvm
  git -C llvm sparse-checkout set runtimes libcxx libcxxabi libunwind cmake llvm/cmake llvm/utils/llvm-lit
  git -C llvm apply "$HERE/llvm-wasm-eh.patch"
fi
EH="-fwasm-exceptions -D__USING_WASM_EXCEPTIONS__"
cmake -G Ninja -S llvm/runtimes -B build -DCMAKE_MODULE_PATH="$HERE" "-DLLVM_ENABLE_RUNTIMES=libcxx;libcxxabi" \
  -DCMAKE_BUILD_TYPE=MinSizeRel -DCMAKE_SYSTEM_NAME=WASI -DCMAKE_C_COMPILER=clang-18 -DCMAKE_CXX_COMPILER=clang++-18 \
  -DCMAKE_AR=/usr/bin/llvm-ar-18 -DCMAKE_RANLIB=/usr/bin/llvm-ranlib-18 -DCMAKE_C_COMPILER_TARGET=wasm32-wasi \
  -DCMAKE_CXX_COMPILER_TARGET=wasm32-wasi -DCMAKE_C_COMPILER_WORKS=ON -DCMAKE_CXX_COMPILER_WORKS=ON \
  "-DCMAKE_C_FLAGS=$EH" "-DCMAKE_CXX_FLAGS=$EH" -DLIBCXX_ENABLE_SHARED=OFF -DLIBCXXABI_ENABLE_SHARED=OFF \
  -DLIBCXX_ENABLE_THREADS=OFF -DLIBCXXABI_ENABLE_THREADS=OFF -DLIBCXX_HAS_PTHREAD_API=OFF -DLIBCXX_ENABLE_EXCEPTIONS=ON \
  -DLIBCXXABI_ENABLE_EXCEPTIONS=ON -DLIBCXXABI_USE_LLVM_UNWINDER=OFF -DLIBCXX_HAS_MUSL_LIBC=ON -DLIBCXX_ENABLE_FILESYSTEM=OFF \
  -DLIBCXX_INCLUDE_BENCHMARKS=OFF -DLIBCXX_INCLUDE_TESTS=OFF -DLIBCXXABI_INCLUDE_TESTS=OFF -DLIBCXXABI_SILENT_TERMINATE=ON \
  -DLIBCXX_CXX_ABI=libcxxabi -DLIBCXXABI_ENABLE_PIC=OFF -DLIBCXX_ENABLE_PIC=OFF -DCMAKE_INSTALL_PREFIX="$WORK/sysroot"
ninja -C build install-cxx install-cxxabi
# libunwind's only part a WebAssembly module needs: _Unwind_RaiseException over the engine's own unwinding.
clang-18 --target=wasm32-wasi $EH -D_LIBUNWIND_HIDE_SYMBOLS -DNDEBUG -Os -I llvm/libunwind/include \
  -c llvm/libunwind/src/Unwind-wasm.c -o build/unwind-wasm.o
llvm-ar-18 rcs sysroot/lib/libunwind.a build/unwind-wasm.o
