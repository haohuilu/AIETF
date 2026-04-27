#!/usr/bin/env bash
# Quick-start script for the Pocket Advisor dashboard.
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "→ Creating virtualenv with uv…"
  uv venv .venv
fi

echo "→ Installing dependencies…"
uv pip install --python .venv/bin/python -r requirements.txt --quiet

echo "→ Starting Pocket Advisor at http://127.0.0.1:5000"
.venv/bin/python app.py
