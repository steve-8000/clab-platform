import type { Task } from "@/types";
import { StatusBadge } from "@/components/ui/status-badge";

export function TaskTable({ tasks, waveIndex }: { tasks: Task[]; waveIndex: number }) {
  if (tasks.length === 0) {
    return <p className="text-sm text-gray-500 py-2">No tasks in this wave</p>;
  }

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-800 bg-gray-900/50">
        <h4 className="text-sm font-medium text-gray-300">Wave {waveIndex + 1} Tasks</h4>
      </div>
      <div className="divide-y divide-gray-800">
        {tasks.map((task) => (
          <div key={task.id} className="px-4 py-3 flex items-center gap-4">
            <StatusBadge status={task.status} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200 truncate">{task.description}</p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-gray-500">
                  <span className="text-gray-400">{task.role}</span>
                </span>
                <span className="text-xs text-gray-500">
                  engine: <span className="text-gray-400">{task.engine}</span>
                </span>
              </div>
            </div>
            {task.completedAt && (
              <span className="text-xs text-gray-500 shrink-0">
                {new Date(task.completedAt).toLocaleString()}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
