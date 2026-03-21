import type { Role, RiskLevel, Capability } from "@clab/domain";
import { hasCapability, getCapabilities } from "./capabilities.js";
import { checkApprovalRequired } from "./approval-gates.js";
import { computeRiskScore } from "./risk-scoring.js";
import type { RiskFactors } from "./risk-scoring.js";

export interface PolicyInput {
  role: Role;
  action: string;
  context: Record<string, unknown>;
}

export interface PolicyDecision {
  allow: boolean;
  reason: string;
  requiredApprovalGate?: string;
  riskScore?: number;
  riskLevel?: RiskLevel;
}

/**
 * Central policy decision engine combining RBAC capabilities,
 * approval gates, and risk scoring into a single evaluate() call.
 */
export class PolicyEngine {
  evaluate(input: PolicyInput): PolicyDecision {
    const { role, action, context } = input;

    // 1. Capability check — infer required capability from action
    const requiredCap = this.inferCapability(action, context);
    if (requiredCap && !hasCapability(role, requiredCap)) {
      return {
        allow: false,
        reason: `Role "${role}" lacks capability "${requiredCap}" required for action "${action}". Allowed: [${getCapabilities(role).join(", ")}]`,
      };
    }

    // 2. Risk scoring
    const factors = this.extractRiskFactors(context);
    const risk = computeRiskScore(factors);

    // 3. Approval gate check
    const approval = checkApprovalRequired(action, context);
    if (approval.required) {
      return {
        allow: false,
        reason: `Approval required — ${approval.reason}`,
        requiredApprovalGate: approval.gate,
        riskScore: risk.score,
        riskLevel: risk.level,
      };
    }

    // 4. High-risk auto-block (unless role can approve high risk)
    if (risk.level === "HIGH" && !hasCapability(role, "APPROVE_HIGH_RISK")) {
      return {
        allow: false,
        reason: `Risk level HIGH (score ${risk.score}) — requires human approval. Reasons: ${risk.reasons.join("; ")}`,
        riskScore: risk.score,
        riskLevel: risk.level,
      };
    }

    // 5. Allow
    return {
      allow: true,
      reason: "Policy check passed",
      riskScore: risk.score,
      riskLevel: risk.level,
    };
  }

  private inferCapability(
    action: string,
    context: Record<string, unknown>,
  ): Capability | undefined {
    const lower = action.toLowerCase();
    const ctx = JSON.stringify(context).toLowerCase();
    const combined = `${lower} ${ctx}`;

    if (/\b(write|create|edit|delete|modify|patch)\b/.test(combined)) {
      return "WRITE_WORKSPACE";
    }
    if (/\b(exec|shell|run|command|bash)\b/.test(combined)) {
      return "EXEC_SHELL";
    }
    if (/\b(browse|browser|navigate|screenshot)\b/.test(combined)) {
      return "BROWSER_ACT";
    }
    if (/\b(read|view|list|search|grep)\b/.test(combined)) {
      return "READ_CONTEXT";
    }
    return undefined;
  }

  private extractRiskFactors(context: Record<string, unknown>): RiskFactors {
    const filesChanged = typeof context["filesChanged"] === "number"
      ? context["filesChanged"]
      : Array.isArray(context["files"])
        ? (context["files"] as unknown[]).length
        : 0;

    const asStr = JSON.stringify(context).toLowerCase();

    return {
      filesChanged,
      hasInfraChanges: asStr.includes("infra") || asStr.includes("terraform") || asStr.includes("cloudformation") || asStr.includes("docker"),
      hasSecretAccess: asStr.includes("secret") || asStr.includes(".env") || asStr.includes("token") || asStr.includes("credential"),
      hasExternalEffects: asStr.includes("external") || asStr.includes("post") || asStr.includes("submit"),
      hasDestructiveOps: asStr.includes("rm -rf") || asStr.includes("force push") || asStr.includes("--force") || asStr.includes("reset --hard"),
      retryCount: typeof context["retryCount"] === "number" ? context["retryCount"] : 0,
    };
  }
}
