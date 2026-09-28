"use client"

// One need line opened (the prototype's dDem): the next step its path points
// to, the four numbers (requested · to be sourced · needed · last order day),
// where the quantity went, where it came from, the price we would pay, and
// what happened to it. Every act is handed back to the desk that opened it.

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Boxes, ExternalLink, Factory, FileSignature, FolderKanban, PackageCheck, Scale, ShoppingCart, Undo2 } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Callout } from "@/components/module-ui/Callout"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { displayDocNumber } from "@/lib/procurement/format"
import { isActionState, type NeedRow } from "@/lib/procurement/need-desk"
import { agreementFor, lastPaid, materialKey, type PriceAgreement, type PriceHistoryEntry } from "@/lib/procurement/prices"
import { displayCategory } from "@/lib/constants"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"
import { LINE_STATE_TONE, PATH_ICON, fmtDay, qty } from "@/components/procurement/need-bits"

export interface NeedLineActs {
  canAct: boolean
  /** May raise an RFQ (rfq.create / rfq.manage); a buyer who only prepares orders may not. */
  canRfq?: boolean
  seesPrices: boolean
  onRfq: (row: NeedRow) => void
  onOrder: (row: NeedRow, mode: "agreement" | "direct") => void
  onProceed: (row: NeedRow) => void
  onAskWorkshop: (row: NeedRow) => void
  onBuyNotMake: (row: NeedRow) => void
  onWorkshopLapsed: (row: NeedRow) => void
  onArrived?: (row: NeedRow) => void
  onSendBack?: (row: NeedRow) => void
}

const SOURCE_ICON = { mfg: Factory, project: FolderKanban, stock: Boxes }

