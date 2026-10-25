"use client"

// One row of «يحتاج قرارك»: the colour of its urgency, the title and the sentence (an order's sentence IS its next-step sentence —
// one definition), who-it-waits-on never appears here (that is the right column), the amount with its basis (G-18), and the
// row's own direct button — plus a second one where the act has two doors («انشره» · «جهّزه»). «صعّد» does its act on the spot.

import { useState, type ElementType } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, ChevronLeft, ChevronRight, FileText, Inbox, Loader2, Mail, Scale, Truck } from "lucide-react"
import { Link } from "@/i18n/routing"
import { useToast } from "@/hooks/use-toast"
import { EscalateError, escalateNoticeCall } from "@/lib/procurement/notice-escalate-client"
import { presentParams, type Params } from "@/lib/procurement/today-present"
import type { Task, TaskSeverity } from "@/lib/procurement/today"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useStepSentence } from "./PoBits"

/** The tile's colour is the urgency; its icon is the KIND of row (the prototype's `inbox` · `scale` · `alert` · `mail` · `doc` · `truck`),
 * so a request, an RFQ to compare, a question, an order and a receipt read apart at a glance. */
const CHIP_ICON: Record<Task["chip"], ElementType> = { req: Inbox, rfq: Scale, po: FileText, rcv: Truck }
export function taskIcon(task: Pick<Task, "kind" | "chip">): ElementType {
  if (task.kind === "rfq_query") return Mail
  if (task.kind === "rfq_no_live") return AlertTriangle
  return CHIP_ICON[task.chip]
}
const SEVERITY_TILE: Record<TaskSeverity, string> = {
  red: "bg-destructive/10 text-destructive",
  amber: "bg-warning/10 text-warning",
  blue: "bg-module/10 text-module",
}

/** The user's own words inside a sentence (an RFQ's title, a supplier's name, a material) are isolated (FSI … PDI — `<bdi>` in text),
 * so an Arabic title inside an English sentence keeps its own order and the sentence keeps the page's direction. Select keys and
 * numbers are never touched. */
const USER_TEXT_KEYS = ["title", "ref", "name", "supplier", "buyer", "receiver", "text", "lines", "list", "note", "material", "question", "place", "need", "why", "project", "request", "what", "unit", "number", "invoice"]
export function isolateUserText(p: Params): Params {
  const out: Params = { ...p }
  for (const k of USER_TEXT_KEYS) {
    const v = out[k]
    if (typeof v === "string" && v) out[k] = `\u2068${v}\u2069`
  }
  return out
}

const buttonClass = (solid: boolean) =>
  cn(
    "inline-flex min-h-11 shrink-0 sm:min-h-9 items-center justify-center gap-1 rounded-lg border px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
    "max-sm:flex-1",
    solid ? "border-module bg-module text-white hover:bg-module/90" : "border-border bg-card text-foreground hover:border-module/40"
  )

export function TodayItem({ task }: { task: Task }) {
  const t = useTranslations("Portal.ProcToday")
  const tProc = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const { toast } = useToast()
  const stepText = useStepSentence()
  const Chevron = locale === "ar" ? ChevronLeft : ChevronRight
  const Icon = taskIcon(task)
  const [busy, setBusy] = useState(false)

  const present = (p: Params) => {
    const out = presentParams(p, locale, (key) => tProc(key))
    if (typeof out.where === "string") out.where = t(`modules.${out.where}`)
    return isolateUserText(out)
  }
  // «الباقي منه» is a pill after the title, the same one the incoming card wears — not words inside it.
  const remainderPill = task.kind === "need_request" && task.titleParams.remainder === 1
  const title = t(task.titleKey, present(remainderPill ? { ...task.titleParams, remainder: 0 } : task.titleParams))
  const sub = task.step ? stepText(task.step) : task.subNs === "Procurement" ? tProc(task.subKey, present(task.subParams)) : t(task.subKey, present(task.subParams))
  const solid = task.tier === "red" || task.kind === "approve"

  const escalate = async () => {
    if (!task.act || busy) return
    setBusy(true)
    try {
      const r = await escalateNoticeCall(task.act.deliveryId)
      toast({ title: t("escalated", { name: r.toName || "", hasName: r.toName ? 1 : 0 }) })
    } catch (error) {
      toast({ title: t("escalate_failed"), description: error instanceof EscalateError ? error.code : undefined, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3" data-testid={`today-${task.kind}`}>
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", SEVERITY_TILE[task.severity])}>
        <Icon size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-bold leading-snug text-foreground">
          {title}
          {remainderPill && (
            <StatusPill tone="violet" className="ms-1.5 align-middle text-[10px]">
              {t("remainderPill")}
            </StatusPill>
          )}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {sub}
          {task.kind === "reject_decide" && task.reasonCode && <span className="ms-1.5 inline-block rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">{tProc(`rejectReason.${task.reasonCode}`)}</span>}
        </p>
      </div>
      {task.amount != null && (
        <span className="flex shrink-0 flex-col items-end self-center text-end">
          <span className="text-sm font-black tabular-nums text-foreground" dir="ltr">
            {sarLtr(Math.round(task.amount).toLocaleString("en-US"))}
          </span>
          {task.basis && <span className="text-[10px] font-semibold text-muted-foreground">{t(`basis.${task.basis}`)}</span>}
        </span>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-2 self-center max-sm:ms-11 max-sm:basis-[calc(100%-2.75rem)]">
        {task.act ? (
          <button type="button" onClick={escalate} disabled={busy} className={buttonClass(solid)}>
            {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
            {t(task.actionKey)}
          </button>
        ) : (
          <Link href={task.href} className={buttonClass(solid)}>
            {t(task.actionKey)}
            {!task.secondary && <Chevron size={13} aria-hidden="true" />}
          </Link>
        )}
        {task.secondary && (
          <Link href={task.secondary.href} className={buttonClass(false)}>
            {t(task.secondary.actionKey)}
          </Link>
        )}
      </div>
    </li>
  )
}
