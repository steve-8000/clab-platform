import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

export interface LocalCallbackServer {
  redirectUri: string
  waitForCode(): Promise<{ code: string; state?: string }>
  stop(): Promise<void>
}

interface LocalCallbackServerOptions {
  port?: number
  path?: string
  timeoutMs?: number
  successHtml?: string
  errorHtml?: (message: string) => string
}

const defaultSuccessHtml = `<!doctype html>
<html>
  <body>
    <h1>Authorization Successful</h1>
    <p>You can close this window.</p>
    <script>setTimeout(() => window.close(), 1500)</script>
  </body>
</html>`

const defaultErrorHtml = (message: string) => `<!doctype html>
<html>
  <body>
    <h1>Authorization Failed</h1>
    <pre>${message}</pre>
  </body>
</html>`

export async function startLocalCallbackServer(options: LocalCallbackServerOptions = {}): Promise<LocalCallbackServer> {
  const callbackPath = options.path ?? "/auth/callback"
  const successHtml = options.successHtml ?? defaultSuccessHtml
  const errorHtml = options.errorHtml ?? defaultErrorHtml
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000

  let server: Server | undefined

  const waitForCode = new Promise<{ code: string; state?: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("OAuth callback timeout"))
    }, timeoutMs)

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        const host = req.headers.host ?? "127.0.0.1"
        const url = new URL(req.url ?? "/", `http://${host}`)

        if (url.pathname !== callbackPath) {
          res.statusCode = 404
          res.end("Not found")
          return
        }

        const error = url.searchParams.get("error")
        const errorDescription = url.searchParams.get("error_description")
        if (error) {
          const message = errorDescription ?? error
          res.statusCode = 400
          res.setHeader("Content-Type", "text/html; charset=utf-8")
          res.end(errorHtml(message))
          clearTimeout(timeout)
          reject(new Error(message))
          return
        }

        const code = url.searchParams.get("code")
        if (!code) {
          res.statusCode = 400
          res.setHeader("Content-Type", "text/html; charset=utf-8")
          res.end(errorHtml("Missing authorization code"))
          clearTimeout(timeout)
          reject(new Error("Missing authorization code"))
          return
        }

        res.statusCode = 200
        res.setHeader("Content-Type", "text/html; charset=utf-8")
        res.end(successHtml)
        clearTimeout(timeout)
        const state = url.searchParams.get("state")
        resolve(state ? { code, state } : { code })
      } catch (error) {
        clearTimeout(timeout)
        reject(error)
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject)
    server!.listen(options.port ?? 0, "127.0.0.1", () => {
      server!.off("error", reject)
      resolve()
    })
  })

  const runningServer = server
  if (!runningServer) {
    throw new Error("Failed to create local OAuth callback server")
  }

  const address = runningServer.address()
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => runningServer.close(() => resolve()))
    throw new Error("Failed to start local OAuth callback server")
  }

  return {
    redirectUri: `http://127.0.0.1:${address.port}${callbackPath}`,
    waitForCode: () => waitForCode,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        runningServer.close((error?: Error | undefined) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}
