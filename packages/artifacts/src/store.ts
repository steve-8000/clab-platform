import type { ArtifactManifest } from "./manifest.js";

export interface ArtifactStore {
  save(manifest: ArtifactManifest, content: Buffer | string): Promise<string>;
  read(uri: string): Promise<{ manifest: ArtifactManifest; content: Buffer }>;
  list(missionId: string): Promise<ArtifactManifest[]>;
  delete(uri: string): Promise<void>;
}

export class LocalArtifactStore implements ArtifactStore {
  constructor(private basePath: string) {}

  async save(manifest: ArtifactManifest, content: Buffer | string): Promise<string> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.join(this.basePath, manifest.missionId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${manifest.id}-${manifest.type.toLowerCase()}`);
    await fs.writeFile(filePath, content);
    await fs.writeFile(`${filePath}.manifest.json`, JSON.stringify(manifest, null, 2));
    return filePath;
  }

  async read(uri: string): Promise<{ manifest: ArtifactManifest; content: Buffer }> {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(uri);
    const manifestRaw = await fs.readFile(`${uri}.manifest.json`, "utf-8");
    return { manifest: JSON.parse(manifestRaw), content };
  }

  async list(missionId: string): Promise<ArtifactManifest[]> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.join(this.basePath, missionId);
    try {
      const files = await fs.readdir(dir);
      const manifests: ArtifactManifest[] = [];
      for (const f of files) {
        if (f.endsWith(".manifest.json")) {
          const raw = await fs.readFile(path.join(dir, f), "utf-8");
          manifests.push(JSON.parse(raw));
        }
      }
      return manifests;
    } catch {
      return [];
    }
  }

  async delete(uri: string): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.rm(uri, { force: true });
    await fs.rm(`${uri}.manifest.json`, { force: true });
  }
}
