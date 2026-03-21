import { parse } from "yaml";
import { RoleDefinitionSchema, type RoleDefinition } from "@clab/domain";

export async function loadRole(yamlContent: string): Promise<RoleDefinition> {
  const raw = parse(yamlContent);
  return RoleDefinitionSchema.parse(raw);
}

export async function loadRolesFromDir(dirPath: string): Promise<Map<string, RoleDefinition>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const roles = new Map<string, RoleDefinition>();

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const yamlPath = path.join(dirPath, entry.name, "role.yaml");
        try {
          const content = await fs.readFile(yamlPath, "utf-8");
          const role = await loadRole(content);
          roles.set(role.id, role);
        } catch { /* skip if no role.yaml */ }
      }
    }
  } catch { /* dir doesn't exist */ }

  return roles;
}
