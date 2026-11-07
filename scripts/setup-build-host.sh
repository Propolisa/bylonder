#!/usr/bin/env bash
# The packages the module build needs on an Ubuntu 24.04 host, as CI installs them (.github/workflows/blender-wasm.yml),
# and Python 3.13 (uv's). Run as root in a build container or distro of its own (scripts/build-module.mjs makes one on Windows).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q clang-18 lld-18 llvm-18 wasi-libc libclang-rt-18-dev-wasm32 libc++-18-dev-wasm32 libc++abi-18-dev-wasm32 \
  ninja-build cmake git git-lfs curl rsync xz-utils python3-pip >/dev/null
# Node 22 (Ubuntu's is too old for the build's scripts, as for the app's: package.json engines).
if ! node --version 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://nodejs.org/dist/v22.17.0/node-v22.17.0-linux-x64.tar.xz | tar -xJ -C /opt
  ln -sf /opt/node-v22.17.0-linux-x64/bin/node /usr/local/bin/node
fi
for tool in clang clang++ wasm-ld llvm-ar llvm-nm; do
  [ -e /usr/bin/$tool ] || ln -s /usr/bin/$tool-18 /usr/bin/$tool
done
if ! command -v python3.13 >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh >/dev/null
  UV_PYTHON_INSTALL_DIR=/opt/python uv python install 3.13 >/dev/null
  ln -sf "$(UV_PYTHON_INSTALL_DIR=/opt/python uv python find 3.13)" /usr/local/bin/python3.13
fi
# The build's Python tools run under python3.13 and the host's python3 (deps/numpy.sh's weaken step).
uv pip install -q --python python3.13 --system --break-system-packages libclang==18.1.1
python3 -m pip install -q --break-system-packages libclang==18.1.1
echo "build host ready: $(clang --version | head -1), $(python3.13 --version)"
