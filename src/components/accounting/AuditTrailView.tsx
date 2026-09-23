"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Download, History, Search } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { useAccounting } from "@/hooks/useAccounting"
import { cn } from "@/lib/utils"
import { auditTrail, type AuditEvent, type AuditEventType, type AuditFlag } from "@/lib/accounting/analytics"
import { formatMoney } from "@/lib/accounting/display"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { AccountingSection, AccountingShell, Money, accountingBasePath } from "./AccountingShell"
import { Kpi, LoadingBooks, SOURCE_LABEL_KEY } from "./AccountingParts"

const EVENT_TYPES: AuditEventType[] = ["entry_posted", "entry_draft", "entry_reversal", "period_closed", "settings_updated"]
const FLAGS: AuditFlag[] = ["manual", "backdated", "after_close", "reversed", "control_account"]

const EVENT_BADGE: Record<AuditEventType, string> = {
  entry_posted: "bg-success/10 text-success",
  entry_draft: "bg-warning/10 text-warning",
  entry_reversal: "bg-destructive/10 text-destructive",
  period_closed: "bg-primary/10 text-primary",
  settings_updated: "bg-cta/10 text-cta",
}

const FLAG_BADGE: Record<AuditFlag, string> = {
  manual: "bg-cta/10 text-cta",
  backdated: "bg-warning/10 text-warning",
  after_close: "bg-destructive/10 text-destructive",
  reversed: "bg-muted text-muted-foreground",
  control_account: "bg-warning/10 text-warning",
}

