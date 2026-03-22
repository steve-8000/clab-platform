# clab-platform Operating Rules

This repository no longer uses `cmux`, `tmux` pane orchestration, or local TUI session binding as the execution model.

## Required control path

- Use the `clab` MCP server for mission, task, approval, session, knowledge, and health operations.
- Treat `CLAB_API_URL` as the single control-plane entry point.
- Do not script against `api-gateway` with ad hoc `curl` when an MCP tool exists.
- Do not reintroduce `cmux`, pane IDs, sticky terminal sessions, or CLI-driven worker execution flows.

## Runtime model

- K8s hosts the control plane, stateful services, and APIs.
- Claude and Codex connect through MCP and repo instructions, not through embedded terminal multiplexers.
- There are no `worker-*` pods or terminal-bound worker daemons in the target architecture.

## Safe defaults

- Prefer mission-based orchestration over direct task mutation.
- Use `approval_list` and `approval_resolve` instead of patching approval state manually.
- Use `knowledge_search` and `knowledge_store` instead of writing directly to the knowledge store.
- If a capability is missing from MCP, add it at the API or MCP layer rather than bypassing the control plane.
