"use client"

import { useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { addDoc, collection, doc, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore"
import { Archive, ArchiveRestore, Building2, CalendarClock, CalendarDays, Handshake, LayoutGrid, List, Loader2, Plus, Search, TrendingUp, UserPlus, UserX, UsersRound } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { AddLeadDialog } from "@/components/admin/AddLeadDialog"
import { CrmBoard, type CrmBoardColumn } from "@/components/admin/CrmBoard"
import { CrmDeals } from "@/components/admin/CrmDeals"
import { StageReasonDialog, type PendingStage } from "@/components/admin/StageReasonDialog"
import { Chip } from "@/components/module-ui/Chip"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { isAllCompanyTypes } from "@/lib/company-types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import {
  ACTIVITY_TYPES,
  CLIENT_STAGES,
  LEAD_SOURCES,
  LEAD_STAGES,
  buildClientRows,
  buildLeadRows,
  contactsClient,
  leadIntake,
  leadMatches,
  summarizeClients,
  summarizeLeads,
  type ActivityType,
  type ClientPlan,
  type ClientSource,
  type HistoryType,
  CLIENT_PLANS,
  CLIENT_SOURCES,
  type ClientRecord,
  type ClientStage,
  type ClientUser,
  type LeadDoc,
  type LeadMatch,
  type LeadSource,
  type LeadViewStage,
} from "@/lib/admin-crm"
import { matchesSearch } from "@/lib/search-text"
import { cn } from "@/lib/utils"

type StaffUser = { id: string; name?: string; email?: string }
type ActivityDoc = { id: string; clientId: string; type: HistoryType; note: string; authorName: string; from?: string; to?: string; createdAt?: { seconds?: number } }
type Filter = "all" | "mine" | "due" | "stale" | "unowned" | "dupes" | "removed"
type LeadRef = { col: "demoRequests" | "onboardingRequests"; id: string }
type Tab = "clients" | "leads"
type View = "board" | "list"
type ListRow = {
  id: string
  name: string
  subtitle: string
  detail: string
  stage: string
  stageStyle: string
  stages: readonly string[]
  stageLocked: boolean
  closed: boolean
  ownerUid: string
  ownerName: string
  nextFollowUp: string
  daysSinceContact: number | null
  followUpDue: boolean
  stale: boolean
  createdMs: number
  flags: string[]
  archived: boolean
  source: LeadSource | null
  leadRef: LeadRef | null
  match: LeadMatch | null
  search: string[]
  /** A client (an account) or a lead (a request) — the two look different everywhere. */
  kind: "client" | "lead"
  phone: string
  email: string
  idNo: string
  plan: ClientPlan | null
  /** Where he came from, in words. */
  origin: string
  /** A client's source as stored (editable); null for a lead (his source is the request). */
  clientSource: ClientSource | null
}

const UNASSIGNED = "__none__"

const STAGE_STYLE: Record<ClientStage, string> = {
  onboarding: "bg-cta/10 text-cta border-cta/20",
  active: "bg-success/10 text-success border-success/20",
  at_risk: "bg-warning/10 text-warning border-warning/20",
  churned: "bg-muted text-muted-foreground border-border",
}

const LEAD_STAGE_STYLE: Record<LeadViewStage, string> = {
  new: "bg-cta/10 text-cta border-cta/20",
  contacted: "bg-secondary/10 text-secondary border-secondary/20",
  demo: "bg-warning/10 text-warning border-warning/20",
  negotiation: "bg-primary/10 text-primary border-primary/20",
  lost: "bg-muted text-muted-foreground border-border",
  converted: "bg-success/10 text-success border-success/20",
}

const activitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  note: z.string().trim().min(1).max(1000),
})
type ActivityValues = z.infer<typeof activitySchema>

function staffName(u: StaffUser): string {
  return u.name?.trim() || u.email || u.id
}

