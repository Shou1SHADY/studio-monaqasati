"use client"

// The RFQ's life actions in one row (Procurement 2.0 RFQ-13…15, WF-26): «مدّد» while it is open, «أعد فتحه» once its date has passed
// without an award, «ذكّر من لم يقدّم» while open, «ألغِ الطلب» in either. Shown to whoever runs this RFQ, never after an award or a
// cancellation. The dialogs run the server acts; the row only chooses which.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Bell, CalendarPlus, RotateCcw, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { riyadhDay } from "@/lib/hr/format"
import { actsOnRfq, type RfqWriteActor } from "@/lib/procurement/rfq-access"
import type { LifecycleResult } from "@/lib/procurement/rfq-server/lifecycle"
import { CancelRfqDialog, ExtendRfqDialog, RemindRfqDialog } from "./RfqLifecycleDialogs"
import { RFQ_EXTEND_EVENT } from "./rfqPageEvents"

export interface LifecycleRfq {
  id: string
  status?: string | null
  deadline?: string | null
  rfqNumber?: string | null
  title?: string | null
  directAward?: boolean | null
  closedEarly?: unknown
  createdByUserId?: string | null
  contractorId?: string | null
  offersCount?: number | null
  needSources?: unknown[] | null
  purchaseSource?: unknown
  products?: Array<{ needSource?: unknown } | null> | null
}

/** The state the row reads: open until the date passes (or an early close), then comparing. */
export function lifecycleState(rfq: Pick<LifecycleRfq, "status" | "deadline" | "closedEarly">, today: string): "open" | "compare" | null {
  if (rfq.status !== "New") return null
  const day = (rfq.deadline || "").slice(0, 10)
  return rfq.closedEarly || (day && day < today) ? "compare" : "open"
}

export const rfqHasNeeds = (rfq: Pick<LifecycleRfq, "needSources" | "purchaseSource" | "products">): boolean =>
  Boolean((rfq.needSources && rfq.needSources.length) || rfq.purchaseSource || (rfq.products || []).some((p) => p?.needSource))

type Dialog = "extend" | "cancel" | "remind" | null

/** Everything the row and the banner share: the open dialog, the toasts, the refresh. */
export function useRfqLifecycle(rfq: LifecycleRfq, onChanged?: () => void) {
  const t = useTranslations("Portal.Procurement.rfqlife")
  const { toast } = useToast()
  const [dialog, setDialog] = useState<Dialog>(null)
  useEffect(() => {
    const open = (e: Event) => {
      if ((e as CustomEvent<{ rfqId?: string }>).detail?.rfqId === rfq.id) setDialog("extend")
    }
    window.addEventListener(RFQ_EXTEND_EVENT, open)
    return () => window.removeEventListener(RFQ_EXTEND_EVENT, open)
  }, [rfq.id])
  const done = (r: LifecycleResult) => {
    if (r.action === "cancel") toast({ title: t("done_cancelled", { count: r.count ?? 0 }) })
    else if (r.action === "remind") toast({ title: t("done_remind", { count: r.told ?? 0 }) })
    else toast({ title: r.reopened ? t("done_reopened", { date: r.deadline ?? "" }) : t("done_extended", { date: r.deadline ?? "" }) })
    if (r.action !== "remind") setDialog(null)
    onChanged?.()
  }
  return { dialog, setDialog, done }
}

export function RfqLifecycleDialogs({ rfq, state }: { rfq: LifecycleRfq; state: ReturnType<typeof useRfqLifecycle> }) {
  const reopen = lifecycleState(rfq, riyadhDay()) === "compare"
  return (
    <>
      <ExtendRfqDialog open={state.dialog === "extend"} onOpenChange={(o) => !o && state.setDialog(null)} rfq={rfq} reopen={reopen} onDone={state.done} />
      <CancelRfqDialog open={state.dialog === "cancel"} onOpenChange={(o) => !o && state.setDialog(null)} rfq={rfq} hasNeeds={rfqHasNeeds(rfq)} onDone={state.done} />
      <RemindRfqDialog open={state.dialog === "remind"} onOpenChange={(o) => !o && state.setDialog(null)} rfq={rfq} onDone={state.done} />
    </>
  )
}

export function RfqLifecycleBar({ rfq, actor, onChanged }: { rfq: LifecycleRfq; actor: RfqWriteActor; onChanged?: () => void }) {
  const t = useTranslations("Portal.Procurement.rfqlife")
  const state = useRfqLifecycle(rfq, onChanged)
  const phase = lifecycleState(rfq, riyadhDay())
  if (!phase || !actsOnRfq(rfq, actor)) return null
  return (
    <div className="flex flex-wrap items-center gap-2" data-rfq={rfq.id}>
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => state.setDialog("extend")}>
        {phase === "compare" ? <RotateCcw size={14} aria-hidden="true" /> : <CalendarPlus size={14} aria-hidden="true" />}
        {phase === "compare" ? t("reopen") : t("extend")}
      </Button>
      {phase === "open" && (
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => state.setDialog("remind")}>
          <Bell size={14} aria-hidden="true" /> {t("remind")}
        </Button>
      )}
      <Button type="button" variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => state.setDialog("cancel")}>
        <XCircle size={14} aria-hidden="true" /> {t("cancel")}
      </Button>
      <RfqLifecycleDialogs rfq={rfq} state={state} />
    </div>
  )
}
