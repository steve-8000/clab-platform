import { createHash, randomBytes } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import { startLocalCallbackServer } from "../oauth/local-callback-server.js"
import type { AuthProvider, AuthResult, CodexOauthRecord } from "../types.js"

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000

interface TokenResponse {
  id_token?: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

interface PkceCodes {
  verifier: string
  challenge: string
}

export interface CodexFetchAdapterOptions {
  storage: {
    get(providerId: string): Promise<CodexOauthRecord | undefined>
    set(providerId: string, record: CodexOauthRecord): Promise<void>
  }
  fetch?: typeof fetch
  providerId?: string
}

export function createCodexProvider(): AuthProvider {
  return {
    id: "codex",
    label: "Codex",
    description: "ChatGPT/Codex OAuth login with browser and device code flows.",
    methods: [
      {
        id: "browser-oauth",
        type: "oauth",
        label: "ChatGPT Pro/Plus (browser)",
        authorize: async (context) => {
          const callbackServer = await startLocalCallbackServer()
          const pkce = generatePkce()
          const state = generateState()
          const authUrl = buildAuthorizeUrl(callbackServer.redirectUri, pkce, state)

          return {
            mode: "auto",
            url: authUrl,
            instructions: "Complete authorization in your browser. The callback page can be closed automatically.",
            complete: async (): Promise<AuthResult> => {
              try {
                const callback = await callbackServer.waitForCode()
                if (callback.state !== state) {
                  return {
                    type: "failed",
                    reason: "Invalid state received from OAuth callback",
                  }
                }

                const tokens = await exchangeCodeForTokens(context.fetch, callback.code, callbackServer.redirectUri, pkce)
                const accountId = extractAccountId(tokens)
                return {
                  type: "success",
                  record: {
                    type: "oauth",
                    access: tokens.access_token,
                    refresh: tokens.refresh_token,
                    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                    ...(accountId ? { accountId } : {}),
                  },
                }
              } finally {
                await callbackServer.stop().catch(() => undefined)
              }
            },
          }
        },
      },
      {
        id: "device-oauth",
        type: "oauth",
        label: "ChatGPT Pro/Plus (device code)",
        authorize: async (context) => {
          const response = await context.fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "provider-auth/0.1.0",
            },
            body: JSON.stringify({ client_id: CLIENT_ID }),
          })

          if (!response.ok) {
            throw new Error(`Failed to initiate device auth: ${response.status}`)
          }

          const deviceData = (await response.json()) as {
            device_auth_id: string
            user_code: string
            interval: string
          }

          const intervalMs = Math.max(parseInt(deviceData.interval, 10) || 5, 1) * 1000

          return {
            mode: "auto",
            url: `${ISSUER}/codex/device`,
            instructions: `Enter code: ${deviceData.user_code}`,
            complete: async (): Promise<AuthResult> => {
              while (true) {
                const poll = await context.fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "provider-auth/0.1.0",
                  },
                  body: JSON.stringify({
                    device_auth_id: deviceData.device_auth_id,
                    user_code: deviceData.user_code,
                  }),
                })

                if (poll.ok) {
                  const data = (await poll.json()) as {
                    authorization_code: string
                    code_verifier: string
                  }
                  const tokens = await exchangeCodeForTokens(context.fetch, data.authorization_code, `${ISSUER}/deviceauth/callback`, {
                    verifier: data.code_verifier,
                    challenge: "",
                  })
                  const accountId = extractAccountId(tokens)

                  return {
                    type: "success",
                    record: {
                      type: "oauth",
                      access: tokens.access_token,
                      refresh: tokens.refresh_token,
                      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                      ...(accountId ? { accountId } : {}),
                    },
                  }
                }

                if (poll.status !== 403 && poll.status !== 404) {
                  return {
                    type: "failed",
                    reason: `Device auth polling failed: ${poll.status}`,
                  }
                }

                await sleep(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS)
              }
            },
          }
        },
      },
      {
        id: "manual-api-key",
        type: "api-key",
        label: "Manual API key",
        prompts: [
          {
            type: "secret",
            key: "apiKey",
            message: "Paste your OpenAI API key",
            validate: (value) => {
              if (!value.trim()) return "API key is required"
              return undefined
            },
          },
        ],
      },
    ],
  }
}

export function createCodexFetchAdapter(options: CodexFetchAdapterOptions) {
  const providerId = options.providerId ?? "codex"
  const fetchImpl = options.fetch ?? fetch

  return async function codexFetch(input: RequestInfo | URL, init?: RequestInit) {
    const auth = await options.storage.get(providerId)
    if (!auth || auth.type !== "oauth") {
      return fetchImpl(input, init)
    }

    let currentAuth = auth
    if (!currentAuth.access || currentAuth.expires < Date.now()) {
      const refreshed = await refreshAccessToken(fetchImpl, currentAuth.refresh)
      const accountId = extractAccountId(refreshed)
      currentAuth = {
        type: "oauth",
        access: refreshed.access_token,
        refresh: refreshed.refresh_token,
        expires: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
        ...(accountId ? { accountId } : {}),
      }
      await options.storage.set(providerId, currentAuth)
    }

    const headers = new Headers(init?.headers)
    headers.set("authorization", `Bearer ${currentAuth.access}`)
    if (currentAuth.accountId) {
      headers.set("ChatGPT-Account-Id", currentAuth.accountId)
    }

    const parsed =
      input instanceof URL
        ? input
        : new URL(typeof input === "string" ? input : input.url)
    const url =
      parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")
        ? new URL(CODEX_API_ENDPOINT)
        : parsed

    return fetchImpl(url, {
      ...init,
      headers,
    })
  }
}

function generatePkce(): PkceCodes {
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash("sha256").update(verifier).digest())
  return { verifier, challenge }
}

function generateState(): string {
  return base64Url(randomBytes(32))
}

function base64Url(input: Uint8Array | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "provider-auth",
  })

  return `${ISSUER}/oauth/authorize?${params.toString()}`
}

async function exchangeCodeForTokens(fetchImpl: typeof fetch, code: string, redirectUri: string, pkce: PkceCodes) {
  const response = await fetchImpl(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  })

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }

  return (await response.json()) as TokenResponse
}

async function refreshAccessToken(fetchImpl: typeof fetch, refreshToken: string) {
  const response = await fetchImpl(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  })

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`)
  }

  return (await response.json()) as TokenResponse
}

function extractAccountId(tokens: TokenResponse): string | undefined {
  const candidate = tokens.id_token ?? tokens.access_token
  const claims = parseJwtClaims(candidate)
  if (!claims) return undefined

  const direct = claims.chatgpt_account_id
  if (direct) return direct

  const scoped = claims["https://api.openai.com/auth"]?.chatgpt_account_id
  if (scoped) return scoped

  return claims.organizations?.[0]?.id
}

function parseJwtClaims(token: string): Record<string, any> | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined

  try {
    const payload = Buffer.from(parts[1]!, "base64url").toString("utf8")
    return JSON.parse(payload) as Record<string, any>
  } catch {
    return undefined
  }
}
