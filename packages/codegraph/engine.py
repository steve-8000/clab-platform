"""Abstract base class for code intelligence engines."""

from __future__ import annotations

import abc

from .models import (
    CallRelations,
    ComplexitySignal,
    DeadCodeCandidate,
    ImpactResult,
    IndexResult,
    RepoSummary,
    SymbolResult,
)


class CodeIntelEngine(abc.ABC):
    """Abstract interface for code intelligence backends.

    Concrete implementations adapt specific tools (e.g. CGC CLI, direct DB
    access) behind a uniform async API consumed by the clab platform.
    """

    @abc.abstractmethod
    async def index_repository(
        self, repo_path: str, force: bool = False
    ) -> IndexResult:
        """Index (or re-index) a repository."""
        ...

    @abc.abstractmethod
    async def get_repository_summary(self, repo_path: str) -> RepoSummary:
        """Return high-level statistics for an indexed repository."""
        ...

    @abc.abstractmethod
    async def search_symbols(
        self,
        repo_path: str,
        query: str,
        kind: str | None = None,
        limit: int = 20,
    ) -> list[SymbolResult]:
        """Search for symbols by name, optionally filtered by type."""
        ...

    @abc.abstractmethod
    async def get_impact_analysis(
        self, repo_path: str, target: str, file_path: str | None = None
    ) -> ImpactResult:
        """Analyse callers, callees, dependents, and importers of *target*."""
        ...

    @abc.abstractmethod
    async def get_call_relations(
        self,
        function_name: str,
        file_path: str | None = None,
        direction: str = "both",
    ) -> CallRelations:
        """Return caller / callee relations for *function_name*.

        *direction* may be ``"callers"``, ``"callees"``, or ``"both"``.
        """
        ...

    @abc.abstractmethod
    async def get_complexity_signals(
        self, repo_path: str | None = None, limit: int = 20
    ) -> list[ComplexitySignal]:
        """Return functions ranked by cyclomatic complexity."""
        ...

    @abc.abstractmethod
    async def get_dead_code_candidates(
        self, repo_path: str | None = None
    ) -> list[DeadCodeCandidate]:
        """Return potentially unused functions/classes."""
        ...
