# LangGraph Local Agent

The Local Agent runs on a developer's machine and orchestrates task execution
via the cmux runtime. It supports both sequential and parallel execution modes.

## Architecture

### Execution Modes

- **Sequential**: Single engine surface execution (Claude or Codex CLI)
- **Parallel** (`build_parallel_agent_graph`): WorkerPool with concurrent workers
  - **3 Codex workers** (`codex-worker-0..2`) — parallel code generation
  - **1 Claude reviewer** (`claude-reviewer`) — review + fix loop (max 2 rounds)
  - Browser workspace runs in isolation for verification

### Key Modules

| Module | Description |
|--------|-------------|
| `local_agent/cmux/runtime.py` | cmux native runtime (workspace/surface management) |
| `local_agent/cmux/worker.py` | WorkerPool — parallel Codex workers + Claude reviewer |
| `local_agent/cmux/browser.py` | Isolated browser workspace for verification |
| `graph/` | LangGraph nodes (parallel executor, planner, replanner) |

## Prerequisites

- Python 3.12+
- Claude CLI (`claude`) or Codex CLI (`codex`) installed
- cmux installed (for workspace/surface management)
- Network access to the Control Plane endpoint

## Setup

```bash
chmod +x setup.sh
./setup.sh
```

This creates a `.venv` virtual environment and installs all dependencies from
`requirements.txt`.

## Running

```bash
source .venv/bin/activate
python -m local_agent --help
```

### Example Commands

```bash
# Connect to the Control Plane and listen for tasks
python -m local_agent --control-plane-url ws://control.clab.dev

# Run with a specific agent ID
python -m local_agent --agent-id my-laptop --control-plane-url ws://localhost:8000

# Enable debug logging
python -m local_agent --log-level debug --control-plane-url ws://localhost:8000
```

## Environment Variables

| Variable              | Description                          | Default                |
|-----------------------|--------------------------------------|------------------------|
| `CONTROL_PLANE_URL`  | WebSocket URL of the Control Plane   | `ws://localhost:8000`  |
| `AGENT_ID`           | Unique identifier for this agent     | hostname               |
| `LOG_LEVEL`          | Logging level (debug/info/warning)   | `info`                 |
| `ANTHROPIC_API_KEY`  | API key for Claude CLI               | (from CLI config)      |
| `OPENAI_API_KEY`     | API key for Codex CLI                | (from CLI config)      |
