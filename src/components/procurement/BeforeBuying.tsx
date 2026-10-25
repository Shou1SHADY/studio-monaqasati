"use client"

// «قبل الشراء» (Procurement 2.0, INC-07/08/09, WF-04/05): what the stores and the workshop said about each material of an incoming
// request, and how much of it is left to buy. Inventory is asked by itself when a request arrives (a day, never past the last
// day to order); a material waiting for the stores' or the workshop's answer is not published; when the window lapses it is
// bought in full — there is no button. «اسأل الورشة» is offered for stone the workshop cuts, with the Manufacturing connector on.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Clock, Loader2, Warehouse, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { fmtDay } from "@/components/procurement/need-bits"
import { incomingAct } from "@/lib/procurement/incoming-client"
import { displayPoNumber } from "@/lib/procurement/format"
import type { IncomingDoc, IncomingLine, ReplyClock } from "@/lib/procurement/incoming-state"
import { beforeBuying, beforeSummary, hasBeforeColumn, type BeforeView } from "@/lib/procurement/stock-check"
import type { PriceHistoryEntry } from "@/lib/procurement/prices"
import { lastPaid } from "@/lib/procurement/prices"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

const qty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-US")

type Tr = ReturnType<typeof useTranslations>

/** Why an act was refused, in words: the server's lower-case code. */
export const beforeError = (t: Tr, reason: string): string => (["window_lapsed", "not_asked", "already_in_hand", "bad_qty", "no_warehouse", "no_reason", "no_work_order", "not_makeable", "connector_off", "already_asked", "no_line", "closed", "not_buyable", "forbidden"].includes(reason) ? t(`before_err_${reason}`) : t("before_err_failed"))

/** One line of the column: the stores' pill, the workshop's pill and what is bought. */
export function BeforeCell({ view, line, locale, t }: { view: BeforeView; line: IncomingLine; locale: string; t: Tr }) {
  const s = view.stock
  const m = view.workshop
  const day = (d: string) => fmtDay(d, locale)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {s?.kind === "wait" && (
        <StatusPill tone="warn">
          <Clock size={11} aria-hidden="true" /> {t("before_stock_wait", { date: day(s.until) })}
        </StatusPill>
      )}
      {s?.kind === "issue" && (
        <StatusPill tone="ok">
          <Warehouse size={11} aria-hidden="true" /> {t("before_stock_issue", { wh: s.warehouse || "—" })}
        </StatusPill>
      )}
      {s?.kind === "part" && (
        <StatusPill tone="ok">
          <Warehouse size={11} aria-hidden="true" /> {t("before_stock_part", { qty: qty(s.give), wh: s.warehouse || "—" })}
        </StatusPill>
      )}
      {s?.kind === "tied" && (
        <StatusPill tone="mute">
          <Warehouse size={11} aria-hidden="true" /> {t("before_stock_tied", { why: s.why })}
        </StatusPill>
      )}
      {s?.kind === "none" && (
        <StatusPill tone="mute">
          <Warehouse size={11} aria-hidden="true" /> {t("before_stock_none")}
        </StatusPill>
      )}
      {s?.kind === "timeout" && (
        <StatusPill tone="mute">
          <Warehouse size={11} aria-hidden="true" /> {t("before_stock_timeout")}
        </StatusPill>
      )}
      {m?.kind === "ask" && (
        <StatusPill tone="warn">
          <Wrench size={11} aria-hidden="true" /> {t("before_mk_ask", { date: day(m.until) })}
        </StatusPill>
      )}
      {m?.kind === "make" && (
        <StatusPill tone="ok">
          <Wrench size={11} aria-hidden="true" /> {t("before_mk_make", { wo: m.wo })}
        </StatusPill>
      )}
      {m?.kind === "part" && (
        <StatusPill tone="ok">
          <Wrench size={11} aria-hidden="true" /> {t("before_mk_part", { qty: qty(m.make), wo: m.wo })}
        </StatusPill>
      )}
      {m?.kind === "buy" && (
        <StatusPill tone="mute">
          <Wrench size={11} aria-hidden="true" /> {t("before_mk_buy", { why: m.why })}
        </StatusPill>
      )}
      {m?.kind === "timeout" && (
        <StatusPill tone="mute">
          <Wrench size={11} aria-hidden="true" /> {t("before_mk_timeout")}
        </StatusPill>
      )}
      {m?.kind === "closed" && (
        <StatusPill tone="mute">
          <Wrench size={11} aria-hidden="true" /> {t("before_mk_closed")}
        </StatusPill>
      )}
      <span className={cn("text-xs font-bold tabular-nums", view.buy.kind === "wait" ? "text-warning" : view.buy.kind === "buy" ? "text-foreground" : "text-muted-foreground")} dir="auto">
        {view.buy.kind === "wait"
          ? t("before_buy_wait")
          : view.buy.kind === "buy"
            ? view.buy.qty < view.buy.of - 0.005
              ? t("before_buy_some", { qty: qty(view.buy.qty), of: qty(view.buy.of) })
              : t("before_buy_all", { qty: qty(view.buy.qty) })
            : view.buy.kind === "zero"
              ? t("before_buy_zero")
              : view.buy.kind === "gone"
                ? t("before_gone")
                : line.ps === "fail"
                  ? t("before_failed")
                  : line.ps === "po"
                    ? t("before_in_po", { ref: displayPoNumber(line.poNumber || "", locale) })
                    : t("before_in_rfq", { ref: line.rfqNumber || "—" })}
      </span>
    </div>
  )
}

