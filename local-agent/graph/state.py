"""Agent state definition for the Plan-Execute-Verify-Replan loop."""
from __future__ import annotations
from typing import Annotated, Sequence, Any
from operator import add
from langchain_core.messages import BaseMessage
from typing_extensions import TypedDict

class TaskItem(TypedDict):
    id: str
    title: str
    description: str
    engine: str  # "claude" or "codex"
    status: str  # "pending", "running", "success", "failed", "skipped"
    result: str
    attempt: int

class AgentState(TypedDict):
    """Full state for the plan-execute-verify-replan agent."""
    messages: Annotated[Sequence[BaseMessage], add]

    # Input
    goal: str
    workdir: str
    role_id: str

    # Planning
    plan: list[TaskItem]
    current_task_index: int
    max_retries: int

    # Knowledge
    enriched_context: str
    pre_k_result: dict

    # Execution
    current_output: str
    current_exit_code: int
    verification_result: str
    verification_passed: bool

    # Completion
    completed_tasks: list[dict]
    failed_tasks: list[dict]
    artifacts: list[dict]
    insights: list[dict]

    # Post-K
    knowledge_debt_passed: bool

    # Control
    iteration_count: int
    max_iterations: int

    # cmux runtime (populated when cmux is available)
    cmux_workspace_id: str
    surface_map: dict  # task_id → surface_id
    browser_surface_id: str

    # Parallel execution
    parallel_mode: bool
    batch_results: list[dict]
