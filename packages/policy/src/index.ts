export { getCapabilities, hasCapability, requireCapability } from "./capabilities.js";
export {
  checkApprovalRequired,
  APPROVAL_GATES,
  type ApprovalGate,
  type ApprovalCheckResult,
} from "./approval-gates.js";
export {
  computeRiskScore,
  type RiskFactors,
  type RiskResult,
} from "./risk-scoring.js";
export {
  PolicyEngine,
  type PolicyInput,
  type PolicyDecision,
} from "./policy-engine.js";