function formatStamp(iso: string | null, locale: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Audit trail (سجل التدقيق): every write to the books in the order it was made —
 * who posted or drafted each entry, reversals, period closes, settings changes —
 * with the patterns an auditor checks raised as flags: hand-written vouchers,
 * backdated entries, postings after a period was closed, manual entries on
 * control accounts. Read-only by construction: it is derived from the ledger's
 * own append-only history, so there is nothing here to edit.
 */
export function AuditTrailView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const data = useAccounting()
  const [search, setSearch] = useState("")
  const [user, setUser] = useState("all")
  const [type, setType] = useState<AuditEventType | "all">("all")
  const [flag, setFlag] = useState<AuditFlag | "all">("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const events = useMemo(() => auditTrail(data.entries, data.periods, data.settingsDoc), [data.entries, data.periods, data.settingsDoc])
  const users = useMemo(() => Array.from(new Set(events.map((e) => e.userName).filter(Boolean) as string[])).sort(), [events])
  const q = search.trim().toLowerCase()
  const visible = events.filter(
    (e) =>
      (user === "all" || e.userName === user) &&
      (type === "all" || e.type === type) &&
      (flag === "all" || e.flags.includes(flag)) &&
      (!from || (e.at && e.at.slice(0, 10) >= from)) &&
      (!to || (e.at && e.at.slice(0, 10) <= to)) &&
      (!q || e.description.toLowerCase().includes(q) || String(e.entryNumber ?? "") === q || (e.userName || "").toLowerCase().includes(q))
  )
  const flagged = events.filter((e) => e.flags.some((f) => f !== "manual")).length

  const describe = (e: AuditEvent) =>
    e.type === "period_closed"
      ? t("acc_audit_period_closed_desc", { period: e.period || "" })
      : e.type === "settings_updated"
        ? t("acc_audit_settings_desc")
        : e.description

  const exportCsv = () => {
    const header = [t("acc_audit_col_time"), t("acc_audit_col_user"), t("acc_audit_col_event"), "#", t("acc_description"), t("acc_date"), t("acc_amount"), t("acc_audit_col_flags")]
    const rows = visible.map((e) => [
      e.at ?? "",
      e.userName ?? "",
      t(`acc_audit_event_${e.type}`),
      e.entryNumber ?? "",
      describe(e),
      e.date ?? "",
      e.amount != null ? formatMoney(e.amount, "units") : "",
      e.flags.map((f) => t(`acc_audit_flag_${f}`)).join(" | "),
    ])
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n")
    // BOM so Excel opens Arabic text as UTF-8.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AccountingShell
      portal={portal}
      title={t("acc_nav_audit_trail")}
      description={t("acc_audit_desc")}
      icon={History}
      action={
        <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={visible.length === 0}>
          <Download size={16} aria-hidden="true" />
          {t("acc_export_csv")}
        </Button>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label={t("acc_audit_kpi_events")} value={String(events.length)} />
        <Kpi label={t("acc_audit_kpi_manual")} value={String(events.filter((e) => e.flags.includes("manual")).length)} />
        <Kpi label={t("acc_audit_kpi_reversals")} value={String(events.filter((e) => e.type === "entry_reversal").length)} />
        <Kpi label={t("acc_audit_kpi_flagged")} value={String(flagged)} tone={flagged > 0 ? "warn" : "good"} hint={t("acc_audit_kpi_flagged_hint")} />
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-2">
        <div className="relative min-w-48 flex-1 sm:max-w-64">
          <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("acc_journal_search")} aria-label={t("acc_journal_search")} className="h-9 ps-9 text-xs" />
        </div>
        <div className="w-44">
          <SearchableSelect
            size="sm"
            className="h-9"
            ariaLabel={t("acc_audit_col_user")}
            value={user}
            onChange={setUser}
            options={[{ value: "all", label: t("acc_audit_all_users") }, ...users.map((u) => ({ value: u, label: u }))]}
            placeholder={t("acc_audit_col_user")}
            searchPlaceholder={t("acc_search_options")}
            noResultsText={t("acc_no_options")}
          />
        </div>
        <div className="w-44">
          <SearchableSelect
            size="sm"
            className="h-9"
            ariaLabel={t("acc_audit_col_event")}
            value={type}
            onChange={(v) => setType(v as AuditEventType | "all")}
            options={[{ value: "all", label: t("acc_audit_all_events") }, ...EVENT_TYPES.map((et) => ({ value: et, label: t(`acc_audit_event_${et}`) }))]}
            placeholder={t("acc_audit_col_event")}
            searchPlaceholder={t("acc_search_options")}
            noResultsText={t("acc_no_options")}
          />
        </div>
        <div className="w-48">
          <SearchableSelect
            size="sm"
            className="h-9"
            ariaLabel={t("acc_audit_col_flags")}
            value={flag}
            onChange={(v) => setFlag(v as AuditFlag | "all")}
            options={[{ value: "all", label: t("acc_audit_all_flags") }, ...FLAGS.map((f) => ({ value: f, label: t(`acc_audit_flag_${f}`) }))]}
            placeholder={t("acc_audit_col_flags")}
            searchPlaceholder={t("acc_search_options")}
            noResultsText={t("acc_no_options")}
          />
        </div>
        <div className="space-y-0.5">
          <Label htmlFor="audit-from" className="text-[10px] text-muted-foreground">{t("acc_audit_recorded_from")}</Label>
          <Input id="audit-from" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40 text-xs" />
        </div>
        <div className="space-y-0.5">
          <Label htmlFor="audit-to" className="text-[10px] text-muted-foreground">{t("acc_audit_recorded_to")}</Label>
          <Input id="audit-to" type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40 text-xs" />
        </div>
      </div>

      {data.isLoading ? (
        <LoadingBooks />
      ) : (
        <AccountingSection title={t("acc_audit_events_title", { count: visible.length })} icon={History}>
          {visible.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">{t("acc_audit_empty")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-start w-36">{t("acc_audit_col_time")}</th>
                    <th className="px-4 py-2.5 text-start w-36">{t("acc_audit_col_user")}</th>
                    <th className="px-4 py-2.5 text-start w-32">{t("acc_audit_col_event")}</th>
                    <th className="px-4 py-2.5 text-start">{t("acc_description")}</th>
                    <th className="px-4 py-2.5 text-start w-28">{t("acc_date")}</th>
                    <th className="px-4 py-2.5 text-end w-28">{t("acc_amount")}</th>
                    <th className="px-4 py-2.5 text-start w-48">{t("acc_audit_col_flags")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <tr key={e.id} className={cn("border-t align-top", e.flags.some((f) => f === "after_close") && "bg-destructive/5")}>
                      <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground" dir="ltr">{formatStamp(e.at, locale)}</td>
                      <td className="px-4 py-2.5 text-xs">{e.userName || "—"}</td>
                      <td className="px-4 py-2.5">
                        <Badge className={cn("border-none text-[10px]", EVENT_BADGE[e.type])}>{t(`acc_audit_event_${e.type}`)}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        {e.entryId ? (
                          <Link href={`${accountingBasePath(portal)}/journal?entry=${encodeURIComponent(e.entryId)}`} className="hover:text-primary hover:underline">
                            <span className="me-1.5 tabular-nums text-muted-foreground" dir="ltr">#{e.entryNumber}</span>
                            {describe(e)}
                          </Link>
                        ) : (
                          describe(e)
                        )}
                        {e.sourceType && SOURCE_LABEL_KEY[e.sourceType] && (
                          <span className="block text-[10px] text-muted-foreground">{t(SOURCE_LABEL_KEY[e.sourceType])}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground" dir="ltr">{e.date ?? "—"}</td>
                      <td className="px-4 py-2.5 text-end">{e.amount != null ? <Money value={e.amount} /> : "—"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {e.flags.map((f) => (
                            <Badge key={f} className={cn("border-none text-[10px]", FLAG_BADGE[f])}>{t(`acc_audit_flag_${f}`)}</Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AccountingSection>
      )}
    </AccountingShell>
  )
}
