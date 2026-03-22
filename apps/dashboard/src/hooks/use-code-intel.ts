"use client";

import { useCallback, useEffect, useState } from "react";
import { ci } from "@/lib/api";
import type {
  ContextBundle,
  Hotspot,
  ImpactAnalysis,
  RepoSnapshot,
  RepoSummary,
  Repository,
  StructuralFinding,
  SymbolNode,
} from "@/types";

export interface GraphExplorerFilters {
  query: string;
  symbolType: string;
  relationType: string;
  depth: 1 | 2 | 3;
  changedOnly: boolean;
}

export interface GraphExplorerNode extends SymbolNode {
  packageName: string;
  changed: boolean;
}

interface GraphExplorerRelationGroup {
  relation: string;
  items: string[];
  depth: 1 | 2 | 3;
}

interface GraphExplorerPackage {
  name: string;
  files: Set<string>;
  symbolCount: number;
  changedCount: number;
}

interface GraphExplorerFile {
  path: string;
  packageName: string;
  symbolCount: number;
  changedCount: number;
}

function toPackageName(filePath: string) {
  const normalized = filePath.replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 1) return "(root)";
  return segments.slice(0, -1).join("/");
}

function inferChanged(metadata: Record<string, unknown> | null | undefined) {
  const changed = metadata?.changed;
  if (typeof changed === "boolean") return changed;
  const gitStatus = metadata?.git_status;
  return typeof gitStatus === "string" && gitStatus !== "unchanged";
}

function normalizeHotspot(input: Partial<Hotspot> & Record<string, unknown>): Hotspot {
  const filePath =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.file === "string"
        ? input.file
        : "";

  const numberOrZero = (value: unknown) => (typeof value === "number" ? value : 0);
  const metric = typeof input.metric === "string" ? input.metric : "complexity";
  const complexity = numberOrZero(input.complexity);
  const fanIn = numberOrZero(input.fan_in);
  const fanOut = numberOrZero(input.fan_out);
  const symbolCount = numberOrZero(input.symbol_count);
  const metricValue = typeof input.metric_value === "number"
    ? input.metric_value
    : metric === "fan_in"
      ? fanIn
      : metric === "fan_out"
        ? fanOut
        : metric === "symbol_count"
          ? symbolCount
          : complexity;

  return {
    file: typeof input.file === "string" ? input.file : filePath,
    file_path: filePath,
    symbol_count: symbolCount,
    metric,
    complexity,
    fan_in: fanIn,
    fan_out: fanOut,
    recent_changes: numberOrZero(input.recent_changes),
    review_failures: numberOrZero(input.review_failures),
    event_coupling: numberOrZero(input.event_coupling),
    metric_value: metricValue,
  };
}

function getRelationName(entry: unknown) {
  if (typeof entry === "string") return null;
  if (!entry || typeof entry !== "object") return null;
  const relation =
    ("relation_type" in entry && entry.relation_type) ||
    ("relation" in entry && entry.relation) ||
    ("type" in entry && entry.type);
  return typeof relation === "string" ? relation.toUpperCase() : null;
}

function getRelationTarget(entry: unknown) {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return null;
  const target =
    ("target" in entry && entry.target) ||
    ("target_symbol" in entry && entry.target_symbol) ||
    ("fq_name" in entry && entry.fq_name) ||
    ("name" in entry && entry.name) ||
    ("file_path" in entry && entry.file_path);
  return typeof target === "string" ? target : null;
}

