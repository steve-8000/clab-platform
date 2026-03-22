import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(rel) {
  return readFileSync(resolve(root, rel), "utf8");
}

function assertContains(text, pattern, label) {
  if (!pattern.test(text)) {
    throw new Error(`missing: ${label}`);
  }
}

const checks = [
  {
    file: "packages/domain/dist/enums.js",
    patterns: [
      [/TaskRunStatus/, "TaskRunStatus enum"],
      [/"PENDING"/, "PENDING status"],
      [/"ASSIGNED"/, "ASSIGNED status"],
      [/"BLOCKED"/, "BLOCKED status"],
      [/"CANCELLED"/, "CANCELLED status"],
    ],
  },
  {
    file: "packages/domain/dist/state-machines.js",
    patterns: [
      [/TASK_RUN_TRANSITIONS/, "TaskRun transitions map"],
      [/PENDING:\s*\["ASSIGNED",\s*"CANCELLED"\]/, "PENDING transition"],
      [/RUNNING:\s*\["SUCCEEDED",\s*"FAILED",\s*"TIMED_OUT",\s*"BLOCKED",\s*"CANCELLED"\]/, "RUNNING transition"],
    ],
  },
  {
    file: "packages/events/dist/envelope.js",
    patterns: [
      [/schemaVersion/, "schemaVersion field"],
      [/aggregateType/, "aggregateType field"],
      [/traceId/, "traceId field"],
      [/correlationId/, "correlationId field"],
    ],
  },
  {
    file: "apps/orchestrator/dist/routes/missions.js",
    patterns: [
      [/mission\.execution\.requested/, "execution request event"],
      [/DUPLICATE_IGNORED/, "idempotent duplicate response"],
      [/approval\.requested/, "approval requested event"],
      [/requiredCapabilities/, "requiredCapabilities payload"],
    ],
  },
  {
    file: "apps/runtime-manager/dist/heartbeat.js",
    patterns: [
      [/STALE_THRESHOLD_MS = 90_000/, "heartbeat timeout 90s"],
      [/TASK_EXECUTION_TIMEOUT_MS/, "execution timeout config"],
    ],
  },
  {
    file: "apps/runtime-manager/dist/app.js",
    patterns: [
      [/\/workers\/register/, "worker register endpoint"],
      [/\/workers\/select/, "worker select endpoint"],
    ],
  },
  {
    file: "apps/worker-codex/dist/app.js",
    patterns: [
      [/execution_request_id:/, "worker idempotency marker"],
      [/DUPLICATE_IGNORED/, "worker duplicate guard"],
      [/degraded/, "worker degraded path"],
    ],
  },
  {
    file: "docs/cutover-execution-spec-v4.md",
    patterns: [
      [/at-least-once/, "delivery semantics"],
      [/Cutover Exit Criteria/, "cutover exit criteria"],
      [/Track A switches to read-only bridge mode/, "legacy bridge retirement"],
    ],
  },
];

for (const check of checks) {
  const content = read(check.file);
  for (const [pattern, label] of check.patterns) {
    assertContains(content, pattern, `${check.file} :: ${label}`);
  }
}

console.log("validate-cutover-v4: OK");
