"""CgcCliEngineAdapter -- adapts the CGC CLI binary to the CodeIntelEngine interface."""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from typing import Any

import structlog

from .engine import CodeIntelEngine
from .models import (
    CallRelations,
    ComplexitySignal,
    DeadCodeCandidate,
    ImpactResult,
    IndexResult,
    RepoSummary,
    SymbolResult,
)

log = structlog.get_logger(__name__)


class CgcCliEngineAdapter(CodeIntelEngine):
    """Wraps the ``cgc`` CLI binary behind the :class:`CodeIntelEngine` API.

    All subprocess invocations are async (via :func:`asyncio.create_subprocess_exec`)
    and failures are caught gracefully -- methods return empty/error results
    instead of raising.
    """

    def __init__(
        self,
        cgc_binary_path: str = "cgc",
        timeout_index: int = 300,
        timeout_query: int = 60,
    ) -> None:
        self.cgc_binary_path = cgc_binary_path
        self.timeout_index = timeout_index
        self.timeout_query = timeout_query

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _run_cgc(self, args: list[str], timeout: int) -> str:
        """Run a ``cgc`` subprocess, capture stdout, handle errors/timeout.

        Returns the stripped stdout on success or an empty string on failure.
        """
        cmd = [self.cgc_binary_path, *args]
        log.debug("cgc.run", cmd=cmd, timeout=timeout)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(), timeout=timeout
            )
        except asyncio.TimeoutError:
            log.error("cgc.timeout", cmd=cmd, timeout=timeout)
            try:
                proc.kill()  # type: ignore[possibly-undefined]
            except Exception:
                pass
            return ""
        except FileNotFoundError:
            log.error("cgc.not_found", binary=self.cgc_binary_path)
            return ""
        except Exception as exc:
            log.error("cgc.error", cmd=cmd, error=str(exc))
            return ""

        stdout = stdout_bytes.decode("utf-8", errors="replace").strip()
        stderr = stderr_bytes.decode("utf-8", errors="replace").strip()

        if proc.returncode != 0:
            log.warning(
                "cgc.nonzero_exit",
                cmd=cmd,
                returncode=proc.returncode,
                stderr=stderr[:500],
            )

        if stderr:
            log.debug("cgc.stderr", stderr=stderr[:500])

        # CGC outputs Rich tables to stderr; combine both streams
        combined = stdout
        if stderr:
            combined = (stdout + chr(10) + stderr) if stdout else stderr
        return combined

    @staticmethod
    def _clean_rich(raw: str) -> str:
        """Strip ANSI codes and normalize Unicode box-drawing characters."""
        # Remove ANSI escape sequences
        cleaned = re.sub(r"\[[0-9;]*m", "", raw)
        # Replace all Unicode box-drawing chars with ASCII equivalents
        cleaned = re.sub(r"[┃┏┓┗┛┡┩┣┫┻┳╋━┠┨╭╮╰╯╰╮─╌╍]", "", cleaned)
        cleaned = cleaned.replace("│", "|")
        cleaned = cleaned.replace("├", "|")
        cleaned = cleaned.replace("┤", "|")
        cleaned = cleaned.replace("┼", "|")
        cleaned = cleaned.replace("╡", "|")
        cleaned = cleaned.replace("╞", "|")
        return cleaned

    @staticmethod
    def _merge_rich_rows(output: str) -> list[str]:
        """Merge multiline Rich table rows into single lines.
        
        CGC wraps long cell values across multiple lines. Continuation
        lines start with │ and have empty first columns.
        """
        cleaned_lines: list[str] = []
        for line in output.splitlines():
            cleaned = CgcCliEngineAdapter._clean_rich(line).strip()
            if not cleaned:
                continue
            # Detect continuation row: starts with | and first column is empty
            parts = [p.strip() for p in cleaned.split("|") if p.strip() != ""]
            # Check if this looks like a continuation (empty first cell)
            raw_parts = cleaned.split("|")
            is_continuation = (
                len(raw_parts) >= 3
                and raw_parts[0].strip() == ""
                and raw_parts[1].strip() == ""
                and cleaned_lines
            )
            if is_continuation and cleaned_lines:
                # Append content to previous line
                cleaned_lines[-1] = cleaned_lines[-1].rstrip() + " " + " ".join(p.strip() for p in raw_parts[2:] if p.strip())
            else:
                cleaned_lines.append(cleaned)
        return cleaned_lines

    def _try_parse_json(self, raw: str) -> Any:
        """Best-effort JSON parse; returns *None* on failure."""
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            log.debug("cgc.json_parse_failed", raw_head=raw[:200])
            return None

    # ------------------------------------------------------------------
    # CodeIntelEngine implementation
    # ------------------------------------------------------------------

    async def index_repository(
        self, repo_path: str, force: bool = False
    ) -> IndexResult:
        args = ["index", repo_path]
        if force:
            args.append("--force")

        job_id = uuid.uuid4().hex[:12]
        log.info("cgc.index_repository", repo_path=repo_path, force=force, job_id=job_id)

        output = await self._run_cgc(args, timeout=self.timeout_index)

        if not output:
            return IndexResult(
                job_id=job_id, status="error", message="No output from cgc index"
            )

        # Detect common success/skip patterns in Rich-formatted output
        status = "completed"
        if "already indexed" in output.lower() or "skipping" in output.lower():
            status = "skipped"
        elif "error" in output.lower():
            status = "error"

        return IndexResult(job_id=job_id, status=status, message=output[:500])

    async def get_repository_summary(self, repo_path: str) -> RepoSummary:
        output = await self._run_cgc(["stats", repo_path], timeout=self.timeout_query)

        if not output:
            return RepoSummary(repo_path=repo_path)

        # CGC stats outputs a Rich table.  Try JSON first, then parse text.
        data = self._try_parse_json(output)
        if isinstance(data, dict):
            return RepoSummary(
                repo_path=repo_path,
                file_count=int(data.get("files", data.get("file_count", 0))),
                function_count=int(data.get("functions", data.get("function_count", 0))),
                class_count=int(data.get("classes", data.get("class_count", 0))),
                module_count=int(data.get("modules", data.get("module_count", 0))),
                languages=data.get("languages", []),
            )

        # Fallback: parse Rich table text output
        summary = RepoSummary(repo_path=repo_path)
        for line in output.splitlines():
            cleaned = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
            lower = cleaned.lower()
            # Match lines like "Files  | 42" or "Files    42"
            match = re.search(r"(\d+)\s*$", cleaned)
            if match:
                val = int(match.group(1))
                if "file" in lower:
                    summary.file_count = val
                elif "function" in lower:
                    summary.function_count = val
                elif "class" in lower:
                    summary.class_count = val
                elif "module" in lower:
                    summary.module_count = val

        return summary

    async def search_symbols(
        self,
        repo_path: str,
        query: str,
        kind: str | None = None,
        limit: int = 20,
    ) -> list[SymbolResult]:
        args = ["find", "name", query]
        if kind:
            args.extend(["--type", kind])
        # Note: cgc find name does not have --limit, but we include it for
        # forward compatibility; the adapter truncates the result list below.

        output = await self._run_cgc(args, timeout=self.timeout_query)
        if not output:
            return []

        data = self._try_parse_json(output)
        if isinstance(data, list):
            return [
                SymbolResult(
                    name=item.get("name", ""),
                    kind=item.get("type", item.get("kind", "")),
                    file_path=item.get("path", item.get("file_path", "")),
                    line_number=int(item.get("line_number", 0)),
                    language=item.get("language", ""),
                )
                for item in data[:limit]
            ]

        # Parse Rich table text output
        results: list[SymbolResult] = []
        for line in output.splitlines():
            cleaned = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
            # Skip header/separator lines
            if (
                not cleaned
                or cleaned.startswith("─")
                or cleaned.startswith("┌")
                or cleaned.startswith("├")
                or cleaned.startswith("└")
                or cleaned.startswith("-")
                or cleaned.startswith("+")
                or cleaned.startswith("╭")
                or cleaned.startswith("╰")
            ):
                continue
            # Try to extract columns separated by |
            parts = [p.strip() for p in cleaned.split("|") if p.strip()]
            if len(parts) >= 3:
                name_val = parts[0]
                kind_val = parts[1] if len(parts) > 1 else ""
                location = parts[2] if len(parts) > 2 else ""
                file_p, line_n = _parse_location(location)
                results.append(
                    SymbolResult(
                        name=name_val,
                        kind=kind_val,
                        file_path=file_p,
                        line_number=line_n,
                    )
                )
            if len(results) >= limit:
                break
        return results

    async def get_impact_analysis(
        self, repo_path: str, target: str, file_path: str | None = None
    ) -> ImpactResult:
        callers_args = ["analyze", "callers", target]
        callees_args = ["analyze", "calls", target]
        if file_path:
            callers_args.extend(["--file", file_path])
            callees_args.extend(["--file", file_path])

        callers_out, callees_out = await asyncio.gather(
            self._run_cgc(callers_args, timeout=self.timeout_query),
            self._run_cgc(callees_args, timeout=self.timeout_query),
        )

        callers = _parse_relation_output(callers_out, self._try_parse_json)
        callees = _parse_relation_output(callees_out, self._try_parse_json)

        return ImpactResult(
            target=target,
            callers=callers,
            callees=callees,
            dependents=callers,  # dependents approximated by callers
            importers=[],
        )

    async def get_call_relations(
        self,
        function_name: str,
        file_path: str | None = None,
        direction: str = "both",
    ) -> CallRelations:
        callers: list[dict] = []
        callees: list[dict] = []

        file_args = ["--file", file_path] if file_path else []

        if direction in ("callers", "both"):
            out = await self._run_cgc(
                ["analyze", "callers", function_name, *file_args],
                timeout=self.timeout_query,
            )
            callers = _parse_relation_output(out, self._try_parse_json)

        if direction in ("callees", "both"):
            out = await self._run_cgc(
                ["analyze", "calls", function_name, *file_args],
                timeout=self.timeout_query,
            )
            callees = _parse_relation_output(out, self._try_parse_json)

        return CallRelations(target=function_name, callers=callers, callees=callees)

    async def get_complexity_signals(
        self, repo_path: str | None = None, limit: int = 20
    ) -> list[ComplexitySignal]:
        args = ["analyze", "complexity"]
        if repo_path:
            args.append(repo_path)
        args.extend(["--limit", str(limit)])

        output = await self._run_cgc(args, timeout=self.timeout_query)
        if not output:
            return []

        data = self._try_parse_json(output)
        if isinstance(data, list):
            return [
                ComplexitySignal(
                    name=item.get("function_name", item.get("name", "")),
                    file_path=item.get("path", item.get("file_path", "")),
                    complexity_score=float(item.get("complexity", item.get("complexity_score", 0))),
                    line_count=int(item.get("line_count", item.get("line_number", 0))),
                )
                for item in data
            ]

        # Parse Rich table
        results: list[ComplexitySignal] = []
        for line in output.splitlines():
            cleaned = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
            parts = [p.strip() for p in cleaned.split("|") if p.strip()]
            if len(parts) >= 3:
                name_val = parts[0]
                try:
                    score = float(re.sub(r"[^\d.]", "", parts[1]))
                except (ValueError, IndexError):
                    continue
                file_p, line_n = _parse_location(parts[2] if len(parts) > 2 else "")
                results.append(
                    ComplexitySignal(
                        name=name_val,
                        file_path=file_p,
                        complexity_score=score,
                        line_count=line_n,
                    )
                )
        return results

    async def get_dead_code_candidates(
        self, repo_path: str | None = None
    ) -> list[DeadCodeCandidate]:
        args = ["analyze", "dead-code"]
        if repo_path:
            args.append(repo_path)

        output = await self._run_cgc(args, timeout=self.timeout_query)
        if not output:
            return []

        data = self._try_parse_json(output)
        if isinstance(data, dict):
            # CGC returns { potentially_unused_functions: [...] }
            items = data.get("potentially_unused_functions", [])
        elif isinstance(data, list):
            items = data
        else:
            items = None

        if items is not None:
            return [
                DeadCodeCandidate(
                    name=item.get("function_name", item.get("name", "")),
                    file_path=item.get("path", item.get("file_path", "")),
                    line_number=int(item.get("line_number", 0)),
                    kind=item.get("kind", "function"),
                )
                for item in items
            ]

        # Parse Rich table
        results: list[DeadCodeCandidate] = []
        for line in output.splitlines():
            cleaned = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
            parts = [p.strip() for p in cleaned.split("|") if p.strip()]
            if len(parts) >= 2:
                name_val = parts[0]
                file_p, line_n = _parse_location(parts[1])
                results.append(
                    DeadCodeCandidate(
                        name=name_val,
                        file_path=file_p,
                        line_number=line_n,
                        kind="function",
                    )
                )
        return results


# ------------------------------------------------------------------
# Module-level helpers
# ------------------------------------------------------------------


def _parse_location(location: str) -> tuple[str, int]:
    """Split ``'path/to/file.py:42'`` into ``('path/to/file.py', 42)``."""
    if ":" in location:
        parts = location.rsplit(":", 1)
        try:
            return parts[0], int(parts[1])
        except ValueError:
            return location, 0
    return location, 0


def _parse_relation_output(raw: str, json_parser: Any) -> list[dict]:
    """Parse caller/callee output from CGC (JSON or Rich table)."""
    if not raw:
        return []

    data = json_parser(raw)
    if isinstance(data, list):
        return data

    results: list[dict] = []
    for line in raw.splitlines():
        cleaned = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
        parts = [p.strip() for p in cleaned.split("|") if p.strip()]
        if len(parts) >= 2:
            name_val = parts[0]
            location = parts[1] if len(parts) > 1 else ""
            file_p, line_n = _parse_location(location)
            results.append(
                {
                    "name": name_val,
                    "file_path": file_p,
                    "line_number": line_n,
                }
            )
    return results