/** The request panel's «قبل الشراء» column: a row per material, shown where there is an answer or stone the workshop cuts. */
export function BeforeBuyingTable({ doc, clock, mfgOn, canAct, history, onAsk }: { doc: IncomingDoc; clock: ReplyClock; mfgOn: boolean; canAct: boolean; history: PriceHistoryEntry[]; onAsk?: () => void }) {
  const t = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const [asking, setAsking] = useState<IncomingLine | null>(null)
  const rows = doc.lines.map((l) => ({ l, view: beforeBuying(doc, l, clock, mfgOn) })).filter((r) => hasBeforeColumn(r.view))
  if (!rows.length) return null
  return (
    <section className="space-y-2 rounded-2xl border bg-card p-4" aria-label={t("before_title")}>
      <h3 className="text-sm font-black">{t("before_title")}</h3>
      <ul className="divide-y">
        {rows.map(({ l, view }) => (
          <li key={l.no} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0 flex-1 basis-56">
              <p className="text-sm font-semibold" dir="auto">
                {l.name} <b className="tabular-nums" dir="ltr">{qty(l.qty)}</b> <span className="text-xs text-muted-foreground">{l.unit}</span>
              </p>
              <BeforeCell view={view} line={l} locale={locale} t={t} />
            </div>
            {canAct && view.canAsk && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAsking(l)}>
                <Wrench size={13} aria-hidden="true" /> {t("before_ask")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {t("before_hint")}
        {mfgOn && rows.some((r) => r.view.canAsk || r.view.workshop) ? ` ${t("before_hint_mfg")}` : ""}
      </p>
      {asking && <AskWorkshopDialog doc={doc} line={asking} history={history} onClose={() => setAsking(null)} onDone={onAsk} />}
    </section>
  )
}

/** The card's one line: awaiting Inventory · awaiting the workshop · Inventory issues N · the workshop makes part · ask the workshop. */
export function BeforeChips({ doc, clock, mfgOn }: { doc: IncomingDoc; clock: ReplyClock; mfgOn: boolean }) {
  const t = useTranslations("Portal.Procurement")
  const s = beforeSummary(doc, clock, mfgOn)
  if (!(s.waitingStock || s.waitingWorkshop || s.issues || s.makes || s.askable)) return null
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {s.waitingStock > 0 && <StatusPill tone="warn">{t("before_sum_wait_stock")}</StatusPill>}
      {s.waitingWorkshop > 0 && <StatusPill tone="warn">{t("before_sum_wait_mfg")}</StatusPill>}
      {s.issues > 0 && <StatusPill tone="ok">{t("before_sum_issues", { count: s.issues })}</StatusPill>}
      {s.makes > 0 && <StatusPill tone="ok">{t("before_sum_makes")}</StatusPill>}
      {s.askable > 0 && <StatusPill tone="info">{t("before_sum_ask")}</StatusPill>}
    </span>
  )
}

/** «اسأل الورشة: نصنّعها بدل أن نشتريها؟» — with the last price we paid, sent along. */
export function AskWorkshopDialog({ doc, line, history, onClose, onDone }: { doc: IncomingDoc; line: IncomingLine; history: PriceHistoryEntry[]; onClose: () => void; onDone?: () => void }) {
  const t = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const { toast } = useToast()
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = lastPaid(history, line.name, line.unit)

  const send = async () => {
    setBusy(true)
    setError(null)
    const res = await incomingAct({ action: "ask-mfg", mrKey: doc.mrKey, lines: [line.no], note: note.trim() || null })
    setBusy(false)
    if (!res.ok) {
      setError(beforeError(t, res.reason))
      return
    }
    toast({ title: t("before_ask_sent") })
    onDone?.()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("before_ask_title")}</DialogTitle>
          <DialogDescription dir="auto">
            {doc.no} · {line.name} {qty(line.qty)} {line.unit}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {/* The material with its specifications and when it is needed (the prototype's `MOD.mkask` info grid). */}
          <div className="rounded-xl border px-3 py-1 text-xs" data-testid="ask-workshop-facts">
            {(line.material?.specs || []).map((sp) => (
              <KeyValueRow key={sp.name.ar} label={locale === "ar" ? sp.name.ar : sp.name.en || sp.name.ar} value={locale === "ar" ? sp.value.ar : sp.value.en || sp.value.ar} className="text-xs" />
            ))}
            <KeyValueRow label={t("before_ask_need_by")} value={line.needBy || doc.needBy ? fmtDay(line.needBy || doc.needBy, locale) : "—"} className="text-xs" />
          </div>
          <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs">
            <b>{t("before_ask_ref")}</b>{" "}
            {ref ? t("before_ask_ref_value", { price: sarLtr(ref.price.toLocaleString("en-US")), unit: line.unit, po: ref.poNumber || "—" }) : t("before_ask_ref_none")}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="mk-note">
              {t("before_ask_note")} <span className="text-xs font-normal text-muted-foreground">{t("before_optional")}</span>
            </Label>
            <Input id="mk-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("before_ask_note_ph")} dir="auto" maxLength={300} />
          </div>
          <p className="rounded-xl bg-info/10 px-3 py-2 text-xs">{t("before_ask_blk")}</p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("before_cancel")}
          </Button>
          <Button onClick={() => void send()} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Wrench size={14} aria-hidden="true" />}
            {t("before_ask_send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
