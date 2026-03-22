"""Knowledge tools — HTTP client to Go knowledge-service."""
from __future__ import annotations
import httpx
import json
from langchain_core.tools import tool

@tool
async def knowledge_search(query: str, limit: int = 10) -> str:
    """Search the knowledge base for relevant entries.
    Args:
        query: Search keywords
        limit: Max results
    """
    from local_agent.config import get_config
    url = get_config().knowledge_url
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{url}/v1/knowledge/search", params={"q": query, "limit": str(limit)})
            data = resp.json()
        results = data.get("results", [])
        if not results:
            return "No knowledge entries found."
        return json.dumps([{"topic": r["topic"], "content": r["content"][:200]} for r in results], indent=2, ensure_ascii=False)
    except Exception as e:
        return f"Knowledge search failed: {e}"

@tool
async def knowledge_store(topic: str, content: str, tags: str = "") -> str:
    """Store a knowledge entry (decision, pattern, insight).
    Args:
        topic: Short title
        content: Detailed content
        tags: Comma-separated tags
    """
    from local_agent.config import get_config
    url = get_config().knowledge_url
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{url}/v1/knowledge", json={"topic": topic, "content": content, "tags": tag_list, "source": "MANUAL"})
            data = resp.json()
        return f"Stored: {data.get('entry',{}).get('id','?')} ({topic})"
    except Exception as e:
        return f"Knowledge store failed: {e}"
