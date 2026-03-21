import type { MissionStatus, WaveStatus, TaskStatus, TaskRunStatus, SessionState } from "./enums.js";

// ---------------------------------------------------------------------------
// Transition maps
// ---------------------------------------------------------------------------

export const MISSION_TRANSITIONS: Record<MissionStatus, readonly MissionStatus[]> = {
  DRAFT:     ["PLANNED", "ABORTED"],
  PLANNED:   ["RUNNING", "ABORTED"],
  RUNNING:   ["REVIEWING", "FAILED", "ABORTED"],
  REVIEWING: ["COMPLETED", "RUNNING", "FAILED", "ABORTED"],
  COMPLETED: [],
  FAILED:    ["PLANNED", "ABORTED"],
  ABORTED:   [],
};

export const WAVE_TRANSITIONS: Record<WaveStatus, readonly WaveStatus[]> = {
  PENDING:   ["READY", "BLOCKED"],
  READY:     ["RUNNING"],
  RUNNING:   ["COMPLETED", "FAILED", "BLOCKED"],
  BLOCKED:   ["READY", "FAILED"],
  COMPLETED: [],
  FAILED:    ["READY"],
};

export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  QUEUED:       ["ASSIGNED", "BLOCKED", "CANCELLED"],
  ASSIGNED:     ["RUNNING", "BLOCKED", "CANCELLED"],
  RUNNING:      ["NEEDS_REVIEW", "SUCCEEDED", "FAILED", "BLOCKED", "CANCELLED"],
  NEEDS_REVIEW: ["SUCCEEDED", "FAILED", "RUNNING"],
  SUCCEEDED:    [],
  FAILED:       ["QUEUED", "CANCELLED"],
  BLOCKED:      ["QUEUED", "CANCELLED"],
  CANCELLED:    [],
};

export const TASK_RUN_TRANSITIONS: Record<TaskRunStatus, readonly TaskRunStatus[]> = {
  STARTING:  ["RUNNING", "FAILED", "ABORTED"],
  RUNNING:   ["SUCCEEDED", "FAILED", "TIMED_OUT", "ABORTED"],
  SUCCEEDED: [],
  FAILED:    [],
  TIMED_OUT: [],
  ABORTED:   [],
};

export const SESSION_TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  IDLE:    ["BOUND", "CLOSED"],
  BOUND:   ["RUNNING", "IDLE", "CLOSED"],
  RUNNING: ["IDLE", "STALE", "CLOSED"],
  STALE:   ["RUNNING", "LOST", "CLOSED"],
  LOST:    ["CLOSED"],
  CLOSED:  [],
};

// ---------------------------------------------------------------------------
// Transition helpers
// ---------------------------------------------------------------------------

type TransitionMap<S extends string> = Record<S, readonly S[]>;

/**
 * Returns true if the transition from `from` to `to` is valid in the given machine.
 */
export function canTransition<S extends string>(
  machine: TransitionMap<S>,
  from: S,
  to: S,
): boolean {
  const allowed = machine[from];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(to);
}

/**
 * Throws if the transition from `from` to `to` is not valid in the given machine.
 */
export function assertTransition<S extends string>(
  machine: TransitionMap<S>,
  from: S,
  to: S,
): void {
  if (!canTransition(machine, from, to)) {
    const allowed = machine[from];
    throw new Error(
      `Invalid state transition: ${from} -> ${to}. Allowed transitions from ${from}: [${(allowed ?? []).join(", ")}]`,
    );
  }
}
