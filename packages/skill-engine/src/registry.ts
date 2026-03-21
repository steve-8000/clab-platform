import type { SkillBundle } from "@clab/domain";
import { BUILTIN_SKILLS } from "./builtin-skills.js";
import { loadSkillsFromDir } from "./loader.js";

export class SkillRegistry {
  private skills = new Map<string, SkillBundle>();

  constructor() {
    for (const skill of BUILTIN_SKILLS) {
      this.skills.set(skill.id, skill);
    }
  }

  async loadCustomSkills(dirPath: string): Promise<void> {
    const custom = await loadSkillsFromDir(dirPath);
    for (const [id, skill] of custom) {
      this.skills.set(id, skill);
    }
  }

  get(skillId: string): SkillBundle | undefined { return this.skills.get(skillId); }
  list(): SkillBundle[] { return Array.from(this.skills.values()); }
  has(skillId: string): boolean { return this.skills.has(skillId); }

  getForRole(roleSkills: string[]): SkillBundle[] {
    return roleSkills.map(id => this.skills.get(id)).filter((s): s is SkillBundle => !!s);
  }
}
