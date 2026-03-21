import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { AuthRecord, AuthStorage } from "../types.js"

export class FileAuthStorage implements AuthStorage {
  constructor(private readonly filepath: string) {}

  async get(providerId: string): Promise<AuthRecord | undefined> {
    const records = await this.readAll()
    return records[providerId]
  }

  async set(providerId: string, record: AuthRecord): Promise<void> {
    const records = await this.readAll()
    records[providerId] = record
    await this.writeAll(records)
  }

  async remove(providerId: string): Promise<void> {
    const records = await this.readAll()
    delete records[providerId]
    await this.writeAll(records)
  }

  async list(): Promise<Record<string, AuthRecord>> {
    return this.readAll()
  }

  private async readAll(): Promise<Record<string, AuthRecord>> {
    try {
      const raw = await readFile(this.filepath, "utf8")
      return JSON.parse(raw) as Record<string, AuthRecord>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {}
      }
      throw error
    }
  }

  private async writeAll(records: Record<string, AuthRecord>): Promise<void> {
    await mkdir(dirname(this.filepath), { recursive: true })
    await writeFile(this.filepath, JSON.stringify(records, null, 2), {
      mode: 0o600,
    })
  }
}

