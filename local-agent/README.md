# LangGraph Local Agent

The Local Agent runs on a developer's machine and acts as a bridge between the
clab Control Plane and local CLI tools (Claude CLI, Codex CLI). It receives task
assignments from the Control Plane over WebSocket, executes them locally, and
streams results back.

## Prerequisites

- Python 3.12+
- Claude CLI (`claude`) or Codex CLI (`codex`) installed
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
