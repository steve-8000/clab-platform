# clab-platform Agent Rules

- Use the `clab` MCP server as the default interface to the deployed platform.
- Do not use `cmux`, `tmux`, pane IDs, or terminal-bound Claude/Codex sessions.
- Do not start `claude` or `codex` inside this repo as part of the runtime architecture.
- Assume there are no `worker-*` pods in the target deployment.
- Prefer MCP tools over raw `curl` calls for missions, tasks, approvals, sessions, knowledge, and health checks.
- If MCP lacks a required operation, add or extend the MCP server instead of bypassing it.
