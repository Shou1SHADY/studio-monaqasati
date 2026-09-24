"use client"

import * as Sentry from "@sentry/nextjs"
import NextError from "next/error"
import { useEffect } from "react"

// The last-resort boundary for a crash in the root layout itself. It renders
// outside every provider (no locale, no translations), so it shows Next's own
// neutral error page — and reports the crash, which nothing else would.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  )
}
