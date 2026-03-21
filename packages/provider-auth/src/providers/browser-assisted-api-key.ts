import type { AuthProvider } from "../types.js"

export interface BrowserAssistedApiKeyProviderOptions {
  id: string
  label: string
  description?: string
  setupUrl: string
  instructions: string
  promptMessage: string
}

export function createBrowserAssistedApiKeyProvider(
  options: BrowserAssistedApiKeyProviderOptions,
): AuthProvider {
  return {
    id: options.id,
    label: options.label,
    ...(options.description ? { description: options.description } : {}),
    methods: [
      {
        id: "browser-api-key",
        type: "api-key",
        label: "Create key in browser",
        setupUrl: options.setupUrl,
        instructions: options.instructions,
        prompts: [
          {
            type: "secret",
            key: "apiKey",
            message: options.promptMessage,
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
