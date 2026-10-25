"use client"

// «قادمة» (INC-06): what will reach Incoming soon, for preparing and never for buying — a project's request still awaiting technical
// approval, a team request awaiting approval before Procurement, a planned work order the stores cannot cover, a stock item close
// above its minimum or lasting only days — each with its materials, the last price paid (and the order it came from), the need date,
// when it is expected, and «نبّهني حين يصل».

import { Bell, BellRing, CalendarClock, Clock, Factory, Loader2 } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { RequestSourceChip } from "@/components/procurement/RequestSourceChip"
import { fmtDay, qty } from "@/components/procurement/need-bits"
import { displayNeedRef, displayPoNumber } from "@/lib/procurement/format"
import { lastPaid, type PriceHistoryEntry } from "@/lib/procurement/prices"
import type { UpcomingItem, UpcomingKind } from "@/lib/procurement/upcoming"
import type { NeedKind } from "@/lib/procurement/needs"

const KIND_SOURCE: Record<UpcomingKind, NeedKind> = { approval: "project", team: "team", workorder: "mfg", stock: "stock" }
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

export function UpcomingList({
  items,
  loading,
  watched,
  onWatch,
  history,
}: {
  items: ReadonlyArray<UpcomingItem>
  loading: boolean
  watched: ReadonlySet<string>
  onWatch: (key: string, on: boolean) => Promise<boolean>
  history: ReadonlyArray<PriceHistoryEntry>
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const { toast } = useToast()

  const toggle = async (key: string) => {
    const on = !watched.has(key)
    const ok = await onWatch(key, on)
    toast(ok ? { title: t(on ? "rq_up_watch_on" : "rq_up_watch_off") } : { title: t("rq_up_watch_failed"), variant: "destructive" })
  }

  return (
    <div className="space-y-2">
      {loading && !items.length ? (
        <div className="flex items-center justify-center rounded-2xl border bg-card p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border bg-card p-12 text-center text-muted-foreground">
          <Clock size={36} className="mx-auto mb-2 opacity-20" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">{t("rq_upcoming_empty")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((u) => {
            const on = watched.has(u.key)
            return (
              <li key={u.key} className="flex flex-wrap items-start gap-3 rounded-2xl border bg-card p-4">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-module/10 text-module" aria-hidden="true">
                  {u.kind === "approval" || u.kind === "team" ? <Clock size={16} /> : u.kind === "workorder" ? <Factory size={16} /> : <CalendarClock size={16} />}
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="flex flex-wrap items-center gap-2">
                    {u.ref && <b className="text-base">{displayNeedRef(u.ref, locale)}</b>}
                    <span className="text-sm font-semibold" dir="auto">
                      {u.kind === "workorder" && u.workOrder ? t("rq_up_wo", { no: u.workOrder.no }) : u.place}
                    </span>
                    <StatusPill tone="violet">{u.kind === "approval" || u.kind === "team" ? t("rq_up_pending") : t("rq_up_planned")}</StatusPill>
                    <RequestSourceChip kind={KIND_SOURCE[u.kind]} />
                  </p>
                  <p className="text-xs text-muted-foreground" dir="auto">
                    {u.kind === "approval"
                      ? t("rq_up_why_approval", { name: u.by || "—", date: u.since ? fmtDay(u.since, locale) : "—" })
                      : u.kind === "team"
                        ? t("rq_up_why_team", { name: u.by || "—", approvers: (u.approvers || []).join(locale === "ar" ? " أو " : " or ") || "—", date: u.since ? fmtDay(u.since, locale) : "—" })
                        : u.kind === "workorder"
                          ? `${t("rq_up_why_wo")}${u.workOrder?.product ? ` · ${u.workOrder.product}` : ""}`
                          : u.etaDays != null
                            ? t("rq_up_why_cover", { days: u.etaDays, onHand: qty(u.stock?.onHand ?? 0), min: qty(u.stock?.min ?? 0) })
                            : t("rq_up_why_stock", { onHand: qty(u.stock?.onHand ?? 0), min: qty(u.stock?.min ?? 0) })}
                  </p>
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm" dir="auto">
                    {u.lines.map((l) => {
                      const last = lastPaid(history as PriceHistoryEntry[], l.name, l.unit)
                      return (
                        <span key={`${l.name}|${l.unit}`}>
                          {l.name}{" "}
                          <b className="tabular-nums" dir="ltr">
                            {qty(l.qty)}
                          </b>{" "}
                          <span className="text-xs text-muted-foreground">{l.unit}</span>
                          {last && (
                            <span className="ms-1 text-[11px] text-muted-foreground">
                              · {t("rq_up_last_price")} <bdi className="tabular-nums">{sarLtr(last.price.toLocaleString("en-US"))}</bdi>
                              {/* Where that price came from: the order and its day (the prototype's `lastTx`). */}
                              {(last.poNumber || last.day) && (
                                <bdi className="ms-1" data-testid="upcoming-price-source">
                                  · {[last.poNumber ? displayPoNumber(last.poNumber, locale) : "", last.day ? fmtDay(last.day, locale) : ""].filter(Boolean).join(" · ")}
                                </bdi>
                              )}
                            </span>
                          )}
                        </span>
                      )
                    })}
                  </p>
                  {(u.needBy || u.etaDays != null) && (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {u.needBy && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-semibold">
                          <CalendarClock size={11} aria-hidden="true" /> {t("rq_need_by", { date: fmtDay(u.needBy, locale) })}
                        </span>
                      )}
                      {u.etaDays != null && <StatusPill tone="info">{t("rq_up_eta", { days: u.etaDays })}</StatusPill>}
                    </p>
                  )}
                </div>
                <Button size="sm" variant="outline" aria-pressed={on} className={cn("h-8 gap-1.5", on && "border-module/40 bg-module/10 text-module")} onClick={() => void toggle(u.key)}>
                  {on ? <BellRing size={13} aria-hidden="true" /> : <Bell size={13} aria-hidden="true" />} {on ? t("rq_up_watching") : t("rq_up_notify")}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t("rq_upcoming_cap")}</p>
    </div>
  )
}
