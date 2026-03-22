"""Knowledge integration nodes calling the Go knowledge-service via HTTP."""
import httpx
import logging

from graph.state import AgentState

logger = logging.getLogger(__name__)

async def pre_k_node(state: AgentState) -> dict:
    """Retrieve prior knowledge from Knowledge Plane."""
    from local_agent.config import get_config
    config = get_config()

    goal = state.get("goal", "")
    role_id = state.get("role_id", "BUILDER")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{config.knowledge_url}/v1/pre-k/retrieve",
                json={"task": goal, "roleId": role_id}
            )
            data = resp.json()

        # Format enriched context
        lines = []
        pre_k = data.get("preK", data.get("ok", {}))
        if isinstance(pre_k, dict):
            entries = pre_k.get("knowledgeEntries", pre_k.get("knowledge_entries", []))
            if entries:
                lines.append("## Prior Knowledge")
                for e in entries:
                    lines.append(f"- [{e.get('topic','')}]: {e.get('excerpt','')[:200]}")
            docs = pre_k.get("projectDocs", pre_k.get("project_docs", []))
            if docs:
                lines.append("## Related Docs")
                for d in docs:
                    lines.append(f"- [{d.get('path','')}]: {d.get('excerpt','')[:150]}")

        enriched = "\n".join(lines) if lines else ""
        return {"enriched_context": enriched, "pre_k_result": data}

    except Exception as e:
        logger.warning(f"Pre-K failed: {e}")
        return {"enriched_context": "", "pre_k_result": {}}


async def post_k_node(state: AgentState) -> dict:
    """Verify knowledge integrity via Knowledge Plane."""
    from local_agent.config import get_config
    config = get_config()

    artifacts = state.get("artifacts", [])
    modified_docs = [a.get("path", "") for a in artifacts if a.get("path", "").endswith(".md")]

    if not modified_docs:
        return {"knowledge_debt_passed": True}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{config.knowledge_url}/v1/post-k/check",
                json={"modifiedDocs": modified_docs, "basePath": state.get("workdir", ".")}
            )
            data = resp.json()

        post_k = data.get("postK", {})
        return {"knowledge_debt_passed": post_k.get("pass", True)}
    except Exception as e:
        logger.warning(f"Post-K failed: {e}")
        return {"knowledge_debt_passed": True}


async def insight_node(state: AgentState) -> dict:
    """Extract and store insights from completed work."""
    from local_agent.config import get_config
    config = get_config()

    completed = state.get("completed_tasks", [])
    if not completed:
        return {"insights": []}

    # Build summary from completed tasks
    summary = "\n".join(f"- {t.get('title','')}: {t.get('result','')[:200]}" for t in completed)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{config.knowledge_url}/v1/insights/extract",
                json={
                    "taskRunId": f"local-{state.get('goal','')[:20]}",
                    "result": {"status": "completed", "summary": summary, "risks": [], "changedFiles": []},
                    "context": state.get("goal", ""),
                }
            )
            data = resp.json()
        return {"insights": data.get("insights", [])}
    except Exception as e:
        logger.warning(f"Insight extraction failed: {e}")
        return {"insights": []}
