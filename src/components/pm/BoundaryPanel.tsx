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
import { DataTable } from "@/components/module-ui/DataTable"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useTableLabels } from "@/hooks/useTableLabels"
import { JOURNAL_ENTRIES } from "@/lib/accounting/journal"
import { BOUNDARY_CONFLICTS, boundaryRows, eventStats, incomingEntries } from "@/lib/pm/boundary"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import type { PmCertificate } from "@/lib/pm/certificate-writes"
import { eventDocId, PM_EVENTS, type PmEvent } from "@/lib/pm/events"
import { PM_STORE, storeLineOf, type PmStoreLine } from "@/lib/pm/store"
import { PURCHASE_REQUESTS, requestOf } from "@/lib/pm/supply"
import { PURCHASE_ORDERS } from "@/lib/procurement/types"
import { pmDate, pmMoney } from "@/lib/pm/format"
import { cn } from "@/lib/utils"

const BLOCKS = [
  { key: "own", icon: Check, iconTone: "text-success" },
  { key: "read", icon: Eye, iconTone: "text-cta" },
  { key: "send", icon: Link2, iconTone: "text-warning" },
  { key: "never", icon: Ban, iconTone: "text-destructive" },
] as const

export function BoundaryPanel({ projectId, orgId, access }: { projectId: string; orgId: string; access: PmAccess }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const labels = useTableLabels()
  const money = access.has("money")

  const q = useMemoFirebase(
    () => (firestore && orgId ? query(collection(firestore, PM_EVENTS), where("organizationId", "==", orgId), where("projectId", "==", projectId)) : null),
    [firestore, orgId, projectId]
  )
  const { data } = useCollection(q)
  const events = useMemo(() => (data ?? []) as unknown as PmEvent[], [data])
  const stats = eventStats(events)

  // What crossed the other way: each module's own records about this project.
  const poQ = useMemoFirebase(
    () => (firestore && orgId ? query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", orgId), where("projectId", "==", projectId)) : null),
    [firestore, orgId, projectId]
  )
  const { data: poData } = useCollection(poQ)
  const certQ = useMemoFirebase(() => (firestore && money ? collection(firestore, "projects", projectId, PM_CERTIFICATES) : null), [firestore, money, projectId])
  const { data: certData } = useCollection(certQ)
  const financeReads = money && access.has("client")
  const relQ = useMemoFirebase(
    () => (firestore && orgId && financeReads ? query(collection(firestore, JOURNAL_ENTRIES), where("organizationId", "==", orgId), where("sourceType", "==", "retention_release")) : null),
    [firestore, orgId, financeReads]
  )
  const { data: relData } = useCollection(relQ)
  const reqQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PURCHASE_REQUESTS) : null), [firestore, projectId])
  const { data: reqData } = useCollection(reqQ)
  const storeQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_STORE) : null), [firestore, projectId])
  const { data: storeData } = useCollection(storeQ)
  const log = useMemo(() => {
    const incoming = incomingEntries({
      pos: (poData ?? []) as unknown as Parameters<typeof incomingEntries>[0]["pos"],
      certificates: (certData ?? []) as unknown as PmCertificate[],
      releases: (relData ?? []) as Array<{ sourceId: string; date: string }>,
      hndDocIds: new Set(events.filter((e) => e.kind === "HND").map((e) => eventDocId(e.key))),
      requests: ((reqData ?? []) as Array<Record<string, unknown> & { id: string }>).map(requestOf),
      stores: ((storeData ?? []) as Array<Partial<PmStoreLine> & { id: string }>).map((d) => storeLineOf(d.id, d)),
    })
    return boundaryRows(events, incoming)
  }, [events, poData, certData, relData, reqData, storeData])

  return (
    <div className="space-y-4">
      <Panel title={t("bound.title")} icon={ShieldCheck} description={t("bound.sub")} bodyClassName="p-0">
        {/* UX-15: four statements as flat rows with a toned icon — not four tinted boxes. */}
        <ul className="grid grid-cols-1 divide-y md:grid-cols-2 md:divide-y-0 md:[&>li:nth-child(n+3)]:border-t">
          {BLOCKS.map(({ key, icon: Icon, iconTone }) => (
            <li key={key} className="flex gap-2.5 px-4 py-3 text-sm leading-relaxed">
              <Icon size={16} className={cn("mt-1 shrink-0", iconTone)} aria-hidden="true" />
              <p>
                <b>{t(`bound.${key}_title`)}:</b> {t(`bound.${key}`)}
              </p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={t("bound.fin_title")} icon={Landmark} description={t("bound.fin_sub")} bodyClassName="p-0">
        <DataTable
          columns={[
            { key: "event", header: t("bound.col_event"), cell: (s) => <span className="font-semibold">{t(`bound.ev.${s.kind}`)}</span> },
            { key: "when", header: t("bound.col_when"), hideBelow: "lg", cell: (s) => <span className="text-xs text-muted-foreground">{t(`bound.ev_when.${s.kind}`)}</span> },
            {
              key: "key",
              header: t("bound.col_key"),
              cell: (s) => (
                <span dir="ltr" className="font-mono text-xs text-muted-foreground [unicode-bidi:isolate]">
                  {s.key}
                </span>
              ),
            },
            { key: "sent", header: t("bound.col_sent"), numeric: true, cell: (s) => <b>{s.sent}</b> },
            { key: "last", header: t("bound.col_last"), cell: (s) => (s.last ? <span className="text-xs">{pmDate(s.last.slice(0, 10), locale)}</span> : <StatusPill tone="bad">{t("bound.none_sent")}</StatusPill>) },
          ]}
          rows={stats}
          rowKey={(s) => s.kind}
          caption={t("bound.fin_title")}
          labels={labels}
          bordered={false}
          dense
          empty={null}
        />
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
            {log.map((row) =>
              row.dir === "out" ? (
                <li key={`out:${row.event.key}`} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                  <StatusPill tone="module">{t("bound.out")}</StatusPill>
                  <SourceBadge module="payments" label={t("bound.to_finance")} />
                  <span className="min-w-0 flex-1">
                    {t(`bound.ev.${row.event.kind}`)}{" "}
                    <span dir="ltr" className="font-mono text-xs text-muted-foreground [unicode-bidi:isolate]">
                      {row.event.key}
                    </span>
                    {money && row.event.amount > 0 && (
                      <>
                        {" · "}
                        <span dir="ltr">{pmMoney(row.event.amount)}</span>
                      </>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{pmDate(row.at.slice(0, 10), locale)}</span>
                </li>
              ) : (
                <li key={`in:${row.entry.id}`} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                  <StatusPill tone="info">{t("bound.in")}</StatusPill>
                  <SourceBadge module={row.entry.module} label={t(`bound.conf_module.${row.entry.module}`)} />
                  <span className="min-w-0 flex-1" dir="auto">
                    {t(`bound.in_kind.${row.entry.kind}`, row.entry.params)}
                    {money && (row.entry.amount ?? 0) > 0 && (
                      <>
                        {" · "}
                        <span dir="ltr">{pmMoney(row.entry.amount ?? 0)}</span>
                      </>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{pmDate(row.at.slice(0, 10), locale)}</span>
                </li>
              )
            )}
          </ul>
        )}
      </details>
    </div>
  )
}
