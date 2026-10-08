"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { CalendarCheck2, CalendarClock, ClipboardList, Loader2, Search, TriangleAlert } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Chip } from "@/components/module-ui/Chip"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { staffName, type AdminCrm } from "@/hooks/useAdminCrm"
import { ACTIVITY_SEGMENTS, NEW_ACTIVITY_TYPES, inActivitySegment, sortActivities, summarizeActivities, toDateKey, type ActivitySegment, type ActivityType, type CrmActivity } from "@/lib/admin-crm"
import { deleteActivity, setActivityDone } from "@/lib/admin-crm-writes"
import { matchesSearch } from "@/lib/search-text"
import { ActivityDialog, type Party } from "./ActivityDialog"
import { ActivityRow } from "./ActivityRow"
import { CrmKpi, SegmentStrip } from "./parts"

/** ADM-08: every activity of every lead and client in one list — open, late, today, this week, done. */
export function ActivitiesTab({ crm, dialogOpen, onDialogOpen }: { crm: AdminCrm; dialogOpen: boolean; onDialogOpen: (open: boolean) => void }) {
  const t = useTranslations("Portal.Admin.Crm")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [segment, setSegment] = useState<ActivitySegment>("open")
  const [search, setSearch] = useState("")
  const [type, setType] = useState<ActivityType | "">("")
  const [mineOnly, setMineOnly] = useState(false)
  const [edit, setEdit] = useState<CrmActivity | null>(null)
  const now = useMemo(() => new Date(), [])
  const today = toDateKey(now)
  const me = crm.user?.uid ?? ""
  const actorName = staffName(crm.staff.find((s) => s.id === me) ?? { id: me, email: crm.user?.email ?? "" })

  const parties = useMemo<Party[]>(() => {
    const people = (id: string, name: string, phone: string, email: string) => {
      const stored = crm.records[id]?.contacts
      return stored?.length ? stored : [{ id: "origin", name, title: "", phone, email, primary: true }]
    }
    return [
      ...crm.leadRows.filter((r) => !r.archived).map((r) => ({ id: r.crmId, label: `${t("lead_badge")} · ${[r.name, r.company].filter(Boolean).join(" — ")}`, contacts: people(r.crmId, r.name, r.phone, r.email) })),
      ...crm.clientRows.map((r) => ({ id: r.id, label: `${t("client_badge")} · ${r.name}`, contacts: people(r.id, r.name, r.phone, r.email) })),
    ]
  }, [crm.leadRows, crm.clientRows, crm.records, t])
  const labelOf = useMemo(() => new Map(parties.map((p) => [p.id, p.label.replace(/^[^·]*· /, "")])), [parties])

  const summary = useMemo(() => summarizeActivities(crm.activities, now), [crm.activities, now])
  const visible = useMemo(() => {
    const searching = search.trim() !== ""
    return sortActivities(
      crm.activities
        .filter((a) => searching || inActivitySegment(a, segment, now))
        .filter((a) => !type || a.type === type)
        .filter((a) => !mineOnly || a.ownerUid === me)
        .filter((a) => !searching || matchesSearch(search, [a.title ?? "", a.note, a.withName ?? "", labelOf.get(a.clientId) ?? ""])),
    )
  }, [crm.activities, segment, search, type, mineOnly, now, me, labelOf])
  const counts: Record<ActivitySegment, number> = { open: summary.open, overdue: summary.overdue, today: summary.today, within7: summary.within7, done: summary.done, all: summary.all }

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <CrmKpi icon={ClipboardList} label={t("seg_open")} value={summary.open} />
        <CrmKpi icon={TriangleAlert} label={t("seg_overdue")} value={summary.overdue} tone={summary.overdue > 0 ? "danger" : undefined} />
        <CrmKpi icon={CalendarClock} label={t("seg_today")} value={summary.today} tone={summary.today > 0 ? "warning" : undefined} />
        <CrmKpi icon={CalendarCheck2} label={t("done_this_week")} value={summary.doneThisWeek} tone="success" />
      </div>
      <Card className="overflow-hidden border-none shadow-sm">
        <div className="space-y-3 border-b p-4">
          <SegmentStrip label={t("segments_label")} items={ACTIVITY_SEGMENTS} value={segment} onChange={setSegment} labelOf={(s) => t(`seg_${s}`)} counts={counts} />
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="relative md:flex-1">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search_activities_placeholder")} aria-label={t("search_activities_placeholder")} className="ps-9" />
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("filters")}>
              <Chip selected={mineOnly} onClick={() => setMineOnly((v) => !v)}>{t("filter_mine")}</Chip>
              {NEW_ACTIVITY_TYPES.map((k) => (
                <Chip key={k} selected={type === k} onClick={() => setType(type === k ? "" : k)}>
                  {t(`type_${k}`)}
                </Chip>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">{t("showing_of", { shown: visible.length, total: search.trim() ? summary.all : counts[segment] })}</p>
        </div>
        <CardContent className="p-0">
          {crm.loading.activities ? (
            <div className="flex justify-center p-16">
              <Loader2 className="animate-spin text-primary" size={28} />
            </div>
          ) : visible.length === 0 ? (
            <p className="p-12 text-center text-sm text-muted-foreground">{crm.activities.length === 0 ? t("activities_empty") : t("empty_filtered")}</p>
          ) : (
            <ul className="divide-y">
              {visible.map((a) => (
                <ActivityRow
                  key={a.id}
                  a={a}
                  today={today}
                  context={labelOf.get(a.clientId)}
                  onToggle={(x) => firestore && run(() => setActivityDone(firestore, x.id, x.status === "scheduled", today, x.type))}
                  onEdit={(x) => {
                    setEdit(x)
                    onDialogOpen(true)
                  }}
                  onDelete={(x) => firestore && run(() => deleteActivity(firestore, x.id))}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
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
