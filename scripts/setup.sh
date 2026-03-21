#!/usr/bin/env bash
# ============================================================================
# clab-platform setup — Configure deps, env, and clab plugin registration
# Prerequisites: Node.js 22+, Claude Code CLI, Codex CLI, tmux
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

# ── Prerequisites ──────────────────────────────────────────────────────────
check_prereqs() {
  info "Checking prerequisites..."

  command -v node >/dev/null 2>&1 || error "Node.js >= 22 required. Install: https://nodejs.org"
  NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d v)
  [[ "$NODE_MAJOR" -ge 22 ]] || error "Node.js >= 22 required (found v${NODE_MAJOR})"

  command -v pnpm >/dev/null 2>&1 || {
    warn "pnpm not found. Installing via corepack..."
    corepack enable && corepack prepare pnpm@9.15.4 --activate
  }

  command -v tmux >/dev/null 2>&1 || {
    warn "tmux not found (required for cmux)."
    if [[ "$(uname)" == "Darwin" ]]; then
      warn "Install: brew install tmux"
    else
      warn "Install: sudo apt install tmux  (or your distro equivalent)"
    fi
    error "tmux is required. Install it and re-run this script."
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

  info "Prerequisites OK (Node $(node -v), pnpm $(pnpm -v), tmux $(tmux -V), claude, codex)"
}

# ── clab plugin ────────────────────────────────────────────────────────────
setup_clab_plugin() {
  local PLUGIN_DIR="${REPO_ROOT}/.claude-plugin"

  if [[ ! -d "$PLUGIN_DIR" ]]; then
    warn "No .claude-plugin directory found — skipping plugin registration"
    return
  fi

  info "Setting up clab plugin..."

  # Set CLAB_API_URL in shell profile
  local SHELL_RC
  if [[ -f "$HOME/.zshrc" ]]; then
    SHELL_RC="$HOME/.zshrc"
  elif [[ -f "$HOME/.bashrc" ]]; then
    SHELL_RC="$HOME/.bashrc"
  else
    SHELL_RC="$HOME/.profile"
  fi

  if ! grep -q "CLAB_API_URL" "$SHELL_RC" 2>/dev/null; then
    echo "" >> "$SHELL_RC"
    echo "# clab-platform: K8s state sync" >> "$SHELL_RC"
    echo "export CLAB_API_URL=https://ai.clab.one" >> "$SHELL_RC"
    info "Added CLAB_API_URL to $SHELL_RC"
  fi

  # Create version-independent symlink for plugin cache
  local CACHE_DIR="$HOME/.claude/plugins/cache/clab-local/clab"
  if [[ -d "$CACHE_DIR" ]]; then
    # Find the versioned directory (e.g., 3.0.0, 3.1.0)
    local VERSION_DIR
    VERSION_DIR=$(find "$CACHE_DIR" -maxdepth 1 -mindepth 1 -type d ! -name current | head -1)
    if [[ -n "$VERSION_DIR" ]]; then
      ln -sfn "$VERSION_DIR" "$CACHE_DIR/current"
      info "Created symlink: $CACHE_DIR/current → $(basename "$VERSION_DIR")"
    fi
  fi

  # Register MCP server globally (~/.claude/mcp.json) using stable 'current' path
  local MCP_CONFIG="$HOME/.claude/mcp.json"
  local MCP_BASE="$HOME/.claude/plugins/cache/clab-local/clab/current"
  mkdir -p "$HOME/.claude"

  info "Registering clab-cmux MCP server globally..."
  python3 -c "
import json, os
p = '$MCP_CONFIG'
d = {}
if os.path.exists(p):
    with open(p) as f: d = json.load(f)
d.setdefault('mcpServers', {})['clab-cmux'] = {
    'command': 'node',
    'args': ['${MCP_BASE}/dist/mcp/server.js'],
    'cwd': '${MCP_BASE}'
}
with open(p, 'w') as f: json.dump(d, f, indent=2)
print('done')
"
  info "MCP server registered at $MCP_CONFIG (path: current → version-independent)"

  # Register plugin in Claude Code settings
  local CLAUDE_SETTINGS="$HOME/.claude/settings.json"
  mkdir -p "$HOME/.claude"

  if [[ -f "$CLAUDE_SETTINGS" ]]; then
    # Check if plugin already registered
    if python3 -c "import json; d=json.load(open('$CLAUDE_SETTINGS')); exit(0 if 'clab@clab-local' in d.get('enabledPlugins',{}) else 1)" 2>/dev/null; then
      info "clab plugin already registered in Claude Code"
    else
      info "Registering clab plugin in Claude Code settings..."
      python3 -c "
import json, sys
p = '$CLAUDE_SETTINGS'
with open(p) as f: d = json.load(f)
d.setdefault('enabledPlugins', {})['clab@clab-local'] = True
d.setdefault('extraKnownMarketplaces', {})['clab-local'] = {
    'source': {'source': 'directory', 'path': '${REPO_ROOT}'}
}
with open(p, 'w') as f: json.dump(d, f, indent=2)
print('done')
"
    fi
  else
    info "Creating Claude Code settings with clab plugin..."
    cat > "$CLAUDE_SETTINGS" << SETTINGS_EOF
{
  "enabledPlugins": {
    "clab@clab-local": true
  },
  "extraKnownMarketplaces": {
    "clab-local": {
      "source": {
        "source": "directory",
        "path": "${REPO_ROOT}"
      }
    }
  }
}
SETTINGS_EOF
  fi

  info "clab plugin registered"
}

