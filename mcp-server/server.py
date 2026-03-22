"""clab-platform MCP Server — exposes knowledge and agent tools to Claude Code / Codex CLI."""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

CONTROL_URL = os.getenv("CLAB_CONTROL_URL", "https://ai.clab.one/api/cp")
KNOWLEDGE_URL = os.getenv("CLAB_KNOWLEDGE_URL", "https://ai.clab.one/api/ks")
LOCAL_AGENT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "local-agent")

server = Server("clab-platform")


@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="knowledge_search",
            description="Search the knowledge base for prior decisions, patterns, and insights.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search keywords"},
                    "limit": {"type": "integer", "description": "Max results (default 10)", "default": 10},
                },
                "required": ["query"],
            },
        ),
        Tool(
            name="knowledge_store",
            description="Store a knowledge entry (decision, pattern, insight, learning) for future reference.",
            inputSchema={
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "Short title"},
                    "content": {"type": "string", "description": "Detailed content"},
                    "tags": {"type": "string", "description": "Comma-separated tags", "default": ""},
                    "source": {"type": "string", "enum": ["MANUAL", "EXTRACTED", "DISTILLED"], "default": "MANUAL"},
                },
                "required": ["topic", "content"],
            },
        ),
        Tool(
            name="knowledge_pre_k",
            description="Retrieve prior knowledge relevant to a task BEFORE starting work. Returns related entries and project docs.",
            inputSchema={
                "type": "object",
                "properties": {
                    "task": {"type": "string", "description": "Task description"},
                    "roleId": {"type": "string", "description": "Role (BUILDER, ARCHITECT, PM)", "default": "BUILDER"},
                },
                "required": ["task"],
            },
        ),
        Tool(
            name="knowledge_post_k",
            description="Verify knowledge integrity AFTER completing work. Checks for broken links, missing crosslinks, orphan docs.",
            inputSchema={
                "type": "object",
                "properties": {
                    "modifiedDocs": {"type": "array", "items": {"type": "string"}, "description": "Paths of modified documents"},
                    "basePath": {"type": "string", "description": "Base directory", "default": "."},
                },
                "required": ["modifiedDocs"],
            },
        ),
        Tool(
            name="mission_run",
            description="Run a full development mission through the LangGraph agent. Decomposes goal into tasks, executes via Claude/Codex CLI, verifies, and stores insights.",
            inputSchema={
                "type": "object",
                "properties": {
                    "goal": {"type": "string", "description": "Development goal to achieve"},
                    "workdir": {"type": "string", "description": "Working directory", "default": "."},
                    "llm": {"type": "string", "enum": ["anthropic", "openai"], "default": "anthropic"},
                },
                "required": ["goal"],
            },
        ),
        Tool(
            name="platform_health",
            description="Check the health of all clab-platform services (Control Plane, Knowledge Plane).",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="session_list",
            description="List all agent sessions with their status.",
            inputSchema={
                "type": "object",
                "properties": {
                    "status": {"type": "string", "description": "Filter by status (CREATED, RUNNING, COMPLETED, FAILED)", "default": ""},
                },
            },
        ),
        Tool(
            name="interrupt_list",
            description="List pending interrupts (human-in-the-loop requests waiting for input).",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="interrupt_resolve",
            description="Resolve a pending interrupt by providing the requested input.",
            inputSchema={
                "type": "object",
                "properties": {
                    "interrupt_id": {"type": "string", "description": "Interrupt ID to resolve"},
                    "value": {"type": "string", "description": "Your response/input"},
                },
                "required": ["interrupt_id", "value"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    try:
        if name == "knowledge_search":
            return await _knowledge_search(arguments)
        elif name == "knowledge_store":
            return await _knowledge_store(arguments)
        elif name == "knowledge_pre_k":
            return await _knowledge_pre_k(arguments)
        elif name == "knowledge_post_k":
            return await _knowledge_post_k(arguments)
        elif name == "mission_run":
            return await _mission_run(arguments)
        elif name == "platform_health":
            return await _platform_health()
        elif name == "session_list":
            return await _session_list(arguments)
        elif name == "interrupt_list":
            return await _interrupt_list()
        elif name == "interrupt_resolve":
            return await _interrupt_resolve(arguments)
        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]
    except Exception as e:
        return [TextContent(type="text", text=f"Error: {e}")]


async def _knowledge_search(args: dict):
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{KNOWLEDGE_URL}/v1/knowledge/search", params={"q": args["query"], "limit": str(args.get("limit", 10))})
        data = resp.json()
    results = data.get("results", [])
    if not results:
        return [TextContent(type="text", text="No knowledge entries found.")]
    text = "\n".join(f"- **{r['topic']}**: {r['content'][:200]}" for r in results)
    return [TextContent(type="text", text=f"Found {len(results)} entries:\n{text}")]


async def _knowledge_store(args: dict):
    tags = [t.strip() for t in args.get("tags", "").split(",") if t.strip()]
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(f"{KNOWLEDGE_URL}/v1/knowledge", json={
            "topic": args["topic"], "content": args["content"],
            "tags": tags, "source": args.get("source", "MANUAL"),
        })
        data = resp.json()
    entry = data.get("entry", {})
    return [TextContent(type="text", text=f"Stored: {entry.get('id', '?')} ({args['topic']})")]


async def _knowledge_pre_k(args: dict):
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(f"{KNOWLEDGE_URL}/v1/pre-k/retrieve", json={
            "task": args["task"], "roleId": args.get("roleId", "BUILDER"),
        })
        data = resp.json()
    return [TextContent(type="text", text=json.dumps(data, indent=2, ensure_ascii=False))]


async def _knowledge_post_k(args: dict):
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(f"{KNOWLEDGE_URL}/v1/post-k/check", json={
            "modifiedDocs": args["modifiedDocs"], "basePath": args.get("basePath", "."),
        })
        data = resp.json()
    post_k = data.get("postK", {})
    if post_k.get("pass", True):
        return [TextContent(type="text", text="Knowledge integrity check PASSED.")]
    debts = post_k.get("debts", [])
    text = "\n".join(f"- [{d['type']}] {d['path']}: {d['description']}" for d in debts)
    return [TextContent(type="text", text=f"FAILED — {len(debts)} issue(s):\n{text}")]


async def _mission_run(args: dict):
    """Run local agent as subprocess."""
    goal = args["goal"]
    workdir = args.get("workdir", os.getcwd())
    llm = args.get("llm", "anthropic")

    # Use local-agent's venv python (not the MCP server's sys.executable)
    venv_python = os.path.join(LOCAL_AGENT_DIR, ".venv", "bin", "python")
    python = venv_python if os.path.exists(venv_python) else sys.executable
    cmd = [
        python, "-m", "local_agent",
        "--llm", llm,
        "--workdir", workdir,
        goal,
    ]

    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=3600, cwd=LOCAL_AGENT_DIR,
        )
        output = proc.stdout
        if proc.returncode != 0:
            output += f"\nSTDERR:\n{proc.stderr}"
        return [TextContent(type="text", text=output or "Mission completed (no output)")]
    except subprocess.TimeoutExpired:
        return [TextContent(type="text", text="Mission timed out after 3600s")]
    except FileNotFoundError:
        return [TextContent(type="text", text="Local agent not found. Run setup.sh first.")]


async def _platform_health():
    results = []
    for name, url in [("Control Plane", CONTROL_URL), ("Knowledge Plane", KNOWLEDGE_URL)]:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{url}/health")
                data = resp.json()
            results.append(f"OK {name}: {data.get('status', 'ok')}")
        except Exception as e:
            results.append(f"FAIL {name}: {e}")
    return [TextContent(type="text", text="\n".join(results))]


async def _session_list(args: dict):
    params = {}
    if args.get("status"):
        params["status"] = args["status"]
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{CONTROL_URL}/sessions", params=params)
        sessions = resp.json()
    if not sessions:
        return [TextContent(type="text", text="No sessions found.")]
    lines = [f"- [{s['status']}] {s['id'][:8]}... goal={s.get('goal','')[:50]}" for s in sessions]
    return [TextContent(type="text", text=f"{len(sessions)} session(s):\n" + "\n".join(lines))]


async def _interrupt_list():
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{CONTROL_URL}/interrupts", params={"status": "pending"})
        interrupts = resp.json()
    if not interrupts:
        return [TextContent(type="text", text="No pending interrupts.")]
    lines = [f"- [{i['id'][:8]}...] {i['value']}" for i in interrupts]
    return [TextContent(type="text", text=f"{len(interrupts)} pending interrupt(s):\n" + "\n".join(lines))]


async def _interrupt_resolve(args: dict):
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(f"{CONTROL_URL}/interrupts/{args['interrupt_id']}/resolve", json={
            "resume_value": args["value"],
        })
        data = resp.json()
    return [TextContent(type="text", text=f"Interrupt resolved: {data.get('id', '?')} -> {data.get('status', '?')}")]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
