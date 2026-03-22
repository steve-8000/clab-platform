"""Knowledge-aware LangGraph agent with Pre-K / Post-K lifecycle."""

from __future__ import annotations

import dataclasses
from typing import Annotated, Any, Sequence
from operator import add

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from typing_extensions import TypedDict

from langgraph.knowledge.langchain_tools import (
    get_knowledge_tools,
    configure_store,
    get_store,
)
from langgraph.knowledge.pre_k import retrieve_pre_knowledge
from langgraph.knowledge.post_k import verify_post_knowledge
from langgraph.knowledge.insights import extract_insights, TaskResult


class KnowledgeAgentState(TypedDict):
    """State for a knowledge-aware agent."""

    messages: Annotated[Sequence[BaseMessage], add]
    task_description: str
    role_id: str
    scope_paths: list[str]
    enriched_context: str
    modified_docs: list[str]
    knowledge_debt_passed: bool
    insights: list[dict]
    knowledge_store_dir: str


async def pre_k_node(state: KnowledgeAgentState) -> dict:
    """Retrieve prior knowledge and inject as system context."""
    store = get_store()
    result = await retrieve_pre_knowledge(
        state.get("task_description", ""),
        state.get("role_id", "BUILDER"),
        store,
        state.get("scope_paths", []),
    )

    lines = []
    if result.knowledge_entries:
        lines.append("## Prior Knowledge")
        for e in result.knowledge_entries:
            lines.append(f"- [{e.topic}]: {e.excerpt}")
    if result.project_docs:
        lines.append("## Related Docs")
        for d in result.project_docs:
            lines.append(f"- [{d.path}]: {d.excerpt[:150]}")
    if result.warnings:
        lines.append("## Warnings")
        for w in result.warnings:
            lines.append(f"- {w}")

    enriched = "\n".join(lines) if lines else ""

    # Inject as system message if there's knowledge
    new_messages = []
    if enriched:
        new_messages.append(
            SystemMessage(
                content=(
                    f"The following prior knowledge may be relevant:\n\n{enriched}"
                )
            )
        )

    return {
        "enriched_context": enriched,
        "messages": new_messages,
    }


async def post_k_node(state: KnowledgeAgentState) -> dict:
    """Verify knowledge integrity after task execution."""
    modified = state.get("modified_docs", [])
    if not modified:
        return {"knowledge_debt_passed": True}

    result = await verify_post_knowledge(modified, ".")
    return {"knowledge_debt_passed": result.passed}


async def insight_node(state: KnowledgeAgentState) -> dict:
    """Extract and store insights from the conversation."""
    messages = state.get("messages", [])

    # Build summary from assistant messages
    assistant_msgs = [
        m.content
        for m in messages
        if hasattr(m, "content") and not isinstance(m, (HumanMessage, SystemMessage))
    ]
    summary = " ".join(str(m) for m in assistant_msgs[-3:])[:1000]

    if len(summary) < 50:
        return {"insights": []}

    store = get_store()
    task_result = TaskResult(
        status="completed",
        summary=summary,
        changed_files=state.get("modified_docs", []),
        risks=[],
    )

    extracted = await extract_insights(
        task_run_id="local-" + state.get("task_description", "unknown")[:20],
        result=task_result,
        context=state.get("task_description", ""),
        store=store,
    )

    return {"insights": [dataclasses.asdict(i) for i in extracted]}


def create_knowledge_agent(
    model, *, store_dir: str = ".knowledge-data", tools: list | None = None
):
    """Create a LangGraph agent with knowledge lifecycle (Pre-K -> LLM -> Post-K -> Insights).

    Args:
        model: LangChain chat model (e.g. ChatAnthropic, ChatOpenAI)
        store_dir: Directory for local knowledge store
        tools: Additional tools to give the agent (knowledge tools are always included)

    Returns:
        Compiled LangGraph StateGraph

    Usage:
        from langchain_anthropic import ChatAnthropic
        from langgraph.knowledge.agent import create_knowledge_agent

        model = ChatAnthropic(model="claude-sonnet-4-20250514")
        agent = create_knowledge_agent(model, store_dir=".knowledge-data")

        result = agent.invoke({
            "messages": [HumanMessage(content="Implement a REST API for user management")],
            "task_description": "Implement REST API for user management",
            "role_id": "BUILDER",
            "scope_paths": ["./docs"],
            "modified_docs": [],
            "knowledge_store_dir": store_dir,
        })
    """
    # Import here to avoid hard dependency on langgraph.graph
    from langgraph.graph import StateGraph, START, END
    from langgraph.prebuilt import ToolNode

    configure_store(store_dir)

    knowledge_tools = get_knowledge_tools()
    all_tools = knowledge_tools + (tools or [])
    model_with_tools = model.bind_tools(all_tools)

    async def agent_node(state: KnowledgeAgentState) -> dict:
        response = await model_with_tools.ainvoke(state["messages"])
        return {"messages": [response]}

    def should_continue(state: KnowledgeAgentState) -> str:
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return "post_k"

    builder = StateGraph(KnowledgeAgentState)

    # Nodes
    builder.add_node("pre_k", pre_k_node)
    builder.add_node("agent", agent_node)
    builder.add_node("tools", ToolNode(all_tools))
    builder.add_node("post_k", post_k_node)
    builder.add_node("insights", insight_node)

    # Edges: Pre-K -> Agent -> (Tools loop) -> Post-K -> Insights -> END
    builder.add_edge(START, "pre_k")
    builder.add_edge("pre_k", "agent")
    builder.add_conditional_edges(
        "agent", should_continue, {"tools": "tools", "post_k": "post_k"}
    )
    builder.add_edge("tools", "agent")
    builder.add_edge("post_k", "insights")
    builder.add_edge("insights", END)

    return builder.compile()
