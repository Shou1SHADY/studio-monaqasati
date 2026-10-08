"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarCheck2, CalendarClock, ClipboardList, TriangleAlert } from "lucide-react"
import { CrmEmptyState, CrmListSkeleton, CrmStat, CrmStatRow } from "@/components/crm/CrmShell"
import { CrmShowMore, CrmToolbar } from "@/components/crm/CrmToolbar"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { staffName, type AdminCrm } from "@/hooks/useAdminCrm"
import { useCrmListState, type CrmListConfig } from "@/hooks/useCrmListState"
import { ACTIVITY_SEGMENTS, NEW_ACTIVITY_TYPES, effectiveContacts, inActivitySegment, sortActivities, summarizeActivities, toDateKey, type CrmActivity } from "@/lib/admin-crm"
import { deleteActivity, setActivityDone } from "@/lib/admin-crm-writes"
import { ActivityDialog, type Party } from "./ActivityDialog"
import { ActivityRow } from "./ActivityRow"

type Row = CrmActivity & { related: "lead" | "client" | ""; party: string }

const NONE = "__none"

/**
 * ADM-08 on the subscribers' «Activities» components: four numbers, the due-date strip (open · overdue · due today ·
 * within 7 days · done · all), the shared toolbar — with a filter that tells a lead's activities from a client's —
 * and one list for both. Every row says whose it is: «lead · company · with … · owner».
 */
