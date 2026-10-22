"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Clock, Loader2 } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { LinkPage } from "@/components/procurement/guest/LinkPage"
import { LinkShell } from "@/components/procurement/guest/LinkShell"
import { PromoCard } from "@/components/procurement/guest/PromoCard"
import { makeLinkApi, viewerId } from "@/components/procurement/guest/link-api"
import type { LinkData } from "@/components/procurement/guest/link-types"

// The visitor's page (LNK-01…13): loads the request through the link, then hands everything to the page components. No account:
// the page opens on the link alone, and the code on his mobile is asked for once, when he sends.
export function PublicRfqContent() {
  const params = useParams()
  const token = params.token as string
  const t = useTranslations("PublicRfq")
  const locale = useLocale()
  const [data, setData] = useState<LinkData | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const api = useMemo(() => (token ? makeLinkApi(token) : null), [token])

  useEffect(() => {
    if (!api) return
    let cancelled = false
    ;(async () => {
      const v = viewerId()
      const res = await api.call<LinkData>(v ? `?v=${v}` : "", { method: "GET", session: null })
      if (cancelled) return
      if (res.ok) setData(res.data)
      else setErrorCode(res.code || "NOT_FOUND")
    })()
    return () => {
      cancelled = true
    }
  }, [api])

  if (!data && !errorCode) {
    return (
      <LinkShell company="">
        <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground" role="status">
          <Loader2 className="animate-spin text-primary" size={36} aria-hidden="true" />
          <p className="text-sm font-medium">{t("loading")}</p>
        </div>
      </LinkShell>
    )
  }

  if (!data || errorCode) {
    const expired = errorCode === "LINK_EXPIRED" || errorCode === "LINK_REVOKED"
    return (
      <LinkShell company="">
        <section className="space-y-4 py-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warning/10 text-warning" aria-hidden="true">
            <Clock size={26} />
          </span>
          <h1 className="text-xl font-black text-foreground">{expired ? t("link_expired_title") : t("invalid_title")}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{expired ? t("link_expired_desc") : t("invalid_desc")}</p>
          <PromoCard />
          <Link href="/">
            <Button variant="outline">{t("go_home")}</Button>
          </Link>
        </section>
      </LinkShell>
    )
  }

  return <LinkPage data={data} api={api} langHref={`/rfq/${token}`} key={locale} />
}
