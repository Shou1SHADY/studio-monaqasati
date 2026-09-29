"use client"

// Money › Match & payment on a PM 1.0 project (STK-07): each line of the
// project's purchase orders — ordered × what we proved we received × what the
// supplier invoiced. Read-only: payment is Finance's, and it does not pay an
// invoice above what we received. Quantities are for everyone who sees the
// sub-tab; the invoiced amount only for holders of money.

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Scale } from "lucide-react"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useProjectCost } from "@/hooks/useProjectCost"
import { pmDate, pmMoney } from "@/lib/pm/format"
import { matchRows, MATCH_STATES, type MatchState } from "@/lib/pm/match"
import { PURCHASE_REQUESTS, reqNo, requestOf } from "@/lib/pm/supply"
import { displayDocNumber } from "@/lib/sales-numbering"
import { collection } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"

const TONE: Record<MatchState, PillTone> = { ok: "ok", over: "bad", under: "warn", noinv: "mute" }
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 })

export function MatchPanel({ projectId, orgId, items, access }: { projectId: string; orgId: string | null; items: Array<{ id: string; code: string }>; access: PmAccess }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const money = access.has("money")
  const world = useProjectCost(projectId, orgId, money)
  const rows = useMemo(() => matchRows(world.pos, world.invoices), [world.pos, world.invoices])
  const codeOf = useMemo(() => new Map(items.map((i) => [i.id, i.code])), [items])
  const firestore = useFirestore()
  const reqQ = useMemoFirebase(() => (firestore && money ? collection(firestore, "projects", projectId, PURCHASE_REQUESTS) : null), [firestore, money, projectId])
  const { data: reqData } = useCollection(reqQ)
  // The request an order answers: named on the order, or — for an older order — the request that names the order.
  const reqSeq = useMemo(() => {
    const reqs = ((reqData ?? []) as Array<Record<string, unknown> & { id: string }>).map(requestOf).filter((r) => r.seq)
    const byId = new Map(reqs.map((r) => [r.id, r.seq as number]))
    const byPo = new Map(reqs.filter((r) => r.poId).map((r) => [r.poId as string, r.seq as number]))
    return (row: { requestId: string | null; poId: string }) => (row.requestId ? byId.get(row.requestId) : undefined) ?? byPo.get(row.poId) ?? null
  }, [reqData])
  const bad = rows.filter((r) => r.state === "over").length

  if (!money) return <Callout tone="info">{t("money.money_only")}</Callout>

  return (
    <Panel
      title={t("money.match.title")}
      icon={Scale}
      count={rows.length || undefined}
      countTone={bad > 0 ? "bad" : "ok"}
      actions={<SourceBadge module="payments" label={t("money.match.payment_in_finance")} />}
      bodyClassName="p-0"
    >
      <p className="px-4 pt-3 text-xs text-muted-foreground">{t("money.match.sub")}</p>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("money.match.empty")}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-start font-semibold">{t("money.match.col.material")}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t("money.match.col.po")}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t("money.match.col.ordered")}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t("money.match.col.received")}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t("money.match.col.invoiced")}</th>
                  <th className="px-4 py-2 text-start font-semibold">{t("money.match.col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const known = (MATCH_STATES as readonly string[]).includes(r.state)
                  const code = r.itemId ? codeOf.get(r.itemId) : null
                  const seq = reqSeq(r)
                  return (
                    <tr key={`${r.poId}:${r.lineId}`} className="border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <p className="font-bold" dir="auto">
                          {r.material}
                        </p>
                        {code && (
                          <p className="text-xs text-muted-foreground" dir="ltr">
                            {code}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        <span dir="ltr">{displayDocNumber(r.poNo, locale)}</span>
                        {seq !== null && <p className="text-muted-foreground">{t("boqsup.po_from", { no: reqNo(seq) })}</p>}
                        {r.invoice && (
                          <p className="text-muted-foreground">
                            {t("money.match.invoice_line", { no: r.invoice.no, date: pmDate(r.invoice.date, locale) })}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums" dir="ltr">
                        {qty(r.ordered)}
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums" dir="ltr">
                        {qty(r.received)}
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums" dir="ltr">
                        {r.invoiced === null ? "—" : qty(r.invoiced)}
                        {r.invoicedAmount !== null && money && <p className="text-xs text-muted-foreground">{pmMoney(r.invoicedAmount)}</p>}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill tone={known ? TONE[r.state] : "bad"}>{known ? t(`money.match.state.${r.state}`) : t("unknown_state")}</StatusPill>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{bad ? t("money.match.over_note", { count: bad }) : t("money.match.all_ok")}</p>
        </>
      )}
    </Panel>
  )
}
