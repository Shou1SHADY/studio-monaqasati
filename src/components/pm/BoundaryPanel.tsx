"use client"

// Settings › Module boundary on a PM 1.0 project (prototype fileBound, PRD §11).
// What the module owns, what it only reads, what it sends as an event, and what
// it never does for another module — then Finance's integration contract with
// this project's live count per event, the conflicts with existing modules that
// governance must unify, and the log of what crossed.

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { AlertTriangle, Ban, Check, Clock, Eye, Landmark, Link2, ShieldCheck } from "lucide-react"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { BOUNDARY_CONFLICTS, boundaryLog, eventStats } from "@/lib/pm/boundary"
import { PM_EVENTS, type PmEvent } from "@/lib/pm/events"
import { pmDate, pmMoney } from "@/lib/pm/format"
import { cn } from "@/lib/utils"

const BLOCKS = [
  { key: "own", icon: Check, tone: "border-success/25 bg-success/5", iconTone: "text-success" },
  { key: "read", icon: Eye, tone: "border-cta/20 bg-cta/5", iconTone: "text-cta" },
  { key: "send", icon: Link2, tone: "border-warning/25 bg-warning/5", iconTone: "text-warning" },
  { key: "never", icon: Ban, tone: "border-destructive/25 bg-destructive/5", iconTone: "text-destructive" },
] as const

export function BoundaryPanel({ projectId, orgId, access }: { projectId: string; orgId: string; access: PmAccess }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const money = access.has("money")

  const q = useMemoFirebase(
    () => (firestore && orgId ? query(collection(firestore, PM_EVENTS), where("organizationId", "==", orgId), where("projectId", "==", projectId)) : null),
    [firestore, orgId, projectId]
  )
  const { data } = useCollection(q)
  const events = useMemo(() => (data ?? []) as unknown as PmEvent[], [data])
  const stats = eventStats(events)
  const log = boundaryLog(events)

  return (
    <div className="space-y-4">
      <Panel title={t("bound.title")} icon={ShieldCheck}>
        <p className="mb-3 text-xs text-muted-foreground">{t("bound.sub")}</p>
        <div className="grid gap-2.5 md:grid-cols-2">
          {BLOCKS.map(({ key, icon: Icon, tone, iconTone }) => (
            <div key={key} className={cn("flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-relaxed", tone)}>
              <Icon size={16} className={cn("mt-1 shrink-0", iconTone)} aria-hidden="true" />
              <p>
                <b>{t(`bound.${key}_title`)}:</b> {t(`bound.${key}`)}
              </p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={t("bound.fin_title")} icon={Landmark} bodyClassName="p-0">
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("bound.fin_sub")}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-start font-semibold">{t("bound.col_event")}</th>
                <th className="px-4 py-2 text-start font-semibold">{t("bound.col_when")}</th>
                <th className="px-4 py-2 text-start font-semibold">{t("bound.col_key")}</th>
                <th className="px-4 py-2 text-end font-semibold">{t("bound.col_sent")}</th>
                <th className="px-4 py-2 text-start font-semibold">{t("bound.col_last")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stats.map((s) => (
                <tr key={s.kind}>
                  <td className="px-4 py-2.5 font-semibold">{t(`bound.ev.${s.kind}`)}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{t(`bound.ev_when.${s.kind}`)}</td>
                  <td className="px-4 py-2.5">
                    <span dir="ltr" className="font-mono text-xs text-muted-foreground [unicode-bidi:isolate]">
                      {s.key}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-end font-bold tabular-nums" dir="ltr">
                    {s.sent}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{s.last ? pmDate(s.last.slice(0, 10), locale) : <StatusPill tone="bad">{t("bound.none_sent")}</StatusPill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <details className="overflow-hidden rounded-xl border bg-card">
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm font-bold">
          <AlertTriangle size={16} className="text-warning" aria-hidden="true" />
          {t("bound.conf_title")}
          <StatusPill tone="warn">
            <span dir="ltr">{BOUNDARY_CONFLICTS.length}</span>
          </StatusPill>
          <span className="text-xs font-normal text-muted-foreground">{t("bound.conf_sub")}</span>
        </summary>
        <ul className="divide-y border-t">
          {BOUNDARY_CONFLICTS.map((c) => (
            <li key={c.key} className="flex items-start gap-2.5 px-4 py-2.5 text-sm leading-relaxed">
              <SourceBadge module={c.module} label={t(`bound.conf_module.${c.module}`)} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">{t(`bound.conf.${c.key}`)}</span>
            </li>
          ))}
        </ul>
      </details>

      <details className="overflow-hidden rounded-xl border bg-card">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 py-3 text-sm font-bold">
          <Clock size={16} className="text-module" aria-hidden="true" />
          {t("bound.log_title")}
          <StatusPill tone="mute">
            <span dir="ltr">{log.length}</span>
          </StatusPill>
          <span className="text-xs font-normal text-muted-foreground">{t("bound.log_sub")}</span>
        </summary>
        {log.length === 0 ? (
          <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">{t("bound.log_empty")}</p>
        ) : (
          <ul className="divide-y border-t">
            {log.map((e) => (
              <li key={e.key} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <StatusPill tone="module">{t("bound.out")}</StatusPill>
                <StatusPill tone="info">{t("bound.to_finance")}</StatusPill>
                <span className="min-w-0 flex-1">
                  {t(`bound.ev.${e.kind}`)}{" "}
                  <span dir="ltr" className="font-mono text-xs text-muted-foreground [unicode-bidi:isolate]">
                    {e.key}
                  </span>
                  {money && e.amount > 0 && (
                    <>
                      {" · "}
                      <span dir="ltr">{pmMoney(e.amount)}</span>
                    </>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{pmDate(e.at?.slice(0, 10), locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  )
}
