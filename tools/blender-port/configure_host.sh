#!/usr/bin/env bash
# Blender's own CMake configure, for its compile commands (blender_build.py retargets them to wasm32): Blender at the
# manifest's tag with its LFS datafiles, configured headless without the libraries on the far side of Bylonder's seams.
# Usage: tools/blender-port/configure_host.sh DIR   (DIR/blender is the source tree, DIR/build-host the configure)
set -euo pipefail
mkdir -p "$1"
DIR=$(realpath "$1")
TAG=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['blender'])" "$(dirname "$0")/manifest.json")
LFS=https://projects.blender.org/blender/blender.git/info/lfs

# Headers the configure looks for. Ubuntu's OpenColorIO installs its CMake config one directory off, and OpenImageIO's
# names an OpenCV include directory it does not install.
SUDO=$([ "$(id -u)" = 0 ] || echo sudo)
$SUDO apt-get install -y -q libjpeg-dev libpng-dev libfreetype-dev libepoxy-dev libtbb-dev libzstd-dev libbrotli-dev libfmt-dev \
  libeigen3-dev libopenexr-dev libopenimageio-dev openimageio-tools libopencolorio-dev libosd-dev libopenvdb-dev >/dev/null
$SUDO mkdir -p /usr/lib/x86_64-linux-gnu/cmake/OpenColorIO /usr/include/opencv4
$SUDO cp -n /usr/share/cmake/OpenColorIO*.cmake /usr/lib/x86_64-linux-gnu/cmake/OpenColorIO/ 2>/dev/null || true

if [ ! -d "$DIR/blender/.git" ]; then
  GIT_LFS_SKIP_SMUDGE=1 git clone -q --depth 1 --branch "$TAG" https://github.com/blender/blender.git "$DIR/blender"
  git -C "$DIR/blender" config lfs.url "$LFS"
  git -C "$DIR/blender" config "lfs.$LFS.access" none
  (cd "$DIR/blender" && GIT_TERMINAL_PROMPT=0 git lfs pull --include="release/datafiles/**")
fi
# The reviewed patches, each applied once: one already in the tree is left as it is.
for p in "$(dirname "$0")"/wasm/patches/*.patch; do
  p=$(realpath "$p")
  git -C "$DIR/blender" apply --reverse --check "$p" 2>/dev/null || git -C "$DIR/blender" apply "$p"
done

OFF="PYTHON_INSTALL FREESTYLE CYCLES OPENGL_BACKEND VULKAN_BACKEND METAL_BACKEND GHOST_X11 GHOST_WAYLAND GHOST_SDL AUDASPACE CODEC_FFMPEG CODEC_SNDFILE
OPENAL JACK PULSEAUDIO SDL OPENIMAGEIO OPENCOLORIO OPENEXR IMAGE_OPENJPEG IMAGE_WEBP MOD_FLUID MOD_OCEANSIM
FFTW3 ALEMBIC USD HYDRA MATERIALX OPENIMAGEDENOISE GMP MANIFOLD QUADRIFLOW POTRACE HARU LIBMV XR_OPENXR INPUT_NDOF INTERNATIONAL
HARFBUZZ FRIBIDI DRACO MESHOPTIMIZER TESTS GTESTS NANOVDB CPU_CHECK MEM_JEMALLOC BLENDER_THUMBNAILER LIBS_PRECOMPILED STRICT_BUILD_OPTIONS"
args=()
# What the shipped module builds with (manifest defines); TBB only so that CMake keeps OpenVDB, as blender_build.py drops
# WITH_TBB and the module's serial tbb headers stand in. Python is found at the host's python3.13, whose headers
# blender_build.py replaces with the module's CPython's (manifest cpython).
ON="PYTHON BULLET OPENSUBDIV OPENVDB TBB MOD_REMESH"
for o in $OFF; do args+=("-DWITH_$o=OFF"); done
for o in $ON; do args+=("-DWITH_$o=ON"); done
args+=("-DPYTHON_ROOT_DIR=$(python3.13 -c 'import sys; print(sys.base_prefix)')")
mkdir -p "$DIR/build-host"
cmake -S "$DIR/blender" -B "$DIR/build-host" -G Ninja -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ -DWITH_HEADLESS=ON -DWITH_COMPOSITOR_CPU=ON -DWITH_IO_WAVEFRONT_OBJ=ON \
  -DWITH_IO_PLY=ON -DWITH_IO_STL=ON -DWITH_IO_FBX=ON -DOpenColorIO_DIR=/usr/lib/x86_64-linux-gnu/cmake/OpenColorIO "${args[@]}" >/dev/null
echo "configured $DIR/build-host: $(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))))" "$DIR/build-host/compile_commands.json") compile commands"
