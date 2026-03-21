import type { AuthRecord, AuthStorage } from "../types.js"

export class MemoryAuthStorage implements AuthStorage {
  private readonly records = new Map<string, AuthRecord>()

  async get(providerId: string): Promise<AuthRecord | undefined> {
    return this.records.get(providerId)
  }

  async set(providerId: string, record: AuthRecord): Promise<void> {
    this.records.set(providerId, record)
  }

  async remove(providerId: string): Promise<void> {
    this.records.delete(providerId)
  }

  async list(): Promise<Record<string, AuthRecord>> {
    return Object.fromEntries(this.records.entries())
  }
}

