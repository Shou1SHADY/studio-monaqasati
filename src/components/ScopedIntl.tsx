import type { ReactNode } from "react"
import { NextIntlClientProvider } from "next-intl"
import { getMessages } from "next-intl/server"
import { scopeMessages, type PortalScope } from "@/i18n/message-scope"

export async function ScopedIntl({ portal, children }: { portal: PortalScope; children: ReactNode }) {
  const messages = await getMessages()
  return <NextIntlClientProvider messages={scopeMessages(messages, portal)}>{children}</NextIntlClientProvider>
}
