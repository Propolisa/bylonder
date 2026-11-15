#!/usr/bin/env bash
# wasi-sdk's sysroot (its wasm32-wasi-threads libc and libc++, built for clang 18), which the module builds against
# (wasm_module.TARGET), at /opt/wasi-sysroot or $WASI_SYSROOT. Kept when it is there at this version.
set -euo pipefail
VERSION=22.0
SHA256=23881870d5a9c94df0529bc3e9b13682b7bbb07e5167555132fdc14e1faf1bb8
DIR=${WASI_SYSROOT:-/opt/wasi-sysroot}
[ "$(cat "$DIR/.version" 2>/dev/null)" = "$VERSION" ] && exit 0
archive=$(mktemp)
curl -fsSL -o "$archive" "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${VERSION%%.*}/wasi-sysroot-$VERSION.tar.gz"
echo "$SHA256  $archive" | sha256sum -c --quiet
rm -rf "$DIR" && mkdir -p "$DIR"
tar -xzf "$archive" -C "$DIR" --strip-components=1
rm "$archive"
echo "$VERSION" >"$DIR/.version"
