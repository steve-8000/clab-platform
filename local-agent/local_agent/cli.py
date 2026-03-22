"""CLI entry point for the local agent."""
from __future__ import annotations
import argparse
import asyncio
import logging
import os
import sys

def main():
    parser = argparse.ArgumentParser(description="LangGraph Local Agent")
    parser.add_argument("goal", nargs="?", help="Development goal to achieve")
    parser.add_argument("--control-plane", default=None, help="Control Plane URL")
    parser.add_argument("--knowledge", default=None, help="Knowledge Service URL")
    parser.add_argument("--llm", default="anthropic", choices=["anthropic", "openai"], help="LLM provider")
    parser.add_argument("--model", default="", help="LLM model name")
    parser.add_argument("--workdir", default=".", help="Working directory")
    parser.add_argument("--max-retries", type=int, default=3, help="Max retries per task")
    parser.add_argument("--interrupt", action="store_true", help="Interrupt before each execution")
    parser.add_argument("--interactive", action="store_true", help="Interactive mode")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose logging")
    parser.add_argument("--parallel", action="store_true", help="Use parallel execution (3 codex workers + 1 codex reviewer)")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    )

    from local_agent.config import AgentConfig, configure
    config = AgentConfig(
        control_plane_url=args.control_plane or os.getenv("CLAB_CONTROL_URL", "https://ai.clab.one/api/cp"),
        knowledge_url=args.knowledge or os.getenv("CLAB_KNOWLEDGE_URL", "https://ai.clab.one/api/ks"),
        llm_provider=args.llm,
        llm_model=args.model,
        workdir=args.workdir,
        max_retries=args.max_retries,
        interrupt_before_execute=args.interrupt,
    )
    configure(config)

    if args.interactive:
        asyncio.run(interactive_loop(config))
    elif args.goal:
        asyncio.run(run_goal(args.goal, config, parallel=args.parallel))
    else:
        parser.print_help()
        sys.exit(1)


async def run_goal(goal: str, config, parallel: bool = False):
    """Run a single goal through the agent graph."""
    from local_agent.graph.builder import build_agent_graph, build_parallel_agent_graph
    from local_agent.cp_reporter import CPReporter

    # Connect to Control Plane (fail-safe — runs offline if CP unavailable)
    reporter = CPReporter(config.control_plane_url)
    try:
        thread_id, run_id = await reporter.start_session(goal, config.workdir)
    except Exception as exc:
        logging.getLogger(__name__).warning("CP unavailable, running offline: %s", exc)
        reporter = None
        thread_id = run_id = None

    graph_builder = build_parallel_agent_graph if parallel else build_agent_graph
    graph = graph_builder(
        interrupt_before_execute=config.interrupt_before_execute,
    )

    initial_state = {
        "messages": [],
        "goal": goal,
        "workdir": config.workdir,
        "role_id": "BUILDER",
        "plan": [],
        "current_task_index": 0,
        "max_retries": config.max_retries,
        "enriched_context": "",
        "pre_k_result": {},
        "current_output": "",
        "current_exit_code": 0,
        "verification_result": "",
        "verification_passed": False,
        "completed_tasks": [],
        "failed_tasks": [],
        "artifacts": [],
        "insights": [],
        "knowledge_debt_passed": True,
        "iteration_count": 0,
        "max_iterations": 20,
        "_cp_reporter": reporter,
    }

    print(f"\n🎯 Goal: {goal}")
    print(f"📁 Workdir: {config.workdir}")
    print(f"🤖 LLM: {config.llm_provider}")
    print(f"⚡ Parallel: {'enabled' if parallel else 'disabled'}")
    if thread_id:
        print(f"📡 CP: thread={thread_id[:8]}... run={run_id[:8]}...")
    else:
        print("📡 CP: offline mode")
    print("─" * 60)

    result = await graph.ainvoke(initial_state)

    # Cleanup cmux runtime (prevent orphan workspaces on next run)
    from graph.executor import cleanup_cmux_runtime
    await cleanup_cmux_runtime()

    # Report completion to CP
    completed = result.get("completed_tasks", [])
    failed = result.get("failed_tasks", [])
    insights = result.get("insights", [])

    if reporter:
        await reporter.report_finished(success=len(failed) == 0)
        await reporter.close()

    print("\n" + "─" * 60)
    print(f"✅ Completed: {len(completed)} tasks")
    print(f"❌ Failed: {len(failed)} tasks")
    print(f"💡 Insights: {len(insights)} extracted")
    print(f"📋 Knowledge debt: {'PASSED' if result.get('knowledge_debt_passed') else 'ISSUES FOUND'}")

    for t in completed:
        print(f"  ✅ {t.get('title','')}")
    for t in failed:
        print(f"  ❌ {t.get('title','')}")


async def interactive_loop(config):
    """Interactive mode — keep accepting goals."""
    print("🤖 LangGraph Local Agent (interactive mode)")
    print("Type a development goal, or 'quit' to exit.\n")

    while True:
        try:
            goal = input("Goal> ").strip()
        except (EOFError, KeyboardInterrupt):
            break

        if goal.lower() in ("quit", "exit", "q"):
            break
        if not goal:
            continue

        await run_goal(goal, config)
        print()

if __name__ == "__main__":
    main()
