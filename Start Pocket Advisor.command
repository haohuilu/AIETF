#!/bin/bash

set -e

cd "$(dirname "$0")"

PORT=5001
URL="http://127.0.0.1:${PORT}"

echo "Starting Pocket Advisor..."
echo "Folder: $(pwd)"

if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Pocket Advisor already appears to be running at ${URL}"
  open "${URL}" >/dev/null 2>&1 || true
  echo
  echo "You can close this window."
  exit 0
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
fi

echo "Checking dependencies..."
if .venv/bin/python -c "import flask, requests, numpy, pandas" >/dev/null 2>&1; then
  echo "Dependencies OK."
else
  echo "Installing dependencies..."
  if command -v uv >/dev/null 2>&1; then
    uv pip install --python .venv/bin/python -r requirements.txt --quiet
  else
    .venv/bin/python -m ensurepip --upgrade >/dev/null 2>&1 || true
    .venv/bin/python -m pip install -r requirements.txt --quiet
  fi
fi

echo
echo "Pocket Advisor is running at ${URL}"
echo "Keep this Terminal window open while using the dashboard."
echo "Press Control-C here to stop the server."
echo

open "${URL}" >/dev/null 2>&1 || true
.venv/bin/python -m flask --app app run --host 127.0.0.1 --port "${PORT}"
