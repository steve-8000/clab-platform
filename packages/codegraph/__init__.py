"""codegraph -- adapter package for CGC (CodeGraphContext) integration."""

from .cli_adapter import CgcCliEngineAdapter
from .engine import CodeIntelEngine
from .models import (
    CallRelations,
    ComplexitySignal,
    DeadCodeCandidate,
    ImpactResult,
    IndexResult,
    RelationEdge,
    RepoSummary,
    SymbolNode,
    SymbolResult,
)
from .normalizer import (
    build_context_bundle,
    extract_structural_findings,
    normalize_relation,
    normalize_symbol,
)

__all__ = [
    # Engine
    "CodeIntelEngine",
    "CgcCliEngineAdapter",
    # Models
    "CallRelations",
    "ComplexitySignal",
    "DeadCodeCandidate",
    "ImpactResult",
    "IndexResult",
    "RelationEdge",
    "RepoSummary",
    "SymbolNode",
    "SymbolResult",
    # Normalizer
    "build_context_bundle",
    "extract_structural_findings",
    "normalize_relation",
    "normalize_symbol",
]
