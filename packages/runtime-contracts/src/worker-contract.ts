export const WORKER_EVENTS = {
  TASK_ASSIGNED: "worker.task.assigned",
  TASK_STARTED: "worker.task.started",
  TOOL_STARTED: "worker.tool.started",
  TOOL_RESULT: "worker.tool.result",
  ARTIFACT_PRODUCED: "worker.artifact.produced",
  TASK_BLOCKED: "worker.task.blocked",
  TASK_COMPLETED: "worker.task.completed",
  TASK_FAILED: "worker.task.failed",
  HEARTBEAT: "worker.heartbeat",
} as const;

export type WorkerEvent = typeof WORKER_EVENTS[keyof typeof WORKER_EVENTS];