# ── pnpm install ───────────────────────────────────────────────────────────
install_deps() {
  info "Installing project dependencies..."
  cd "$REPO_ROOT"
  pnpm install
  info "Dependencies installed"
}

# ── Environment file ──────────────────────────────────────────────────────
create_env() {
  local ENV_FILE="${REPO_ROOT}/.env"
  if [[ -f "$ENV_FILE" ]]; then
    info ".env already exists — skipping"
    return
  fi

  info "Creating .env from template..."
  cat > "$ENV_FILE" << 'ENV_EOF'
# ============================================================================
# clab-platform environment variables
# Copy to .env and fill in optional overrides
# ============================================================================

# --- API Keys (optional fallback) ---
# Local cmux execution uses logged-in Claude/Codex CLI sessions.
# Only set these if you explicitly want direct API-based fallback behavior.
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# --- Database ---
DATABASE_URL=postgres://clab:clab_secret@localhost:5432/clab

# --- NATS ---
NATS_URL=nats://localhost:4222

# --- JWT ---
JWT_SECRET=change-me-in-production

# --- Logging ---
LOG_LEVEL=debug
NODE_ENV=development
ENV_EOF
  warn "Created .env — add optional overrides if needed (local cmux uses logged-in CLI sessions)"
}

# ── K8s deployment info ───────────────────────────────────────────────────
show_k8s_info() {
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
  echo -e "${BOLD} K8s Deployment (ArgoCD GitOps)${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo "  K8s manifests:  infra/k8s/base/  (Kustomize)"
  echo "  GitOps repo:    k8s-stg (separate deployment repo)"
  echo "  ArgoCD sync:    workloads/clab-platform/"
  echo ""
  echo "  Build & push images:"
  echo "    docker build --build-arg SERVICE=api-gateway -t clab/api-gateway:v1 ."
  echo "    docker build --build-arg SERVICE=dashboard   -t clab/dashboard:v1 -f infra/docker/Dockerfile.dashboard ."
  echo ""
  echo "  See docs/deployment.md for full K8s setup guide."
  echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
  echo -e "${BOLD} clab-platform Setup${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
  echo ""

  check_prereqs
  install_deps
  create_env
  setup_clab_plugin
  show_k8s_info

  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN} Setup complete!${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Next steps:"
  echo "    1. source ${SHELL_RC:-~/.zshrc}    # reload shell"
  echo "    2. Edit .env with optional overrides if needed"
  echo "    3. docker compose -f infra/docker/docker-compose.yml up -d postgres nats"
  echo "    4. pnpm db:push                    # run migrations"
  echo "    5. pnpm dev                        # start all services"
  echo "    6. claude                           # start Claude Code with clab plugin"
  echo ""
}

main "$@"
