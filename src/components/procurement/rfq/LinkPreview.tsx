"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, Eye, Loader2, Monitor, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/module-ui/Chip"
import { LinkPage } from "@/components/procurement/guest/LinkPage"
import type { LinkData, LinkMe } from "@/components/procurement/guest/link-types"
import { Link, useRouter } from "@/i18n/routing"
import { useUser } from "@/firebase"
import { bareNumber } from "@/lib/supplier-free/derive"
import { cn } from "@/lib/utils"

interface PreviewPayload extends LinkData {
  visitors: Array<{ offerId: string; company: string }>
  me: LinkMe | null
}

// «معاينة» (LNK-13): the visitor's page exactly as he sees it — as a new supplier, or as a visitor who already quoted (his
// quote, what was asked of him, his result). Read through an authenticated route that never touches the link's counters, so
// looking at it is not a view. Every act on the page is inert here.
export function LinkPreview({ rfqId }: { rfqId: string }) {
  const t = useTranslations("PublicRfq")
  const locale = useLocale()
  const router = useRouter()
  const { user } = useUser()
  const as = useSearchParams().get("as") || ""
  const [data, setData] = useState<PreviewPayload | null>(null)
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState<"phone" | "full">("phone")

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setData(null)
    void (async () => {
      try {
        const idToken = await user.getIdToken()
        const res = await fetch(`/api/rfq-share/preview?rfqId=${encodeURIComponent(rfqId)}${as ? `&as=${encodeURIComponent(as)}` : ""}`, { headers: { Authorization: `Bearer ${idToken}` } })
        const json = (await res.json().catch(() => null)) as { success?: boolean; data?: PreviewPayload } | null
        if (cancelled) return
        if (res.ok && json?.success && json.data) setData(json.data)
        else setFailed(true)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, rfqId, as])

  const pick = (offerId: string) => router.replace(offerId ? `/contractor/rfqs/${rfqId}/preview/link?as=${encodeURIComponent(offerId)}` : `/contractor/rfqs/${rfqId}/preview/link`)

  return (
    <div className="space-y-3" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Eye size={14} aria-hidden="true" />
          <b className="text-foreground">{t("preview_title")}</b>
          {data?.rfq.number ? t("preview_sub", { no: bareNumber(data.rfq.number) }) : null}
        </span>
        <div className="flex gap-1.5" role="group" aria-label={t("preview_title")}>
          <Chip selected={view === "phone"} icon={Smartphone} onClick={() => setView("phone")}>
            {t("preview_phone")}
          </Chip>
          <Chip selected={view === "full"} icon={Monitor} onClick={() => setView("full")}>
            {t("preview_full")}
          </Chip>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("preview_as")}>
          <span className="text-muted-foreground">{t("preview_as")}</span>
          <Chip selected={!as} onClick={() => pick("")}>
            {t("preview_new")}
          </Chip>
          {data?.visitors.slice(0, 4).map((v) => (
            <Chip key={v.offerId} selected={as === v.offerId} onClick={() => pick(v.offerId)}>
              {v.company}
            </Chip>
          ))}
        </div>
        <span className="text-muted-foreground">{t("preview_not_counted")}</span>
        <span className="flex-1" />
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link href={`/contractor/rfqs/${rfqId}/offers`}>
            <ArrowLeft size={14} className="rtl-flip" aria-hidden="true" />
            {t("preview_back")}
          </Link>
        </Button>
      </div>

      {!data && !failed && (
        <div className="flex justify-center py-20 text-muted-foreground" role="status">
          <Loader2 className="animate-spin text-primary" size={32} aria-hidden="true" />
        </div>
      )}
      {failed && <p className="py-12 text-center text-sm text-muted-foreground">{t("error_generic")}</p>}
      {data && (
        <div className={cn("mx-auto overflow-hidden rounded-2xl border shadow-sm", view === "phone" ? "max-w-[390px]" : "max-w-3xl")} data-preview-frame={view}>
          <LinkPage key={as || "new"} data={data} api={null} preview={{ me: data.me }} />
        </div>
      )}
    </div>
  )
}
