export class AuthManagerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "AuthManagerError"
  }
}

export class AuthCancelledError extends AuthManagerError {
  constructor(message = "Authentication cancelled") {
    super(message)
    this.name = "AuthCancelledError"
  }
}

export class ProviderNotFoundError extends AuthManagerError {
  constructor(providerId: string) {
    super(`Unknown provider: ${providerId}`)
    this.name = "ProviderNotFoundError"
  }
}

