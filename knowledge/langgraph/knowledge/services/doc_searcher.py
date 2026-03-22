"""Project-doc search by keyword matching -- ported from doc-searcher.ts."""

from __future__ import annotations

import os
from pathlib import Path

from langgraph.knowledge.types import SearchResult


def _walk_md(directory: str) -> list[str]:
    """Recursively collect ``.md`` file paths, skipping hidden dirs and node_modules."""

    results: list[str] = []
    try:
        for entry in os.scandir(directory):
            if entry.is_dir(follow_symlinks=False):
                if entry.name.startswith(".") or entry.name == "node_modules":
                    continue
                results.extend(_walk_md(entry.path))
            elif entry.is_file() and entry.name.endswith(".md"):
                results.append(entry.path)
    except OSError:
        pass
    return results


async def search_docs(
    keywords: list[str],
    search_paths: list[str],
    max_results: int = 5,
    max_total_chars: int = 2000,
) -> list[SearchResult]:
    """Search markdown docs for keyword matches across *search_paths*."""

    all_files: list[str] = []
    for sp in search_paths:
        p = Path(sp)
        try:
            if p.is_dir():
                all_files.extend(_walk_md(sp))
            elif p.is_file() and p.suffix == ".md":
                all_files.append(sp)
        except OSError:
            continue

    scored: list[SearchResult] = []
    for file_path in all_files:
        try:
            content = Path(file_path).read_text(encoding="utf-8")
        except OSError:
            continue

        lower = content.lower()
        matched = [kw for kw in keywords if kw.lower() in lower]

        # Must match at least 2 keywords to qualify
        if len(matched) < 2:
            continue

        scored.append(
            SearchResult(
                path=file_path,
                relevance_score=len(matched),
                excerpt=content[:400],
                matched_keywords=matched,
            )
        )

    scored.sort(key=lambda r: r.relevance_score, reverse=True)
    top = scored[:max_results]

    # Trim total excerpt chars
    trimmed: list[SearchResult] = []
    total_chars = 0
    for r in top:
        remaining = max_total_chars - total_chars
        if remaining <= 0:
            break
        if len(r.excerpt) > remaining:
            trimmed.append(
                SearchResult(
                    path=r.path,
                    relevance_score=r.relevance_score,
                    excerpt=r.excerpt[:remaining],
                    matched_keywords=r.matched_keywords,
                )
            )
            total_chars += remaining
        else:
            trimmed.append(r)
            total_chars += len(r.excerpt)

    return trimmed
