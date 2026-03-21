import { createBrowserAssistedApiKeyProvider } from "./browser-assisted-api-key.js"

const ANTHROPIC_CONSOLE_URL = "https://console.anthropic.com/settings/keys"

export function createClaudeProvider() {
  return createBrowserAssistedApiKeyProvider({
    id: "claude",
    label: "Claude",
    description: "Browser-assisted API key login for Anthropic/Claude.",
    setupUrl: ANTHROPIC_CONSOLE_URL,
    instructions: "Open the Anthropic console, create an API key, then paste it here.",
    promptMessage: "Paste your Anthropic API key",
  })
}
