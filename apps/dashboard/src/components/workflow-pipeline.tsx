import { PipelineStats } from "@/lib/api";

const STAGES = [
  { key: "preK" as const, label: "Pre-K", sub: "Knowledge Retrieval", color: "text-purple-400", bg: "bg-purple-400", border: "border-purple-800" },
  { key: "dispatched" as const, label: "Dispatch", sub: "Task Assignment", color: "text-blue-400", bg: "bg-blue-400", border: "border-blue-800" },
  { key: "executing" as const, label: "Execute", sub: "AI Processing", color: "text-cyan-400", bg: "bg-cyan-400", border: "border-cyan-800" },
  { key: "postK" as const, label: "Post-K", sub: "Integrity Check", color: "text-amber-400", bg: "bg-amber-400", border: "border-amber-800" },
  { key: "review" as const, label: "Review", sub: "Approval Gate", color: "text-orange-400", bg: "bg-orange-400", border: "border-orange-800" },
  { key: "completed" as const, label: "Done", sub: "Completed", color: "text-green-400", bg: "bg-green-400", border: "border-green-800" },
];

export function WorkflowPipeline({ pipeline }: { pipeline: PipelineStats }) {
  const total = Math.max(
    pipeline.preK + pipeline.dispatched + pipeline.executing + pipeline.postK + pipeline.review + pipeline.completed + pipeline.failed,
    1
  );

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">AI Workflow Pipeline</h2>
        <span className="text-xs text-gray-500">{total} total tasks</span>
      </div>

      {/* Pipeline visualization */}
      <div className="flex items-center gap-1 mb-6">
        {STAGES.map((stage) => {
          const count = pipeline[stage.key];
          const pct = (count / total) * 100;
          return pct > 0 ? (
            <div
              key={stage.key}
              className={`h-2 rounded-full ${stage.bg} transition-all`}
              style={{ width: `${Math.max(pct, 3)}%`, opacity: 0.7 }}
              title={`${stage.label}: ${count}`}
            />
          ) : null;
        })}
        {pipeline.failed > 0 && (
          <div
            className="h-2 rounded-full bg-red-500 transition-all"
            style={{ width: `${Math.max((pipeline.failed / total) * 100, 3)}%`, opacity: 0.7 }}
            title={`Failed: ${pipeline.failed}`}
          />
        )}
      </div>

      {/* Stage cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {STAGES.map((stage, i) => {
          const count = pipeline[stage.key];
          const isActive = count > 0;
          return (
            <div key={stage.key} className="relative">
              <div className={`rounded-lg p-3 border ${isActive ? stage.border : "border-gray-800"} ${isActive ? "bg-gray-800" : "bg-gray-900"} text-center`}>
                <p className={`text-lg font-bold ${isActive ? stage.color : "text-gray-600"}`}>{count}</p>
                <p className={`text-xs font-medium ${isActive ? stage.color : "text-gray-600"}`}>{stage.label}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{stage.sub}</p>
              </div>
              {i < STAGES.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-2.5 transform -translate-y-1/2 text-gray-600 text-xs z-10">→</div>
              )}
            </div>
          );
        })}
      </div>

      {pipeline.failed > 0 && (
        <div className="mt-3 flex items-center gap-2 text-red-400 text-sm">
          <span>✗</span>
          <span>{pipeline.failed} failed tasks</span>
        </div>
      )}
    </div>
  );
}
