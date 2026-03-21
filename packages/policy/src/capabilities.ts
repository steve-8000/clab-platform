import type { Role, Capability } from "@clab/domain";

const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  PM: ["READ_CONTEXT"],
  OPERATIONS_REVIEWER: ["READ_CONTEXT", "EXEC_SHELL"],
  BUILDER: ["READ_CONTEXT", "WRITE_WORKSPACE", "EXEC_SHELL"],
  ARCHITECT: ["READ_CONTEXT", "WRITE_WORKSPACE"],
  STRATEGIST: ["READ_CONTEXT"],
  RESEARCH_ANALYST: ["READ_CONTEXT", "BROWSER_ACT"],
};

/**
 * Returns all capabilities granted to the given role.
 */
export function getCapabilities(role: Role): readonly Capability[] {
  return ROLE_CAPABILITIES[role] ?? [];
}

/**
 * Returns true if the role has the specified capability.
 */
export function hasCapability(role: Role, cap: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(cap) ?? false;
}

/**
 * Throws if the role does not possess the required capability.
 */
export function requireCapability(role: Role, cap: Capability): void {
  if (!hasCapability(role, cap)) {
    throw new Error(
      `Role "${role}" lacks required capability "${cap}"`,
    );
  }
}
