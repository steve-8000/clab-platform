"""File system tools for the agent."""
from __future__ import annotations
import os
from langchain_core.tools import tool

@tool
def read_file(path: str) -> str:
    """Read a file's contents.
    Args:
        path: File path (relative to workdir or absolute)
    """
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        if len(content) > 10000:
            return content[:10000] + f"\n... (truncated, {len(content)} total chars)"
        return content
    except Exception as e:
        return f"Error reading {path}: {e}"

@tool
def write_file(path: str, content: str) -> str:
    """Write content to a file.
    Args:
        path: File path
        content: Content to write
    """
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Written {len(content)} chars to {path}"
    except Exception as e:
        return f"Error writing {path}: {e}"

@tool
def list_files(directory: str = ".", pattern: str = "") -> str:
    """List files in a directory.
    Args:
        directory: Directory path
        pattern: Optional filter pattern (e.g. ".py")
    """
    try:
        files = []
        for root, dirs, filenames in os.walk(directory):
            # Skip hidden dirs
            dirs[:] = [d for d in dirs if not d.startswith(".") and d != "node_modules" and d != "__pycache__"]
            for name in filenames:
                if pattern and pattern not in name:
                    continue
                rel = os.path.relpath(os.path.join(root, name), directory)
                files.append(rel)
        files.sort()
        if len(files) > 100:
            return "\n".join(files[:100]) + f"\n... ({len(files)} total)"
        return "\n".join(files) if files else "(empty)"
    except Exception as e:
        return f"Error listing {directory}: {e}"
