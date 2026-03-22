"""CLI entry point for the local agent."""
from __future__ import annotations
import argparse
import asyncio
import logging
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
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    )

    from local_agent.config import AgentConfig, configure
    config = AgentConfig(
        control_plane_url=args.control_plane or "http://localhost:8000",
        knowledge_url=args.knowledge or "http://localhost:4007",
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
        asyncio.run(run_goal(args.goal, config))
    else:
        parser.print_help()
        sys.exit(1)


async def run_goal(goal: str, config):
    """Run a single goal through the agent graph."""
    from local_agent.graph.builder import build_agent_graph

    graph = build_agent_graph(
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
    }

    print(f"\n🎯 Goal: {goal}")
    print(f"📁 Workdir: {config.workdir}")
    print(f"🤖 LLM: {config.llm_provider}")
    print("─" * 60)

    result = await graph.ainvoke(initial_state)

    # Print summary
    completed = result.get("completed_tasks", [])
    failed = result.get("failed_tasks", [])
    insights = result.get("insights", [])

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
    from local_agent.graph.builder import build_agent_graph

    graph = build_agent_graph(
        interrupt_before_execute=config.interrupt_before_execute,
    )

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
