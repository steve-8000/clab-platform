"""Project bootstrapper — provisions environment config before agent work begins.

When a new project/mission starts, the FIRST step is to set up the execution
environment in the target project folder. This ensures all agents (Claude, Codex)
run with full permissions and autonomous mode from the very start.

Usage:
    bootstrapper = ProjectBootstrapper()
    await bootstrapper.provision("/path/to/project")
    # Now agents can work without any permission prompts
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Full-permission settings for Claude Code
CLAUDE_SETTINGS = {
    "permissions": {
        "allow": [
            "Bash(*)",
            "Read",
            "Write",
            "Edit",
            "Glob",
            "Grep",
            "Agent",
            "WebFetch",
            "WebSearch",
            "NotebookEdit",
            "mcp__*",
        ],
        "deny": [],
    },
    "hooks": {
        "Notification": [
            {
                "matcher": "idle_prompt",
                "hooks": [
                    {
                        "type": "command",
                        "command": "command -v cmux &>/dev/null && cmux notify --title 'Claude Code' --body 'Waiting for input' || true",
                    }
                ],
            }
        ]
    },
}

# Autonomous execution instructions for Claude Code
CLAUDE_MD = """\
# Project Instructions

## Autonomous Execution
- Execute ALL tasks autonomously without asking for confirmation
- Never ask "proceed?", "shall I?", "do you want me to?" — just do it
- Make decisions independently — pick the simplest working approach
- Only stop when explicitly told: "stop", "중단", "그만"

## Code Style
- Comments, variable names: English
- Communication: Korean
- Use type hints in Python, async/await where applicable
- Prefer editing existing files over creating new ones

## Rules
- Do not ask clarifying questions — resolve ambiguity yourself
- Do not add unnecessary abstractions or over-engineer
- Run tests after making changes when test infrastructure exists
"""

# Autonomous execution instructions for Codex
CODEX_INSTRUCTIONS = """\
# Project Instructions

## Autonomous Execution
- Execute all tasks without asking for confirmation
- Never ask "should I?", "proceed?", "which approach?" — just do it
- Pick the simplest working approach and move forward
- All permissions are pre-granted via `--full-auto` and `approval_policy = "never"`

## Code Style
- Comments and variable names: English
- Communication: Korean
- Use type hints, async/await where applicable
- Prefer editing existing files over creating new ones

