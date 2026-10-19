# Source this before working on Zombros:  source tools/env.sh
# Puts the project-local Node, pnpm, uv/Python and Blender first on PATH and
# keeps every cache and model download inside this folder.

ZOMBROS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
export ZOMBROS_ROOT
T="$ZOMBROS_ROOT/tools"
C="$ZOMBROS_ROOT/.cache"

export PATH="$ZOMBROS_ROOT/.venv/bin:$T/bin:$T/node/bin:$T/blender:$PATH"

# Node / pnpm
export COREPACK_HOME="$C/corepack"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export npm_config_cache="$C/npm"

# Python (uv-managed interpreter + venv)
export UV_CACHE_DIR="$C/uv"
export UV_PYTHON_INSTALL_DIR="$T/python"
export UV_PYTHON_PREFERENCE=only-managed
export UV_PROJECT_ENVIRONMENT="$ZOMBROS_ROOT/.venv"
export PIP_CACHE_DIR="$C/pip"

# AI model weights and framework caches
export HF_HOME="$T/ai/models/huggingface"
export TORCH_HOME="$T/ai/models/torch"
export HY3DGEN_MODELS="$T/ai/models/hy3dgen"
export U2NET_HOME="$T/ai/models/u2net"
export CUDA_CACHE_PATH="$C/nv"
export TRITON_CACHE_DIR="$C/triton"

# Blender: keep its user config/addons in the project
export BLENDER_USER_RESOURCES="$T/blender-user"

unset T C