export function ActivitiesTab({ crm, dialogOpen, onDialogOpen }: { crm: AdminCrm; dialogOpen: boolean; onDialogOpen: (open: boolean) => void }) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [edit, setEdit] = useState<CrmActivity | null>(null)
  const now = useMemo(() => new Date(), [])
  const today = toDateKey(now)
  const me = crm.user?.uid ?? ""
  const actorName = staffName(crm.staff.find((s) => s.id === me) ?? { id: me, email: crm.user?.email ?? "" })

  const parties = useMemo<Party[]>(() => {
    const people = (id: string, name: string, phone: string, email: string) => effectiveContacts(crm.records[id]?.contacts, { name, phone, email })
    return [
      ...crm.leadRows.filter((r) => !r.archived).map((r) => ({ id: r.crmId, label: `${t("lead_badge")} · ${[r.name, r.company].filter(Boolean).join(" — ")}`, contacts: people(r.crmId, r.name, r.phone, r.email) })),
      ...crm.clientRows.map((r) => ({ id: r.id, label: `${t("client_badge")} · ${r.name}`, contacts: people(r.id, r.name, r.phone, r.email) })),
    ]
  }, [crm.leadRows, crm.clientRows, crm.records, t])

  // Whose activity it is: a lead (by its company, else its name) or a client.
  const owners = useMemo(() => {
    const out = new Map<string, { related: "lead" | "client"; party: string }>()
    for (const r of crm.leadRows) out.set(r.crmId, { related: "lead", party: r.company || r.name })
    for (const r of crm.clientRows) out.set(r.id, { related: "client", party: r.name })
    return out
  }, [crm.leadRows, crm.clientRows])
  const rows = useMemo<Row[]>(
    () => sortActivities(crm.activities).map((a) => ({ ...a, related: owners.get(a.clientId)?.related ?? "", party: owners.get(a.clientId)?.party ?? "" })),
    [crm.activities, owners],
  )
  const summary = useMemo(() => summarizeActivities(crm.activities, now), [crm.activities, now])

  const config: CrmListConfig<Row> = {
    segments: ACTIVITY_SEGMENTS.map((s) => ({ key: s, label: t(`seg_${s}`), predicate: (a: Row) => inActivitySegment(a, s, now) })),
    facets: [
      { key: "related", label: t("activity_related"), options: [{ value: "lead", label: t("lead_badge") }, { value: "client", label: t("client_badge") }], valueOf: (a) => a.related || null },
      { key: "type", label: t("type_label"), options: NEW_ACTIVITY_TYPES.map((k) => ({ value: k, label: t(`type_${k}`) })), valueOf: (a) => a.type },
      {
        key: "owner",
        label: t("owner_label"),
        options: [
          { value: me, label: t("filter_me") },
          { value: NONE, label: t("unassigned") },
          ...crm.staff.filter((s) => s.id !== me).map((s) => ({ value: s.id, label: staffName(s) })),
        ],
        valueOf: (a) => a.ownerUid || NONE,
      },
    ],
    savedViews: [
      { key: "mine", label: t("view_my_activities"), segment: "open", facets: { owner: [me] } },
      { key: "mine_today", label: t("view_my_today"), segment: "today", facets: { owner: [me] } },
      { key: "overdue", label: t("seg_overdue"), segment: "overdue" },
      { key: "leads", label: t("view_lead_activities"), segment: "open", facets: { related: ["lead"] } },
      { key: "clients", label: t("view_client_activities"), segment: "open", facets: { related: ["client"] } },
    ],
    groups: [
      { key: "owner", label: t("owner_label"), keyOf: (a) => a.ownerName || a.authorName || t("unassigned") },
      { key: "type", label: t("type_label"), keyOf: (a) => t(a.system ? "type_system" : a.type === "stage" ? "type_stage" : `type_${a.type}`) },
      { key: "related", label: t("activity_related"), keyOf: (a) => (a.related ? t(a.related === "lead" ? "lead_badge" : "client_badge") : "—") },
    ],
    searchText: (a) => [a.title ?? "", a.note, a.withName ?? "", a.party].join(" "),
    defaultSegment: "open",
    pageSize: 30,
  }
  const state = useCrmListState(rows, config, locale)

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }

  return (
    <div className="space-y-6">
      <CrmStatRow>
        <CrmStat icon={ClipboardList} label={t("seg_open")} value={summary.open} onClick={() => state.setSegment("open")} active={state.segment === "open" && !state.activeView} />
        <CrmStat icon={TriangleAlert} label={t("seg_overdue")} value={summary.overdue} accent="destructive" danger={summary.overdue > 0} onClick={() => state.setSegment("overdue")} active={state.segment === "overdue"} />
        <CrmStat icon={CalendarClock} label={t("seg_today")} value={summary.today} accent="warning" onClick={() => state.setSegment("today")} active={state.segment === "today"} />
        <CrmStat icon={CalendarCheck2} label={t("done_this_week")} value={summary.doneThisWeek} accent="success" />
      </CrmStatRow>

      <CrmToolbar config={config} state={state} searchPlaceholder={t("search_activities_placeholder")} />

      {crm.loading.activities ? (
        <CrmListSkeleton />
      ) : state.matching === 0 ? (
        <div className="rounded-xl border bg-card">
          <CrmEmptyState icon={ClipboardList} title={crm.activities.length === 0 ? t("activities_empty") : t("empty_filtered")} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {state.grouped.map((g) => (
            <div key={g.key || "all"}>
              {g.label && (
                <p className="border-b bg-muted/30 px-4 py-1.5 text-xs font-bold text-muted-foreground">
                  {g.label} <bdi className="font-normal">({g.rows.length})</bdi>
                </p>
              )}
              <ul className="divide-y">
                {g.rows.map((a) => (
                  <ActivityRow
                    key={a.id}
                    a={a}
                    today={today}
                    context={a.related ? `${t(a.related === "lead" ? "lead_badge" : "client_badge")} · ${a.party}` : undefined}
                    onToggle={(x) => firestore && run(() => setActivityDone(firestore, x.id, x.status === "scheduled", today, x.type))}
                    onEdit={(x) => {
                      setEdit(x)
                      onDialogOpen(true)
                    }}
                    onDelete={(x) => firestore && run(() => deleteActivity(firestore, x.id))}
                  />
                ))}
              </ul>
            </div>
          ))}
          <CrmShowMore state={state} />
        </div>
      )}
      <ActivityDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          onDialogOpen(o)
          if (!o) setEdit(null)
        }}
        parties={parties}
        staff={crm.staff}
        actor={{ uid: me, name: actorName }}
        activity={edit}
      />
    </div>
  )
}
