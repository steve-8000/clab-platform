"""Build the complete Plan-Execute-Verify-Replan StateGraph."""
from __future__ import annotations

def build_agent_graph(checkpointer=None, interrupt_before_execute: bool = False):
    """Build and compile the local agent graph.

    Graph flow:
      START -> pre_k -> planner -> select_task -> executor -> verifier
        -> (success & more tasks? -> select_task)
        -> (success & no more? -> post_k -> insights -> END)
        -> (failure? -> replanner -> select_task)
    """
    from langgraph.graph import StateGraph, START, END
    from langgraph.types import RetryPolicy
    from local_agent.graph.state import AgentState
    from local_agent.graph.planner import planner_node
    from local_agent.graph.executor import executor_node
    from local_agent.graph.verifier import verifier_node
    from local_agent.graph.replanner import replanner_node
    from local_agent.graph.knowledge import pre_k_node, post_k_node, insight_node

    builder = StateGraph(AgentState)

    # Add nodes
    builder.add_node("pre_k", pre_k_node)
    builder.add_node("planner", planner_node)
    builder.add_node("select_task", select_task_node)
    builder.add_node("executor", executor_node)
    builder.add_node("verifier", verifier_node)
    builder.add_node("replanner", replanner_node)
    builder.add_node("mark_complete", mark_complete_node)
    builder.add_node("post_k", post_k_node)
    builder.add_node("insights", insight_node)

    # Edges
    builder.add_edge(START, "pre_k")
    builder.add_edge("pre_k", "planner")
    builder.add_edge("planner", "select_task")
    builder.add_edge("select_task", "executor")
    builder.add_edge("executor", "verifier")

    # Conditional: after verification
    builder.add_conditional_edges("verifier", after_verify, {
        "mark_complete": "mark_complete",
        "replanner": "replanner",
    })

    # After replanner -> back to select_task
    builder.add_edge("replanner", "select_task")

    # After mark_complete -> check if more tasks
    builder.add_conditional_edges("mark_complete", has_more_tasks, {
        "select_task": "select_task",
        "post_k": "post_k",
    })

    builder.add_edge("post_k", "insights")
    builder.add_edge("insights", END)

    # Compile with production features
    compile_kwargs = {}
    if checkpointer:
        compile_kwargs["checkpointer"] = checkpointer
    if interrupt_before_execute:
        compile_kwargs["interrupt_before"] = ["executor"]

    compile_kwargs["retry_policy"] = [RetryPolicy(
        initial_interval=2.0,
        backoff_factor=2.0,
        max_attempts=3,
    )]

    return builder.compile(**compile_kwargs)


def select_task_node(state: dict) -> dict:
    """Select the next pending task from the plan."""
    plan = state.get("plan", [])
    idx = state.get("current_task_index", 0)

    # Find next pending task starting from current index
    while idx < len(plan) and plan[idx].get("status") not in ("pending",):
        idx += 1

    return {"current_task_index": idx}


def mark_complete_node(state: dict) -> dict:
    """Mark current task as complete and record it."""
    plan = state.get("plan", [])
    idx = state.get("current_task_index", 0)

    if idx < len(plan):
        task = plan[idx]
        plan[idx] = {**task, "status": "success", "result": state.get("current_output", "")[:1000]}
        completed = state.get("completed_tasks", []) + [plan[idx]]
        return {
            "plan": plan,
            "current_task_index": idx + 1,
            "completed_tasks": completed,
        }
    return {}


def after_verify(state: dict) -> str:
    """Route after verification: success -> mark_complete, failure -> replanner."""
    if state.get("verification_passed", False) or state.get("current_exit_code", -1) == 0:
        return "mark_complete"
    return "replanner"


def has_more_tasks(state: dict) -> str:
    """Check if there are more pending tasks."""
    plan = state.get("plan", [])
    idx = state.get("current_task_index", 0)

    for i in range(idx, len(plan)):
        if plan[i].get("status") == "pending":
            return "select_task"
    return "post_k"