function buildRelationGroups(
  inspector: ImpactAnalysis | null,
  contextBundle: ContextBundle | null,
): GraphExplorerRelationGroup[] {
  const groups: GraphExplorerRelationGroup[] = [];
  const byRelation = new Map<string, string[]>();

  if (contextBundle) {
    for (const relation of contextBundle.direct_relations) {
      const relationName = getRelationName(relation);
      const target = getRelationTarget(relation);
      if (!relationName || !target) continue;
      const items = byRelation.get(relationName) || [];
      items.push(target);
      byRelation.set(relationName, items);
    }
  }

  for (const [relation, items] of byRelation.entries()) {
    groups.push({ relation, items, depth: 1 });
  }

  if (inspector?.direct.length) {
    groups.push({ relation: "CALLS", items: inspector.direct, depth: 1 });
  }
  if (inspector?.transitive.length) {
    groups.push({ relation: "TRANSITIVE", items: inspector.transitive, depth: 2 });
  }
  if (inspector?.related_tests.length) {
    groups.push({ relation: "OWNS_TEST", items: inspector.related_tests, depth: 1 });
  }

  const merged = new Map<string, GraphExplorerRelationGroup>();
  for (const group of groups) {
    const existing = merged.get(group.relation);
    if (!existing) {
      merged.set(group.relation, {
        relation: group.relation,
        depth: group.depth,
        items: Array.from(new Set(group.items)),
      });
      continue;
    }

    existing.depth = Math.min(existing.depth, group.depth) as 1 | 2 | 3;
    existing.items = Array.from(new Set([...existing.items, ...group.items]));
  }

  return Array.from(merged.values());
}

export function useRepositories() {
  const [data, setData] = useState<Repository[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await ci.repositories();
      setData(Array.isArray(response) ? response : response.repositories || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    data,
    repositories: data,
    isLoading,
    loading: isLoading,
    error,
    refresh,
  };
}

export function useRepoSummary(repoId: string) {
  const [data, setData] = useState<RepoSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!repoId) {
      setData(null);
      setIsLoading(false);
      return;
    }
    try {
      const response = await ci.summary(repoId);
      setData(response || null);
    } catch {
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    setIsLoading(true);
    refresh();
  }, [refresh]);

  return { data, isLoading, refresh };
}

