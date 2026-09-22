"use client"

// The purchase order's drawer (PRD 3.0 §5.1, §6.1–6.2). One grammar for every
// state: header → next step (the computed facts and only the buttons this
// person may press; when the step is somebody else's it says who and shows
// no button) → the money trail → line progress → deliveries → award facts →
// documents → log. Every button re-runs the domain predicate before it shows,
// and the write re-runs it again inside its transaction; a refusal comes back
// as a `ProcWriteError` code and is shown as the sentence for that code.

import { useMemo, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, Clock, FileText, Info, Printer, Star } from "lucide-react"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import type { ProcurementWorld } from "@/hooks/useProcurementWorld"
import { Link } from "@/i18n/routing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { displayPoNumber, displayReceiptNumber } from "@/lib/procurement/format"
import { approvalRefusal, canRecordAcceptance, canSend, canUpdateDate, daysLate, isSelfApproval, lineToArrive, poBlocks, poStatus, receiptDay, receiptsOf } from "@/lib/procurement/po"
import { receiptState, type ReceiptState } from "@/lib/procurement/receipts"
import type { PoLine, PoLogEntry, PoSendChannel, PurchaseOrder, RejectDecision } from "@/lib/procurement/types"
import {
  ProcWriteError,
  approvePurchaseOrder,
  cancelPurchaseOrder,
  cancelRemainder,
  closePurchaseOrder,
  decideReject,
  ratePurchaseOrder,
  recordSupplierAcceptance,
  remindSupplier,
  resubmitPurchaseOrder,
  returnPurchaseOrder,
  sendPurchaseOrder,
  updatePromisedDate,
  type RatingInput,
  type WriteOpts,
} from "@/lib/procurement/writes"
import { DateDialog, ReasonDialog, RejectDecisionDialog } from "./PoActionDialogs"
import { HonestDateText, LineBar, Money, PoStatusPill, useDateText } from "./PoBits"
import {
  actorCanExpedite,
  actorCanResubmit,
  actorCanReturn,
  buildPoPrintModel,
  buildStatementModel,
  canCancelOrder,
  canCloseComplete,
  canCloseShort,
  canRateNow,
  figure,
  lineActions,
  lineParts,
  moneyTrail,
  quantityText,
  type PrintCompany,
} from "./PoModel"
import { printPurchaseOrder, printReceiptStatement } from "./PoPrint"
import { PoRateDialog } from "./PoRateDialog"
import { PoSendDialog } from "./PoSendDialog"

type Tone = "red" | "amber" | "blue" | "green"

