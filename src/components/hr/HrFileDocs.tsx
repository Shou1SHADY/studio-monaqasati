"use client"

// The employee file's Documents (the prototype's efDocs, DC-01…07): one row per
// document he holds — no iqama for a Saudi, a licence only for a trade that
// drives, the contract from the contract (open-ended expires never) — with its
// number, expiry, days left (coloured; "expired N days ago") and state, and
// the row's own action: record the issue (never issued) or the renewal; the
// contract's end is the HR manager's decision. Then the GOSI number, scheme
// and medical class, the attachments and the injury register.

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useTableLabels } from "@/hooks/useTableLabels"
import { DOC_RANK, medicalClass, type DocRow } from "@/lib/hr/documents"
import { hrDate } from "@/lib/hr/format"
import { gosiRates } from "@/lib/hr/pay"
import { daysBetween } from "@/lib/hr/statutory"
import { cn } from "@/lib/utils"
import { HrEmployeeFiles } from "./HrEmployeeFiles"
import { HrInjuryPanel } from "./HrInjuryPanel"
import { DOC_TONE } from "./HrPeopleView"
import type { FileView } from "./hr-file-view"

export function HrFileDocs({ v }: { v: FileView }) {
  const t = useTranslations("Portal.HR")
  const labels = useTableLabels()
  const { emp, today, locale, access } = v
  const no = emp.docs?.no ?? {}
  const gosi = gosiRates(emp.nationality, emp.join)
  const mayRenew = access.allowed("documents.manage") && emp.status !== "left"
  const mayDecideContract = access.allowed("exit.manage") && emp.contract?.type === "fixed" && (emp.status === "active" || emp.status === "leave" || emp.status === "expected")
  const numberOf = (r: DocRow): string | null => {
    if (r.type === "iqama") return emp.idNo ?? null
    if (r.type === "passport" || r.type === "insurance" || r.type === "licence") return no[r.type] ?? null
    return null
  }
  const left = (r: DocRow) => {
    if (!r.expiry) return r.pendingDue ? <span className="text-xs text-muted-foreground">{t("file.doc_due_by", { date: hrDate(r.pendingDue, locale) })}</span> : "—"
    const n = daysBetween(today, r.expiry)
    return (
      <span className={cn("tabular-nums", r.state === "expired" ? "font-bold text-destructive" : r.state === "d30" ? "font-semibold text-destructive" : r.state === "d60" ? "font-semibold text-warning" : undefined)}>
        {n < 0 ? t("file.expired_ago", { n: -n }) : t("file.days_left", { n })}
      </span>
    )
  }

  const daysLeft = (r: DocRow) => (r.open || !r.expiry ? null : daysBetween(today, r.expiry))
  const columns: DataColumn<DocRow>[] = [
    { key: "doc", header: t("file.doc_col.doc"), sortValue: (r) => t(`doc.${r.type}`), cell: (r) => <span className="font-semibold">{t(`doc.${r.type}`)}</span> },
    {
      key: "number",
      header: t("file.doc_col.number"),
      sortValue: (r) => (r.type === "contract" ? null : numberOf(r)),
      cell: (r) => {
        const num = numberOf(r)
        return <span className="text-xs tabular-nums text-muted-foreground">{r.type === "contract" ? t("file.contract_qiwa") : num ? <bdi dir="ltr">{num}</bdi> : "—"}</span>
      },
    },
    {
      key: "expiry",
      header: t("file.doc_col.expiry"),
      sortValue: (r) => (r.open ? null : (r.expiry ?? null)),
      cell: (r) => (r.open ? t("file.open_ended") : r.expiry ? hrDate(r.expiry, locale) : r.pendingDue ? t("file.not_issued") : t("file.doc_missing")),
    },
    { key: "left", header: t("file.doc_col.left"), sortValue: daysLeft, cell: (r) => (r.open ? "—" : left(r)) },
    {
      key: "state",
      header: t("file.doc_col.state"),
      sortValue: (r) => (r.open ? 0 : DOC_RANK[r.state]),
      cell: (r) => <StatusPill tone={r.open ? "ok" : DOC_TONE[r.state]}>{r.open ? t("doc_state.valid") : r.pendingDue && !r.expiry ? t("file.not_issued") : t(`doc_state.${r.state}`)}</StatusPill>,
    },
    ...(mayRenew || mayDecideContract
      ? [
          {
            key: "action",
            header: <span className="sr-only">{t("file.doc_col.action")}</span>,
            label: t("file.doc_col.action"),
            className: "text-end",
            cell: (r: DocRow) =>
              r.type === "contract"
                ? mayDecideContract && (
                    <Button size="sm" variant="outline" onClick={() => v.open("contract")}>
                      {t("file.act.contract")}
                    </Button>
                  )
                : mayRenew && (
                    <Button size="sm" variant="outline" onClick={() => v.open("renew", { docType: r.type })}>
                      {r.expiry ? t("file.renew_row") : t("file.issue_row")}
                    </Button>
                  ),
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-4">
      <Panel title={t("file.seg.docs")} bodyClassName="p-0">
        <DataTable caption={t("file.seg.docs")} labels={labels} dense bordered={false} columns={columns} rows={v.rows} rowKey={(r) => r.type} empty={null} />
        <div className="grid gap-x-6 border-t px-4 py-3 sm:grid-cols-3">
          <KeyValueRow
            label={t("file.gosi_no")}
            value={
              <span>
                <span dir={no.gosi ? "ltr" : undefined}>{no.gosi || t("file.not_recorded")}</span>
                <span className="ms-1.5 text-xs text-muted-foreground">{t(emp.nationality === "sa" ? "file.gosi_cover_sa" : "file.gosi_cover_x")}</span>
              </span>
            }
          />
          <KeyValueRow label={t("file.gosi_scheme")} value={t(`file.scheme.${gosi.scheme}`)} />
          <KeyValueRow label={t("file.medical_class")} value={medicalClass(emp) ?? "—"} ltr />
        </div>
      </Panel>
      {(access.allowed("documents.manage") || access.seesPay(emp.id)) && <HrEmployeeFiles access={access} actor={v.actor} emp={emp} />}
      <HrInjuryPanel access={access} actor={v.actor} emp={emp} />
    </div>
  )
}