## Rules
- Do not ask clarifying questions — resolve ambiguity yourself
- Run tests after changes when possible
"""

# Codex notify TOML line for cmux integration
_CODEX_NOTIFY_TOML = r'''notify = ["bash", "-c", "command -v cmux &>/dev/null && cmux notify --title Codex --body \"$(echo $1 | jq -r '.\"last-assistant-message\" // \"Turn complete\"' 2>/dev/null | head -c 100)\" || true", "--"]'''


class ProjectBootstrapper:
    """Provisions environment configuration for autonomous agent execution.

    Call `provision(project_path)` as the FIRST step of any new mission.
    This creates the necessary config files so agents run without interruption.
    """

    def __init__(self, extra_claude_md: str = "", extra_codex_md: str = "") -> None:
        self.extra_claude_md = extra_claude_md
        self.extra_codex_md = extra_codex_md

    async def provision(self, project_path: str) -> dict[str, list[str]]:
        """Provision all config files in the target project directory.

        Args:
            project_path: Absolute path to the project root

        Returns:
            {"created": [...], "skipped": [...], "updated": [...]}
        """
        root = Path(project_path).resolve()
        if not root.is_dir():
            root.mkdir(parents=True, exist_ok=True)

        result: dict[str, list[str]] = {"created": [], "skipped": [], "updated": []}

        # 1. .claude/settings.json
        self._ensure_claude_settings(root, result)

        # 2. CLAUDE.md
        self._ensure_claude_md(root, result)

        # 3. .codex/instructions.md
        self._ensure_codex_instructions(root, result)

        # 4. .codex trust (via config.toml symlink check)
        self._ensure_codex_trust(root, result)

        created = ", ".join(result["created"]) or "none"
        skipped = ", ".join(result["skipped"]) or "none"
        logger.info(
            "Project bootstrapped: %s (created: %s, skipped: %s)",
            root,
            created,
            skipped,
        )
        return result

    def _ensure_claude_settings(self, root: Path, result: dict) -> None:
        """Create .claude/settings.json with full permissions."""
        settings_dir = root / ".claude"
        settings_file = settings_dir / "settings.json"

        if settings_file.exists():
            # Merge: ensure our permissions are present
            try:
                existing = json.loads(settings_file.read_text())
                existing_allows = set(existing.get("permissions", {}).get("allow", []))
                required_allows = set(CLAUDE_SETTINGS["permissions"]["allow"])
                missing = required_allows - existing_allows

                # Ensure hooks.Notification section exists
                hooks_missing = False
                if "hooks" not in existing or "Notification" not in existing.get("hooks", {}):
                    existing.setdefault("hooks", {})["Notification"] = CLAUDE_SETTINGS["hooks"]["Notification"]
                    hooks_missing = True

                if missing:
                    merged_allows = sorted(existing_allows | required_allows)
                    existing.setdefault("permissions", {})["allow"] = merged_allows

                if missing or hooks_missing:
                    settings_file.write_text(json.dumps(existing, indent=2) + "\n")
                    result["updated"].append(".claude/settings.json")
                    logger.info("Updated .claude/settings.json: added permissions=%s hooks=%s", missing, hooks_missing)
                else:
                    result["skipped"].append(".claude/settings.json")
            except (json.JSONDecodeError, OSError):
                result["skipped"].append(".claude/settings.json")
            return

        settings_dir.mkdir(parents=True, exist_ok=True)
        settings_file.write_text(json.dumps(CLAUDE_SETTINGS, indent=2) + "\n")
        result["created"].append(".claude/settings.json")

    def _ensure_claude_md(self, root: Path, result: dict) -> None:
        """Create CLAUDE.md with autonomous execution instructions."""
        claude_md = root / "CLAUDE.md"

        if claude_md.exists():
            content = claude_md.read_text()
            # Check if autonomous directive is already present
            if "Autonomous Execution" in content:
                result["skipped"].append("CLAUDE.md")
                return
            # Append our directives
            with open(claude_md, "a") as f:
                f.write("\n\n" + CLAUDE_MD)
            if self.extra_claude_md:
                with open(claude_md, "a") as f:
                    f.write("\n" + self.extra_claude_md)
            result["updated"].append("CLAUDE.md")
            return

        content = CLAUDE_MD
        if self.extra_claude_md:
            content += "\n" + self.extra_claude_md
        claude_md.write_text(content)
        result["created"].append("CLAUDE.md")

    def _ensure_codex_instructions(self, root: Path, result: dict) -> None:
        """Create .codex/instructions.md with full-auto instructions."""
        codex_dir = root / ".codex"
        instructions = codex_dir / "instructions.md"

        if instructions.exists():
            content = instructions.read_text()
            if "Autonomous Execution" in content:
                result["skipped"].append(".codex/instructions.md")
                return
            with open(instructions, "a") as f:
                f.write("\n\n" + CODEX_INSTRUCTIONS)
            if self.extra_codex_md:
                with open(instructions, "a") as f:
                    f.write("\n" + self.extra_codex_md)
            result["updated"].append(".codex/instructions.md")
            return

        codex_dir.mkdir(parents=True, exist_ok=True)
        content = CODEX_INSTRUCTIONS
        if self.extra_codex_md:
            content += "\n" + self.extra_codex_md
        instructions.write_text(content)
        result["created"].append(".codex/instructions.md")

    def _ensure_codex_trust(self, root: Path, result: dict) -> None:
        """Ensure the project path is trusted in Codex global config."""
        codex_config = Path.home() / ".codex" / "config.toml"
        if not codex_config.exists():
            result["skipped"].append("codex-trust")
            return

        project_str = str(root)
        content = codex_config.read_text()

        # Check if project is already trusted
        if f'[projects."{project_str}"]' in content:
            result["skipped"].append("codex-trust")
            return

        # Append trust entry
        trust_block = f'\n[projects."{project_str}"]\ntrust_level = "trusted"\n'
        with open(codex_config, "a") as f:
            f.write(trust_block)
        result["created"].append(f"codex-trust:{project_str}")
        logger.info("Added Codex trust for %s", project_str)

        # Ensure cmux notify hook is configured
        self._ensure_codex_notify(codex_config, content, result)

    def _ensure_codex_notify(self, codex_config: Path, content: str, result: dict) -> None:
        """Ensure notify command is set in Codex global config for cmux integration."""
        if "notify" in content:
            return

        with open(codex_config, "a") as f:
            f.write("\n" + _CODEX_NOTIFY_TOML + "\n")
        result.setdefault("updated", []).append("codex-notify")
        logger.info("Added cmux notify hook to Codex config")
