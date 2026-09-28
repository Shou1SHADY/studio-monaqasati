"use client"

// «امضِ بالشراء» — Inventory's one-day check window passed without an answer
// (the prototype's `late` form): buy only what the stores do not cover — the
// computed cover is relied on, not reserved — or the whole quantity. Holding
// a purchase hostage to Inventory's silence is worse than buying too much.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, Clock, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { NeedRow } from "@/lib/procurement/need-desk"
import { recordNeedDecision } from "@/lib/procurement/need-decision-writes"
import type { ProcActor } from "@/lib/procurement/types"
import { ProcWriteError } from "@/lib/procurement/writes"
import { cn } from "@/lib/utils"
import { qty } from "@/components/procurement/need-bits"

export function ProceedPurchaseDialog({ rows, actor, onClose }: { rows: NeedRow[]; actor: ProcActor; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const tProc = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [how, setHow] = useState<"short" | "full">("short")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cover = rows.map((r) => Math.min(Math.max(0, r.onHand ?? 0), r.total))
  const source = rows[0]?.need.source

  const go = async () => {
    if (!firestore || busy || !source || source.kind !== "project_request" || !source.projectId || !source.purchaseRequestId) return
    setBusy(true)
    setError(null)
    try {
      await recordNeedDecision(firestore, actor, { projectId: source.projectId, requestId: source.purchaseRequestId, kind: how === "short" ? "proceed_short" : "proceed_full", cover })
      toast({ title: t("nd_proceeded") })
      onClose()
    } catch (err) {
      console.error(err)
      setError(err instanceof ProcWriteError ? tProc(`err_${err.code}`, err.params) : t("nd_failed"))
    } finally {
      setBusy(false)
    }
  }

  const choice = (k: "short" | "full", label: string) => (
    <button
      key={k}
      type="button"
      aria-pressed={how === k}
      onClick={() => setHow(k)}
      className={cn(
        "min-h-11 rounded-lg border px-3 py-2 text-start text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        how === k ? "border-module bg-module text-white" : "border-border bg-card text-foreground hover:border-module/40"
      )}
    >
      {label}
    </button>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock size={18} className="text-warning" aria-hidden="true" /> {t("nd_proceed")}
          </DialogTitle>
          <DialogDescription>{t("nd_proceed_sub")}</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">{t("nd_how_much")}</legend>
          {choice("short", rows.map((r, i) => t("nd_short_only", { name: r.name, qty: qty(r.total - cover[i]), unit: r.unit })).join(" · "))}
          {choice("full", rows.map((r) => t("nd_full_qty", { name: r.name, qty: qty(r.total), unit: r.unit })).join(" · "))}
          <p className="text-[11px] text-muted-foreground">{t("nd_cover_hint", { cover: rows.map((r, i) => `${qty(cover[i])} ${r.unit}`).join(" · ") })}</p>
        </fieldset>
        <div className="rounded-xl border border-module/20 bg-module/5 p-3 text-xs leading-relaxed">
          <p className="mb-1 font-black text-module">{t("dor_effects")}</p>
          <p>{t(how === "short" ? "nd_effect_short" : "nd_effect_full")}</p>
          <p>{t("nd_effect_logged")}</p>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("acc_cancel")}
          </Button>
          <Button onClick={go} disabled={busy} className="gap-1.5 bg-module text-module-foreground hover:bg-module/90">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {t("nd_proceed_go")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
