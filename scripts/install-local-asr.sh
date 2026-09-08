#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
asr_dir="$HOME/Library/Application Support/Ankimo/asr"
mkdir -p "$asr_dir"
if [[ ! -x "$asr_dir/.venv/bin/python" ]]; then
  uv venv --python 3.12 "$asr_dir/.venv"
fi
uv pip install --python "$asr_dir/.venv/bin/python" -r "$repo_dir/server/local-asr-requirements.txt"
"$asr_dir/.venv/bin/python" - <<'PY'
from pathlib import Path
import shutil
from huggingface_hub import snapshot_download
model = "mlx-community/Qwen3-ASR-0.6B-8bit"
revision = "89e96d92ba34aca20b3e29fb10cc284097d1219f"
target = Path.home() / "Library/Application Support/Ankimo/asr/model"
if not target.exists():
    source = snapshot_download(model, revision=revision)
    staging = target.with_name("model.installing")
    shutil.copytree(source, staging, dirs_exist_ok=True)
    staging.rename(target)
assert (target / "config.json").is_file()
assert list(target.glob("*.safetensors"))
print("Local Qwen3-ASR 0.6B runtime ready")
PY
