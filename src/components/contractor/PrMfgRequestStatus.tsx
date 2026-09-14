"use client"

// What became of a purchase request Procurement routed to make: awaiting the
// workshop's answer, accepted (with its work orders), partly accepted (the
// returned quantities are Procurement's to buy), declined with the reason, or
// moved to purchase. After the answer window an unanswered request may be
// bought instead (REQ-07) — Procurement's act, read by Manufacturing.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, Clock, Factory, Loader2, ShoppingCart, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { MfgSettings } from "@/lib/manufacturing-engine"
import { moveRequestToPurchase, type Actor } from "@/lib/manufacturing-writes"
import { emitMfgEvent, mfgLinks } from "@/lib/mfg-events"
import type { ManufacturingRequest } from "@/lib/sales-orders"
import { ageText, errText } from "@/components/inventory/MfgOutsideBits"

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })

export function PrMfgRequestStatus({
  request,
  settings,
  nowMs,
  canBuy,
  actor,
}: {
  request: ManufacturingRequest
  settings: MfgSettings
  nowMs: number
  canBuy: boolean
  actor: Actor
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const hours = request.requestedAt ? Math.max(0, (nowMs - new Date(request.requestedAt).getTime()) / 3600000) : 0
  const overdue = request.status === "new" && hours >= settings.answerWindowHours
  const refs = (request.workOrderDocNumbers || []).join(" · ")
  const partialLines = (request.lines || []).filter((l) => (l.returnedQuantity || 0) > 0)

  const buy = async () => {
    if (!firestore || busy) return
    setBusy(true)
    try {
      await moveRequestToPurchase(firestore, { request, actor })
      toast({ title: t("mfx_pr_moved_toast", { ref: request.requestNumber }) })
      // mfg.request.moved — the workshop drops it from its queue knowingly.
      await emitMfgEvent(firestore, {
        kind: "request_moved_to_purchase",
        copy: t,
        organizationId: request.organizationId,
        actor,
        to: [{ permission: "manufacturing.manage" }],
        params: { number: request.requestNumber },
        link: mfgLinks.request(request.id),
      })
      setConfirming(false)
    } catch (err) {
      console.error(err)
      toast({ title: errText(t, err), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const tone =
    request.status === "accepted"
      ? "border-success/25 bg-success/5 text-success"
      : request.status === "partial"
        ? "border-warning/25 bg-warning/5 text-warning"
        : request.status === "rejected" || overdue
          ? "border-destructive/25 bg-destructive/5 text-destructive"
          : request.status === "moved"
            ? "border-slate-200 bg-slate-50 text-slate-600"
            : "border-cta/20 bg-cta/5 text-cta"
  const Icon = request.status === "accepted" ? CheckCircle2 : request.status === "rejected" ? XCircle : request.status === "moved" ? ShoppingCart : request.status === "new" ? Clock : Factory

  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border px-3 py-2 text-xs sm:flex-row sm:items-center", tone)}>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 space-y-0.5">
          <p className="font-semibold">
            <span className="font-mono" dir="ltr">{request.requestNumber}</span>
            {" — "}
            {request.status === "new" && (overdue ? t("mfx_pr_status_overdue", { age: ageText(t, hours), hours: settings.answerWindowHours }) : t("mfx_pr_status_new", { age: ageText(t, hours) }))}
            {request.status === "accepted" && t("mfx_pr_status_accepted", { refs: refs || "—" })}
            {request.status === "partial" && t("mfx_pr_status_partial", { refs: refs || "—" })}
            {request.status === "rejected" && t("mfx_pr_status_rejected", { reason: request.rejectionReason || request.answerNote || "—" })}
            {request.status === "moved" && t("mfx_pr_status_moved", { name: request.decidedByUserName || "" })}
            {request.status === "estimated" && t("mfx_pr_status_estimated")}
          </p>
          {request.status === "partial" &&
            partialLines.map((l, i) => (
              <p key={i} className="text-[11px] font-normal text-slate-700">
                {t("mfx_pr_partial_line", { item: l.itemName, make: fmt(l.makeQuantity || 0), returned: fmt(l.returnedQuantity || 0), unit: l.unit })}
              </p>
            ))}
          {request.status === "rejected" && <p className="text-[11px] font-normal text-slate-700">{t("mfx_pr_rejected_hint")}</p>}
          {request.decidedByUserName && request.status !== "moved" && request.status !== "new" && (
            <p className="text-[11px] font-normal text-muted-foreground">{t("mfx_pr_answered_by", { name: request.decidedByUserName })}</p>
          )}
        </div>
      </div>
      {overdue && canBuy && (
        <Button size="sm" variant="outline" className="h-9 shrink-0 gap-1.5 border-destructive/30 bg-white text-destructive hover:bg-destructive hover:text-white" onClick={() => setConfirming(true)}>
          <ShoppingCart size={13} aria-hidden="true" />
          {t("mfx_pr_buy_btn")}
        </Button>
      )}

      <AlertDialog open={confirming} onOpenChange={(open) => { if (!open && !busy) setConfirming(false) }}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("mfx_pr_buy_title", { ref: request.requestNumber })}</AlertDialogTitle>
            <AlertDialogDescription>{t("mfx_pr_buy_desc", { hours: settings.answerWindowHours })}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="rounded-xl border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
            {t("mfg4_recorded_as", { name: actor.name })} — {t("mfg4_from_signin")}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("crm_cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void buy()
              }}
              disabled={busy}
              className="gap-2"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />}
              {t("mfx_pr_buy_btn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
