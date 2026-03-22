"""Translation functions: CGC raw data -> clab domain models."""

from __future__ import annotations

from typing import Any

import structlog

from .models import RelationEdge, SymbolNode

log = structlog.get_logger(__name__)

# CGC relation type -> clab domain relation type.
# "CONTAINS" is structural-only and intentionally skipped.
_RELATION_TYPE_MAP: dict[str, str | None] = {
    "CALLS": "CALLS",
    "IMPORTS": "IMPORTS",
    "INHERITS": "EXTENDS",
    "CONTAINS": None,  # structural only, skip
}


def normalize_symbol(cgc_symbol: dict[str, Any]) -> SymbolNode:
    """Convert a CGC raw symbol dict into a clab-domain :class:`SymbolNode`.

    Handles inconsistent key names across different CGC output formats.
    """
    name = cgc_symbol.get("name", cgc_symbol.get("function_name", ""))
    kind = cgc_symbol.get("type", cgc_symbol.get("kind", "unknown"))
    file_path = cgc_symbol.get("path", cgc_symbol.get("file_path", ""))
    line_number = int(cgc_symbol.get("line_number", 0))
    language = cgc_symbol.get("language", "")
    qualified_name = cgc_symbol.get("qualified_name", "")

    if not qualified_name and file_path and name:
        qualified_name = f"{file_path}::{name}"

    return SymbolNode(
        name=name,
        kind=kind.lower(),
        file_path=file_path,
        line_number=line_number,
        language=language,
        qualified_name=qualified_name,
    )


def normalize_relation(cgc_relation: dict[str, Any]) -> RelationEdge | None:
    """Convert a CGC raw relation dict into a clab-domain :class:`RelationEdge`.

    Returns ``None`` if the relation type should be skipped (e.g. ``CONTAINS``).
    """
    raw_type = cgc_relation.get("type", cgc_relation.get("relation_type", "")).upper()
    mapped_type = _RELATION_TYPE_MAP.get(raw_type)

    if mapped_type is None:
        if raw_type and raw_type not in _RELATION_TYPE_MAP:
            log.debug("normalizer.unknown_relation_type", raw_type=raw_type)
        return None

    source = cgc_relation.get("source", cgc_relation.get("caller", cgc_relation.get("from", "")))
    target = cgc_relation.get("target", cgc_relation.get("callee", cgc_relation.get("to", "")))
    file_path = cgc_relation.get("file_path", cgc_relation.get("path", ""))
    line_number = int(cgc_relation.get("line_number", 0))

    return RelationEdge(
        source=str(source),
        target=str(target),
        relation_type=mapped_type,
        file_path=file_path,
        line_number=line_number,
    )


def build_context_bundle(
    symbols: list[SymbolNode],
    relations: list[RelationEdge],
    task_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble a ContextBundle dict from normalized symbols and relations.

    The bundle is a plain dict suitable for serialization / passing to
    downstream agent prompts.
    """
    bundle: dict[str, Any] = {
        "symbols": [s.model_dump() for s in symbols],
        "relations": [r.model_dump() for r in relations],
        "symbol_count": len(symbols),
        "relation_count": len(relations),
    }

    if task_context:
        bundle["task_context"] = task_context

    # Derive quick summary stats
    kinds: dict[str, int] = {}
    for s in symbols:
        kinds[s.kind] = kinds.get(s.kind, 0) + 1
    bundle["symbol_kinds"] = kinds

    relation_types: dict[str, int] = {}
    for r in relations:
        relation_types[r.relation_type] = relation_types.get(r.relation_type, 0) + 1
    bundle["relation_types"] = relation_types

    return bundle


def extract_structural_findings(
    before_snapshot: dict[str, Any],
    after_snapshot: dict[str, Any],
) -> list[dict[str, Any]]:
    """Compare two snapshots and return a list of structural findings.

    Each finding is a dict with keys: ``type``, ``description``, ``details``.
    Snapshots are expected to be ContextBundle dicts (as produced by
    :func:`build_context_bundle`).
    """
    findings: list[dict[str, Any]] = []

    before_symbols = {s["qualified_name"]: s for s in before_snapshot.get("symbols", [])}
    after_symbols = {s["qualified_name"]: s for s in after_snapshot.get("symbols", [])}

    # --- Added symbols ---
    added = set(after_symbols.keys()) - set(before_symbols.keys())
    for qn in sorted(added):
        sym = after_symbols[qn]
        findings.append(
            {
                "type": "symbol_added",
                "description": f"New {sym.get('kind', 'symbol')}: {sym.get('name', qn)}",
                "details": sym,
            }
        )

    # --- Removed symbols ---
    removed = set(before_symbols.keys()) - set(after_symbols.keys())
    for qn in sorted(removed):
        sym = before_symbols[qn]
        findings.append(
            {
                "type": "symbol_removed",
                "description": f"Removed {sym.get('kind', 'symbol')}: {sym.get('name', qn)}",
                "details": sym,
            }
        )

    # --- Relation changes ---
    def _relation_key(r: dict) -> str:
        return f"{r.get('source')}--{r.get('relation_type')}-->{r.get('target')}"

    before_rels = {_relation_key(r): r for r in before_snapshot.get("relations", [])}
    after_rels = {_relation_key(r): r for r in after_snapshot.get("relations", [])}

    for key in sorted(set(after_rels.keys()) - set(before_rels.keys())):
        rel = after_rels[key]
        findings.append(
            {
                "type": "relation_added",
                "description": (
                    f"New {rel.get('relation_type', 'relation')}: "
                    f"{rel.get('source')} -> {rel.get('target')}"
                ),
                "details": rel,
            }
        )

    for key in sorted(set(before_rels.keys()) - set(after_rels.keys())):
        rel = before_rels[key]
        findings.append(
            {
                "type": "relation_removed",
                "description": (
                    f"Removed {rel.get('relation_type', 'relation')}: "
                    f"{rel.get('source')} -> {rel.get('target')}"
                ),
                "details": rel,
            }
        )

    # --- Count-level changes ---
    for metric in ("symbol_count", "relation_count"):
        before_val = before_snapshot.get(metric, 0)
        after_val = after_snapshot.get(metric, 0)
        if before_val != after_val:
            findings.append(
                {
                    "type": "count_change",
                    "description": f"{metric}: {before_val} -> {after_val}",
                    "details": {"metric": metric, "before": before_val, "after": after_val},
                }
            )

    log.info(
        "normalizer.structural_findings",
        finding_count=len(findings),
        added=len(added),
        removed=len(removed),
    )

    return findings
