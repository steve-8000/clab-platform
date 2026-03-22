#!/usr/bin/env bash
set -euo pipefail

echo "Setting up MCP Server..."

python3 --version >/dev/null 2>&1 || { echo "Python 3 required"; exit 1; }

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  echo "Created virtual environment"
fi

.venv/bin/pip install -r requirements.txt -q
echo "MCP Server setup complete."
