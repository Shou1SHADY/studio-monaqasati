"use client"

// «بانتظار تأكيدك» — the storekeeper's side of a manual receipt (RCV-05, `proc:GRN:<no>:MAN`). A purchase made outside the platform and
// delivered to a MAIN warehouse reaches him as a draft; confirming it lands the stock, declining (with a reason) moves nothing and tells the
// buyer. Shown to whoever holds `warehouses.receive` / `warehouses.manage`; mounted on the receipts page and ready for Inventory's own desk.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getAuth } from "firebase/auth"
import { Check, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { displayReceiptNumber } from "@/lib/procurement/format"
import { receiptDay } from "@/lib/procurement/po"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"

export const pendingDrafts = (deliveries: DeskDelivery[]): DeskDelivery[] => deliveries.filter((d) => d.source === "manual" && d.manualDraft?.state === "draft")

export function ManualDraftInbox({ deliveries, warehouseName }: { deliveries: DeskDelivery[]; warehouseName: (id: string | null | undefined) => string | null }) {
  const t = useTranslations("Portal.ProcReceipts.draft")
  const locale = useLocale()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [declining, setDeclining] = useState<string | null>(null)
  const [why, setWhy] = useState("")
  const drafts = pendingDrafts(deliveries)
  if (!drafts.length) return null

  const answer = async (d: DeskDelivery, verdict: "confirm" | "decline") => {
    const user = getAuth().currentUser
    if (!user) return
    setBusy(d.id)
    try {
      const res = await fetch("/api/procurement/manual-receipt/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ deliveryId: d.id, answer: verdict, note: verdict === "decline" ? why.trim() : null }),
      })
      if (res.ok) {
        toast({ title: t(verdict === "confirm" ? "confirmed" : "declined", { number: displayReceiptNumber(d.docNumber, locale) }) })
        setDeclining(null)
        setWhy("")
      } else toast({ title: t("failed"), variant: "destructive" })
    } catch {
      toast({ title: t("failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/60" aria-label={t("title")}>
      <header className="space-y-0.5 border-b border-amber-200 px-4 py-3">
        <h2 className="text-sm font-bold text-amber-900">
          {t("title")} <span className="tabular-nums">{drafts.length}</span>
        </h2>
        <p className="text-xs text-amber-900/80">{t("sub")}</p>
      </header>
      <ul className="divide-y divide-amber-200">
        {drafts.map((d) => (
          <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-0.5 text-sm">
              <p className="font-bold" dir="auto">
                {displayReceiptNumber(d.docNumber, locale)} · {d.supplierName}
              </p>
              <p className="text-xs text-muted-foreground" dir="auto">
                {(d.items || []).map((it) => `${it.quantity ?? ""} ${it.unitOfMeasure || it.unit || ""} ${it.name || ""}`.trim()).join(" · ")}
              </p>
              <p className="text-[11px] text-muted-foreground" dir="auto">
                {warehouseName(d.manualDraft?.warehouseId) || "—"} · {receiptDay(d)} · {t("by", { name: d.manualDraft?.byName || d.confirmedByName || "" })}
              </p>
              {declining === d.id && <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t("why")} aria-label={t("why")} className="mt-2 h-9" dir="auto" />}
            </div>
            <div className="flex shrink-0 gap-2">
              {declining === d.id ? (
                <>
                  <Button size="sm" variant="destructive" className="h-9 gap-1" disabled={busy === d.id || why.trim().length < 3} onClick={() => void answer(d, "decline")}>
                    {busy === d.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
                    {t("decline")}
                  </Button>
                  <Button size="sm" variant="outline" className="h-9" onClick={() => setDeclining(null)}>
                    {t("back")}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" className="h-9 gap-1" disabled={busy === d.id} onClick={() => void answer(d, "confirm")}>
                    {busy === d.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
                    {t("confirm")}
                  </Button>
                  <Button size="sm" variant="outline" className="h-9" onClick={() => setDeclining(d.id)}>
                    {t("decline")}
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
