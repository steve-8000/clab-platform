import type { RoleDefinition } from "@clab/domain";

export function canPerformAction(role: RoleDefinition, action: string): boolean {
  if (role.blockedActions.includes(action)) return false;
  if (role.allowedActions.includes(action)) return true;
  if (role.allowedActions.includes("*")) return true;
  return false;
}

export function requiresApproval(role: RoleDefinition, action: string): boolean {
  if (role.blockedActions.includes(action)) return true;
  if (role.reviewPolicy === "mandatory") return true;
  return false;
}

export function canDispatchTo(sourceRole: RoleDefinition, targetRole: RoleDefinition): boolean {
  if (sourceRole.authorityLevel === "c_level") return true;
  if (sourceRole.authorityLevel === "manager" && targetRole.reportsTo === sourceRole.id) return true;
  return false;
}
