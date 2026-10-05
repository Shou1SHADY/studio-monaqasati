"use client"

// The employee file's Requests & log (the prototype's efLog): his requests —
// each with the day it was filed, who holds it now (by name where we know
// him) or who decided it — his letters, his violations (with the hearing and
// the 180-day note: only applied penalties count again), and the undeletable
// log, each entry with the module it came from (EM-06).

import { useTranslations } from "next-intl"
import { Gavel, History, Inbox } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import type { LogEntry } from "@/lib/hr/employee-writes"
import { displayName } from "@/lib/hr/employee"
import { hrDate, hrMoney } from "@/lib/hr/format"
import type { HrRequest } from "@/lib/hr/requests"
import type { PortalComponentId } from "@/lib/portal-components"
import { HrLettersPanel } from "./HrLetters"
import { HrRequestList } from "./HrRequestList"
import { HrViolationList } from "./HrViolationList"
import type { FileView } from "./hr-file-view"

const SOURCE_MODULE: Record<LogEntry["source"], PortalComponentId | null> = { hr: null, finance: "payments", inventory: "warehouses", projects: "project-management" }

export function HrFileLog({ v, onRecordViolation }: { v: FileView; onRecordViolation: () => void }) {
  const t = useTranslations("Portal.HR")
  const { emp, access, locale } = v
  const nameOf = (employeeId: string | null | undefined) => {
    const e = employeeId ? v.employees.find((x) => x.id === employeeId) : null
    return e ? displayName(e, locale) : null
  }
  // Who holds a request now (the prototype's reqHolder), or who decided it.
  const facts = (r: HrRequest) => {
    const filed = t("file.req_filed", { date: hrDate(r.filedBy?.at?.slice(0, 10) ?? r.createdAt?.slice(0, 10), locale), by: r.filedBy?.byName || "—" })
    if (r.state === "pending" && r.kind === "leave" && r.lineManagerId) return `${filed} · ${t("file.req_with", { who: nameOf(r.lineManagerId) ?? t("file.line_manager") })}`
    if (r.state === "pending" || r.state === "endorsed") return `${filed} · ${t("file.req_with", { who: t(r.deciderLevel === "management" ? "file.holder_management" : "file.holder_manager") })}`
    if (r.state === "finance") return `${filed} · ${t("file.req_with", { who: t("file.holder_finance") })}`
    const by = r.finance?.byName || r.cancel?.byName || r.decision?.byName
    return by ? `${filed} · ${t("file.req_by", { who: by })}` : filed
  }
  const requests = v.requests.filter((r) => r.kind !== "raise" || v.money)

  return (
    <div className="space-y-4">
      <Panel title={t("req.title")} icon={Inbox} count={requests.length}>
        <HrRequestList access={access} requests={requests} showEmployee={false} empty={t("req.none")} rowFacts={(r) => { const f = facts(r); return f ? <p className="text-xs text-muted-foreground">{f}</p> : null }} />
      </Panel>

      <HrLettersPanel access={access} actor={v.actor} emp={emp} pay={v.pay} portal={v.portal} />

      <Panel
        title={t("vio.title")}
        icon={Gavel}
        count={v.violations.length}
        actions={
          access.allowed("violation.record", { site: emp.siteId }) && (emp.siteId || access.allowed("violation.record")) && emp.status !== "left" ? (
            <Button size="sm" variant="outline" onClick={onRecordViolation}>
              {t("vio.record")}
            </Button>
          ) : null
        }
      >
        <HrViolationList access={access} actor={v.actor} violations={v.violations} all={v.violations} pay={v.pay} showEmployee={false} empty={t("vio.none")} />
        {v.violations.some((x) => x.hearing?.on) && (
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {v.violations
              .filter((x) => x.hearing?.on)
              .map((x) => (
                <li key={x.id}>{t("file.vio_heard", { code: t(`violation.${x.code}` as "violation.late15"), on: hrDate(x.on, locale), date: hrDate(x.hearing!.on, locale) })}</li>
              ))}
          </ul>
        )}
        <p className="pt-2 text-[11px] text-muted-foreground">{t("file.vio_180_note")}</p>
      </Panel>

      <Panel title={t("file.log_title")} icon={History} count={v.log.length}>
        {v.log.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("file.log_empty")}</p>
        ) : (
          <ol className="divide-y">
            {v.log.map((l) => {
              const mod = SOURCE_MODULE[l.source] ?? null
              return (
                <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
                  <span className="font-semibold text-foreground">{t.has(`log.${l.kind}`) ? t(`log.${l.kind}` as "log.created", logParams(l, t, v.siteName, locale)) : l.kind}</span>
                  <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {l.byName || "—"} · {hrDate(l.at?.slice(0, 10), locale)}
                    {mod && <SourceBadge module={mod} label={t(`file.src.${l.source}` as "file.src.finance")} />}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </Panel>
    </div>
  )
}

/** Log params rendered for reading: places and trades by name, days by locale. */
function logParams(l: LogEntry, t: ReturnType<typeof useTranslations>, siteName: (id: string | null | undefined) => string | null, locale: string): Record<string, string> {
  const p = l.params ?? {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(p)) {
    if (v == null) out[k] = "—"
    else if (k === "from" || k === "to") {
      if (l.kind === "moved" || l.kind === "move_scheduled") out[k] = siteName(String(v)) ?? t("sites.unassigned")
      else out[k] = hrDate(String(v), locale)
    } else if (k === "on" || k === "consent" || k === "lastDay") out[k] = hrDate(String(v), locale)
    else if (k === "reason" && l.kind === "exit_started") out[k] = t(`exit.reasons.${v}` as "exit.reasons.resignation")
    else if (k === "doc") out[k] = t(`doc.${v}` as "doc.iqama")
    else if (k === "docs") out[k] = String(v).split(",").map((d) => t(`file.no_key.${d}` as "file.no_key.passport")).join("، ")
    else if (k === "recommend") out[k] = t(`pview.recs.${v}` as "pview.recs.confirm")
    else if (k === "trade") out[k] = t(`trade.${v}` as "trade.mason")
    else if (k === "code") out[k] = t(`violation.${v}` as "violation.late15")
    else if (k === "site") out[k] = siteName(String(v)) ?? t("sites.unassigned")
    else if (k === "fee") out[k] = hrMoney(Number(v))
    else if (k === "pf") out[k] = t(`pf.name.${v}` as "pf.name.qiwa")
    else if (k === "task") out[k] = t(`pf.short.${v}` as "pf.short.ct")
    else if (k === "was" || k === "now") out[k] = t(`punch.shift.${v}` as "punch.shift.m")
    else if (k === "why") out[k] = t(`punch.otno.${v}` as "punch.otno.nowork")
    else if (k === "course") out[k] = t(`train.course.${v}` as "train.course.ind")
    else if (k === "band") out[k] = t(`perf.band.${v}` as "perf.band.A")
    else out[k] = String(v)
  }
  return out
}