function Callout({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  const Icon = tone === "green" ? CheckCircle2 : tone === "blue" ? Info : AlertTriangle
  return (
    <div
      className={cn(
        "flex gap-2 rounded-lg border px-3 py-2 text-sm leading-relaxed",
        tone === "red" && "border-destructive/30 bg-destructive/5 text-destructive",
        tone === "amber" && "border-warning/30 bg-warning/5 text-warning",
        tone === "blue" && "border-cta/30 bg-cta/5 text-cta",
        tone === "green" && "border-success/30 bg-success/5 text-success",
        className
      )}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-foreground/90">{children}</div>
    </div>
  )
}

function Section({ title, badge, action, children }: { title: string; badge?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-muted-foreground">
          {title}
          {badge}
        </h3>
        {action}
      </header>
      <div className="space-y-3 px-3 py-3">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <div className="min-w-0">
        <p>{label}</p>
        {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0 font-bold">{children}</div>
    </div>
  )
}

const RECEIPT_TONE: Record<ReceiptState, string> = {
  on_the_way: "bg-module/10 text-module",
  late_notice: "bg-destructive/10 text-destructive",
  received: "bg-success/10 text-success",
  received_with_rejects: "bg-destructive/10 text-destructive",
  received_held: "bg-warning/10 text-warning",
  received_short: "bg-warning/10 text-warning",
  manual_no_po: "bg-muted text-muted-foreground",
}

type DialogState =
  | null
  | { kind: "return" }
  | { kind: "send" }
  | { kind: "accept" }
  | { kind: "date" }
  | { kind: "cancel_line"; line: PoLine }
  | { kind: "reject"; line: PoLine }
  | { kind: "close_short" }
  | { kind: "cancel_order" }
  | { kind: "rate" }

export function PoDrawer({ po, world, open, onOpenChange, now }: { po: PurchaseOrder | null; world: ProcurementWorld; open: boolean; onOpenChange: (open: boolean) => void; now: Date }) {
  const t = useTranslations("Portal.ProcOrders")
  const tProc = useTranslations("Portal.Procurement")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale() as "ar" | "en"
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const fmt = useDateText()
  const { actor, policies } = world
  const { profile } = useResolvedProfile(actor.uid || null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const receipts = useMemo(() => (po ? receiptsOf(po, world.deliveries) : []), [po, world.deliveries])
  const deliveries = useMemo(
    () => (po ? world.deliveries.filter((d) => d.poId === po.id).sort((a, b) => (receiptDay(b) || "").localeCompare(receiptDay(a) || "")) : []),
    [po, world.deliveries]
  )
  const blocks = useMemo(
    () => (po && po.status === "awaiting_approval" ? poBlocks(po, { supplier: world.supplierFacts.get(po.supplierOrgId) ?? null, otherOrders: world.orders, policies, now }) : []),
    [po, world.supplierFacts, world.orders, policies, now]
  )

  // The writes stamp their own clock: the page's `now` is a render-time value.
  const opts: WriteOpts = { copy: tShared, locale, orgName: world.orgName }

  /** Runs a write; a refusal is shown as the sentence for its code. Resolves whether it succeeded. */
  const run = async (key: string, fn: () => Promise<unknown>, successKey?: string): Promise<boolean> => {
    if (!firestore) return false
    setBusy(key)
    try {
      await fn()
      if (successKey) toast({ title: t(successKey) })
      return true
    } catch (err) {
      if (err instanceof ProcWriteError) toast({ title: tProc(`err_${err.code}`, err.params), variant: "destructive" })
      else {
        console.error(err)
        toast({ title: t("toast.failed"), variant: "destructive" })
      }
      return false
    } finally {
      setBusy(null)
    }
  }

  const company: PrintCompany = useMemo(() => {
    const p = (profile || {}) as { companyName?: string; name?: string; crNumber?: string; taxNumber?: string; city?: string; location?: string; phone?: string; phoneNumber?: string; email?: string }
    return { name: p.companyName || world.orgName || p.name || "", cr: p.crNumber || null, vat: p.taxNumber || null, address: p.location || p.city || null, phone: p.phone || p.phoneNumber || null, email: p.email || null }
  }, [profile, world.orgName])

  const tPrint = (key: string, params?: Record<string, string | number>) => t(`print.${key}`, params)

  if (!po) return null
  const status = poStatus(po)
  const number = displayPoNumber(po.docNumber, locale)
  const money = moneyTrail(po)
  const f = firestore

  const printOrder = () => {
    if (!printPurchaseOrder(buildPoPrintModel(po, company, actor.seesPrices), number, locale, tPrint, now)) toast({ title: t("toast.popup_blocked"), variant: "destructive" })
  }
  const printStatement = () => {
    if (!printReceiptStatement(buildStatementModel(po, world.deliveries, company, now), number, (n) => displayReceiptNumber(n, locale), locale, tPrint)) toast({ title: t("toast.popup_blocked"), variant: "destructive" })
  }

  // ── Next step ──────────────────────────────────────────────────────────
  const nextStep = (): ReactNode => {
    const expediter = actorCanExpedite(actor)
    const cancelLink = f && canCancelOrder(po, actor) && (
      <Button variant="link" size="sm" className="h-auto p-0 text-destructive" onClick={() => setDialog({ kind: "cancel_order" })}>
        {t("next.cancel_order")}
      </Button>
    )
    switch (status) {
      case "awaiting_approval": {
        if (po.returnedReason) {
          return (
            <>
              <Callout tone="red">
                <b>{t("next.returned_title")}</b> — {po.returnedReason}
              </Callout>
              {f && actorCanResubmit(po, actor) ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={busy != null} onClick={() => run("resubmit", () => resubmitPurchaseOrder(f, actor, po.id, null, opts), "toast.resubmitted")}>
                    {t("next.resubmit")}
                  </Button>
                  {cancelLink}
                </div>
              ) : (
                <Callout tone="blue">{t("next.awaiting_resubmission", { by: po.preparedByName })}</Callout>
              )}
            </>
          )
        }
        const refusal = approvalRefusal(po, actor, policies)
        const flags: ReactNode[] = []
        if (po.basis === "retroactive") flags.push(<Callout key="retro" tone="amber">{t("next.flag_retroactive")}</Callout>)
        if (po.shortCompetition) flags.push(<Callout key="short" tone="amber">{t("next.flag_short_competition", { count: po.offersCount })}</Callout>)
        if (po.lowestOfferTotal != null && po.totalExVat > po.lowestOfferTotal)
          flags.push(
            <Callout key="lowest" tone="blue">
              {t("next.flag_non_lowest", { reason: po.awardReasonCode ? tProc(`awardReason.${po.awardReasonCode}`) : "—" })}
              {po.awardReasonText ? ` — ${po.awardReasonText}` : ""}
            </Callout>
          )
        if (po.noOfficialQuote && po.basis !== "retroactive") flags.push(<Callout key="quote" tone="amber">{t("next.flag_no_official_quote")}</Callout>)
        return (
          <>
            {blocks.map((b) => (
              <Callout key={b.code} tone="red">
                {tProc(`blocks.${b.code}`, b.params)}
              </Callout>
            ))}
            {flags}
            {!refusal && f ? (
              <>
                {isSelfApproval(po, actor) && <Callout tone="amber">{tProc("selfApproval")}</Callout>}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={busy != null || blocks.length > 0}
                    title={blocks.length ? t("next.approve_blocked") : undefined}
                    onClick={() =>
                      run(
                        "approve",
                        () => approvePurchaseOrder(f, actor, po.id, { policies, blocks: { supplier: world.supplierFacts.get(po.supplierOrgId) ?? null, otherOrders: world.orders } }, opts),
                        "toast.approved"
                      )
                    }
                  >
                    {t("next.approve")}
                  </Button>
                  <Button variant="outline" disabled={busy != null} onClick={() => setDialog({ kind: "return" })}>
                    {t("next.return")}
                  </Button>
                  {cancelLink}
                </div>
              </>
            ) : (
              <>
                <Callout tone="blue">
                  {t("next.awaiting_approver", { approver: tProc(`approver.${po.approverKind}`) })}
                  {refusal && actor.canApprove && refusal.code !== "not_awaiting" ? ` — ${tProc(`refusal.${refusal.code}`, refusal.params)}` : ""}
                </Callout>
                {f && actorCanReturn(actor) && refusal?.code === "own_order" && (
                  <Button variant="outline" size="sm" disabled={busy != null} onClick={() => setDialog({ kind: "return" })}>
                    {t("next.return")}
                  </Button>
                )}
                {cancelLink}
              </>
            )}
          </>
        )
      }
      case "approved":
        return (
          <>
            <Callout tone="green">
              {t("next.approved_body", { by: po.approvedByName || "—", date: fmt(po.approvedAt), supplier: po.supplierName })}
            </Callout>
            <div className="flex flex-wrap items-center gap-2">
              {f && expediter && canSend(po) && (
                <Button disabled={busy != null} onClick={() => setDialog({ kind: "send" })}>
                  {t("next.send")}
                </Button>
              )}
              {cancelLink}
            </div>
          </>
        )
      case "sent":
        return (
          <>
            <Callout tone="blue">{t("next.sent_body", { channel: po.sentChannel ? tProc(`channel.${po.sentChannel}`) : "—", date: fmt(po.sentAt) })}</Callout>
            <div className="flex flex-wrap items-center gap-2">
              {f && expediter && canRecordAcceptance(po) && (
                <Button disabled={busy != null} onClick={() => setDialog({ kind: "accept" })}>
                  {t("next.record_acceptance")}
                </Button>
              )}
              {f && expediter && (
                <Button variant="outline" disabled={busy != null} onClick={() => run("remind", () => remindSupplier(f, actor, po.id, opts), po.supplierUserId ? "toast.reminded_portal" : "toast.reminded_offline")}>
                  {t("next.remind")}
                </Button>
              )}
              {cancelLink}
            </div>
          </>
        )
      case "in_delivery":
      case "part_received": {
        const late = daysLate(po, now)
        return (
          <>
            {late > 0 ? (
              <Callout tone="red">{t("next.late_body", { days: late })}</Callout>
            ) : po.promisedDate ? (
              <Callout tone="blue">{t("next.promised_body", { date: fmt(po.promisedDate) })}</Callout>
            ) : (
              <Callout tone="amber">{t("next.no_date_body")}</Callout>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {f && expediter && canUpdateDate(po) && (
                <Button variant={late > 0 ? "default" : "outline"} disabled={busy != null} onClick={() => setDialog({ kind: "date" })}>
                  {t("next.update_date")}
                </Button>
              )}
              {f && expediter && canUpdateDate(po) && (
                <Button variant="outline" disabled={busy != null} onClick={() => run("remind", () => remindSupplier(f, actor, po.id, opts), po.supplierUserId ? "toast.reminded_portal" : "toast.reminded_offline")}>
                  {t("next.remind")}
                </Button>
              )}
              {f && canCloseShort(po, actor) && (
                <Button variant="ghost" disabled={busy != null} onClick={() => setDialog({ kind: "close_short" })}>
                  {t("next.close_short")}
                </Button>
              )}
              {cancelLink}
            </div>
          </>
        )
      }
      case "received":
        return (
          <>
            <Callout tone="green">{t("next.received_body")}</Callout>
            <div className="flex flex-wrap items-center gap-2">
              {f && canCloseComplete(po, actor) && (
                <Button disabled={busy != null} onClick={() => run("close", () => closePurchaseOrder(f, actor, po.id, {}, opts), "toast.closed")}>
                  {t("next.close")}
                </Button>
              )}
              {f && canRateNow(po, world.deliveries, actor) && (
                <Button variant="outline" className="gap-2" disabled={busy != null} onClick={() => setDialog({ kind: "rate" })}>
                  <Star size={15} aria-hidden="true" />
                  {t("next.rate")}
                </Button>
              )}
            </div>
          </>
        )
      case "closed":
        return (
          <>
            <Callout tone={po.closedShort ? "amber" : "green"}>
              {po.closedShort ? t("next.closed_short_body", { reason: po.closeReason || "—" }) : t("next.closed_body")}
              {po.closedAt ? ` · ${fmt(po.closedAt)}` : ""}
            </Callout>
            {po.rating ? (
              <div className="rounded-lg border px-3 py-2 text-sm">
                <p className="font-bold">{t("next.rated_title", { conformity: po.rating.conformity, cooperation: po.rating.cooperation })}</p>
                <p className="text-xs text-muted-foreground">
                  {po.rating.byName} · {fmt(po.rating.at)} · {po.rating.publishAnonymously ? t("next.rated_published") : t("next.rated_internal")}
                </p>
                {po.rating.note && <p className="mt-1 text-xs">{po.rating.note}</p>}
              </div>
            ) : (
              f &&
              canRateNow(po, world.deliveries, actor) && (
                <Button variant="outline" className="gap-2" disabled={busy != null} onClick={() => setDialog({ kind: "rate" })}>
                  <Star size={15} aria-hidden="true" />
                  {t("next.rate")}
                </Button>
              )
            )}
          </>
        )
      case "cancelled":
        return <Callout tone="amber">{t("next.cancelled_body", { reason: po.cancelledReason || "—" })}</Callout>
      default:
        return null
    }
  }

  // ── Log ────────────────────────────────────────────────────────────────
  const logSentence = (e: PoLogEntry): string => {
    const p = e.params || {}
    const params: Record<string, string | number> = {
      by: e.byName || "—",
      note: e.note || "",
      date: p.date ? fmt(String(p.date)) : "",
      number: p.number ? displayReceiptNumber(String(p.number), locale) : "",
      channel: p.channel ? tProc(`channel.${String(p.channel) as PoSendChannel}`) : "",
      decision: p.decision ? tProc(`rejectDecision.${String(p.decision) as RejectDecision}`) : "",
    }
    let s = tProc(`log.${e.action}`, params)
    if (e.action === "approved" && p.selfApproved) s += ` · ${tProc("selfApproval")}`
    if (e.action === "closed" && p.short) s += ` · ${tProc("status.closed_short")}`
    if (e.action === "date_updated" && e.note) s += ` — ${e.note}`
    return s
  }
  const log = [...(po.log || [])].reverse()

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side={isRtl ? "left" : "right"} dir={isRtl ? "rtl" : "ltr"} className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
          <SheetHeader className="space-y-2 border-b px-4 py-4 text-start sm:px-6">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-module/10 text-module">
                <FileText size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <SheetTitle className="flex flex-wrap items-center gap-2 text-lg font-black leading-relaxed text-primary">
                  <span dir="ltr" className="tabular-nums">
                    {number}
                  </span>
                  <PoStatusPill po={po} now={now} />
                  <Badge variant="outline" className="text-[11px] font-normal">
                    {tProc(`basis.${po.basis}`)}
                  </Badge>
                </SheetTitle>
                <SheetDescription className="text-sm text-foreground">
                  <span className="font-bold">{po.supplierName}</span>
                  {po.rfqTitle ? ` · ${po.rfqTitle}` : ""}
                  {po.projectName ? ` · ${po.projectName}` : ""}
                </SheetDescription>
                <p className="text-xs text-muted-foreground">{t("head.prepared", { by: po.preparedByName, date: fmt(po.createdAt) })}</p>
              </div>
            </div>
          </SheetHeader>

          <div className="space-y-4 px-4 py-4 sm:px-6">
            <Section title={t("sec.next_step")}>{nextStep()}</Section>

            {actor.seesPrices && (
              <Section title={t("sec.money")} badge={<Badge variant="outline" className="text-[10px] font-normal">{t("sec.money_badge")}</Badge>}>
                <Row label={t("money.ex_vat")}>
                  <Money value={money.exVat} />
                </Row>
                <Row label={t("money.vat", { rate: Math.round(po.vatRate * 100) })}>
                  <Money value={money.vat} />
                </Row>
                <Row label={t("money.commitment")} hint={po.approvedAt ? t("money.commitment_hint_approved", { date: fmt(po.approvedAt) }) : t("money.commitment_hint_pending")}>
                  <Money value={money.commitment} />
                </Row>
                <Row label={t("money.accepted")} hint={money.accepted == null ? t("money.accepted_unknown") : t("money.accepted_hint")}>
                  {money.accepted == null ? <span className="text-muted-foreground">—</span> : <Money value={money.accepted} />}
                </Row>
                <Row label={t("money.open")} hint={money.lumpSum ? t("money.open_lump_hint") : undefined}>
                  <Money value={money.open} />
                </Row>
                <p className="text-[11px] leading-relaxed text-muted-foreground">{t("money.footer")}</p>
              </Section>
            )}

            <Section title={t("sec.lines", { count: po.lines.length })}>
              {po.lines.map((l) => {
                const acts = lineActions(po, l, actor)
                const parts = lineParts(l)
                return (
                  <div key={l.id} className="space-y-2 border-b pb-3 last:border-b-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 text-sm font-bold" dir="auto">
                        {l.name}
                      </p>
                      <p className="shrink-0 text-sm tabular-nums">
                        {quantityText(parts.ordered, l.unit)}
                        {actor.seesPrices && l.unitPrice != null && (
                          <span className="ms-1 text-xs text-muted-foreground">
                            × <Money value={l.unitPrice} />
                          </span>
                        )}
                      </p>
                    </div>
                    <LineBar line={l} />
                    {l.rejectDecision && (
                      <p className="text-xs text-muted-foreground">
                        {t("line.reject_decided", { decision: tProc(`rejectDecision.${l.rejectDecision}`) })}
                        {l.rejectDecisionNote ? ` — ${l.rejectDecisionNote}` : ""}
                      </p>
                    )}
                    {l.cancelReason && parts.cancelled > 0 && <p className="text-xs text-muted-foreground">{t("line.cancelled_reason", { qty: figure(parts.cancelled), unit: l.unit, reason: l.cancelReason })}</p>}
                    {(acts.decideReject || acts.cancelRemainder) && f && (
                      <div className="flex flex-wrap gap-2">
                        {acts.decideReject && (
                          <Button size="sm" variant="destructive" disabled={busy != null} onClick={() => setDialog({ kind: "reject", line: l })}>
                            {t("line.decide_reject", { qty: figure(l.rejected), unit: l.unit })}
                          </Button>
                        )}
                        {acts.cancelRemainder && (
                          <Button size="sm" variant="outline" disabled={busy != null} onClick={() => setDialog({ kind: "cancel_line", line: l })}>
                            {t("line.cancel_remainder")}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {po.lines.length === 0 && <p className="text-sm text-muted-foreground">{t("line.none")}</p>}
            </Section>

            <Section title={t("sec.deliveries")}>
              {deliveries.length === 0 ? (
                <p className="text-sm text-muted-foreground">{status === "in_delivery" || status === "part_received" ? t("deliveries.none_yet") : t("deliveries.none")}</p>
              ) : (
                deliveries.map((d) => {
                  const st = receiptState(d, now)
                  const accepted = (d.lines || []).reduce((s, l) => s + (Number(l.accepted) || 0), 0)
                  return (
                    <Link key={d.id} href={`/contractor/goods-received?delivery=${d.id}`} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <div className="min-w-0">
                        <p className="font-bold">
                          <span dir="ltr" className="tabular-nums">
                            {d.docNumber ? displayReceiptNumber(d.docNumber, locale) : t("deliveries.notice")}
                          </span>
                          {d.status === "confirmed" && <span className="ms-2 text-xs font-normal text-muted-foreground">{t("deliveries.accepted_qty", { qty: figure(accepted) })}</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fmt(receiptDay(d))}
                          {d.receivedByName ? ` · ${d.receivedByName}` : ""}
                        </p>
                      </div>
                      <Badge className={cn("shrink-0 border-none text-[11px] font-bold", RECEIPT_TONE[st])}>{tProc(`receiptState.${st}`)}</Badge>
                    </Link>
                  )
                })
              )}
            </Section>

            <Section title={t("sec.award")}>
              <Row label={t("award.basis")}>{tProc(`basis.${po.basis}`)}</Row>
              {po.basis === "rfq" && (
                <>
                  <Row label={t("award.offers")}>{po.offersCount}</Row>
                  {po.lowestOfferTotal != null && (
                    <Row label={t("award.lowest")}>
                      <Money value={po.lowestOfferTotal} masked={!actor.seesPrices} />
                    </Row>
                  )}
                  {po.awardReasonCode && (
                    <Row label={t("award.reason")}>
                      <span className="font-normal">
                        {tProc(`awardReason.${po.awardReasonCode}`)}
                        {po.awardReasonText ? ` — ${po.awardReasonText}` : ""}
                      </span>
                    </Row>
                  )}
                </>
              )}
              {po.basis === "retroactive" && po.awardReasonText && (
                <Row label={t("award.reason")}>
                  <span className="font-normal">{po.awardReasonText}</span>
                </Row>
              )}
              <div className="flex flex-wrap gap-1.5">
                {po.shortCompetition && <Badge className="border-none bg-warning/10 text-[11px] text-warning">{tProc("exception.short_competition", { count: po.offersCount })}</Badge>}
                {po.noOfficialQuote && <Badge className="border-none bg-warning/10 text-[11px] text-warning">{tProc("exception.no_official_quote")}</Badge>}
                {po.approvedById && po.approvedById === po.preparedById && <Badge className="border-none bg-warning/10 text-[11px] text-warning">{tProc("exception.self_approval")}</Badge>}
              </div>
              {po.rfqId && (
                <Link href={`/contractor/rfqs/${po.rfqId}/offers`} className="text-xs font-bold text-cta hover:underline">
                  {t("award.open_rfq")}
                </Link>
              )}
            </Section>

            <Section title={t("sec.documents")}>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={printOrder}>
                  <Printer size={14} aria-hidden="true" />
                  {t("docs.print_po")}
                  {!actor.seesPrices && <span className="text-[10px] text-muted-foreground">({t("docs.no_values")})</span>}
                </Button>
                {deliveries.length > 0 && (
                  <Button variant="outline" size="sm" className="gap-2" onClick={printStatement}>
                    <Printer size={14} aria-hidden="true" />
                    {t("docs.print_statement")}
                  </Button>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t("docs.supplier_date")}</dt>
                <dd>
                  <HonestDateText po={po} now={now} />
                </dd>
                {po.paymentTerms && (
                  <>
                    <dt className="text-muted-foreground">{t("docs.payment_terms")}</dt>
                    <dd dir="auto">{po.paymentTerms}</dd>
                  </>
                )}
                {po.deliveryLocation && (
                  <>
                    <dt className="text-muted-foreground">{t("docs.delivery_location")}</dt>
                    <dd dir="auto">{po.deliveryLocation}</dd>
                  </>
                )}
                {po.supplierAcceptedAt && (
                  <>
                    <dt className="text-muted-foreground">{t("docs.accepted_at")}</dt>
                    <dd>
                      {fmt(po.supplierAcceptedAt)} · {po.acceptanceRecordedBy === "supplier" ? t("docs.by_supplier") : t("docs.by_us")}
                    </dd>
                  </>
                )}
              </dl>
            </Section>

            {log.length > 0 && (
              <Section title={t("sec.log")}>
                <ol className="space-y-2">
                  {log.map((e, i) => (
                    <li key={`${e.at}-${i}`} className="flex gap-2 text-sm">
                      <Clock size={14} className="mt-1 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0">
                        <p dir="auto">{logSentence(e)}</p>
                        <p className="text-[11px] text-muted-foreground">{fmt(e.at)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Section>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {f && (
        <>
          <ReasonDialog
            open={dialog?.kind === "return"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={t("return.title")}
            description={t("return.desc")}
            label={t("return.label")}
            submitLabel={t("return.submit")}
            effects={[t("return.effect")]}
            onSubmit={(reason) => run("return", () => returnPurchaseOrder(f, actor, po.id, reason, opts), "toast.returned")}
          />
          <ReasonDialog
            open={dialog?.kind === "cancel_order"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={t("cancel_order.title")}
            description={t("cancel_order.desc")}
            label={t("cancel_order.label")}
            submitLabel={t("cancel_order.submit")}
            destructive
            effects={[t("cancel_order.effect")]}
            onSubmit={(reason) => run("cancel", () => cancelPurchaseOrder(f, actor, po.id, reason, opts), "toast.cancelled")}
          />
          <ReasonDialog
            open={dialog?.kind === "close_short"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={t("close_short.title")}
            description={t("close_short.desc")}
            label={t("close_short.label")}
            submitLabel={t("close_short.submit")}
            effects={[t("close_short.effect")]}
            onSubmit={(reason) => run("close", () => closePurchaseOrder(f, actor, po.id, { reason }, opts), "toast.closed")}
          />
          <ReasonDialog
            open={dialog?.kind === "cancel_line"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={t("cancel_line.title")}
            description={t("cancel_line.desc")}
            label={t("cancel_line.label")}
            submitLabel={t("cancel_line.submit")}
            destructive
            context={dialog?.kind === "cancel_line" ? t("cancel_line.context", { line: dialog.line.name, qty: figure(lineToArrive(dialog.line)), unit: dialog.line.unit }) : null}
            effects={[t("cancel_line.effect_1"), t("cancel_line.effect_2")]}
            onSubmit={(reason) => (dialog?.kind === "cancel_line" ? run("cancel_line", () => cancelRemainder(f, actor, po.id, { lineId: dialog.line.id, reason }, opts), "toast.remainder_cancelled") : Promise.resolve(false))}
          />
          <DateDialog
            open={dialog?.kind === "accept"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={t("accept.title")}
            description={t("accept.desc")}
            dateLabel={t("accept.date")}
            submitLabel={t("accept.submit")}
            effects={[t("accept.effect")]}
            now={now}
            onSubmit={({ date }) => run("accept", () => recordSupplierAcceptance(f, actor, po.id, { promisedDate: date, by: "buyer" }, opts), "toast.accepted")}
          />
          <DateDialog
            open={dialog?.kind === "date"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={t("date_form.title")}
            description={t("date_form.desc")}
            dateLabel={t("date_form.date")}
            noteLabel={t("date_form.note")}
            notePlaceholder={t("date_form.note_ph")}
            submitLabel={t("date_form.submit")}
            defaultDate={po.promisedDate}
            effects={[t("date_form.effect")]}
            now={now}
            onSubmit={({ date, note }) => run("date", () => updatePromisedDate(f, actor, po.id, { date, note }, opts), "toast.date_updated")}
          />
          <RejectDecisionDialog
            open={dialog?.kind === "reject"}
            onOpenChange={(o) => !o && setDialog(null)}
            line={dialog?.kind === "reject" ? dialog.line : null}
            onSubmit={({ decision, note }) => (dialog?.kind === "reject" ? run("reject", () => decideReject(f, actor, po.id, { lineId: dialog.line.id, decision, note }, opts), "toast.reject_decided") : Promise.resolve(false))}
          />
          <PoSendDialog
            open={dialog?.kind === "send"}
            onOpenChange={(o) => !o && setDialog(null)}
            po={po}
            orgName={world.orgName}
            seesPrices={actor.seesPrices}
            onSubmit={(channel: PoSendChannel) => run("send", () => sendPurchaseOrder(f, actor, po.id, channel, opts), channel === "portal" ? "toast.sent_portal" : "toast.sent_offline")}
          />
          <PoRateDialog
            open={dialog?.kind === "rate"}
            onOpenChange={(o) => !o && setDialog(null)}
            po={po}
            receipts={receipts}
            onSubmit={(input: RatingInput) => run("rate", () => ratePurchaseOrder(f, actor, po.id, { ...input, receipts: world.deliveries }, opts), "toast.rated")}
          />
        </>
      )}
    </>
  )
}
