#!/usr/bin/env bash
# ============================================================================
# clab-platform setup — Configure deps and MCP-based local development
# Prerequisites: Node.js 22+, Claude Code CLI, Codex CLI
# Usage: ./scripts/setup.sh
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[clab]${NC} $*"; }
warn()  { echo -e "${YELLOW}[clab]${NC} $*"; }
error() { echo -e "${RED}[clab]${NC} $*"; exit 1; }

check_prereqs() {
  info "Checking prerequisites..."

  command -v node >/dev/null 2>&1 || error "Node.js >= 22 required. Install: https://nodejs.org"
  NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d v)
  [[ "$NODE_MAJOR" -ge 22 ]] || error "Node.js >= 22 required (found v${NODE_MAJOR})"

  command -v pnpm >/dev/null 2>&1 || {
    warn "pnpm not found. Installing via corepack..."
    corepack enable && corepack prepare pnpm@9.15.4 --activate
  }

  command -v claude >/dev/null 2>&1 || {
    error "Claude Code CLI not found. Install first:
    macOS:  curl -fsSL https://claude.ai/install.sh | sh
    npm:    npm install -g @anthropic-ai/claude-code"
  }

  command -v codex >/dev/null 2>&1 || {
    error "Codex CLI not found. Install first:
    npm install -g @openai/codex"
  }

  command -v docker >/dev/null 2>&1 || warn "Docker not found — needed for container builds (optional for local dev)"

  info "Prerequisites OK (Node $(node -v), pnpm $(pnpm -v), claude, codex)"
}

install_deps() {
  info "Installing project dependencies..."
  cd "$REPO_ROOT"
  pnpm install
  info "Dependencies installed"
}

create_env() {
  local ENV_FILE="${REPO_ROOT}/.env"
  if [[ -f "$ENV_FILE" ]]; then
    info ".env already exists — skipping"
    return
  fi

  info "Creating .env..."
  cat > "$ENV_FILE" << 'ENV_EOF'
# ============================================================================
# clab-platform environment variables
# ============================================================================

# --- Control Plane ---
CLAB_API_URL=http://127.0.0.1:30400
DEFAULT_WORKSPACE_ID=

# --- API Keys (optional direct model fallback) ---
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# --- Database ---
DATABASE_URL=postgres://clab:clab_secret@localhost:5432/clab

# --- NATS ---
NATS_URL=nats://localhost:4222

# --- Logging ---
LOG_LEVEL=debug
NODE_ENV=development
ENV_EOF
  warn "Created .env — set CLAB_API_URL for your target environment before using the MCP server."
}

show_k8s_info() {
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
  echo -e "${BOLD} K8s Deployment (ArgoCD GitOps)${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo "  K8s manifests:  infra/k8s/base/  (legacy reference)"
  echo "  GitOps repo:    k8s-stg (deployment repo)"
  echo "  Control plane:  CLAB_API_URL -> api-gateway"
  echo "  MCP config:     .mcp.json"
  echo "  Claude rules:   CLAUDE.md + .claude/settings.json"
  echo "  Codex rules:    AGENTS.md"
  echo ""
}

main() {
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
  echo -e "${BOLD} clab-platform Setup${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
  echo ""

  check_prereqs
  install_deps
  create_env
  show_k8s_info

  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN} Setup complete!${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Next steps:"
  echo "    1. Edit .env and set CLAB_API_URL"
  echo "    2. Start the platform services you need"
  echo "    3. Run Claude or Codex from this repo so .mcp.json is picked up"
  echo "    4. Use the clab MCP server instead of direct curl/tmux/cmux or worker flows"
  echo ""
}

main "$@"
