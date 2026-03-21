export interface ApprovalGate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly triggers: readonly string[];
}

const GATES: readonly ApprovalGate[] = [
  {
    id: "package-modification",
    name: "Package Modification",
    description: "Triggered when package.json, lockfile, or infra config is changed.",
    triggers: ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "infra.config"],
  },
  {
    id: "secret-access",
    name: "Secret Access",
    description: "Triggered when secrets, tokens, credentials, or .env files are accessed.",
    triggers: [".env", "secret", "token", "credential"],
  },
  {
    id: "destructive-git",
    name: "Destructive Git",
    description: "Triggered on rm -rf, force push, or other destructive git operations.",
    triggers: ["rm -rf", "git push --force", "git push -f", "git reset --hard", "git clean -fd"],
  },
  {
    id: "external-effect",
    name: "External Effect",
    description: "Triggered on browser form submissions or external POST requests.",
    triggers: ["browser submit", "external POST", "fetch POST", "http POST"],
  },
  {
    id: "deploy-change",
    name: "Deploy Change",
    description: "Triggered on deploy, migration, DNS, or billing changes.",
    triggers: ["deploy", "migration", "DNS", "billing", "migrate"],
  },
] as const;

export interface ApprovalCheckResult {
  required: boolean;
  gate?: string;
  reason?: string;
}

/**
 * Checks whether a given action in context requires human approval.
 * Scans all gates for trigger matches against the action string and context values.
 */
export function checkApprovalRequired(
  action: string,
  context: Record<string, unknown>,
): ApprovalCheckResult {
  const searchable = buildSearchable(action, context);

  for (const gate of GATES) {
    for (const trigger of gate.triggers) {
      if (searchable.includes(trigger.toLowerCase())) {
        return {
          required: true,
          gate: gate.id,
          reason: `${gate.name}: matched trigger "${trigger}"`,
        };
      }
    }
  }

  return { required: false };
}

function buildSearchable(action: string, context: Record<string, unknown>): string {
  const parts: string[] = [action];
  for (const value of Object.values(context)) {
    if (typeof value === "string") {
      parts.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") parts.push(item);
      }
    }
  }
  return parts.join(" ").toLowerCase();
}

export { GATES as APPROVAL_GATES };
