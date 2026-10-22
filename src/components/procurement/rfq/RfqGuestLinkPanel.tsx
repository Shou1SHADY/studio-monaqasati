"use client"

// «رابط الزوار — لموردين خارج المنصة» on the RFQ page: while the round is open, the link a supplier without an account quotes
// through — copy it, hand it over with the ready message (the composer), see it as a supplier sees it, and how many times it was
// opened. The buyer's own preview is not an open (R-21). The link is minted (or reused) by /api/rfq-share/create.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Copy, Eye, Link2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/module-ui/Panel"
import { Link } from "@/i18n/routing"
import { useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { LinkStats } from "@/lib/procurement/link-views"

export function RfqGuestLinkPanel({ rfqId, canShare, onShare }: { rfqId: string; canShare: boolean; onShare: () => void }) {
  const t = useTranslations("Portal.Procurement.rfqx.guest_link")
  const tl = useTranslations("Portal.Procurement.linkx")
  const { user } = useUser()
  const { toast } = useToast()
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [stats, setStats] = useState<LinkStats | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    void (async () => {
      try {
        const idToken = await user.getIdToken()
        const res = await fetch(`/api/rfq-share/preview?rfqId=${encodeURIComponent(rfqId)}`, { headers: { Authorization: `Bearer ${idToken}` } })
        const json = (await res.json().catch(() => null)) as { success?: boolean; data?: { stats?: LinkStats } } | null
        if (!cancelled && res.ok && json?.success && json.data?.stats) setStats(json.data.stats)
      } catch {
        // The counter is a courtesy; the panel works without it.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, rfqId])

  const copy = async () => {
    if (!user) return
    setBusy(true)
    try {
      let link = url
      if (!link) {
        const idToken = await user.getIdToken()
        const res = await fetch("/api/rfq-share/create", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ rfqId }) })
        const json = (await res.json().catch(() => null)) as { data?: { url?: string } } | null
        link = res.ok ? json?.data?.url || null : null
        setUrl(link)
      }
      if (!link) throw new Error("no_link")
      await navigator.clipboard.writeText(link)
      toast({ title: t("copied") })
    } catch {
      toast({ title: t("failed"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t("title")} icon={Link2}>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      {url && (
        <p className="mt-2 truncate rounded-lg bg-muted px-3 py-2 text-xs font-semibold" dir="ltr">
          {url}
        </p>
      )}
      {stats && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-views>
          <Eye size={13} aria-hidden="true" />
          <b className="text-foreground">{stats.views === 0 ? tl("views_none") : stats.views === 1 ? tl("views_one") : tl("views", { count: stats.views })}</b>
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {canShare && (
          <>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void copy()} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {t("copy")}
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onShare}>
              <Link2 size={14} aria-hidden="true" />
              {t("share")}
            </Button>
          </>
        )}
        <Button asChild type="button" variant="outline" size="sm" className="gap-1.5 border-dashed">
          <Link href={`/contractor/rfqs/${rfqId}/preview/link`}>
            <Eye size={14} aria-hidden="true" />
            {t("supplier_view")}
          </Link>
        </Button>
      </div>
    </Panel>
  )
}
