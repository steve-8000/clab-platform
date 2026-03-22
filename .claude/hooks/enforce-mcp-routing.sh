#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)

COMMAND=$(python3 - <<'PY' "$INPUT"
import json, sys
payload = json.loads(sys.argv[1])
print(payload.get("tool_input", {}).get("command", ""))
PY
)

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

if [[ "$COMMAND" =~ (^|[[:space:]])(tmux|cmux)([[:space:]]|$) ]]; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"cmux/tmux execution is removed from this repository. Use the clab MCP server instead."}}'
  exit 0
fi

if [[ "$COMMAND" =~ (^|[[:space:]])(claude|codex)([[:space:]]|$) ]]; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Do not launch Claude or Codex as part of the runtime path inside this repo. Use the clab MCP server."}}'
  exit 0
fi

if [[ "$COMMAND" =~ curl ]] && [[ "$COMMAND" =~ /v1/(missions|sessions|approvals|knowledge|dashboard|health) ]]; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Use the clab MCP tools for control-plane operations instead of raw curl calls."}}'
  exit 0
fi

exit 0
