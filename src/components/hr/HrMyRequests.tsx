"use client"

// My file — my requests (the prototype's meReqs): every request in one table —
// what it asks, its number, the day filed, where it stands, who holds it now
// or who decided it (and why, when declined) — with "cancel" on one that has
// not started; then his letters, and the penalties on him with the objection
// window (PN-04).

import { useLocale, useTranslations } from "next-intl"
import { Flag, Inbox } from "lucide-react"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { hrDate } from "@/lib/hr/format"
import { requestNoDisplay } from "@/lib/hr/requests"
import { HrLettersPanel } from "./HrLetters"
import { HrViolationList } from "./HrViolationList"
import { CancelOwnRequest, describeRequest, REQUEST_TONE } from "./HrRequestList"
import type { MyFileCtx } from "./HrMyFile"

export function HrMyRequests({ ctx }: { ctx: MyFileCtx }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const { requests } = ctx
  const th = "px-3 py-2 text-start text-xs font-semibold text-muted-foreground"
  return (
    <div className="space-y-4">
      <Panel title={t("me.all_requests")} icon={Inbox} count={requests.length}>
        {requests.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("req.none")}</p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  <th className={th}>{t("me.col.request")}</th>
                  <th className={th}>{t("me.col.no")}</th>
                  <th className={th}>{t("me.col.date")}</th>
                  <th className={th}>{t("me.col.state")}</th>
                  <th className={th}>{t("me.col.holder")}</th>
                  <th className={th}>
                    <span className="sr-only">{t("me.col.action")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {requests.map((r) => {
                  const holder = ctx.holderOf(r)
                  const decidedBy = r.finance?.byName ?? r.decision?.byName ?? r.cancel?.byName ?? null
                  const why = r.state === "declined" || r.state === "cancelled" ? (r.finance?.note ?? r.cancel?.note ?? r.decision?.note ?? null) : null
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="px-3 py-2 font-semibold">{describeRequest(t, r, locale, { money: true })}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground" dir="ltr">
                        {requestNoDisplay(r.no, locale)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{hrDate(r.createdAt, locale)}</td>
                      <td className="px-3 py-2">
                        <StatusPill tone={REQUEST_TONE[r.state]}>{t(`req.state.${r.state}`)}</StatusPill>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {holder ? t("me.held_by", { name: holder }) : decidedBy ? t("me.decided_by", { name: decidedBy, date: hrDate((r.finance ?? r.decision ?? r.cancel)?.at, locale) }) : "—"}
                        {why && (
                          <span className="block" dir="auto">
                            {t("me.reason", { text: why })}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-end">
                        <CancelOwnRequest access={ctx.access} r={r} actor={ctx.actor} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* EM-08 — his letters: status, the reason when declined, the issued letter to view and print. */}
      <HrLettersPanel access={ctx.access} actor={ctx.actor} emp={ctx.emp} pay={ctx.pay} />

      <Panel title={t("me.penalties")} icon={Flag} count={ctx.violations.length}>
        <HrViolationList access={ctx.access} actor={ctx.actor} violations={ctx.violations} all={ctx.violations} showEmployee={false} empty={t("vio.none")} />
      </Panel>
    </div>
  )
}
