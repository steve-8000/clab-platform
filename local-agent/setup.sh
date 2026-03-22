#!/usr/bin/env bash
set -euo pipefail

echo "Setting up LangGraph Local Agent..."

# Check Python
python3 --version >/dev/null 2>&1 || { echo "Python 3 required"; exit 1; }

# Create venv
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  echo "Created virtual environment"
fi

# Install dependencies
.venv/bin/pip install -r requirements.txt -q
echo "Dependencies installed"

# Check CLI tools
command -v claude >/dev/null 2>&1 && echo "✓ Claude CLI found" || echo "⚠ Claude CLI not found"
command -v codex >/dev/null 2>&1 && echo "✓ Codex CLI found" || echo "⚠ Codex CLI not found"

echo ""
echo "Setup complete! Run:"
echo "  source .venv/bin/activate"
echo "  python -m local_agent --help"
