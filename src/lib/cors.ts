// Cross-origin access to /api/* for the mobile app's WEB build.
//
// The native app talks to these routes with no browser in the way, so CORS
// never applies to it. The same app exported as a PWA runs on its own origin
// (Firebase Hosting), and a browser will not hand a page on one origin a
// response from another unless the response names that origin. This is the
// allow-list. An origin not on it gets no CORS header and stays blocked —
// which is the situation every other site on the internet is in today, so
// nothing is opened that was closed.
//
// Nothing here relaxes authentication: the routes still verify the Bearer
// token they are given, and credentials (cookies) are never allowed across
// origins — the token travels in a header.
//
// Kept free of imports beyond app-env so it can run in the edge middleware.

import { IS_UAT } from "@/lib/app-env"

/** The hosted PWA. Add a production hosting site here when one exists. */
export const MOBILE_PWA_ORIGINS = [
  "https://mdmak-mobile-uat.web.app",
  "https://mdmak-mobile-uat.firebaseapp.com",
]

/** `expo start --web`, and a local `dist/` served for QA — only for UAT and
 * local builds, never for the production site. */
const LOCAL_DEV_ORIGINS = [
  "http://localhost:8081",
  "http://localhost:19006",
  "http://localhost:4173",
  "http://127.0.0.1:8081",
]

/** Comma-separated extra origins from the environment, for a new hosting
 * site or a preview channel without a code change. */
function extraOrigins(): string[] {
  return (process.env.CORS_EXTRA_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

export function allowedOrigins(): string[] {
  const local = IS_UAT || process.env.NODE_ENV !== "production" ? LOCAL_DEV_ORIGINS : []
  return [...MOBILE_PWA_ORIGINS, ...local, ...extraOrigins()]
}

/** The origin to echo back, or null when the request's origin is not allowed
 * (or the request has none — same-origin and non-browser callers). */
export function allowedOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null
  return allowedOrigins().includes(origin) ? origin : null
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    // The header set depends on the request's Origin — caches must not reuse
    // one origin's answer for another.
    Vary: "Origin",
  }
}
