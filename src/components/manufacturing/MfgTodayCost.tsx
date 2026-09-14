"use client"

// The cost controller's Today (TD-04, FN-04, FN-06, FN-07): work in progress —
// the same number on every screen — the scrap waiting for approval, the orders
// whose actual runs 15% or more above the standard of the work done; then the
// decisions (scrap reviews, cost statements to send or recalculate, variances)
// and the WIP reconciliation: per order, the sum, the ledger balance Finance
// holds for account 110402, the difference and what is still pending inside it.
// The cost controller does not see "awaiting other modules" (TD-08).

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { Coins, Hourglass, Trash2 } from "lucide-react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { ACC } from "@/lib/accounting/accounts"
import { JOURNAL_ENTRIES, type JournalEntry } from "@/lib/accounting/journal"
import { round2 } from "@/lib/manufacturing-engine"
import { wipReconciliation, wipTotal } from "@/lib/manufacturing-view"
import { cn } from "@/lib/utils"
import { useMfgUi } from "./MfgUiContext"
import { MfgModuleChip } from "./MfgOrderBits"
import { MfgEmpty, MfgKpiCard, MfgPanel, fmtMoney, useMfgDate } from "./ui/MfgUi"
import { DecisionList, Money, TodayGrid, TodayKpis } from "./MfgTodayBits"

type LedgerRead = { state: "loading" } | { state: "off" } | { state: "ready"; balance: number }

/** Finance's balance of the WIP account up to the cut-off, read from the
 * general journal: posted lines on 110402, debit − credit. Nothing is read
 * while the org has Accounting switched off. */
function useWipLedger(orgId: string, cutoff: string): LedgerRead {
  const firestore = useFirestore()
  const settingsQuery = useMemoFirebase(
    () => (firestore && orgId ? query(collection(firestore, "accounting_settings"), where("organizationId", "==", orgId)) : null),
    [firestore, orgId]
  )
  const { data: settingsData, error: settingsError } = useCollection<{ enabled?: boolean }>(settingsQuery)
  const enabled = !!settingsData?.some((s) => s.enabled === true)
  const journalQuery = useMemoFirebase(
    () => (firestore && orgId && enabled ? query(collection(firestore, JOURNAL_ENTRIES), where("organizationId", "==", orgId)) : null),
    [firestore, orgId, enabled]
  )
  const { data: entries, error: journalError } = useCollection<JournalEntry>(journalQuery)
  return useMemo<LedgerRead>(() => {
    if (settingsError || journalError) return { state: "off" }
    if (settingsData === null) return { state: "loading" }
    if (!enabled) return { state: "off" }
    if (entries === null) return { state: "loading" }
    let balance = 0
    for (const e of entries) {
      if (e.status !== "posted" || e.date > cutoff) continue
      for (const l of e.lines || []) if (l.account === ACC.inventoryWip) balance += (Number(l.debit) || 0) - (Number(l.credit) || 0)
    }
    return { state: "ready", balance: round2(balance) }
  }, [settingsError, journalError, settingsData, enabled, entries, cutoff])
}

export function MfgTodayCost() {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { views, data } = ui

  const figures = useMemo(() => {
    const open = views.filter((v) => v.released && v.live)
    const scrapPending = views.filter((v) => v.live).flatMap((v) => v.calc.slice.scrap.filter((s) => s.status === "pending"))
    const over = open.filter((v) => v.cost.earnedStandard > 0 && v.cost.total / v.cost.earnedStandard > 1.15)
    return {
      wip: wipTotal(views),
      open: open.length,
      scrapValue: round2(scrapPending.reduce((a, s) => a + s.value, 0)),
      over,
    }
  }, [views])

  return (
    <div className="min-w-0 space-y-4">
      <TodayKpis>
        <MfgKpiCard icon={Coins} label={t("mfw_kpi_wip_title")} value={<Money value={figures.wip} />} sub={t("mfw_kpi_wip_sub", { count: figures.open })} />
        <MfgKpiCard
          icon={Trash2}
          label={t("mfw_kpi_scrap_pending")}
          value={<Money value={figures.scrapValue} />}
          subTone={figures.scrapValue ? "warn" : "muted"}
          sub={figures.scrapValue ? t("mfw_kpi_scrap_pending_sub", { limit: fmtMoney(data.settings.scrapApprovalLimit) }) : t("mfw_none")}
        />
        <MfgKpiCard
          icon={Hourglass}
          label={t("mfw_kpi_over_standard")}
          value={<span className="tabular-nums">{figures.over.length}</span>}
          unit={t("mfw_orders_word", { count: figures.over.length })}
          subTone={figures.over.length ? "bad" : "ok"}
          sub={figures.over.length ? figures.over.map((v) => v.ref).join(t("mfw_list_sep")) : t("mfw_kpi_within_standard")}
        />
      </TodayKpis>

      <TodayGrid
        main={
          <MfgPanel title={t("mfw_decisions_title")} subtitle={t("mfw_decisions_sub_cost")} count={ui.decisions.length}>
            <DecisionList items={ui.decisions} empty={t("mfw_decisions_empty")} />
          </MfgPanel>
        }
        side={<WipReconciliation />}
      />
    </div>
  )
}

