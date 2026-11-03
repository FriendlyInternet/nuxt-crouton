#!/usr/bin/env bash
# Crate audio kit (#2229): build a self-contained Python + model in /Users/Shared/crate, so any
# account on this Mac (the one that holds the music) can run analyze.py. Run from the repo:
#   bash pocs/crate/scripts/audio/build-kit.sh
set -euo pipefail
KIT=/Users/Shared/crate
HERE="$(cd "$(dirname "$0")" && pwd)"
MODEL_URL=https://essentia.upf.edu/models/feature-extractors/discogs-effnet
mkdir -p "$KIT/models" "$KIT/features"
UV_PYTHON_INSTALL_DIR="$KIT/python" uv python install 3.11
PY="$(UV_PYTHON_INSTALL_DIR="$KIT/python" uv python find 3.11)"
[ -x "$KIT/venv/bin/python" ] || uv venv --python "$PY" "$KIT/venv"
VIRTUAL_ENV="$KIT/venv" uv pip install 'essentia==2.1b6.dev1389' 'onnxruntime==1.31.0' 'numpy==2.4.6'
for f in discogs-effnet-bsdynamic-1.onnx discogs-effnet-bs64-1.json; do
  [ -s "$KIT/models/$f" ] || curl -fsSL -o "$KIT/models/$f" "$MODEL_URL/$f"
done
cp "$HERE/analyze.py" "$KIT/"
chmod -R a+rX "$KIT"
chmod a+rwx "$KIT/features"   # written by the music account, read by this one
echo "Kit ready in $KIT"
