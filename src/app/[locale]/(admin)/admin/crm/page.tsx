"use client"

import { useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { addDoc, collection, doc, query, serverTimestamp, setDoc, where } from "firebase/firestore"
import { CalendarClock, Handshake, Loader2, Plus, Search, UserX, UsersRound } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { AddLeadDialog } from "@/components/admin/AddLeadDialog"
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
  LEAD_STAGES,
  buildClientRows,
  buildLeadRows,
  contactsClient,
  summarizeClients,
  summarizeLeads,
  type ActivityType,
  type ClientRecord,
  type ClientStage,
  type ClientUser,
  type LeadDoc,
  type LeadViewStage,
} from "@/lib/admin-crm"
import { cn } from "@/lib/utils"

type StaffUser = { id: string; name?: string; email?: string }
type ActivityDoc = { id: string; clientId: string; type: ActivityType; note: string; authorName: string; createdAt?: { seconds?: number } }
type Filter = "all" | "mine" | "due" | "stale" | "unowned"
type Tab = "clients" | "leads"
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

  const list = useMemo<ListRow[]>(() => {
    if (tab === "leads") {
      return leadRows.map((r) => ({
        id: r.crmId,
        name: r.name,
        subtitle: [r.company, t(`source_${r.source}`)].filter(Boolean).join(" · "),
        detail: [t(`source_${r.source}`), r.company, r.phone, r.email].filter(Boolean).join(" · "),
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
      }))
    }
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      subtitle: t(r.role === "Contractor" ? "role_contractor" : "role_supplier"),
      detail: [t(r.role === "Contractor" ? "role_contractor" : "role_supplier"), r.city, r.phone, r.email].filter(Boolean).join(" · "),
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
    }))
  }, [tab, rows, leadRows, t])

  const searchable = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) map.set(r.id, `${r.name} ${r.email} ${r.phone}`)
    for (const r of leadRows) map.set(r.crmId, `${r.name} ${r.company} ${r.email} ${r.phone}`)
    return map
  }, [rows, leadRows])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return list
      .filter((r) => {
        if (filter === "mine") return r.ownerUid === user?.uid
        if (filter === "due") return r.followUpDue
        if (filter === "stale") return r.stale
        if (filter === "unowned") return !r.closed && !r.ownerUid
        return true
      })
      .filter((r) => !needle || (searchable.get(r.id) ?? r.name).toLowerCase().includes(needle))
      .sort((a, b) => Number(b.followUpDue) - Number(a.followUpDue) || Number(b.stale) - Number(a.stale) || a.name.localeCompare(b.name))
  }, [list, filter, search, user?.uid, searchable])

  const open = list.find((r) => r.id === openId) ?? null
  const onLeads = tab === "leads"
  const shown = onLeads
    ? { total: leadSummary.total, followUpsDue: leadSummary.followUpsDue, stale: leadSummary.stale, unowned: leadSummary.unowned }
    : summary
  const loading = onLeads ? demoLoading || onboardingLoading : usersLoading

  const switchTab = (next: Tab) => {
    setTab(next)
    setFilter("all")
    setSearch("")
    setOpenId(null)
  }

  const saveRecord = async (clientId: string, patch: Partial<ClientRecord>) => {
    if (!firestore) return
    try {
      await setDoc(doc(firestore, "adminCrmClients", clientId), { ...patch, updatedAt: serverTimestamp() }, { merge: true })
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }

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
  ]

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
                tab === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
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

        <Card className="border-none shadow-sm overflow-hidden">
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
            <div className="flex flex-wrap gap-2">
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  aria-pressed={filter === f.key}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    filter === f.key ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground hover:text-foreground hover:border-foreground/30",
                  )}
                >
                  {f.label}
                  {f.count !== undefined && <span className="ms-1.5 opacity-80" dir="ltr">{f.count}</span>}
                </button>
              ))}
            </div>
          </div>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="p-16 flex justify-center">
                <Loader2 className="animate-spin text-primary" size={28} />
              </div>
            ) : visible.length === 0 ? (
              <p className="p-12 text-center text-sm text-muted-foreground">{list.length === 0 ? t(onLeads ? "empty_leads" : "empty") : t("empty_filtered")}</p>
            ) : (
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>{t(onLeads ? "col_lead" : "col_client")}</TableHead>
                    <TableHead>{t("col_stage")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("col_owner")}</TableHead>
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
                        <p className="text-xs text-muted-foreground">{r.subtitle}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={r.stageStyle}>{t(`stage_${r.stage}`)}</Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm">{r.ownerName || <span className="text-muted-foreground">{t("unassigned")}</span>}</TableCell>
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
            />
          )}
        </DialogContent>
      </Dialog>
      <AddLeadDialog open={addLeadOpen} onOpenChange={setAddLeadOpen} ownerName={ownerNameOf(user?.uid ?? "") || user?.email || ""} />
    </PortalLayout>
  )
}

function Kpi({ icon: Icon, label, value, tone }: { icon: typeof Handshake; label: string; value: number; tone?: "warning" }) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-center gap-3">
      <span className={cn("grid place-items-center h-10 w-10 rounded-lg shrink-0", tone === "warning" ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary")} aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted-foreground truncate">{label}</p>
        <p className="text-lg font-black text-foreground" dir="ltr">{value}</p>
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
}: {
  row: ListRow
  staff: StaffUser[]
  currentUid: string
  currentName: string
  onSave: (patch: Partial<ClientRecord>) => Promise<void>
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
        <DialogTitle>{row.name}</DialogTitle>
        <DialogDescription>
          {row.detail}
        </DialogDescription>
      </DialogHeader>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="crm-stage">{t("stage_label")}</Label>
          <Select value={row.stage} onValueChange={(v) => onSave({ stage: v })} disabled={row.stageLocked}>
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
                  <span className="font-semibold text-foreground">{t(`type_${a.type}`)} · {a.authorName}</span>
                  <span dir="ltr">{a.createdAt?.seconds ? new Date(a.createdAt.seconds * 1000).toISOString().slice(0, 10) : ""}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap">{a.note}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