export default function AdminCrmPage() {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()

  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [openId, setOpenId] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<Tab>(searchParams.get("tab") === "leads" ? "leads" : "clients")
  const [addLeadOpen, setAddLeadOpen] = useState(false)
  const [view, setView] = useState<View>("board")
  const [stageFilter, setStageFilter] = useState<LeadViewStage | "">("")
  const [sourceFilter, setSourceFilter] = useState<LeadSource | "">("")

  const usersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "users"), where("role", "in", ["Contractor", "Supplier"]))
  }, [firestore, user, isUserLoading])
  const staffQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "users"), where("role", "==", "Admin"))
  }, [firestore, user, isUserLoading])
  const recordsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return collection(firestore, "adminCrmClients")
  }, [firestore, user, isUserLoading])

  const demoQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return collection(firestore, "demoRequests")
  }, [firestore, user, isUserLoading])
  const onboardingQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return collection(firestore, "onboardingRequests")
  }, [firestore, user, isUserLoading])

  const { data: demoDocs, isLoading: demoLoading } = useCollection<Omit<LeadDoc, "id" | "source"> & { origin?: string }>(demoQuery)
  const { data: onboardingDocs, isLoading: onboardingLoading } = useCollection<Omit<LeadDoc, "id" | "source">>(onboardingQuery)
  const { data: users, isLoading: usersLoading } = useCollection<ClientUser>(usersQuery)
  const { data: staff } = useCollection<StaffUser>(staffQuery)
  const { data: records } = useCollection<ClientRecord>(recordsQuery)

  const rows = useMemo(() => {
    const byId: Record<string, ClientRecord> = {}
    for (const r of records ?? []) byId[r.id] = r
    return buildClientRows(users ?? [], byId, new Date())
  }, [users, records])
  const summary = useMemo(() => summarizeClients(rows), [rows])

  const leadRows = useMemo(() => {
    const byId: Record<string, ClientRecord> = {}
    for (const r of records ?? []) byId[r.id] = r
    const docs: LeadDoc[] = [
      ...(demoDocs ?? []).map((d) => ({ ...d, source: d.origin === "manual" ? ("manual" as const) : ("demo" as const) })),
      ...(onboardingDocs ?? []).map((d) => ({ ...d, source: "onboarding" as const })),
    ]
    return buildLeadRows(docs, byId, new Date())
  }, [demoDocs, onboardingDocs, records])
  const leadSummary = useMemo(() => summarizeLeads(leadRows), [leadRows])
  const matches = useMemo(() => leadMatches(leadRows, rows.map((r) => ({ name: r.name, email: r.email, phone: r.phone }))), [leadRows, rows])
  const intake = useMemo(() => leadIntake(leadRows, new Date()), [leadRows])
  const leadNameOf = useMemo(() => new Map(leadRows.map((r) => [r.crmId, r.name])), [leadRows])

  const onLeads = tab === "leads"

  const list = useMemo<ListRow[]>(() => {
    if (tab === "leads") {
      const sep = locale === "ar" ? "، " : ", "
      return leadRows.map((r) => {
        const match = matches.get(r.crmId) ?? null
        return {
        id: r.crmId,
        name: r.name,
        subtitle: [t(`source_${r.source}`), r.company].filter(Boolean).join(" · "),
        detail: [
          t(`source_${r.source}`),
          r.company,
          r.phone,
          r.email,
          [...(isAllCompanyTypes(r.types) ? [t("type_all")] : r.types.map((x) => t(`type_${x}`))), ...(r.typeOther ? [r.typeOther] : [])].join(sep),
          r.preferredDate ? t("demo_on", { date: r.preferredDate }) : "",
          [r.city, r.size].filter(Boolean).join(sep),
        ]
          .filter(Boolean)
          .join(" · "),
        stage: r.stage,
        stageStyle: LEAD_STAGE_STYLE[r.stage],
        stages: LEAD_STAGES,
        stageLocked: r.converted,
        closed: r.stage === "lost" || r.stage === "converted",
        ownerUid: r.ownerUid,
        ownerName: r.ownerName,
        nextFollowUp: r.nextFollowUp,
        daysSinceContact: r.daysSinceContact,
        followUpDue: r.followUpDue,
        stale: r.stale,
        createdMs: r.createdMs,
        flags: [
          ...(r.archived ? [t("flag_removed")] : []),
          ...(match?.client ? [t("flag_client", { name: match.client })] : []),
          ...(match?.duplicates.length ? [t("flag_duplicate", { count: match.duplicates.length })] : []),
        ],
        archived: r.archived,
        source: r.source,
        leadRef: { col: r.source === "onboarding" ? ("onboardingRequests" as const) : ("demoRequests" as const), id: r.id },
        match,
        search: [r.name, r.company, r.email, r.phone, r.city],
        kind: "lead" as const,
        phone: r.phone,
        email: r.email,
        idNo: r.idNo,
        plan: null,
        origin: t(`source_${r.source}`),
        clientSource: null,
        }
      })
    }
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      subtitle: [t(r.role === "Contractor" ? "role_contractor" : "role_supplier"), r.plan ? t(`plan_${r.plan}`) : t("plan_unset")].join(" · "),
      detail: [t(r.role === "Contractor" ? "role_contractor" : "role_supplier"), r.city].filter(Boolean).join(" · "),
      stage: r.stage,
      stageStyle: STAGE_STYLE[r.stage],
      stages: CLIENT_STAGES,
      stageLocked: false,
      closed: r.stage === "churned",
      ownerUid: r.ownerUid,
      ownerName: r.ownerName,
      nextFollowUp: r.nextFollowUp,
      daysSinceContact: r.daysSinceContact,
      followUpDue: r.followUpDue,
      stale: r.stale,
      createdMs: 0,
      flags: [],
      archived: false,
      source: null,
      leadRef: null,
      match: null,
      search: [r.name, r.email, r.phone, r.city],
      kind: "client" as const,
      phone: r.phone,
      email: r.email,
      idNo: r.idNo,
      plan: r.plan,
      origin: t(`csource_${r.source}`),
      clientSource: r.source,
    }))
  }, [tab, rows, leadRows, matches, t, locale])

  const visible = useMemo(() => {
    return list
      // A removed lead shows only under «Removed»; a search looks across stages and sources.
      .filter((r) => (filter === "removed" ? r.archived : !r.archived))
      .filter((r) => {
        if (filter === "mine") return r.ownerUid === user?.uid
        if (filter === "due") return r.followUpDue
        if (filter === "stale") return r.stale
        if (filter === "unowned") return !r.closed && !r.ownerUid
        if (filter === "dupes") return Boolean(r.match?.duplicates.length)
        return true
      })
      .filter((r) => !onLeads || search.trim() !== "" || ((!stageFilter || r.stage === stageFilter) && (!sourceFilter || r.source === sourceFilter)))
      .filter((r) => !search.trim() || matchesSearch(search, r.search))
      .sort((a, b) =>
        onLeads
          ? b.createdMs - a.createdMs || a.name.localeCompare(b.name)
          : Number(b.followUpDue) - Number(a.followUpDue) || Number(b.stale) - Number(a.stale) || a.name.localeCompare(b.name),
      )
  }, [list, filter, search, user?.uid, onLeads, stageFilter, sourceFilter])

  const open = list.find((r) => r.id === openId) ?? null
  const shown = onLeads
    ? { total: leadSummary.total, followUpsDue: leadSummary.followUpsDue, stale: leadSummary.stale, unowned: leadSummary.unowned }
    : summary
  const loading = onLeads ? demoLoading || onboardingLoading : usersLoading

  const switchTab = (next: Tab) => {
    setTab(next)
    setFilter("all")
    setStageFilter("")
    setSourceFilter("")
    setSearch("")
    setOpenId(null)
  }

  // Removing a lead hides it (junk, a duplicate) — the request is kept and can be restored.
  const setArchived = async (row: ListRow, archived: boolean) => {
    if (!firestore || !row.leadRef) return
    try {
      await updateDoc(doc(firestore, row.leadRef.col, row.leadRef.id), {
        archived,
        archivedAt: archived ? serverTimestamp() : null,
        archivedByUid: archived ? user?.uid ?? null : null,
      })
      toast({ title: t(archived ? "lead_removed" : "lead_restored") })
      setOpenId(null)
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }

  // Every stage change states why — the board, its "move to" and the record's field all ask here.
  const [pendingStage, setPendingStage] = useState<PendingStage | null>(null)
  const askStage = (id: string, to: string) => {
    const row = list.find((r) => r.id === id)
    if (!row || row.stage === to) return
    setPendingStage({ id, name: row.name, from: row.stage, to })
  }
  const confirmStage = async (reason: string) => {
    const p = pendingStage
    if (!p || !firestore) return
    try {
      await setDoc(doc(firestore, "adminCrmClients", p.id), { stage: p.to, updatedAt: serverTimestamp() }, { merge: true })
      await addDoc(collection(firestore, "adminCrmActivities"), {
        clientId: p.id,
        type: "stage",
        from: p.from,
        to: p.to,
        note: reason,
        authorUid: user?.uid ?? "",
        authorName: ownerNameOf(user?.uid ?? "") || user?.email || "",
        createdAt: serverTimestamp(),
      })
      toast({ title: t("stage_changed", { to: t(`stage_${p.to}`) }) })
      setPendingStage(null)
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }

  const saveRecord = async (clientId: string, patch: Partial<ClientRecord>) => {
    if (!firestore) return
    try {
      await setDoc(doc(firestore, "adminCrmClients", clientId), { ...patch, updatedAt: serverTimestamp() }, { merge: true })
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }

  const boardColumns: CrmBoardColumn[] = onLeads
    ? [...LEAD_STAGES, "converted" as const].map((id) => ({
        id,
        label: t(`stage_${id}`),
        badgeClass: LEAD_STAGE_STYLE[id],
        accepts: id !== "converted",
      }))
    : CLIENT_STAGES.map((id) => ({ id, label: t(`stage_${id}`), badgeClass: STAGE_STYLE[id], accepts: true }))

  const staffList = staff ?? []
  const ownerNameOf = (uid: string) => {
    const s = staffList.find((x) => x.id === uid)
    return s ? staffName(s) : ""
  }

  const filters: Array<{ key: Filter; label: string; count?: number }> = [
    { key: "all", label: t("filter_all"), count: shown.total },
    { key: "mine", label: t("filter_mine") },
    { key: "due", label: t("filter_due"), count: shown.followUpsDue },
    { key: "stale", label: t(onLeads ? "filter_stale_leads" : "filter_stale"), count: shown.stale },
    { key: "unowned", label: t("filter_unowned"), count: shown.unowned },
    ...(onLeads
      ? [
          { key: "dupes" as const, label: t("filter_dupes"), count: list.filter((r) => !r.archived && r.match?.duplicates.length).length },
          { key: "removed" as const, label: t("filter_removed"), count: list.filter((r) => r.archived).length },
        ]
      : []),
  ]
  const liveLeads = leadRows.filter((r) => !r.archived)
  const sourceCount = (s: LeadSource) => liveLeads.filter((r) => r.source === s).length

  return (
    <PortalLayout>
      <div className="space-y-6" dir={locale === "ar" ? "rtl" : "ltr"}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-foreground font-headline flex items-center gap-2">
              <Handshake size={26} className="shrink-0 text-primary" />
              {t("page_title")}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">{t("page_subtitle")}</p>
          </div>
          {onLeads && (
            <Button onClick={() => setAddLeadOpen(true)} className="gap-1.5">
              <Plus size={15} aria-hidden="true" />
              {t("add_lead")}
            </Button>
          )}
        </div>

        <div role="tablist" aria-label={t("page_title")} className="inline-flex rounded-lg border bg-muted/40 p-1">
          {(["clients", "leads"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => switchTab(k)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "inline-flex items-center gap-1.5",
                tab === k ? (k === "leads" ? "bg-background text-warning shadow-sm" : "bg-background text-primary shadow-sm") : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k === "leads" ? <UserPlus size={14} aria-hidden="true" /> : <Building2 size={14} aria-hidden="true" />}
              {t(`tab_${k}`)}
              <span className="ms-1.5 opacity-70" dir="ltr">{k === "leads" ? leadSummary.total : summary.total}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi icon={UsersRound} label={t(onLeads ? "kpi_total_leads" : "kpi_total")} value={shown.total} />
          <Kpi icon={CalendarClock} label={t("kpi_followups")} value={shown.followUpsDue} tone={shown.followUpsDue > 0 ? "warning" : undefined} />
          <Kpi icon={UserX} label={t(onLeads ? "kpi_stale_leads" : "kpi_stale")} value={shown.stale} tone={shown.stale > 0 ? "warning" : undefined} />
          <Kpi icon={Handshake} label={t("kpi_unowned")} value={shown.unowned} />
        </div>

        {onLeads && (
          <section aria-label={t("intake_title")} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Kpi icon={TrendingUp} label={t("intake_week")} value={intake.thisWeek} hint={t("intake_week_hint", { n: intake.lastWeek })} />
            <Kpi icon={CalendarDays} label={t("intake_month")} value={intake.thisMonth} hint={t("intake_month_hint", { n: intake.lastMonth })} />
            <div className="rounded-xl border bg-card p-4">
              <p className="text-xs font-semibold text-muted-foreground">{t("intake_sources")}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {LEAD_SOURCES.map((s) => (
                  <li key={s} className="flex items-center justify-between gap-2">
                    <span>{t(`source_${s}`)}</span>
                    <span className="font-bold tabular-nums" dir="ltr">{intake.bySource[s]}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Leads and clients never look alike: the panel's edge and every row carry the kind. */}
        <Card className={cn("border-none shadow-sm overflow-hidden border-t-4", onLeads ? "border-t-warning" : "border-t-primary")}>
          <div className="p-4 border-b flex flex-col md:flex-row md:items-center gap-3">
            <div className="relative md:w-72">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("search_placeholder")}
                aria-label={t("search_placeholder")}
                className="ps-9"
              />
            </div>
            <div role="group" aria-label={t("view_label")} className="inline-flex rounded-lg border bg-muted/40 p-1 md:order-last md:ms-auto">
              {(["board", "list"] as const).map((v) => {
                const Icon = v === "board" ? LayoutGrid : List
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon size={14} aria-hidden="true" />
                    {t(`view_${v}`)}
                  </button>
                )
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {filters.map((f) => (
                <Chip key={f.key} selected={filter === f.key} count={f.count} onClick={() => setFilter(f.key)}>
                  {f.label}
                </Chip>
              ))}
            </div>
          </div>
          {onLeads && (
            <div className="px-4 py-3 border-b flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-6">
              <div role="group" aria-label={t("stage_filter_label")} className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">{t("stage_filter_label")}</span>
                <Chip selected={stageFilter === ""} count={leadSummary.total} onClick={() => setStageFilter("")}>
                  {t("filter_all")}
                </Chip>
                {[...LEAD_STAGES, "converted" as const].map((s) => (
                  <Chip key={s} selected={stageFilter === s} count={leadSummary.byStage[s]} onClick={() => setStageFilter(stageFilter === s ? "" : s)}>
                    {t(`stage_${s}`)}
                  </Chip>
                ))}
              </div>
              <p className="basis-full text-xs text-muted-foreground lg:order-last">{t("converted_hint")}</p>
              <div role="group" aria-label={t("source_filter_label")} className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">{t("source_filter_label")}</span>
                <Chip selected={sourceFilter === ""} onClick={() => setSourceFilter("")}>
                  {t("filter_all")}
                </Chip>
                {LEAD_SOURCES.map((s) => (
                  <Chip key={s} selected={sourceFilter === s} count={sourceCount(s)} onClick={() => setSourceFilter(sourceFilter === s ? "" : s)}>
                    {t(`source_${s}`)}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="p-16 flex justify-center">
                <Loader2 className="animate-spin text-primary" size={28} />
              </div>
            ) : visible.length === 0 ? (
              <p className="p-12 text-center text-sm text-muted-foreground">{list.length === 0 ? t(onLeads ? "empty_leads" : "empty") : t("empty_filtered")}</p>
            ) : view === "board" ? (
              <CrmBoard
                items={visible}
                columns={boardColumns}
                onOpen={setOpenId}
                onMove={(id, stage) => askStage(id, stage)}
              />
            ) : (
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>{t(onLeads ? "col_lead" : "col_client")}</TableHead>
                    <TableHead>{t("col_stage")}</TableHead>
                    {!onLeads && <TableHead className="hidden md:table-cell">{t("col_plan")}</TableHead>}
                    <TableHead className="hidden md:table-cell">{t("col_owner")}</TableHead>
                    {onLeads && <TableHead className="hidden sm:table-cell">{t("col_received")}</TableHead>}
                    <TableHead className="hidden sm:table-cell">{t("col_last_contact")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("col_follow_up")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r) => (
                    <TableRow
                      key={r.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => setOpenId(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          setOpenId(r.id)
                        }
                      }}
                      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      <TableCell>
                        <p className="font-bold">{r.name}</p>
                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <KindBadge kind={r.kind} />
                          {r.subtitle}
                        </p>
                        {r.flags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.flags.map((f) => (
                              <Badge key={f} variant="outline" className="border-warning/30 bg-warning/10 text-[11px] font-medium text-warning">{f}</Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={r.stageStyle}>{t(`stage_${r.stage}`)}</Badge>
                      </TableCell>
                      {!onLeads && (
                        <TableCell className="hidden md:table-cell">
                          {r.plan ? <Badge variant="outline" className="border-cta/20 bg-cta/10 text-cta">{t(`plan_${r.plan}`)}</Badge> : <span className="text-xs text-muted-foreground">{t("plan_unset")}</span>}
                        </TableCell>
                      )}
                      <TableCell className="hidden md:table-cell text-sm">{r.ownerName || <span className="text-muted-foreground">{t("unassigned")}</span>}</TableCell>
                      {onLeads && (
                        <TableCell className="hidden sm:table-cell text-sm tabular-nums" dir="ltr">
                          {r.createdMs ? new Date(r.createdMs).toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB") : "—"}
                        </TableCell>
                      )}
                      <TableCell className="hidden sm:table-cell text-sm">
                        {r.daysSinceContact === null ? (
                          <span className="text-warning font-medium">{t("never_contacted")}</span>
                        ) : (
                          <span className={cn(r.stale && "text-warning font-medium")}>{t("days_ago", { n: r.daysSinceContact })}</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm" dir="ltr">
                        {r.nextFollowUp ? <span className={cn("inline-block", r.followUpDue && "text-warning font-medium")}>{r.nextFollowUp}</span> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
          {open && (
            <ClientPanel
              key={open.id}
              row={open}
              staff={staffList}
              currentUid={user?.uid ?? ""}
              currentName={ownerNameOf(user?.uid ?? "") || user?.email || ""}
              onSave={(patch) => saveRecord(open.id, patch)}
              onStageRequest={(to) => askStage(open.id, to)}
              duplicateNames={(open.match?.duplicates ?? []).map((id) => leadNameOf.get(id) ?? id)}
              onArchive={open.leadRef ? (archived) => setArchived(open, archived) : undefined}
            />
          )}
        </DialogContent>
      </Dialog>
      <StageReasonDialog pending={pendingStage} stageLabel={(st) => t(`stage_${st}`)} onCancel={() => setPendingStage(null)} onConfirm={confirmStage} />
      <AddLeadDialog open={addLeadOpen} onOpenChange={setAddLeadOpen} ownerName={ownerNameOf(user?.uid ?? "") || user?.email || ""} />
    </PortalLayout>
  )
}

/** Client or lead — the same shape in both tabs, never mistaken for one another. */
function KindBadge({ kind }: { kind: "client" | "lead" }) {
  const t = useTranslations("Portal.Admin.Crm")
  return (
    <Badge variant="outline" className={cn("gap-1 text-[11px] font-semibold", kind === "lead" ? "border-warning/30 bg-warning/10 text-warning" : "border-primary/20 bg-primary/10 text-primary")}>
      {kind === "lead" ? <UserPlus size={11} aria-hidden="true" /> : <Building2 size={11} aria-hidden="true" />}
      {t(kind === "lead" ? "kind_lead" : "kind_client")}
    </Badge>
  )
}

function Kpi({ icon: Icon, label, value, tone, hint }: { icon: typeof Handshake; label: string; value: number; tone?: "warning"; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-center gap-3">
      <span className={cn("grid place-items-center h-10 w-10 rounded-lg shrink-0", tone === "warning" ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary")} aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted-foreground truncate">{label}</p>
        <p className="text-lg font-black text-foreground" dir="ltr">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}

function ClientPanel({
  row,
  staff,
  currentUid,
  currentName,
  onSave,
  onStageRequest,
  duplicateNames,
  onArchive,
}: {
  row: ListRow
  staff: StaffUser[]
  currentUid: string
  currentName: string
  onSave: (patch: Partial<ClientRecord>) => Promise<void>
  /** A stage change asks for its reason first (the page's dialog). */
  onStageRequest: (to: string) => void
  duplicateNames: string[]
  onArchive?: (archived: boolean) => Promise<void>
}) {
  const t = useTranslations("Portal.Admin.Crm")
  const firestore = useFirestore()
  const { toast } = useToast()

  const activitiesQuery = useMemoFirebase(() => {
    if (!firestore) return null
    return query(collection(firestore, "adminCrmActivities"), where("clientId", "==", row.id))
  }, [firestore, row.id])
  const { data: activities } = useCollection<Omit<ActivityDoc, "id">>(activitiesQuery)
  const sorted = useMemo(
    () => [...(activities ?? [])].sort((a, b) => (b.createdAt?.seconds ?? Number.MAX_SAFE_INTEGER) - (a.createdAt?.seconds ?? Number.MAX_SAFE_INTEGER)),
    [activities],
  )

  const form = useForm<ActivityValues>({ resolver: zodResolver(activitySchema), defaultValues: { type: "call", note: "" } })

  const setOwner = (uid: string) => {
    if (uid === UNASSIGNED) return onSave({ ownerUid: "", ownerName: "" })
    const s = staff.find((x) => x.id === uid)
    return onSave({ ownerUid: uid, ownerName: s ? staffName(s) : "" })
  }

  const log = async (values: ActivityValues) => {
    if (!firestore) return
    try {
      await addDoc(collection(firestore, "adminCrmActivities"), {
        clientId: row.id,
        type: values.type,
        note: values.note,
        authorUid: currentUid,
        authorName: currentName,
        createdAt: serverTimestamp(),
      })
      if (contactsClient(values.type)) await onSave({ lastContactAt: new Date().toISOString() })
      form.reset({ type: values.type, note: "" })
      toast({ title: t("saved") })
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <span dir="auto">{row.name}</span>
          <KindBadge kind={row.kind} />
        </DialogTitle>
        <DialogDescription>
          {row.detail}
        </DialogDescription>
      </DialogHeader>

      {/* The record: how to reach him, who he is, where he came from — and, for a client, his subscription. */}
      <div className="grid gap-x-6 gap-y-3 rounded-lg border p-4 sm:grid-cols-2">
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">{t("rec_phone")}</p>
          {row.phone ? <a href={`tel:${row.phone}`} className="font-semibold hover:underline" dir="ltr">{row.phone}</a> : <p>—</p>}
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">{t("rec_email")}</p>
          {row.email ? <a href={`mailto:${row.email}`} className="break-all font-semibold hover:underline" dir="ltr">{row.email}</a> : <p>—</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="crm-idno" className="text-xs font-normal text-muted-foreground">{t("rec_id")}</Label>
          <Input id="crm-idno" dir="ltr" defaultValue={row.idNo} placeholder={t("rec_id_placeholder")} onBlur={(e) => e.target.value.trim() !== row.idNo && void onSave({ idNo: e.target.value.trim() })} className="h-9" />
        </div>
        <div className="space-y-1">
          {row.clientSource ? (
            <>
              <Label htmlFor="crm-source" className="text-xs font-normal text-muted-foreground">{t("rec_source")}</Label>
              <NativeSelect id="crm-source" value={row.clientSource} onChange={(e) => void onSave({ source: e.target.value })} className="h-9">
                {CLIENT_SOURCES.map((x) => (
                  <option key={x} value={x}>{t(`csource_${x}`)}</option>
                ))}
              </NativeSelect>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{t("rec_source")}</p>
              <p className="font-semibold">{row.origin}</p>
            </>
          )}
        </div>
        {row.kind === "client" && (
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="crm-plan" className="text-xs font-normal text-muted-foreground">{t("plan_label")}</Label>
            <NativeSelect id="crm-plan" value={row.plan ?? ""} onChange={(e) => void onSave({ plan: e.target.value })} className="h-9 sm:w-64">
              <option value="">{t("plan_unset")}</option>
              {CLIENT_PLANS.map((x) => (
                <option key={x} value={x}>{t(`plan_${x}`)}</option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>

      {(row.match?.client || duplicateNames.length > 0) && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm space-y-1">
          {row.match?.client && <p>{t("match_client", { name: row.match.client })}</p>}
          {duplicateNames.length > 0 && <p>{t("match_duplicates", { names: duplicateNames.join("، ") })}</p>}
          <p className="text-xs text-muted-foreground">{t("match_hint")}</p>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="crm-stage">{t("stage_label")}</Label>
          <Select value={row.stage} onValueChange={(v) => onStageRequest(v)} disabled={row.stageLocked}>
            <SelectTrigger id="crm-stage"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(row.stageLocked ? [row.stage] : row.stages).map((s) => <SelectItem key={s} value={s}>{t(`stage_${s}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="crm-owner">{t("owner_label")}</Label>
          <Select value={row.ownerUid || UNASSIGNED} onValueChange={setOwner}>
            <SelectTrigger id="crm-owner"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>{t("unassigned")}</SelectItem>
              {staff.map((s) => <SelectItem key={s.id} value={s.id}>{staffName(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="crm-follow-up">{t("follow_up_label")}</Label>
          <Input
            id="crm-follow-up"
            type="date"
            dir="ltr"
            value={row.nextFollowUp}
            onChange={(e) => onSave({ nextFollowUp: e.target.value })}
          />
        </div>
      </div>

      <form onSubmit={form.handleSubmit(log)} className="space-y-3 rounded-lg border p-4">
        <p className="text-sm font-bold">{t("log_title")}</p>
        <div className="grid sm:grid-cols-[10rem_1fr] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="crm-type">{t("type_label")}</Label>
            <Select value={form.watch("type")} onValueChange={(v) => form.setValue("type", v as ActivityType)}>
              <SelectTrigger id="crm-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTIVITY_TYPES.map((a) => <SelectItem key={a} value={a}>{t(`type_${a}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crm-note">{t("note_label")}</Label>
            <Textarea id="crm-note" rows={2} placeholder={t("note_placeholder")} {...form.register("note")} />
            {form.formState.errors.note && <p className="text-xs text-destructive">{t("note_required")}</p>}
          </div>
        </div>
        <Button type="submit" disabled={form.formState.isSubmitting} className="gap-2">
          {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("save_activity")}
        </Button>
      </form>

      <div className="space-y-2">
        <p className="text-sm font-bold">{t("history_title")}</p>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("history_empty")}</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((a) => (
              <li key={a.id} className="rounded-lg bg-muted/40 p-3 text-sm">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {a.type === "stage" && a.from && a.to ? t("history_stage", { from: t(`stage_${a.from}`), to: t(`stage_${a.to}`) }) : t(`type_${a.type}`)} · {a.authorName}
                  </span>
                  <span dir="ltr">{a.createdAt?.seconds ? new Date(a.createdAt.seconds * 1000).toISOString().slice(0, 10) : ""}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap">{a.note}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t pt-4">
        <CrmDeals clientId={row.id} author={{ uid: currentUid, name: currentName }} />
      </div>

      {onArchive && (
        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">{t(row.archived ? "restore_hint" : "remove_hint")}</p>
          <Button variant="outline" size="sm" className={cn("gap-1.5 shrink-0", !row.archived && "text-destructive")} onClick={() => void onArchive(!row.archived)}>
            {row.archived ? <ArchiveRestore size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
            {t(row.archived ? "restore_lead" : "remove_lead")}
          </Button>
        </div>
      )}
    </>
  )
}
