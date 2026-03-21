import { parse } from "yaml";
import { SkillBundleSchema, type SkillBundle } from "@clab/domain";

export async function loadSkill(yamlContent: string): Promise<SkillBundle> {
  const raw = parse(yamlContent);
  return SkillBundleSchema.parse(raw);
}

export async function loadSkillsFromDir(dirPath: string): Promise<Map<string, SkillBundle>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const skills = new Map<string, SkillBundle>();
  try {
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      if (file.endsWith(".yaml") || file.endsWith(".yml")) {
        const content = await fs.readFile(path.join(dirPath, file), "utf-8");
        const skill = await loadSkill(content);
        skills.set(skill.id, skill);
      }
    }
  } catch {}
  return skills;
}
