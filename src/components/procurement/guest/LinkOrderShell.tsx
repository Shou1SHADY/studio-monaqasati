"use client"

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Link } from "@/i18n/routing"

// The order link's frame (the prototype's `lktop` and `lkf`): the mark, «أمر شراء» with the buyer's company, a language switch, one
// narrow column and the footer. No navigation into the platform.
export function LinkOrderShell({ company, langHref, children }: { company: string; langHref: string; children: ReactNode }) {
  const t = useTranslations("PoLink")
  const tb = useTranslations("PublicRfq")
  const locale = useLocale()
  const isRtl = locale === "ar"
  return (
    <div className="min-h-screen bg-muted/30 font-body" dir={isRtl ? "rtl" : "ltr"}>
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-xl items-center gap-3 px-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-black text-primary-foreground" aria-hidden="true">
            {isRtl ? "م" : "M"}
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <b className="text-sm text-foreground">{tb("brand")}</b>
            <small className="text-[10px] tracking-latin text-muted-foreground">MDMAK TECH</small>
          </span>
          <span className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <b className="truncate text-sm text-foreground">{t("purchase_order")}</b>
            {company && <small className="truncate text-xs text-muted-foreground">{company}</small>}
          </span>
          <Link href={langHref} locale={isRtl ? "en" : "ar"} className="shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {isRtl ? "English" : "العربية"}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-xl space-y-4 px-4 py-5">{children}</main>
      <footer className="px-4 pb-8 pt-2 text-center text-[11px] text-muted-foreground">{tb("footer")}</footer>
    </div>
  )
}
