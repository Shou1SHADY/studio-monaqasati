"use client"

// My file — documents and details (the prototype's meDocs): his card — the
// number first, his key everywhere — with the ID or iqama number, trade,
// contract, probation while it runs, line manager and who handles employee
// affairs, his contact details and qualification, the air ticket; the update
// button (the HR manager approves; an IBAN with the bank's document); and his
// documents with the days left (DC-01) — only the ones that are his.

import { useLocale, useTranslations } from "next-intl"
import { BadgeCheck, IdCard, PencilLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { probationState } from "@/lib/hr/employee"
import { empNo, hrDate } from "@/lib/hr/format"
import { serviceYears } from "@/lib/hr/statutory"
import { cn } from "@/lib/utils"
import { DOC_TONE } from "./HrPeopleView"
import type { MyFileCtx } from "./HrMyFile"

export function HrMyDocs({ ctx }: { ctx: MyFileCtx }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const { emp, today } = ctx
  const fixed = emp.contract?.type === "fixed"
  const probation = probationState(emp, today) === "on"
  const contact = (emp.contact ?? {}) as { mobile?: string | null; address?: string | null; emergency?: string | null; qualification?: string | null }
  const th = "px-3 py-2 text-start text-xs font-semibold text-muted-foreground"
  return (
    <div className="space-y-4">
      <Panel
        title={t("me.card")}
        icon={IdCard}
        actions={
          <Button size="sm" variant="outline" onClick={() => ctx.ask("data")}>
            <PencilLine size={14} className="me-1.5" aria-hidden="true" />
            {t("req.new_data")}
          </Button>
        }
      >
        <KeyValueRow label={t("people.col.no")} value={<span className="text-base">{empNo(emp.no)}</span>} ltr strong />
        <p className="pb-1 text-[11px] text-muted-foreground">{t("me.no_note")}</p>
        <KeyValueRow label={t(emp.nationality === "sa" ? "me.national_id" : "me.iqama_no")} value={emp.idNo || "—"} ltr />
        <KeyValueRow label={t("me.trade_contract")} value={t(`trade.${emp.trade}` as "trade.mason")} />
        <KeyValueRow label={t("new.join")} value={`${hrDate(emp.join, locale)} · ${t("file.years", { n: Math.floor(serviceYears(emp.join, today)) })}`} />
        <KeyValueRow label={t("new.contract")} value={fixed ? t("me.contract_fixed", { date: hrDate(emp.contract.end, locale) }) : t("contract.open")} />
        {probation && <KeyValueRow label={t("file.probation")} value={t("file.probation_until", { date: hrDate(emp.probation?.end, locale) })} />}
        <KeyValueRow label={t("me.line_manager")} value={ctx.lineManager?.name ?? t("me.holder.management")} />
        <KeyValueRow label={t("me.affairs")} value={ctx.holders.gov ?? ctx.holders.manager ?? "—"} />
        <KeyValueRow label={t("data_field.mobile")} value={contact.mobile || "—"} ltr={Boolean(contact.mobile)} />
        <KeyValueRow label={t("data_field.address")} value={contact.address || "—"} />
        <KeyValueRow label={t("data_field.emergency")} value={contact.emergency || "—"} />
        <KeyValueRow label={t("data_field.qualification")} value={contact.qualification || "—"} />
        {emp.nationality !== "sa" && <KeyValueRow label={t("me.ticket")} value={t("me.ticket_booked")} />}
        <p className="pt-2 text-[11px] text-muted-foreground">{t("me.details_note")}</p>
      </Panel>

      <Panel title={t("me.documents")} icon={BadgeCheck} count={ctx.docs.length}>
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className={th}>{t("me.col.document")}</th>
                <th className={th}>{t("me.col.expires")}</th>
                <th className={th}>{t("me.col.left")}</th>
                <th className={th}>{t("me.col.state")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ctx.docs.map((d) => (
                <tr key={d.type}>
                  <td className="px-3 py-2 font-semibold">{t(`doc.${d.type}`)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{d.expiry ? hrDate(d.expiry, locale) : t("doc_state.missing")}</td>
                  <td className={cn("px-3 py-2 tabular-nums", d.left != null && d.left < 0 ? "text-destructive" : d.left != null && d.left <= 30 ? "text-warning" : "text-muted-foreground")}>
                    {d.left == null ? "—" : d.left < 0 ? t("me.expired_ago", { n: -d.left }) : t("file.days_left", { n: d.left })}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={DOC_TONE[d.state]}>{t(`doc_state.${d.state}`)}</StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pt-2 text-[11px] text-muted-foreground">{t("me.documents_note")}</p>
      </Panel>
    </div>
  )
}
