"use client"

// The order link's page body (prototype `ALT.polink`, S4 §6.2): the order — its place, its day, its lines and total — then exactly ONE
// state block: cancelled · declined · complete · «هل تقبل الأمر؟» · «أبلغ بالتسليم» (G-17: nothing to press on a cancelled or completed
// order). The supplier reads «أمر 2026/014», never the buyer's code. Pure presentation: the container owns the requests.

import { useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, Calendar, Check, Coins, MapPin, Truck, User, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { fmtDayLong } from "@/lib/procurement/format"
import { POL_DECLINE_REASONS, POL_REPORT_OFFSETS, type PoDeclineReason, type PoLinkLine, type PoLinkView, type PoReportOffset } from "@/lib/po-link"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

const figure = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n)

export interface LinkOrderActions {
  accept: (date: string | null) => Promise<void>
  decline: (reason: PoDeclineReason, note: string) => Promise<void>
  askChange: (text: string) => Promise<void>
  report: (offset: PoReportOffset, note: string) => Promise<void>
  acceptVersion: (n: number) => Promise<void>
}

function Panel({ title, sub, children, tone }: { title: ReactNode; sub?: ReactNode; children: ReactNode; tone?: "bad" | "good" }) {
  return (
    <section className={cn("rounded-md border bg-card", tone === "bad" && "border-destructive/30", tone === "good" && "border-success/30")}>
      <header className="border-b px-3.5 py-2.5">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </header>
      <div className="space-y-3 p-3.5">{children}</div>
    </section>
  )
}

