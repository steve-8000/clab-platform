import type { MiddlewareHandler } from "hono";

/**
 * Placeholder authentication middleware.
 *
 * TODO: implement API key / JWT validation.
 * When implemented this should:
 *  1. Extract the token from the Authorization header or X-API-Key header.
 *  2. Validate against the auth service.
 *  3. Attach the resolved identity to the context (c.set("user", ...)).
 *  4. Return 401 on failure.
 */
export function authMiddleware(): MiddlewareHandler {
  return async (_c, next) => {
    // TODO: implement API key / JWT validation
    await next();
  };
}
