import type { Breadcrumb, BrowserOptions, Event } from "@sentry/nextjs"
import { APP_ENV } from "./app-env"

// The DSN only says where to send events — it is public by design (every
// browser receives it), so one value serves production and UAT, told apart by
// `environment`. NEXT_PUBLIC_SENTRY_DSN overrides it; an empty value turns
// reporting off. Must stay a literal process.env read (NEXT_PUBLIC_* rule).
const DEFAULT_DSN = "https://5edf267f3ae680daab9c35780e728a59@o4512143003156480.ingest.de.sentry.io/4512143010824272"
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? DEFAULT_DSN

// A guest link's token IS its access: /receive/<token>, /offer/<token>, /portal/<token>,
// /rfq/<token> and their API routes. It must never reach Sentry in a URL,
// a transaction name or a breadcrumb.
const TOKEN_PATH = /\/(receive|offer|rfq|po|po-link|guest-offer|rfq-share|receipt-links|portal|pm-portal)\/[^/?#\s"']+/g

export function scrubTokens<T>(value: T): T {
  return (typeof value === "string" ? value.replace(TOKEN_PATH, "/$1/[token]") : value) as T
}

function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  const data = crumb.data ? Object.fromEntries(Object.entries(crumb.data).map(([k, v]) => [k, scrubTokens(v)])) : crumb.data
  return { ...crumb, message: scrubTokens(crumb.message), data }
}

function scrubEvent<E extends Event>(event: E): E {
  if (event.request?.url) event.request.url = scrubTokens(event.request.url)
  if (event.transaction) event.transaction = scrubTokens(event.transaction)
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb)
  return event
}

type StreamedSpan = Parameters<NonNullable<BrowserOptions["beforeSendSpan"]>>[0]

// SDK 11 streams spans (`traceLifecycle: 'stream'`): `beforeSendTransaction` never runs,
// so a page load's name ("/receive/<token>") and its url attributes are scrubbed here.
// An attribute is a plain value or { value, unit }.
export function scrubSpan(span: StreamedSpan): StreamedSpan {
  const attributes: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(span.attributes ?? {})) {
    attributes[k] = v && typeof v === "object" && "value" in v ? { ...v, value: scrubTokens(v.value) } : scrubTokens(v)
  }
  return { ...span, name: scrubTokens(span.name), attributes: attributes as StreamedSpan["attributes"] }
}

export function sentryOptions(): BrowserOptions {
  return {
    dsn: DSN,
    // Only deployed builds report; a developer's laptop is not production.
    enabled: Boolean(DSN) && process.env.NODE_ENV === "production",
    environment: APP_ENV === "uat" ? "uat" : "production",
    // Nothing about the person or the request leaves the platform: requests
    // carry Firebase ID tokens (headers), one-time codes and passwords (bodies).
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubEvent(event),
    beforeSendSpan: scrubSpan,
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  }
}