function Lines({ view }: { view: PoLinkView }) {
  const t = useTranslations("PoLink")
  const locale = useLocale() as "ar" | "en"
  const unitOf = (l: PoLinkLine) => (l.pk ? (locale === "en" ? l.packName?.en : l.packName?.ar) || l.unit : l.unit)
  const total = view.total
  return (
    <section className="rounded-md border bg-card" aria-label={t("lines_title")}>
      <ul className="divide-y">
        {view.lines.map((l) => (
          <li key={l.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
            <p className="min-w-0 text-sm font-bold" dir="auto">
              {l.name}
            </p>
            <p className="shrink-0 text-end text-sm tabular-nums">
              <b>{figure(l.quantity)}</b> <span dir="auto">{unitOf(l)}</span>
              {l.price != null && <span className="text-muted-foreground"> × {figure(l.price)}</span>}
              {l.pk != null && (
                <small className="block text-[11px] text-muted-foreground" dir="auto">
                  {t("piece_total", { total: figure(l.quantity * l.pk), base: l.base || "" })}
                  {l.need != null && ` (${t("piece_need", { need: figure(l.need) })})`}
                </small>
              )}
            </p>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-3.5 py-2.5 text-sm">
        <span className="font-bold">{t(total.kind === "lump" ? "total_lump" : total.kind === "nvat" ? "total_nvat" : "total_incl")}</span>
        <b dir="ltr" className="tabular-nums">
          {sarLtr(figure(total.amount))}
        </b>
      </div>
    </section>
  )
}

function Head({ view }: { view: PoLinkView }) {
  const t = useTranslations("PoLink")
  const locale = useLocale()
  const day = (d: string | null) => fmtDayLong(d, locale)
  const place = [view.site?.city, view.site?.district].filter(Boolean).join(" — ")
  const supplyOn = view.promisedDate || view.dueDate
  const pill =
    view.state === "cancelled"
      ? ["pill_cancelled", "bg-destructive/10 text-destructive"]
      : view.state === "declined"
        ? ["pill_declined", "bg-destructive/10 text-destructive"]
        : view.state === "complete"
          ? ["pill_complete", "bg-success/10 text-success"]
          : view.state === "accepted"
            ? ["pill_accepted", "bg-success/10 text-success"]
            : ["pill_awaiting", "bg-warning/10 text-warning"]
  const unload = view.access?.unload
  return (
    <div className="space-y-2">
      <small className="text-xs text-muted-foreground">
        {t("order_word")} <span dir="ltr">{view.no}</span>
      </small>
      <h1 className="text-xl font-black leading-snug" dir="auto">
        {t("title", { company: view.company || t("the_buyer") })}
      </h1>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {(place || view.site?.name) && (
          <span className="inline-flex flex-wrap items-center gap-1" dir="auto">
            <MapPin size={12} aria-hidden="true" />
            {place || view.site?.name}
            {view.site?.address ? ` · ${view.site.address}` : ""}
            {view.site?.mapUrl && (
              <a href={view.site.mapUrl} target="_blank" rel="noreferrer" title={t("map_hint")} className="font-bold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("on_map")}
              </a>
            )}
          </span>
        )}
        {supplyOn && (
          <span className="inline-flex items-center gap-1">
            <Calendar size={12} aria-hidden="true" />
            {t("supply_on")} <b className="text-foreground">{day(supplyOn)}</b>
          </span>
        )}
        {view.needBy && (
          <span className="inline-flex items-center gap-1">
            <Calendar size={12} aria-hidden="true" />
            {t("need_by", { date: day(view.needBy) })}
          </span>
        )}
        {view.terms && (
          <span className="inline-flex items-center gap-1" dir="auto">
            <Coins size={12} aria-hidden="true" />
            {view.terms}
          </span>
        )}
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", pill[1])}>{t(pill[0])}</span>
      </p>
      {(unload || view.access?.slot || view.access?.note) && (
        <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground" dir="auto">
          {[unload === "sup" ? t("unload_sup") : unload === "us" ? t("unload_us") : null, view.access?.slot ? t("slot", { slot: view.access.slot }) : null, view.access?.note].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
  )
}

function StateCard({ icon, tone, title, body }: { icon: ReactNode; tone: "bad" | "good"; title: string; body: string }) {
  return (
    <section className="space-y-2 rounded-md border bg-card p-6 text-center" role="status">
      <span className={cn("mx-auto grid h-11 w-11 place-items-center rounded-full", tone === "bad" ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success")}>{icon}</span>
      <h2 className="text-lg font-black">{title}</h2>
      <p className="text-sm text-muted-foreground" dir="auto">
        {body}
      </p>
    </section>
  )
}

function AcceptPanel({ view, actions, busy }: { view: PoLinkView; actions: LinkOrderActions; busy: boolean }) {
  const t = useTranslations("PoLink")
  const locale = useLocale()
  const [mode, setMode] = useState<"none" | "decline" | "change">("none")
  const [reason, setReason] = useState<PoDeclineReason>("stock")
  const [note, setNote] = useState("")
  const [text, setText] = useState("")
  const [date, setDate] = useState("")
  const due = view.dueDate || view.needBy
  const needsDate = !due
  return (
    <Panel title={t("accept_title")} sub={due ? t("accept_body", { due: fmtDayLong(due, locale), by: fmtDayLong(view.acceptBy, locale) }) : t("accept_body_pick")}>
      {needsDate && (
        <label className="block space-y-1 text-xs font-semibold">
          {t("accept_date")}
          <Input type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 max-w-[12rem]" />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || (needsDate && !date)} className="gap-1.5" onClick={() => void actions.accept(needsDate ? date : null)}>
          <Check size={14} aria-hidden="true" />
          {t("btn_accept")}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setMode(mode === "change" ? "none" : "change")} aria-expanded={mode === "change"}>
          {t("btn_change")}
        </Button>
        <Button type="button" variant="outline" disabled={busy} className="border-destructive/40 text-destructive hover:bg-destructive/5" onClick={() => setMode(mode === "decline" ? "none" : "decline")} aria-expanded={mode === "decline"}>
          {t("btn_decline")}
        </Button>
      </div>
      {mode === "decline" && (
        <div className="space-y-2">
          <p className="text-xs font-semibold">{t("decline_reason")}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("decline_reason")}>
            {POL_DECLINE_REASONS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className={cn("min-h-[40px] rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", reason === r ? "border-transparent bg-destructive/10 font-bold text-destructive" : "hover:bg-muted")}>
                {t(`reason_${r}`)}
              </button>
            ))}
          </div>
          {reason === "other" && <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("decline_other_ph")} aria-label={t("decline_other_ph")} dir="auto" />}
          <Button type="button" variant="destructive" disabled={busy || (reason === "other" && note.trim().length < 4)} onClick={() => void actions.decline(reason, note)}>
            {t("decline_send")}
          </Button>
        </div>
      )}
      {mode === "change" && (
        <div className="space-y-2">
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("change_ph")} aria-label={t("change_ph")} dir="auto" />
          <Button type="button" disabled={busy || text.trim().length < 3} onClick={() => void actions.askChange(text)}>
            {t("change_send")}
          </Button>
        </div>
      )}
    </Panel>
  )
}

function ReportPanel({ view, actions, busy }: { view: PoLinkView; actions: LinkOrderActions; busy: boolean }) {
  const t = useTranslations("PoLink")
  const locale = useLocale()
  const [offset, setOffset] = useState<PoReportOffset>(0)
  const [note, setNote] = useState("")
  return (
    <Panel
      title={
        <>
          <Truck size={15} aria-hidden="true" />
          {t("report_title")}
        </>
      }
      sub={t("report_sub")}
    >
      {view.notices.length > 0 && (
        <ul className="space-y-1">
          {view.notices.map((n) => (
            <li key={n.id} className="flex items-start gap-1.5 text-xs text-success" dir="auto">
              <Check size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {t("reported_line", { date: fmtDayLong(n.date, locale, false) })}
                {n.note ? ` — ${n.note}` : ""}
                {n.count ? ` · ${t(n.count.rejected ? "counted_rej" : "counted", { accepted: figure(n.count.accepted), rejected: figure(n.count.rejected) })}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {view.receiver && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" dir="auto">
          <User size={12} aria-hidden="true" />
          {t("receiver")}: {view.receiver.name}
          {view.receiver.phone ? (
            <>
              {" · "}
              <span dir="ltr">{view.receiver.phone}</span>
            </>
          ) : null}
        </p>
      )}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold">{t("arrives")}</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("arrives")}>
          {POL_REPORT_OFFSETS.map((o) => (
            <button key={o} type="button" role="radio" aria-checked={offset === o} onClick={() => setOffset(o)} className={cn("min-h-[40px] rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", offset === o ? "border-transparent bg-module/10 font-bold text-module" : "hover:bg-muted")}>
              {t(`day_${o}`)}
            </button>
          ))}
        </div>
      </div>
      <label className="block space-y-1 text-xs font-semibold">
        {t("note_label")} <span className="font-normal text-muted-foreground">{t("optional")}</span>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t("note_ph")} dir="auto" className="h-10 font-normal" />
      </label>
      <Button type="button" disabled={busy} className="gap-1.5" onClick={() => void actions.report(offset, note).then(() => setNote(""))}>
        <Truck size={14} aria-hidden="true" />
        {t("btn_report")}
      </Button>
      {view.payment && (
        <p className="text-xs text-muted-foreground">{t("payment_line", { state: t(`pay_${view.payment.state}`) })}</p>
      )}
    </Panel>
  )
}

export function LinkOrderView({ view, actions, busy }: { view: PoLinkView; actions: LinkOrderActions; busy: boolean }) {
  const t = useTranslations("PoLink")
  const locale = useLocale()
  const day = (iso: string | null | undefined) => fmtDayLong((iso || "").slice(0, 10), locale)
  return (
    <div className="space-y-4">
      <Head view={view} />
      <Lines view={view} />
      {view.pendingVersion && view.acts.acceptVersion && (
        <section className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm" role="status">
          <AlertTriangle size={14} className="shrink-0 text-warning" aria-hidden="true" />
          <span className="min-w-0 flex-1" dir="auto">
            {t(view.pendingVersion.kind === "date" ? "version_date" : "version_close", { n: view.pendingVersion.n, date: day(view.pendingVersion.date) })}
          </span>
          <Button type="button" size="sm" disabled={busy} onClick={() => void actions.acceptVersion(view.pendingVersion!.n)}>
            {t("version_accept", { n: view.pendingVersion.n })}
          </Button>
        </section>
      )}
      {view.state === "cancelled" && <StateCard tone="bad" icon={<X size={20} aria-hidden="true" />} title={t("cancelled_title")} body={t(view.cancel?.why ? "cancelled_body" : "cancelled_body_plain", { date: day(view.cancel?.at), why: view.cancel?.why || "" })} />}
      {view.state === "declined" && <StateCard tone="bad" icon={<X size={20} aria-hidden="true" />} title={t("declined_title")} body={t("declined_body", { reason: view.decline?.note || "", date: day(view.decline?.at) })} />}
      {view.state === "complete" && <StateCard tone="good" icon={<Check size={20} aria-hidden="true" />} title={t("complete_title")} body={t("complete_body")} />}
      {view.state === "awaiting" && <AcceptPanel view={view} actions={actions} busy={busy} />}
      {view.state === "accepted" && (view.acts.report ? <ReportPanel view={view} actions={actions} busy={busy} /> : <StateCard tone="good" icon={<Check size={20} aria-hidden="true" />} title={t("accepted_title")} body={t("accepted_body")} />)}
    </div>
  )
}