export function NeedLineDrawer({ row, agreements, history, cap, today, acts, onClose }: { row: NeedRow; agreements: PriceAgreement[]; history: PriceHistoryEntry[]; cap: number; today: string; acts: NeedLineActs; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const n = row.need
  const act = acts.canAct && isActionState(row.state)
  const PathIcon = row.path ? PATH_ICON[row.path] : Boxes
  const SrcIcon = SOURCE_ICON[n.kind]
  const ag = agreementFor(agreements, row.name, row.unit, today)
  const last = lastPaid(history, row.name, row.unit)
  const money = (v: number) => sarLtr(v.toLocaleString("en-US", { maximumFractionDigits: 2 }))
  const cover = n.decision?.kind === "proceed_short" ? Number(n.decision.cover?.[row.index]) || 0 : 0

  let step: ReactNode = null
  if (act) {
    const rfqOk = acts.canRfq !== false
    const btn = (label: string, onClick: () => void, primary = false, icon?: ReactNode) => (
      <Button key={label} size="sm" variant={primary ? "default" : "outline"} onClick={onClick} className={cn("h-9 gap-1.5", primary ? "bg-module text-module-foreground hover:bg-module/90" : "border border-border bg-card text-foreground shadow-none hover:bg-muted")}>
        {icon}
        {label}
      </Button>
    )
    if (row.state === "late")
      step = (
        <>
          <Callout tone="warn">{t("nd_step_late", { cover: qty(Math.min(row.onHand ?? 0, row.total)), total: qty(row.total), unit: row.unit })}</Callout>
          <div className="flex flex-wrap gap-2">{btn(t("nd_proceed"), () => acts.onProceed(row), true)}</div>
        </>
      )
    else if (row.state === "mfgl")
      step = (
        <>
          <Callout tone="warn">{t("nd_step_mfgl")}</Callout>
          <div className="flex flex-wrap gap-2">{btn(t("nd_proceed"), () => acts.onWorkshopLapsed(row), true)}</div>
        </>
      )
    else if (row.path === "mfg")
      step = (
        <>
          <Callout tone="info">{t("nd_step_mfg")}</Callout>
          <div className="flex flex-wrap gap-2">
            {btn(t("nd_ask_workshop"), () => acts.onAskWorkshop(row), true, <Factory size={14} aria-hidden="true" />)}
            {btn(t("nd_buy_not_make"), () => acts.onBuyNotMake(row))}
          </div>
        </>
      )
    else if (row.path === "agreement" && ag)
      step = (
        <>
          <Callout tone="info">{t("nd_step_agreement", { number: displayDocNumber(ag.agreement.docNumber, locale), supplier: ag.agreement.supplierName, price: acts.seesPrices ? money(ag.price) : "—" })}</Callout>
          <div className="flex flex-wrap gap-2">
            {btn(t("dor_open_agreement"), () => acts.onOrder(row, "agreement"), true, <FileSignature size={14} aria-hidden="true" />)}
            {rfqOk && btn(t("nd_rfq_anyway"), () => acts.onRfq(row))}
          </div>
        </>
      )
    else if (row.path === "direct")
      step = (
        <>
          <Callout tone="info">{t("nd_step_direct", { value: acts.seesPrices && row.estimate != null ? money(row.estimate) : "—", cap: money(cap) })}</Callout>
          <div className="flex flex-wrap gap-2">
            {btn(t("dor_open_direct"), () => acts.onOrder(row, "direct"), true, <ShoppingCart size={14} aria-hidden="true" />)}
            {rfqOk && btn(t("nd_rfq"), () => acts.onRfq(row))}
          </div>
        </>
      )
    else if (row.path === "stock")
      step = (
        <>
          <Callout tone="info">{t("nd_step_stock", { qty: qty(row.onHand ?? 0), unit: row.unit })}</Callout>
          {rfqOk && <div className="flex flex-wrap gap-2">{btn(t("nd_rfq_anyway"), () => acts.onRfq(row))}</div>}
        </>
      )
    else
      step = (
        <div className="flex flex-wrap gap-2">
          {rfqOk && btn(t("nd_request_quotes"), () => acts.onRfq(row), true, <Scale size={14} aria-hidden="true" />)}
          {row.estimate != null && btn(t("nd_single_source"), () => acts.onOrder(row, "direct"), !rfqOk)}
        </div>
      )
  }

  const whereWent: Array<{ label: ReactNode; qty: number }> = []
  if (cover > 0) whereWent.push({ label: t("nd_went_stock"), qty: cover })
  if (row.state === "rfq") whereWent.push({ label: n.rfqId ? <Link href={`/contractor/rfqs/${n.rfqId}/offers`} className="font-semibold text-module hover:underline">{t("pri_in_rfq", { ref: n.rfqNumber || "" })}</Link> : t("pri_in_rfq", { ref: "" }), qty: row.open })
  if (row.state === "po" || (row.state === "done" && n.poId)) whereWent.push({ label: n.poId ? <Link href={`/contractor/rfqs/orders?po=${n.poId}`} className="font-semibold text-module hover:underline">{t("pri_in_order", { ref: displayDocNumber(n.poNumber || "", locale) })}</Link> : t("pri_in_order", { ref: "" }), qty: row.open })
  if (row.state === "mfg") whereWent.push({ label: t("nd_went_mfg"), qty: row.total })
  if (row.state === "cx") whereWent.push({ label: t("nd_went_cx"), qty: row.total })

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={isRtl ? "left" : "right"} dir={isRtl ? "rtl" : "ltr"} className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="space-y-1 border-b p-5 text-start">
          <SheetTitle className="flex items-center gap-2 text-lg font-black">
            <PathIcon size={18} className="shrink-0 text-module" aria-hidden="true" />
            <span dir="auto">{row.name}</span>
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-semibold">
              <SrcIcon size={11} aria-hidden="true" /> {t(`pri_from_${n.kind}`)}
            </span>
            <span dir="auto">{n.refLabel}</span>
            <span dir="auto">· {n.projectName || n.context || t("nd_for_stock")}</span>
            <StatusPill tone={LINE_STATE_TONE[row.state]}>{t(`nd_state_${row.state}`)}</StatusPill>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 p-5">
          {step && (
            <section className="space-y-2">
              <h3 className="text-sm font-black">{t("nd_next_step")}</h3>
              {step}
            </section>
          )}
          {act && row.samplePending && <Callout tone="warn">{t("nd_sample_pending_block")}</Callout>}
          {(acts.onArrived || acts.onSendBack) && (
            <div className="flex flex-wrap gap-2">
              {acts.onArrived && (
                <Button size="sm" variant="outline" className="h-9 gap-1.5 border border-border bg-card text-foreground shadow-none hover:bg-muted" onClick={() => acts.onArrived?.(row)}>
                  <PackageCheck size={14} aria-hidden="true" /> {t("mfy_pr_mark_arrived")}
                </Button>
              )}
              {acts.onSendBack && (
                <Button size="sm" variant="ghost" className="h-9 gap-1.5 text-muted-foreground" onClick={() => acts.onSendBack?.(row)}>
                  <Undo2 size={14} aria-hidden="true" /> {t("pri_decline")}
                </Button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t("nd_stat_requested")} value={`${qty(row.total)} ${row.unit}`} />
            <Stat label={t("nd_stat_open")} value={`${qty(row.open)} ${row.unit}`} />
            <Stat label={t("nd_stat_need")} value={row.needBy ? fmtDay(row.needBy, locale) : "—"} />
            <Stat label={t("nd_stat_last_day")} value={row.lastOrderDay ? fmtDay(row.lastOrderDay, locale) : "—"} bad={row.lastOrderIn != null && row.lastOrderIn < 0} />
          </div>

          <DrawerSection title={t("nd_where_went")}>
            {whereWent.map((w, i) => (
              <KeyValueRow key={i} label={w.label} value={qty(w.qty)} ltr />
            ))}
            {isActionState(row.state) && row.open > 0 && <KeyValueRow label={t("nd_stat_open")} value={<span className="text-warning">{qty(row.open)}</span>} ltr />}
            <KeyValueRow label={t("nd_total_is_requested")} value={qty(row.total)} ltr strong />
          </DrawerSection>

          <DrawerSection title={t("nd_where_from")}>
            <KeyValueRow label={t("nd_source")} value={`${t(`pri_from_${n.kind}`)} · ${n.refLabel}`} />
            {n.projectName && <KeyValueRow label={t("nd_project")} value={n.projectName} />}
            {n.requestedBy && <KeyValueRow label={t("nd_requested_by")} value={`${n.requestedBy}${n.at ? ` · ${fmtDay(n.at, locale)}` : ""}`} />}
            {n.kind === "stock" && n.stock ? <KeyValueRow label={t("nd_deliver_to")} value={n.refLabel} /> : n.projectName ? <KeyValueRow label={t("nd_deliver_to")} value={n.projectName} /> : n.kind === "mfg" ? <KeyValueRow label={t("nd_deliver_to")} value={t("nd_deliver_workshop")} /> : null}
            <KeyValueRow label={t("nd_stock_check")} value={row.onHand == null ? t("pri_not_in_stock") : t("pri_on_hand", { qty: `${qty(row.onHand)} ${row.unit}` })} />
            {row.category && <KeyValueRow label={t("nd_category")} value={displayCategory(row.category, locale)} />}
            {n.note && <p className="py-2 text-sm text-muted-foreground" dir="auto">{n.note}</p>}
          </DrawerSection>

          {acts.seesPrices && (
            <DrawerSection title={t("nd_price")}>
              {ag && <KeyValueRow label={t("nd_agreement_price", { number: displayDocNumber(ag.agreement.docNumber, locale) })} value={money(ag.price)} ltr />}
              {last ? <KeyValueRow label={t("nd_last_price", { supplier: last.supplierName, date: fmtDay(last.day, locale) })} value={money(last.price)} ltr /> : <p className="py-2 text-sm text-muted-foreground">{t("nd_no_price")}</p>}
              <Link href={`/contractor/suppliers?segment=history&material=${encodeURIComponent(materialKey(row.name, row.unit))}`} className="inline-flex items-center gap-1 py-2 text-xs font-bold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("nd_price_history")} <ExternalLink size={11} className="rtl-flip" aria-hidden="true" />
              </Link>
            </DrawerSection>
          )}

          <DrawerSection title={t("nd_log")} defaultOpen={false}>
            {n.at && <KeyValueRow label={fmtDay(n.at, locale)} value={t("nd_log_requested", { name: n.requestedBy || "—" })} />}
            {n.decision && <KeyValueRow label={fmtDay(n.decision.at, locale)} value={t(`nd_log_${n.decision.kind}`, { name: n.decision.byName })} />}
            {n.mfgRequestId && <KeyValueRow label="—" value={t("nd_log_asked_workshop")} />}
            {n.rfqNumber && <KeyValueRow label="—" value={t("pri_in_rfq", { ref: n.rfqNumber })} />}
            {n.poNumber && <KeyValueRow label="—" value={t("pri_in_order", { ref: displayDocNumber(n.poNumber, locale) })} />}
          </DrawerSection>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm font-black tabular-nums", bad ? "text-destructive" : "text-foreground")} dir="auto">
        {value}
      </p>
    </div>
  )
}
