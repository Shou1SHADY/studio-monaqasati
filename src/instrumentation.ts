import * as Sentry from "@sentry/nextjs"
import { sentryOptions } from "@/lib/sentry-options"

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(sentryOptions())
  }
}

// Errors thrown while rendering or in route handlers on the server.
export const onRequestError = Sentry.captureRequestError