export function useSymbolSearch(repoId: string, query: string, symbolType: string) {
  const [data, setData] = useState<SymbolNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const search = useCallback(async () => {
    if (!repoId || !query.trim()) {
      setData([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await ci.searchSymbols(
        repoId,
        query.trim(),
        symbolType === "all" ? undefined : symbolType,
      );
      setData(response.symbols || []);
    } catch {
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [query, repoId, symbolType]);

  useEffect(() => {
    const timer = setTimeout(search, 300);
    return () => clearTimeout(timer);
  }, [search]);

  return { data, isLoading };
}

export function useSnapshots(repoId: string) {
  const [data, setData] = useState<RepoSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!repoId) {
      setData([]);
      setIsLoading(false);
      return;
    }
    try {
      const response = await ci.snapshots(repoId);
      setData(response.snapshots || []);
    } catch {
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    setIsLoading(true);
    refresh();
  }, [refresh]);

  return { data, isLoading, refresh };
}

export function useHotspots(repoId: string, metric?: string) {
  const [data, setData] = useState<Hotspot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!repoId) {
      setData([]);
      setIsLoading(false);
      return;
    }
    try {
      const response = await ci.hotspots(repoId, metric);
      const hotspots = Array.isArray(response) ? response : response.hotspots || [];
      setData(hotspots.map((hotspot: Record<string, unknown>) => normalizeHotspot(hotspot)));
    } catch {
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [metric, repoId]);

  useEffect(() => {
    setIsLoading(true);
    refresh();
  }, [refresh]);

  return { data, isLoading, refresh };
}

export function useImpact(repoId: string | null, target: string) {
  const [impact, setImpact] = useState<ImpactAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  const analyze = useCallback(async () => {
    if (!repoId || !target.trim()) {
      setImpact(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await ci.impact(repoId, target.trim());
      setImpact(response || null);
    } catch {
      setImpact(null);
    } finally {
      setLoading(false);
    }
  }, [repoId, target]);

  return { impact, loading, analyze };
}

export function useStructuralFindings(reviewId: string) {
  const [data, setData] = useState<StructuralFinding[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!reviewId) {
      setData([]);
      setIsLoading(false);
      return;
    }

    try {
      const response = await ci.structuralFindings(reviewId);
      setData(Array.isArray(response) ? response : response.findings || []);
    } catch {
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [reviewId]);

  useEffect(() => {
    if (!reviewId) {
      setData([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    refresh();
  }, [refresh, reviewId]);

  return { data, isLoading, refresh };
}

export function useGraphExplorer(repoId: string, filters: GraphExplorerFilters) {
  const { data: symbols, isLoading: searchLoading } = useSymbolSearch(
    repoId,
    filters.query,
    filters.symbolType,
  );
  const [selectedSymbol, setSelectedSymbol] = useState<GraphExplorerNode | null>(null);
  const [inspector, setInspector] = useState<ImpactAnalysis | null>(null);
  const [contextBundle, setContextBundle] = useState<ContextBundle | null>(null);
  const [inspectorLoading, setInspectorLoading] = useState(false);

  const graphSymbols: GraphExplorerNode[] = symbols
    .map((symbol): GraphExplorerNode => ({
      ...symbol,
      packageName: toPackageName(symbol.file_path),
      changed: inferChanged(symbol.metadata),
    }))
    .filter((symbol) => !filters.changedOnly || symbol.changed);

  const packageMap = new Map<string, GraphExplorerPackage>();
  const fileMap = new Map<string, GraphExplorerFile>();

  for (const symbol of graphSymbols) {
    const pkg = packageMap.get(symbol.packageName) ?? {
      name: symbol.packageName,
      files: new Set<string>(),
      symbolCount: 0,
      changedCount: 0,
    };
    pkg.files.add(symbol.file_path);
    pkg.symbolCount += 1;
    pkg.changedCount += symbol.changed ? 1 : 0;
    packageMap.set(symbol.packageName, pkg);

    const file = fileMap.get(symbol.file_path) ?? {
      path: symbol.file_path,
      packageName: symbol.packageName,
      symbolCount: 0,
      changedCount: 0,
    };
    file.symbolCount += 1;
    file.changedCount += symbol.changed ? 1 : 0;
    fileMap.set(symbol.file_path, file);
  }

  const packages = Array.from(packageMap.values());
  const files = Array.from(fileMap.values());

  useEffect(() => {
    if (!selectedSymbol) return;
    const stillVisible = graphSymbols.some(
      (symbol) =>
        symbol.id === selectedSymbol.id &&
        symbol.file_path === selectedSymbol.file_path &&
        symbol.line_number === selectedSymbol.line_number,
    );
    if (!stillVisible) {
      setSelectedSymbol(null);
      setInspector(null);
      setContextBundle(null);
    }
  }, [graphSymbols, selectedSymbol]);

  const loadInspector = useCallback(
    async (symbol: GraphExplorerNode | null) => {
      setSelectedSymbol(symbol);
      setContextBundle(null);
      if (!repoId || !symbol) {
        setInspector(null);
        setInspectorLoading(false);
        return;
      }

      setInspectorLoading(true);
      try {
        const response = await ci.impact(repoId, symbol.fq_name || symbol.name);
        setInspector(response || null);
        const taskRunId = typeof symbol.metadata?.task_run_id === "string"
          ? symbol.metadata.task_run_id
          : null;
        if (taskRunId) {
          const bundleResponse = await ci.contextBundle(taskRunId);
          setContextBundle(bundleResponse.context_bundle || bundleResponse || null);
        }
      } catch {
        setInspector(null);
        setContextBundle(null);
      } finally {
        setInspectorLoading(false);
      }
    },
    [repoId],
  );

  const related = buildRelationGroups(inspector, contextBundle)
    .filter((group) => filters.depth >= group.depth)
    .filter((group) => {
      if (filters.relationType === "ALL") return true;
      return group.relation === filters.relationType;
    })
    .filter((group) => group.items.length > 0);

  return {
    packages,
    files,
    symbols: graphSymbols,
    inspector,
    inspectorLoading,
    contextBundle,
    searchLoading,
    selectedSymbol,
    setSelectedSymbol: loadInspector,
    clearSelection: () => {
      setSelectedSymbol(null);
      setInspector(null);
      setContextBundle(null);
    },
    related,
  };
}
