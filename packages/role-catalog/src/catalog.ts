import type { RoleDefinition } from "@clab/domain";
import { BUILTIN_ROLES } from "./builtin-roles.js";
import { loadRolesFromDir } from "./loader.js";

export class RoleCatalog {
  private roles = new Map<string, RoleDefinition>();

  constructor() {
    for (const role of BUILTIN_ROLES) {
      this.roles.set(role.id, role);
    }
  }

  async loadCustomRoles(dirPath: string): Promise<void> {
    const custom = await loadRolesFromDir(dirPath);
    for (const [id, role] of custom) {
      this.roles.set(id, role);
    }
  }

  get(roleId: string): RoleDefinition | undefined { return this.roles.get(roleId); }
  list(): RoleDefinition[] { return Array.from(this.roles.values()); }
  has(roleId: string): boolean { return this.roles.has(roleId); }

  getByEngine(engine: string): RoleDefinition[] {
    return this.list().filter(r => r.defaultEngine === engine);
  }

  getSubordinates(roleId: string): RoleDefinition[] {
    return this.list().filter(r => r.reportsTo === roleId);
  }
}