function WipReconciliation() {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const d = useMfgDate()
  const rec = useMemo(() => wipReconciliation(ui.views), [ui.views])
  const ledger = useWipLedger(ui.data.orgId, ui.today)
  const diff = ledger.state === "ready" ? round2(rec.total - ledger.balance) : null
  const unexplained = diff != null ? round2(diff - rec.unposted.time - rec.unposted.custody) : null

  const pending = [
    ...rec.pendingScrap.map((v) => t("mfw_rec_pending_scrap", { order: v.ref, value: fmtMoney(v.calc.slice.scrap.filter((s) => s.status === "pending").reduce((a, s) => a + s.value, 0)) })),
    ...rec.notesOut.flatMap((v) => v.notes.filter((n) => n.status === "in_transit").map((n) => t("mfw_rec_note_out", { note: n.noteNumber }))),
    ...rec.remnantsPending.map((v) => t("mfw_rec_remnants", { order: v.ref })),
  ]

  return (
    <MfgPanel
      title={t("mfw_rec_title")}
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {t("mfw_rec_account")} <MfgModuleChip module="finance" /> · {t("mfw_rec_as_of", { date: d.short(ui.today) })}
        </span>
      }
      count={rec.rows.length}
    >
      {rec.rows.length === 0 ? (
        <MfgEmpty icon={Coins} title={t("mfw_rec_empty")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-xs">
            <thead className="bg-muted/40 text-[11px] font-bold text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start">{t("mfw_rec_col_order")}</th>
                <th className="px-3 py-2 text-end">{t("mfw_rec_col_cost")}</th>
                <th className="px-3 py-2 text-end">{t("mfw_rec_col_delivered")}</th>
                <th className="px-3 py-2 text-end">{t("mfw_rec_col_scrap")}</th>
                <th className="px-3 py-2 text-end">{t("mfw_rec_col_balance")}</th>
              </tr>
            </thead>
            <tbody>
              {rec.rows.map((r) => (
                <tr key={r.view.id} className="border-t border-border/60">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => ui.openOrder(r.view.id)}
                      className="rounded text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <b className="block hover:underline">
                        <bdi dir="ltr">{r.view.ref}</bdi>
                      </b>
                      <span className="block text-[10px] text-muted-foreground">{r.view.product.name}</span>
                    </button>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{fmtMoney(r.cost)}</td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{fmtMoney(r.delivered)}</td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{fmtMoney(r.scrap)}</td>
                  <td className="px-3 py-2 text-end font-bold tabular-nums" dir="ltr">{fmtMoney(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <dl className="space-y-1.5 border-t border-border/60 px-4 py-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t("mfw_rec_sum")}</dt>
          <dd className="font-bold">
            <Money value={rec.total} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t("mfw_rec_ledger")}</dt>
          <dd className="font-bold">{ledger.state === "ready" ? <Money value={ledger.balance} /> : "—"}</dd>
        </div>
        {ledger.state === "off" && <p className="text-[11px] text-muted-foreground">{t("mfw_rec_ledger_off")}</p>}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-1.5">
          <dt className="font-bold text-foreground">{t("mfw_rec_difference")}</dt>
          <dd className={cn("font-black", diff != null && Math.abs(diff) >= 1 ? (unexplained != null && Math.abs(unexplained) < 1 ? "text-foreground" : "text-destructive") : "text-success")}>
            {diff != null ? <Money value={diff} /> : "—"}
          </dd>
        </div>
        {diff != null && Math.abs(diff) >= 1 && (
          <>
            {rec.unposted.time >= 1 && (
              <div className="flex items-center justify-between gap-3 ps-3 text-muted-foreground">
                <dt>{t("mfw_rec_unposted_time")}</dt>
                <dd><Money value={rec.unposted.time} /></dd>
              </div>
            )}
            {rec.unposted.custody >= 1 && (
              <div className="flex items-center justify-between gap-3 ps-3 text-muted-foreground">
                <dt>{t("mfw_rec_unposted_custody")}</dt>
                <dd><Money value={rec.unposted.custody} /></dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 ps-3">
              <dt className="font-bold text-foreground">{t("mfw_rec_unexplained")}</dt>
              <dd className={cn("font-black", unexplained != null && Math.abs(unexplained) >= 1 ? "text-destructive" : "text-success")}>{unexplained != null ? <Money value={unexplained} /> : "—"}</dd>
            </div>
          </>
        )}
        {pending.length > 0 && (
          <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
            <b className="text-slate-700">{t("mfw_rec_pending")}</b> {pending.join(" · ")}
          </p>
        )}
      </dl>
    </MfgPanel>
  )
}
