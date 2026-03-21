import { AuthCancelledError, AuthManagerError, ProviderNotFoundError } from "./errors.js"
import type {
  ApiKeyMethodDefinition,
  AuthResult,
  AuthContext,
  AuthManagerOptions,
  AuthMethodDefinition,
  AuthProvider,
  OAuthMethodDefinition,
  PromptDefinition,
} from "./types.js"

export class AuthManager {
  private readonly providers = new Map<string, AuthProvider>()
  private readonly context: AuthContext

  constructor(private readonly options: AuthManagerOptions) {
    for (const provider of options.providers) {
      this.providers.set(provider.id, provider)
    }

    this.context = {
      storage: options.storage,
      fetch: options.fetch ?? fetch,
    }
  }

  getProvider(providerId: string): AuthProvider {
    const provider = this.providers.get(providerId)
    if (!provider) throw new ProviderNotFoundError(providerId)
    return provider
  }

  listProviders(): AuthProvider[] {
    return Array.from(this.providers.values())
  }

  async listCredentials() {
    return this.options.storage.list()
  }

  async logout(providerId: string) {
    await this.options.storage.remove(providerId)
    await this.notify("success", `Logged out from ${providerId}`)
  }

  async login(providerId: string, methodId?: string) {
    const provider = this.getProvider(providerId)
    const method = await this.resolveMethod(provider, methodId)
    const inputs = await this.collectInputs(method.prompts ?? [])

    if (method.type === "oauth") {
      return this.loginOauth(provider, method, inputs)
    }

    return this.loginApiKey(provider, method, inputs)
  }

  private async resolveMethod(provider: AuthProvider, methodId?: string): Promise<AuthMethodDefinition> {
    if (methodId) {
      const method = provider.methods.find((item) => item.id === methodId)
      if (!method) {
        throw new AuthManagerError(`Unknown method "${methodId}" for provider "${provider.id}"`)
      }
      return method
    }

    if (provider.methods.length === 1) {
      const method = provider.methods[0]
      if (!method) throw new AuthManagerError(`Provider "${provider.id}" has no methods`)
      return method
    }

    const selected = await this.options.driver.chooseMethod(provider, provider.methods)
    if (!selected) throw new AuthCancelledError()
    const method = provider.methods.find((item) => item.id === selected)
    if (!method) throw new AuthManagerError(`Unknown selected method "${selected}" for provider "${provider.id}"`)
    return method
  }

  private async collectInputs(prompts: PromptDefinition[]) {
    const inputs: Record<string, string> = {}

    for (const prompt of prompts) {
      if (prompt.when) {
        const current = inputs[prompt.when.key]
        if (current === undefined) continue
        const matches = prompt.when.op === "eq" ? current === prompt.when.value : current !== prompt.when.value
        if (!matches) continue
      }

      const value = await this.prompt(prompt)
      if (value === null) throw new AuthCancelledError()
      const error = prompt.validate?.(value)
      if (error) {
        throw new AuthManagerError(`Invalid input for "${prompt.key}": ${error}`)
      }
      inputs[prompt.key] = value
    }

    return inputs
  }

  private async prompt(prompt: PromptDefinition) {
    if (prompt.type === "text") return this.options.driver.promptText(prompt)
    if (prompt.type === "secret") return this.options.driver.promptSecret(prompt)
    return this.options.driver.promptSelect(prompt)
  }

  private async loginOauth(
    provider: AuthProvider,
    method: OAuthMethodDefinition,
    inputs: Record<string, string>,
  ) {
    const pending = await method.authorize(this.context, inputs)

    await this.maybeOpenUrl(pending.url)
    if (pending.instructions) {
      await this.notify("info", pending.instructions)
    }

    const result =
      pending.mode === "auto"
        ? await pending.complete()
        : await pending.complete(await this.requireCode(provider, method))

    if (result.type !== "success") {
      throw new AuthManagerError(result.reason ?? `Authentication failed for ${provider.id}`)
    }

    await this.options.storage.set(result.providerId ?? provider.id, result.record)
    await this.notify("success", `Login successful for ${result.providerId ?? provider.id}`)
    return result.record
  }

  private async requireCode(provider: AuthProvider, method: OAuthMethodDefinition) {
    const code = await this.options.driver.promptText({
      type: "text",
      key: "authorizationCode",
      message: `Paste the authorization code for ${provider.label} (${method.label})`,
    })

    if (!code) throw new AuthCancelledError()
    return code
  }

  private async loginApiKey(
    provider: AuthProvider,
    method: ApiKeyMethodDefinition,
    inputs: Record<string, string>,
  ) {
    if (method.setupUrl) {
      await this.notify("info", method.instructions ?? `Open ${method.setupUrl} and create an API key.`)
      await this.maybeOpenUrl(method.setupUrl)
    } else if (method.instructions) {
      await this.notify("info", method.instructions)
    }

    const result =
      method.authorize?.(this.context, inputs) ??
      Promise.resolve(this.defaultApiKeyResult(inputs))

    const resolved = await result
    if (resolved.type !== "success") {
      throw new AuthManagerError(resolved.reason ?? `Authentication failed for ${provider.id}`)
    }

    await this.options.storage.set(resolved.providerId ?? provider.id, resolved.record)
    await this.notify("success", `Login successful for ${resolved.providerId ?? provider.id}`)
    return resolved.record
  }

  private defaultApiKeyResult(inputs: Record<string, string>) {
    const success = (key: string): AuthResult => ({
      type: "success",
      record: {
        type: "api",
        key,
      },
    })

    const key = inputs.apiKey ?? Object.values(inputs)[0]
    if (!key) {
      return {
        type: "failed" as const,
        reason: "Missing API key input",
      }
    }

    return success(key)
  }

  private async maybeOpenUrl(url: string) {
    if (!this.options.driver.openUrl) return
    await this.options.driver.openUrl(url)
  }

  private async notify(level: "info" | "success" | "warn" | "error", message: string, cause?: unknown) {
    if (!this.options.driver.notify) return
    if (level === "error") {
      await this.options.driver.notify({ level, message, cause })
      return
    }
    await this.options.driver.notify({ level, message })
  }
}
