#!/usr/bin/env bash
# Installs the whole Zombros toolchain inside this folder (idempotent).
#   bash tools/setup.sh
set -euo pipefail

NODE_V=v24.22.0
UV_V=0.13.1
BLENDER_V=5.1.2
PYTHON_V=3.11
# Last PyTorch release with Pascal (P100, sm_60) wheels.
TORCH_V=2.14.1
TORCH_INDEX=https://download.pytorch.org/whl/cu126

source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
T="$ZOMBROS_ROOT/tools"
mkdir -p "$T/dl" "$T/bin"
cd "$T/dl"

if [ ! -x "$T/node/bin/node" ]; then
  f=node-$NODE_V-linux-x64.tar.xz
  curl -fsSLO "https://nodejs.org/dist/$NODE_V/$f"
  curl -fsSL "https://nodejs.org/dist/$NODE_V/SHASUMS256.txt" | grep " $f\$" | sha256sum -c
  mkdir -p "$T/node" && tar -xJf "$f" -C "$T/node" --strip-components=1
fi

if [ ! -x "$T/bin/uv" ]; then
  f=uv-x86_64-unknown-linux-gnu.tar.gz
  curl -fsSLO "https://github.com/astral-sh/uv/releases/download/$UV_V/$f"
  curl -fsSL "https://github.com/astral-sh/uv/releases/download/$UV_V/$f.sha256" | sha256sum -c
  tar -xzf "$f" -C "$T/bin" --strip-components=1
fi

if [ ! -x "$T/blender/blender" ]; then
  f=blender-$BLENDER_V-linux-x64.tar.xz
  curl -fsSLO "https://download.blender.org/release/Blender${BLENDER_V%.*}/$f"
  curl -fsSL "https://download.blender.org/release/Blender${BLENDER_V%.*}/blender-$BLENDER_V.sha256" | grep " $f\$" | sha256sum -c
  mkdir -p "$T/blender" && tar -xJf "$f" -C "$T/blender" --strip-components=1
fi

[ -x "$T/bin/pnpm" ] || corepack enable --install-directory "$T/bin" pnpm

# MPFB (MakeHuman for Blender) + its CC0 system assets, into tools/blender-user.
if [ ! -d "$BLENDER_USER_RESOURCES/extensions/blender_org/mpfb" ]; then
  blender --online-mode -c extension sync
  blender --online-mode -c extension install -s -e mpfb
fi
MPFB_DATA="$BLENDER_USER_RESOURCES/extensions/.user/blender_org/mpfb/data"
if [ ! -d "$MPFB_DATA/proxymeshes" ]; then
  f=makehuman_system_assets_cc0.zip
  [ -f "$f" ] || curl -fsSLO "https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/$f"
  unzip -tq "$f"
  mkdir -p "$MPFB_DATA" && unzip -oq "$f" -d "$MPFB_DATA"
fi

cd "$ZOMBROS_ROOT"
[ -x .venv/bin/python ] || uv venv --python "$PYTHON_V" .venv
UV_HTTP_TIMEOUT=900 uv pip install --python .venv "torch==$TORCH_V" --index-url "$TORCH_INDEX"

pnpm install
echo "Done. Run: source tools/env.sh"
