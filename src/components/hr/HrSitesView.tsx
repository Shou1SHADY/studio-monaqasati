"use client"

// Sites (PRD AS-01, WF-01 step 3): the company's workplaces — each with its
// type (which decides the kind of labour cost that follows the people there),
// its project and end date when it is a project site, and its supervisor.
// "Unassigned" is always there, its own row with no output. The fleet — the
// drivers and vehicles delivery notes pick from — sits under it.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Loader2, MapPin, Pencil, Plus, Power } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { FleetRegistry } from "@/components/hr/FleetRegistry"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { HR_EMPLOYEES, HR_SITES } from "@/lib/hr/collections"
import { costKindOf, SITE_TYPES, siteBlocks, UNASSIGNED_SITE, type HrSite, type SiteType } from "@/lib/hr/sites"
import { saveSite, setSiteActive } from "@/lib/hr/site-writes"
import { HrWriteError } from "@/lib/hr/write-guard"

type Draft = { id?: string; name: string; type: SiteType; projectId: string; endDate: string; supervisorUserId: string }
const EMPTY: Draft = { name: "", type: "project", projectId: "", endDate: "", supervisorUserId: "" }

export function HrSitesView({ access, actorName }: { access: HrAccess; actorName: string }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { toast } = useToast()
  const orgId = access.orgId
  const canEdit = access.allowed("settings.manage")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  const sitesQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, HR_SITES), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: sitesData, isLoading } = useCollection(sitesQ)
  const empQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, HR_EMPLOYEES), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: empData } = useCollection(empQ)
  const projQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: projData } = useCollection(projQ)
  const { orgMembers } = useOrgMembers(orgId)

  const sites = useMemo(() => ((sitesData ?? []) as unknown as HrSite[]).slice().sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name)), [sitesData])
  const headcount = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of (empData ?? []) as Array<{ siteId?: string | null; status?: string | null }>) {
      if (e.status === "left") continue
      const k = e.siteId || UNASSIGNED_SITE
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [empData])
  const projects = (projData ?? []) as Array<{ id: string; name?: string; pm?: { durationDays?: number; startOn?: string } | null }>
  const memberName = (uid?: string | null) => {
    const m = orgMembers.find((x) => x.id === uid)
    return (m?.name as string) || (m?.email as string) || "—"
  }

  const blocks = draft ? siteBlocks({ name: draft.name, type: draft.type, projectId: draft.projectId || null, endDate: draft.endDate || null }) : []

  const save = async () => {
    if (!firestore || !orgId || !draft || blocks.length) return
    setBusy(true)
    try {
      await saveSite(firestore, access.ctx, orgId, { name: draft.name, type: draft.type, projectId: draft.projectId || null, endDate: draft.endDate || null, supervisorUserId: draft.supervisorUserId || null }, draft.id)
      toast({ title: t("sites.saved") })
      setDraft(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? `err.${err.code}` : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (s: HrSite) => {
    if (!firestore) return
    try {
      await setSiteActive(firestore, access.ctx, s.id, s.active === false)
    } catch (err) {
      console.error(err)
      toast({ title: t("err.save"), variant: "destructive" })
    }
  }

  return (
    <div className="space-y-6">
      <Panel
        title={t("sites.title")}
        icon={MapPin}
        count={sites.filter((s) => s.active !== false).length || undefined}
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => setDraft({ ...EMPTY })}>
              <Plus size={15} className="me-1.5" aria-hidden="true" />
              {t("sites.add")}
            </Button>
          ) : null
        }
        bodyClassName="p-0"
      >
        {isLoading ? (
          <div className="flex justify-center p-10">
            <Loader2 className="animate-spin text-muted-foreground" size={24} aria-hidden="true" />
          </div>
        ) : (
          <ul className="divide-y">
            {sites.length === 0 && (
              <li className="p-4">
                <EmptyState icon={MapPin} title={t("sites.empty")} description={t("sites.empty_desc")} />
              </li>
            )}
            {sites.map((s) => (
              <li key={s.id} className={s.active === false ? "flex flex-wrap items-center gap-3 px-4 py-3 opacity-60" : "flex flex-wrap items-center gap-3 px-4 py-3"}>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                    <span dir="auto">{s.name}</span>
                    <StatusPill tone="module">{t(`site_type.${s.type}`)}</StatusPill>
                    {s.active === false && <StatusPill tone="mute">{t("sites.inactive")}</StatusPill>}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("sites.line", {
                      cost: t(`cost_kind.${costKindOf(s.type)}`),
                      supervisor: s.supervisorUserId ? memberName(s.supervisorUserId) : t("sites.no_supervisor"),
                      count: headcount.get(s.id) ?? 0,
                    })}
                    {s.type === "project" && s.projectId ? ` · ${projects.find((p) => p.id === s.projectId)?.name ?? "—"}` : ""}
                    {s.endDate ? ` · ${t("sites.ends", { date: s.endDate })}` : ""}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t("sites.edit")}
                      onClick={() => setDraft({ id: s.id, name: s.name, type: s.type, projectId: s.projectId ?? "", endDate: s.endDate ?? "", supervisorUserId: s.supervisorUserId ?? "" })}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </Button>
                    <Button size="sm" variant="outline" aria-label={t(s.active === false ? "sites.activate" : "sites.deactivate")} onClick={() => void toggle(s)}>
                      <Power size={14} aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
            <li className="flex flex-wrap items-center gap-3 bg-muted/30 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{t("sites.unassigned")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("sites.unassigned_line", { count: headcount.get(UNASSIGNED_SITE) ?? 0 })}</p>
              </div>
            </li>
          </ul>
        )}
      </Panel>

      {orgId && <FleetRegistry orgId={orgId} actor={{ id: access.ctx.uid, name: actorName }} />}

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t(draft?.id ? "sites.edit" : "sites.add")}</DialogTitle>
            <DialogDescription>{t("sites.dialog_desc")}</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="site-name">{t("sites.name")}</Label>
                <Input id="site-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={busy} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="site-type">{t("sites.type")}</Label>
                  <Select value={draft.type} onValueChange={(v) => setDraft({ ...draft, type: v as SiteType })} disabled={busy}>
                    <SelectTrigger id="site-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SITE_TYPES.map((x) => (
                        <SelectItem key={x} value={x}>
                          {t(`site_type.${x}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">{t("sites.cost_note", { cost: t(`cost_kind.${costKindOf(draft.type)}`) })}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="site-end">{t("sites.end")}</Label>
                  <Input id="site-end" type="date" dir="ltr" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} disabled={busy} />
                </div>
              </div>
              {draft.type === "project" && (
                <div className="space-y-1.5">
                  <Label htmlFor="site-project">{t("sites.project")}</Label>
                  <SearchableSelect
                    id="site-project"
                    value={draft.projectId}
                    onChange={(v) => setDraft({ ...draft, projectId: v })}
                    options={projects.map((p) => ({ value: p.id, label: p.name || p.id }))}
                    placeholder={t("sites.pick_project")}
                    searchPlaceholder={t("search")}
                    noResultsText={t("no_results")}
                    disabled={busy}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="site-sup">{t("sites.supervisor")}</Label>
                <SearchableSelect
                  id="site-sup"
                  value={draft.supervisorUserId}
                  onChange={(v) => setDraft({ ...draft, supervisorUserId: v })}
                  options={orgMembers.map((m) => ({ value: m.id, label: (m.name as string) || (m.email as string) || m.id }))}
                  placeholder={t("sites.pick_supervisor")}
                  searchPlaceholder={t("search")}
                  noResultsText={t("no_results")}
                  disabled={busy}
                />
                <p className="text-[11px] text-muted-foreground">{t("sites.supervisor_note")}</p>
              </div>
              <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`sites.block.${b}`))} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
