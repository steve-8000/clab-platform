import type { RiskLevel } from "@clab/domain";

export interface RiskFactors {
  filesChanged: number;
  hasInfraChanges: boolean;
  hasSecretAccess: boolean;
  hasExternalEffects: boolean;
  hasDestructiveOps: boolean;
  retryCount: number;
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  reasons: string[];
}

/**
 * Computes a risk score (0-100) from the given factors.
 *
 * Scoring:
 *  - filesChanged:       +1 per file, capped at 20
 *  - hasInfraChanges:    +20
 *  - hasSecretAccess:    +25
 *  - hasExternalEffects: +15
 *  - hasDestructiveOps:  +30
 *  - retryCount:         +5 per retry, capped at 15
 *
 * Levels: LOW < 30, MEDIUM < 70, HIGH >= 70
 */
export function computeRiskScore(factors: RiskFactors): RiskResult {
  let score = 0;
  const reasons: string[] = [];

  // files changed
  const fileScore = Math.min(factors.filesChanged, 20);
  if (fileScore > 0) {
    score += fileScore;
    reasons.push(`${factors.filesChanged} file(s) changed (+${fileScore})`);
  }

  // infra changes
  if (factors.hasInfraChanges) {
    score += 20;
    reasons.push("Infrastructure changes detected (+20)");
  }

  // secret access
  if (factors.hasSecretAccess) {
    score += 25;
    reasons.push("Secret/credential access detected (+25)");
  }

  // external effects
  if (factors.hasExternalEffects) {
    score += 15;
    reasons.push("External side-effects detected (+15)");
  }

  // destructive ops
  if (factors.hasDestructiveOps) {
    score += 30;
    reasons.push("Destructive operations detected (+30)");
  }

  // retries
  const retryScore = Math.min(factors.retryCount * 5, 15);
  if (retryScore > 0) {
    score += retryScore;
    reasons.push(`${factors.retryCount} retry attempt(s) (+${retryScore})`);
  }

  // clamp
  score = Math.min(score, 100);

  const level: RiskLevel = score < 30 ? "LOW" : score < 70 ? "MEDIUM" : "HIGH";

  return { score, level, reasons };
}
