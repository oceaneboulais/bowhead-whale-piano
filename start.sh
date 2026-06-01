#!/usr/bin/env bash
#
# start.sh — set up a Python virtualenv, precompute clip frequencies for the
# pitch-lock feature, and serve the Bowhead Whale Piano locally.
#
#   ./start.sh                 # venv + analyze clips + serve
#   WANDB=1 ./start.sh         # also log the note/frequency mapping to W&B
#   PORT=9000 ./start.sh       # serve on a different port
#   PYTHON=python3 ./start.sh  # use a specific interpreter to build the venv
#
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-/opt/homebrew/bin/python3.11}"
command -v "$PY" >/dev/null 2>&1 || PY="$(command -v python3)"
VENV=".venv"
PORT="${PORT:-8000}"

# 1. Virtual environment ------------------------------------------------------
if [ ! -d "$VENV" ]; then
  echo "▶ Creating virtualenv ($PY) -> $VENV"
  "$PY" -m venv "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"
echo "▶ Installing Python deps"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

# 2. Weights & Biases (optional) ---------------------------------------------
WB_FLAG=""
if [ "${WANDB:-0}" = "1" ]; then
  if ! wandb status >/dev/null 2>&1; then
    echo "▶ W&B requested — logging in (set WANDB_API_KEY to skip the prompt)"
    wandb login || true
  fi
  WB_FLAG="--wandb"
fi

# 3. Precompute clip frequencies for pitch-lock -------------------------------
echo "▶ Analyzing clip frequencies (pitch-lock)"
python analyze_clips.py $WB_FLAG \
  || echo "  (analysis skipped/failed — the app will analyze clips in-browser instead)"

# 4. Serve --------------------------------------------------------------------
echo
echo "▶ Serving on http://localhost:$PORT  (Ctrl-C to stop)"
if command -v node >/dev/null 2>&1 && [ -f server.js ]; then
  PORT="$PORT" node server.js
else
  python -m http.server "$PORT"
fi
