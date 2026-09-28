"use client"

// «رابط الزوار — لموردين خارج المنصة» on the RFQ page (R-40, prototype dRfq):
// while the round is open, the link a supplier without an account offers
// through — copy it, share it (the share dialog records the channel), or open
// it to see exactly what the supplier sees. The link is minted (or reused)
// by /api/rfq-share/create; nothing is stored on the RFQ itself.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Copy, Eye, Link2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/module-ui/Panel"
import { useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"

export function RfqGuestLinkPanel({ rfqId, canShare, onShare }: { rfqId: string; canShare: boolean; onShare: () => void }) {
  const t = useTranslations("Portal.Procurement.rfqx.guest_link")
  const { user } = useUser()
  const { toast } = useToast()
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<"copy" | "view" | null>(null)

  const linkUrl = async (): Promise<string | null> => {
    if (url) return url
    if (!user) return null
    const idToken = await user.getIdToken()
    const res = await fetch("/api/rfq-share/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ rfqId }),
    })
    const json = (await res.json().catch(() => null)) as { data?: { url?: string } } | null
    const got = res.ok ? json?.data?.url || null : null
    setUrl(got)
    return got
  }

  const copy = async () => {
    setBusy("copy")
    try {
      const u = await linkUrl()
      if (!u) throw new Error("no_link")
      await navigator.clipboard.writeText(u)
      toast({ title: t("copied") })
    } catch {
      toast({ title: t("failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const view = async () => {
    // Opened inside the click so the browser does not treat it as a popup.
    const tab = window.open("", "_blank")
    setBusy("view")
    try {
      const u = await linkUrl()
      if (!u) throw new Error("no_link")
      if (tab) {
        tab.opener = null
        tab.location.href = u
      } else window.open(u, "_blank", "noopener,noreferrer")
    } catch {
      tab?.close()
      toast({ title: t("failed"), variant: "destructive" })
    } finally {
      setBusy(null)
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
      <div className="mt-3 flex flex-wrap gap-2">
        {canShare && (
          <>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={copy} disabled={busy !== null}>
              {busy === "copy" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {t("copy")}
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onShare}>
              <Link2 size={14} aria-hidden="true" />
              {t("share")}
            </Button>
          </>
        )}
        <Button type="button" variant="outline" size="sm" className="gap-1.5 border-dashed" onClick={view} disabled={busy !== null}>
          {busy === "view" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
          {t("supplier_view")}
        </Button>
      </div>
    </Panel>
  )
}
