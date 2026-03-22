"""Build the complete Plan-Execute-Verify-Replan StateGraph."""
from __future__ import annotations

from graph.state import AgentState

def build_agent_graph(checkpointer=None, interrupt_before_execute: bool = False):
    """Build and compile the local agent graph.

    Graph flow:
      START -> pre_k -> planner -> select_task -> executor -> verifier
        -> (success & more tasks? -> select_task)
        -> (success & no more? -> post_k -> insights -> END)
        -> (failure? -> replanner -> select_task)
    """
    from langgraph.graph import StateGraph, START, END
    from graph.state import AgentState
    from graph.planner import planner_node
    from graph.executor import executor_node
    from graph.verifier import verifier_node
    from graph.replanner import replanner_node
    from graph.knowledge import pre_k_node, post_k_node, insight_node

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

    return builder.compile(**compile_kwargs)


def select_task_node(state: AgentState) -> dict:
    """Select the next pending task from the plan."""
    plan = state.get("plan", [])
    idx = state.get("current_task_index", 0)
    iteration_count = state.get("iteration_count", 0) + 1
    max_iterations = state.get("max_iterations", 20)

    # Guard: force termination if max iterations reached
    if iteration_count >= max_iterations:
        return {"current_task_index": len(plan), "iteration_count": iteration_count}

    # Find next pending task starting from current index
    while idx < len(plan) and plan[idx].get("status") not in ("pending",):
        idx += 1

    return {"current_task_index": idx, "iteration_count": iteration_count}


def mark_complete_node(state: AgentState) -> dict:
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


def after_verify(state: AgentState) -> str:
    """Route after verification: success -> mark_complete, failure -> replanner."""
    if state.get("verification_passed", False) or state.get("current_exit_code", -1) == 0:
        return "mark_complete"
    return "replanner"


def has_more_tasks(state: AgentState) -> str:
    """Check if there are more pending tasks."""
    plan = state.get("plan", [])
    idx = state.get("current_task_index", 0)

    for i in range(idx, len(plan)):
        if plan[i].get("status") == "pending":
            return "select_task"
    return "post_k"



def build_parallel_agent_graph(checkpointer=None, interrupt_before_execute: bool = False):
    """Build graph with parallel execution — 3 codex workers + 1 codex reviewer.

    Uses parallel_executor_node instead of sequential executor_node.
    Batch selection and completion handle multiple tasks per cycle.
    """
    from langgraph.graph import StateGraph, START, END
    from graph.state import AgentState
    from graph.planner import planner_node
    from graph.executor import parallel_executor_node
    from graph.verifier import verifier_node
    from graph.replanner import replanner_node
    from graph.knowledge import pre_k_node, post_k_node, insight_node

    builder = StateGraph(AgentState)

    builder.add_node("pre_k", pre_k_node)
    builder.add_node("planner", planner_node)
    builder.add_node("select_task", select_batch_node)
    builder.add_node("executor", parallel_executor_node)
    builder.add_node("verifier", verifier_node)
    builder.add_node("replanner", replanner_node)
    builder.add_node("mark_complete", mark_batch_complete_node)
    builder.add_node("post_k", post_k_node)
    builder.add_node("insights", insight_node)

    builder.add_edge(START, "pre_k")
    builder.add_edge("pre_k", "planner")
    builder.add_edge("planner", "select_task")
    builder.add_edge("select_task", "executor")
    builder.add_edge("executor", "verifier")

    builder.add_conditional_edges("verifier", after_verify, {
        "mark_complete": "mark_complete",
        "replanner": "replanner",
    })
    builder.add_edge("replanner", "select_task")
    builder.add_conditional_edges("mark_complete", has_more_tasks, {
        "select_task": "select_task",
        "post_k": "post_k",
    })

    builder.add_edge("post_k", "insights")
    builder.add_edge("insights", END)

    compile_kwargs = {}
    if checkpointer:
        compile_kwargs["checkpointer"] = checkpointer
    if interrupt_before_execute:
        compile_kwargs["interrupt_before"] = ["executor"]

    return builder.compile(**compile_kwargs)


select_batch_node = select_task_node  # same logic, reused for parallel graph


def mark_batch_complete_node(state: AgentState) -> dict:
    """Mark all tasks in the executed batch as complete."""
    plan = state.get("plan", [])
    completed = list(state.get("completed_tasks", []))

    for i in range(len(plan)):
        if plan[i].get("status") == "running":
            plan[i] = {**plan[i], "status": "success", "result": plan[i].get("result", "")[:1000]}
            completed.append(plan[i])

    # Find next pending task index
    next_idx = len(plan)
    for i in range(len(plan)):
        if plan[i].get("status") == "pending":
            next_idx = i
            break

    return {
        "plan": plan,
        "current_task_index": next_idx,
        "completed_tasks": completed,
    }
