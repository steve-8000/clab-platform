#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== clab-platform setup ==="
echo ""

# 1. Environment
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — edit API keys if needed"
else
  echo "✓ .env exists"
fi

# 2. Local Agent
echo ""
echo "--- Local Agent ---"
(cd local-agent && bash setup.sh)

# 3. MCP Server
echo ""
echo "--- MCP Server ---"
(cd mcp-server && bash setup.sh)

# 4. Register MCP with Codex (if available)
if command -v codex >/dev/null 2>&1; then
  EXISTING=$(codex mcp list 2>&1 | grep clab || true)
  if [ -z "$EXISTING" ]; then
    codex mcp add clab -- "$(pwd)/mcp-server/.venv/bin/python" "$(pwd)/mcp-server/server.py" 2>/dev/null || true
    echo "✓ MCP server registered with Codex"
  else
    echo "✓ MCP server already registered with Codex"
  fi
else
  echo "⚠ Codex CLI not found — skip MCP registration"
fi

# 5. Check CLI tools
echo ""
echo "--- CLI Tools ---"
command -v claude >/dev/null 2>&1 && echo "✓ Claude Code CLI" || echo "⚠ Claude Code CLI not found (npm i -g @anthropic-ai/claude-code)"
command -v codex >/dev/null 2>&1 && echo "✓ Codex CLI" || echo "⚠ Codex CLI not found (npm i -g @openai/codex)"
command -v cmux >/dev/null 2>&1 && echo "✓ cmux" || echo "⚠ cmux not found (required for parallel execution)"

echo ""
echo "=== Setup complete ==="
echo ""
echo "Quick start:"
echo "  # Use as MCP tool from Claude Code / Codex"
echo "  cd your-project && $(pwd)/bin/clab-init"
echo "  claude  # or codex, then use mission_run tool"
echo ""
echo "  # Or run local agent directly"
echo "  cd local-agent && source .venv/bin/activate"
echo "  python -m local_agent --parallel --workdir ~/your-project 'your goal'"
