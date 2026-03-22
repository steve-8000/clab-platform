"""Knowledge integrity checker -- ported from integrity-checker.ts."""

from __future__ import annotations

import os
import re
from pathlib import Path

from langgraph.knowledge.types import DebtItem

_HUB_CANDIDATES = ("index.md", "hub.md", "README.md", "_index.md")


def _collect_md(directory: str) -> list[str]:
    """Recursively collect ``.md`` files, skipping hidden dirs and node_modules."""

    results: list[str] = []
    try:
        for entry in os.scandir(directory):
            if entry.is_dir(follow_symlinks=False):
                if entry.name.startswith(".") or entry.name == "node_modules":
                    continue
                results.extend(_collect_md(entry.path))
            elif entry.is_file() and entry.name.endswith(".md"):
                results.append(entry.path)
    except OSError:
        pass
    return results


def _extract_links(content: str) -> list[str]:
    """Extract relative markdown links ``[text](path)``."""

    links: list[str] = []
    for m in re.finditer(r"\[([^\]]*)\]\(([^)]+)\)", content):
        href = m.group(2)
        if not href.startswith("http") and not href.startswith("#"):
            links.append(href.split("#")[0])
    return links


def _has_crosslink_section(content: str) -> bool:
    idx = content.find("## Related")
    if idx == -1:
        return False
    after = content[idx:]
    return bool(re.search(r"\[([^\]]+)\]\(([^)]+)\)", after))


def _find_hub_doc(directory: str) -> str | None:
    for name in _HUB_CANDIDATES:
        candidate = os.path.join(directory, name)
        if os.path.isfile(candidate):
            return candidate
    return None


async def check_integrity(
    modified_docs: list[str],
    base_path: str,
) -> tuple[bool, list[DebtItem]]:
    """Run integrity checks on *modified_docs* and return ``(pass, debts)``."""

    debts: list[DebtItem] = []

    for doc in modified_docs:
        full_path = os.path.normpath(os.path.join(base_path, doc))

        try:
            content = Path(full_path).read_text(encoding="utf-8")
        except OSError:
            continue

        # 1. Crosslink check
        if not _has_crosslink_section(content):
            debts.append(
                DebtItem(
                    type="missing_crosslink",
                    path=doc,
                    description='Missing "## Related" section with crosslinks',
                )
            )

        # 2. Hub registration check
        folder = os.path.dirname(full_path)
        hub_doc = _find_hub_doc(folder)
        if hub_doc is not None:
            hub_content = Path(hub_doc).read_text(encoding="utf-8")
            doc_basename = os.path.basename(full_path)
            if doc_basename not in hub_content:
                debts.append(
                    DebtItem(
                        type="missing_hub",
                        path=doc,
                        description=f"Not listed in hub doc {os.path.relpath(hub_doc, base_path)}",
                    )
                )

        # 3. Link validation
        for link in _extract_links(content):
            resolved = os.path.normpath(
                os.path.join(os.path.dirname(full_path), link)
            )
            if not os.path.exists(resolved):
                debts.append(
                    DebtItem(
                        type="broken_link",
                        path=doc,
                        description=f"Broken link: {link}",
                    )
                )

        # 4. Staleness check (frontmatter)
        fm_match = re.match(r"^---\n([\s\S]*?)\n---", content)
        if fm_match and re.search(r"status:\s*(deprecated|stale)", fm_match.group(1), re.IGNORECASE):
            debts.append(
                DebtItem(
                    type="stale_doc",
                    path=doc,
                    description="Doc is marked as deprecated/stale in frontmatter",
                )
            )

    # 5. Orphan detection
    try:
        all_docs = _collect_md(base_path)
        for doc_path in all_docs:
            folder = os.path.dirname(doc_path)
            hub_doc = _find_hub_doc(folder)
            if hub_doc is None or hub_doc == doc_path:
                continue

            basename = os.path.basename(doc_path)
            if basename in _HUB_CANDIDATES:
                continue

            hub_content = Path(hub_doc).read_text(encoding="utf-8")
            if basename not in hub_content:
                debts.append(
                    DebtItem(
                        type="orphan_doc",
                        path=os.path.relpath(doc_path, base_path),
                        description=f"Orphan: not referenced by {os.path.relpath(hub_doc, base_path)}",
                    )
                )
    except OSError:
        pass

    return (len(debts) == 0, debts)
