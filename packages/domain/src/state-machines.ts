import type { MissionStatus, WaveStatus, TaskStatus, TaskRunStatus, SessionState, MessageStatus, RoleStatus } from "./enums.js";

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
  STARTING:       ["RUNNING", "FAILED", "ABORTED"],
  RUNNING:        ["AWAITING_INPUT", "SUCCEEDED", "FAILED", "TIMED_OUT", "ABORTED"],
  AWAITING_INPUT: ["RUNNING", "SUCCEEDED", "FAILED", "ABORTED"],
  SUCCEEDED:      [],
  FAILED:         [],
  TIMED_OUT:      [],
  ABORTED:        [],
};

export const SESSION_TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  IDLE:           ["BOUND", "CLOSED"],
  BOUND:          ["RUNNING", "IDLE", "CLOSED"],
  RUNNING:        ["AWAITING_INPUT", "IDLE", "STALE", "CLOSED"],
  AWAITING_INPUT: ["RUNNING", "STALE", "CLOSED"],
  STALE:          ["RUNNING", "LOST", "CLOSED"],
  LOST:           ["CLOSED"],
  CLOSED:         [],
};

export const MESSAGE_TRANSITIONS: Record<MessageStatus, readonly MessageStatus[]> = {
  streaming:      ["done", "error", "awaiting_input", "interrupted"],
  awaiting_input: ["streaming", "done", "error", "interrupted"],
  interrupted:    ["streaming", "done"],
  done:           [],
  error:          [],
};

export const ROLE_STATUS_TRANSITIONS: Record<RoleStatus, readonly RoleStatus[]> = {
  idle:           ["working"],
  working:        ["awaiting_input", "done"],
  awaiting_input: ["working", "done"],
  done:           ["idle"],
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
