export type AuthRecord =
  | {
      type: "api"
      key: string
    }
  | {
      type: "oauth"
      access: string
      refresh: string
      expires: number
      accountId?: string
      metadata?: Record<string, string>
    }

export interface AuthStorage {
  get(providerId: string): Promise<AuthRecord | undefined>
  set(providerId: string, record: AuthRecord): Promise<void>
  remove(providerId: string): Promise<void>
  list(): Promise<Record<string, AuthRecord>>
}

export interface PromptOption {
  label: string
  value: string
  hint?: string
}

export interface PromptWhen {
  key: string
  op: "eq" | "neq"
  value: string
}

interface BasePromptDefinition {
  key: string
  message: string
  placeholder?: string
  when?: PromptWhen
  validate?: (value: string) => string | undefined
}

export interface TextPromptDefinition extends BasePromptDefinition {
  type: "text"
}

export interface SecretPromptDefinition extends BasePromptDefinition {
  type: "secret"
}

export interface SelectPromptDefinition extends BasePromptDefinition {
  type: "select"
  options: PromptOption[]
}

export type PromptDefinition = TextPromptDefinition | SecretPromptDefinition | SelectPromptDefinition

export type DriverEvent =
  | {
      level: "info" | "success" | "warn"
      message: string
    }
  | {
      level: "error"
      message: string
      cause?: unknown
    }

export interface AuthDriver {
  chooseMethod(
    provider: AuthProvider,
    methods: AuthMethodDefinition[],
  ): Promise<string | null>
  promptText(prompt: TextPromptDefinition): Promise<string | null>
  promptSecret(prompt: SecretPromptDefinition): Promise<string | null>
  promptSelect(prompt: SelectPromptDefinition): Promise<string | null>
  openUrl?(url: string): Promise<void>
  notify?(event: DriverEvent): Promise<void>
}

export interface AuthContext {
  storage: AuthStorage
  fetch: typeof fetch
}

export interface AuthSuccessResult {
  type: "success"
  record: AuthRecord
  providerId?: string
}

export interface AuthFailedResult {
  type: "failed"
  reason?: string
}

export type AuthResult = AuthSuccessResult | AuthFailedResult

export interface OAuthAutoAuthorization {
  mode: "auto"
  url: string
  instructions?: string
  complete(): Promise<AuthResult>
}

export interface OAuthCodeAuthorization {
  mode: "code"
  url: string
  instructions?: string
  complete(code: string): Promise<AuthResult>
}

export type OAuthAuthorization = OAuthAutoAuthorization | OAuthCodeAuthorization

export interface OAuthMethodDefinition {
  id: string
  type: "oauth"
  label: string
  prompts?: PromptDefinition[]
  authorize(context: AuthContext, inputs: Record<string, string>): Promise<OAuthAuthorization>
}

export interface ApiKeyMethodDefinition {
  id: string
  type: "api-key"
  label: string
  prompts?: PromptDefinition[]
  setupUrl?: string
  instructions?: string
  authorize?(context: AuthContext, inputs: Record<string, string>): Promise<AuthResult>
}

export type AuthMethodDefinition = OAuthMethodDefinition | ApiKeyMethodDefinition

export interface AuthProvider {
  id: string
  label: string
  description?: string
  methods: AuthMethodDefinition[]
}

export interface AuthManagerOptions {
  storage: AuthStorage
  driver: AuthDriver
  providers: AuthProvider[]
  fetch?: typeof fetch
}

export interface CodexOauthRecord {
  type: "oauth"
  access: string
  refresh: string
  expires: number
  accountId?: string
}

