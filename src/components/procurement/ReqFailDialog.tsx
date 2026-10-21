"use client"

// «تعذّر الشراء» (Procurement 2.0, INC-11, WF-27): what is still to be bought of an incoming request is closed with a reason
// (no offers by the deadline · prices far above budget · not available on the market · another reason ≥ 4 characters) and an
// optional alternative. What is already in an RFQ or an order carries on. The requester reads the reason and the alternative; a
// project reads the same on the line. The server does it (/api/procurement/incoming, action `fail`).

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getAuth } from "firebase/auth"
import { Loader2, OctagonAlert } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Chip } from "@/components/module-ui/Chip"
import { displayNeedRef } from "@/lib/procurement/format"
import { FAIL_OTHER_MIN, FAIL_REASONS, type FailReason } from "@/lib/procurement/incoming-state"
import type { RequestCard } from "@/lib/procurement/incoming-requests"

export function ReqFailDialog({ card, onClose, onDone }: { card: RequestCard | null; onClose: () => void; onDone?: () => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const { toast } = useToast()
  const [why, setWhy] = useState<FailReason | null>(null)
  const [note, setNote] = useState("")
  const [alt, setAlt] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const doc = card?.need.incoming
  const ready = Boolean(why) && (why !== "other" || note.trim().length >= FAIL_OTHER_MIN)

  const close = () => {
    if (busy) return
    setWhy(null)
    setNote("")
    setAlt("")
    setError(null)
    onClose()
  }

  const submit = async () => {
    if (!card || !doc || !why || !ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const token = (await getAuth().currentUser?.getIdToken()) || ""
      const res = await fetch("/api/procurement/incoming", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "fail", mrKey: doc.mrKey, reason: why, note: why === "other" ? note.trim() : null, alt: alt.trim() || null }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null
        setError(body?.code === "NOTHING_TO_CLOSE" ? t("rf_nothing") : t("rf_failed"))
        return
      }
      toast({ title: t("rf_done", { name: doc.requestedFor.name || doc.requestedBy.name }) })
      onDone?.()
      setWhy(null)
      setNote("")
      setAlt("")
      onClose()
    } catch {
      setError(t("rf_failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!card} onOpenChange={(o) => !o && close()}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-md">
        {card && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <OctagonAlert size={18} className="text-destructive" aria-hidden="true" />
                {t("rf_title")}
              </DialogTitle>
              <DialogDescription>{t("rf_desc", { count: card.buyLines, ref: displayNeedRef(card.need.refLabel, locale) })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("rf_title")}>
                {FAIL_REASONS.map((code) => (
                  <Chip key={code} selected={why === code} aria-pressed={why === code} onClick={() => setWhy(code)}>
                    {t(`rf_why_${code}`)}
                  </Chip>
                ))}
              </div>
              {why === "other" && (
                <div className="space-y-1">
                  <Label htmlFor="rf-note" className="sr-only">
                    {t("rf_other_ph")}
                  </Label>
                  <Input id="rf-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("rf_other_ph")} dir="auto" aria-invalid={note.trim().length < FAIL_OTHER_MIN || undefined} />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="rf-alt" className="text-xs">
                  {t("rf_alt")} <span className="text-muted-foreground">{t("rf_alt_opt")}</span>
                </Label>
                <Input id="rf-alt" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder={t("rf_alt_ph")} dir="auto" />
              </div>
              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={close} disabled={busy}>
                {t("rf_back")}
              </Button>
              <Button variant="destructive" onClick={() => void submit()} disabled={!ready || busy} className="gap-1.5">
                {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {t("rf_go")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
