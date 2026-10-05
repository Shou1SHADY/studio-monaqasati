"use client"

// My file — my requests (the prototype's meReqs): every request in one table —
// what it asks, its number, the day filed, where it stands, who holds it now
// or who decided it (and why, when declined) — with "cancel" on one that has
// not started; then his letters, and the penalties on him with the objection
// window (PN-04).

import { useLocale, useTranslations } from "next-intl"
import { Flag, Inbox } from "lucide-react"
import { DataTable, Figure, type DataColumn } from "@/components/module-ui/DataTable"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useTableLabels } from "@/hooks/useTableLabels"
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
  const labels = useTableLabels()
  type Req = MyFileCtx["requests"][number]
  const decidedBy = (r: Req) => r.finance?.byName ?? r.decision?.byName ?? r.cancel?.byName ?? null
  const columns: DataColumn<Req>[] = [
    { key: "request", header: t("me.col.request"), cell: (r) => <span className="font-semibold">{describeRequest(t, r, locale, { money: true })}</span> },
    {
      key: "no",
      header: t("me.col.no"),
      sortValue: (r) => r.no ?? null,
      cell: (r) => <Figure className="text-muted-foreground">{requestNoDisplay(r.no, locale)}</Figure>,
    },
    { key: "date", header: t("me.col.date"), sortValue: (r) => r.createdAt ?? null, cell: (r) => <span className="text-muted-foreground">{hrDate(r.createdAt, locale)}</span> },
    { key: "state", header: t("me.col.state"), sortValue: (r) => t(`req.state.${r.state}`), cell: (r) => <StatusPill tone={REQUEST_TONE[r.state]}>{t(`req.state.${r.state}`)}</StatusPill> },
    {
      key: "holder",
      header: t("me.col.holder"),
      sortValue: (r) => ctx.holderOf(r) ?? decidedBy(r),
      cell: (r) => {
        const holder = ctx.holderOf(r)
        const by = decidedBy(r)
        const why = r.state === "declined" || r.state === "cancelled" ? (r.finance?.note ?? r.cancel?.note ?? r.decision?.note ?? null) : null
        return (
          <span className="text-xs text-muted-foreground">
            {holder ? t("me.held_by", { name: holder }) : by ? t("me.decided_by", { name: by, date: hrDate((r.finance ?? r.decision ?? r.cancel)?.at, locale) }) : "—"}
            {why && (
              <span className="block" dir="auto">
                {t("me.reason", { text: why })}
              </span>
            )}
          </span>
        )
      },
    },
    {
      key: "action",
      header: <span className="sr-only">{t("me.col.action")}</span>,
      label: t("me.col.action"),
      className: "text-end",
      cell: (r) => <CancelOwnRequest access={ctx.access} r={r} actor={ctx.actor} />,
    },
  ]
  return (
    <div className="space-y-4">
      <Panel title={t("me.all_requests")} icon={Inbox} count={requests.length}>
        <DataTable
          caption={t("me.all_requests")}
          labels={labels}
          dense
          bordered={false}
          className="-mx-4"
          columns={columns}
          rows={requests}
          rowKey={(r) => r.id}
          pageSize={50}
          empty={<p className="py-4 text-center text-sm text-muted-foreground">{t("req.none")}</p>}
        />
      </Panel>

      {/* EM-08 — his letters: status, the reason when declined, the issued letter to view and print. */}
      <HrLettersPanel access={ctx.access} actor={ctx.actor} emp={ctx.emp} pay={ctx.pay} />

      <Panel title={t("me.penalties")} icon={Flag} count={ctx.violations.length}>
        <HrViolationList access={ctx.access} actor={ctx.actor} violations={ctx.violations} all={ctx.violations} showEmployee={false} empty={t("vio.none")} />
      </Panel>
    </div>
  )
}
