"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Archive, ArchiveRestore, Building2, CalendarCheck2, Clock, CopyCheck, FileText, Handshake, Loader2, MapPin, Pencil, Tag, Target, UserPlus, UserRound, Users, Wallet, ClipboardList } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { IconButton } from "@/components/module-ui/IconButton"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { CrmStat, CrmStatRow } from "@/components/crm/CrmShell"
import { CreateAccountDialog } from "@/components/admin/CreateAccountDialog"
import { Link, useRouter } from "@/i18n/routing"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { staffName, useAdminCrm, type AdminCrm } from "@/hooks/useAdminCrm"
import { CLIENT_PLANS, LEAD_STAGES, activityState, companySizeRange, effectiveContacts, formatCrmDate, toDateKey, type ClientRecord, type LeadRow } from "@/lib/admin-crm"
import { saveRecord, setLeadArchived } from "@/lib/admin-crm-writes"
import { cn } from "@/lib/utils"
import { ActivitiesSection } from "./ActivitiesSection"
import { ContactsSection } from "./ContactsSection"
import { DuplicateBanner } from "./DuplicateBanner"
import { EditLeadDialog } from "./EditLeadDialog"
import { CrmTrail, InfoItem, Money, StageBadge } from "./parts"
import { QuotesSection } from "./QuotesSection"
import { useStageChange } from "./useStageChange"

const UNASSIGNED = ""

/**
 * ADM-05: a lead's own page — it has a link a colleague can open. The trail, then the head (name, stage · type ·
 * source, edit, remove), the duplicate warning (ADM-09), four numbers, the information card where owner and stage are
 * changed in place and the deal lives (ADM-07), then contacts (ADM-06), activities (ADM-08) and price quotes, each with
 * its count and its add button. «Remove from the list» stays at the foot.
 */
export function LeadFile({ crmId }: { crmId: string }) {
  const crm = useAdminCrm()
  return (
    <PortalLayout>
      <LeadFileView crmId={crmId} crm={crm} />
    </PortalLayout>
  )
}

/** The page itself, over the CRM's data — rendered by the route, and on its own in tests and previews. */
export function LeadFileView({ crmId, crm }: { crmId: string; crm: AdminCrm }) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const router = useRouter()
  const row = crm.leadRows.find((r) => r.crmId === crmId) ?? null
  const rec: ClientRecord = crm.records[crmId] ?? {}

  const actorName = staffName(crm.staff.find((s) => s.id === crm.user?.uid) ?? { id: crm.user?.uid ?? "", email: crm.user?.email ?? "" })
  const actor = { uid: crm.user?.uid ?? "", name: actorName }
  const stage = useStageChange(actor)
  const contacts = useMemo(() => effectiveContacts(rec.contacts, { name: row?.name ?? "", phone: row?.phone ?? "", email: row?.email ?? "" }), [rec.contacts, row?.name, row?.phone, row?.email])
  const mine = useMemo(() => crm.activities.filter((a) => a.clientId === crmId), [crm.activities, crmId])
  const rowsById = useMemo(() => new Map(crm.leadRows.map((r) => [r.crmId, r])), [crm.leadRows])
  // A converted lead's client file: the account's CRM record names the lead it came from.
  const clientId = useMemo(() => Object.entries(crm.records).find(([, r]) => r.convertedFromLead === crmId)?.[0] ?? "", [crm.records, crmId])
  const [converting, setConverting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState("")
  useEffect(() => setValue(rec.expectedValue ? String(rec.expectedValue) : ""), [rec.expectedValue])

  const save = async (patch: Partial<ClientRecord>) => {
    if (!firestore) return
    try {
      await saveRecord(firestore, crmId, patch)
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }
  const setOwner = (uid: string) => {
    const s = crm.staff.find((x) => x.id === uid)
    return save(uid ? { ownerUid: uid, ownerName: s ? staffName(s) : "" } : { ownerUid: "", ownerName: "" })
  }
  const archive = async (r: LeadRow, archived: boolean) => {
    if (!firestore) return
    try {
      await setLeadArchived(firestore, r, archived, actor.uid)
      toast({ title: t(archived ? "lead_removed" : "lead_restored") })
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }

  const loading = crm.loading.leads
  const today = toDateKey(new Date())
  const parties = row ? [{ id: crmId, label: [row.name, row.company].filter(Boolean).join(" — "), contacts }] : []
  const openActivities = mine.filter((a) => activityState(a, today) !== "done").length
  const dupes = crm.matches.get(crmId)?.duplicates.length ?? 0
  const fromLanding = row?.channel === "demo" || row?.channel === "onboarding"

  return (
    <div className="space-y-6" dir={locale === "ar" ? "rtl" : "ltr"}>
      <CrmTrail
        backHref="/admin/crm?tab=leads"
        backLabel={t("back_to_crm")}
        crumbs={[{ label: t("page_title"), href: "/admin/crm" }, { label: t("tab_leads"), href: "/admin/crm?tab=leads" }, { label: row?.name ?? "…" }]}
      />

      {loading && !row ? (
        <div className="flex justify-center p-16">
          <Loader2 className="animate-spin text-primary" size={28} aria-label={t("loading")} />
        </div>
      ) : !row ? (
        <p className="rounded-xl border p-12 text-center text-sm text-muted-foreground">{t("lead_not_found")}</p>
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <h1 className="flex items-center gap-2 text-2xl font-black text-primary md:text-3xl">
                <UserRound size={24} className="shrink-0" aria-hidden="true" />
                <span className="truncate">{row.name}</span>
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">{t("lead_badge")}</Badge>
                {dupes > 0 && (
                  <Badge variant="outline" className="gap-1 border-warning/30 bg-warning/10 text-warning">
                    <CopyCheck size={12} aria-hidden="true" />
                    {t("flag_duplicate_short")}
                  </Badge>
                )}
                <StageBadge stage={row.stage} label={t(`stage_${row.stage}`)} />
                {row.kind !== "unspecified" && <Badge variant="outline">{t(`kind_${row.kind}`)}</Badge>}
                <Badge variant="outline">{t(`channel_${row.channel}`)}</Badge>
                {row.archived && <Badge variant="outline" className="border-destructive/30 text-destructive">{t("flag_removed")}</Badge>}
              </div>
              {row.company && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Building2 size={14} aria-hidden="true" />
                  {row.company}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* ADM-10: the lead becomes a client when its account is created — from here, not from another page. */}
              {row.converted ? (
                clientId && (
                  <Button variant="outline" asChild className="gap-1.5">
                    <Link href={`/admin/crm/customers/${clientId}`}>
                      <Building2 size={15} aria-hidden="true" />
                      {t("open_client_file")}
                    </Link>
                  </Button>
                )
              ) : (
                !row.archived && (
                  <Button onClick={() => setConverting(true)} className="gap-1.5">
                    <UserPlus size={15} aria-hidden="true" />
                    {t("create_account")}
                  </Button>
                )
              )}
              <IconButton icon={Pencil} label={t("edit")} onClick={() => setEditing(true)} />
              <IconButton
                icon={row.archived ? ArchiveRestore : Archive}
                label={t(row.archived ? "restore_lead" : "remove_lead")}
                onClick={() => void archive(row, !row.archived)}
                className={cn(!row.archived && "text-destructive")}
              />
            </div>
          </header>

          <DuplicateBanner row={row} match={crm.matches.get(crmId)} rowsById={rowsById} records={crm.records} uid={actor.uid} activities={crm.activities} quoteCount={crm.quoteCount} />

          <CrmStatRow>
            <CrmStat icon={Wallet} label={t("kpi_expected_value")} value={row.expectedValue ? <Money amount={row.expectedValue} /> : "—"} accent="success" />
            <CrmStat icon={FileText} label={t("quotes_title")} value={crm.quoteCount[crmId] ?? 0} />
            <CrmStat icon={ClipboardList} label={t("kpi_open_activities")} value={openActivities} accent="cta" />
            <CrmStat icon={Clock} label={t("last_contact")} value={row.daysSinceContact === null ? t("never_contacted") : t("days_ago", { n: row.daysSinceContact })} accent={row.stale ? "warning" : "primary"} />
          </CrmStatRow>

          <section aria-label={t("info_title")} className="grid gap-5 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoItem icon={UserRound} label={t("owner_label")}>
              <NativeSelect aria-label={t("owner_label")} className="h-9 w-full max-w-56" value={row.ownerUid || UNASSIGNED} onChange={(e) => void setOwner(e.target.value)}>
                <option value={UNASSIGNED}>{t("unassigned")}</option>
                {crm.staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {staffName(s)}
                  </option>
                ))}
              </NativeSelect>
            </InfoItem>
            <InfoItem icon={Target} label={t("stage_label")}>
              <NativeSelect aria-label={t("stage_label")} className="h-9 w-full max-w-56" value={row.stage} disabled={row.converted} onChange={(e) => stage.ask(crmId, row.name, row.stage, e.target.value)}>
                {(row.converted ? ["converted"] : LEAD_STAGES).map((s) => (
                  <option key={s} value={s}>
                    {t(`stage_${s}`)}
                  </option>
                ))}
              </NativeSelect>
            </InfoItem>
            <InfoItem icon={Handshake} label={t("col_source")}>
              {t(`channel_${row.channel}`)}
            </InfoItem>
            <InfoItem icon={Users} label={t("col_type")}>
              {t(`kind_${row.kind}`)}
            </InfoItem>
            <InfoItem icon={MapPin} label={t("city_label")}>
              {row.city || "—"}
            </InfoItem>
            <InfoItem icon={Building2} label={t("size_label")}>
              {companySizeRange(row.size) ? <bdi dir="ltr">{t("size_value", { range: companySizeRange(row.size) })}</bdi> : "—"}
            </InfoItem>
            <InfoItem icon={Tag} label={t("plan_label")}>
              <NativeSelect aria-label={t("plan_label")} className="h-9 w-full max-w-56" value={row.plan} onChange={(e) => void save({ plan: e.target.value })}>
                <option value="">—</option>
                {CLIENT_PLANS.map((p) => (
                  <option key={p} value={p}>
                    {t(`plan_${p}`)}
                  </option>
                ))}
              </NativeSelect>
            </InfoItem>
            <InfoItem icon={Wallet} label={t("expected_value")}>
              <Input
                aria-label={t("expected_value")}
                type="number"
                min={0}
                inputMode="decimal"
                dir="ltr"
                className="h-9 max-w-56"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => {
                  const n = Number(value)
                  if (Number.isFinite(n) && n !== (rec.expectedValue ?? 0)) void save({ expectedValue: n > 0 ? n : 0 })
                }}
              />
            </InfoItem>
            <InfoItem icon={CalendarCheck2} label={t("expected_close")}>
              <Input aria-label={t("expected_close")} type="date" dir="ltr" className="h-9 max-w-56" value={row.expectedClose} onChange={(e) => void save({ expectedClose: e.target.value })} />
            </InfoItem>
          </section>
          <p className="-mt-3 text-xs text-muted-foreground">{t("received_on", { date: formatCrmDate(row.createdMs, locale) })}</p>

          <ContactsSection recordId={crmId} contacts={contacts} originNote={fromLanding ? t("contact_origin") : undefined} />
          <ActivitiesSection recordId={crmId} activities={mine} parties={parties} staff={crm.staff} actor={actor} />
          <QuotesSection recordId={crmId} author={actor} />

          {stage.dialog}
          <EditLeadDialog row={row} open={editing} onOpenChange={setEditing} />
          <CreateAccountDialog
            lead={converting ? { id: row.id, source: row.source, name: row.name, company: row.company, email: row.email, phone: row.phone, kind: row.kind } : null}
            onOpenChange={setConverting}
            onCreated={(uid) => uid && router.push(`/admin/crm/customers/${uid}`)}
          />
          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">{t(row.archived ? "restore_hint" : "remove_hint")}</p>
            <Button variant="outline" size="sm" className={cn("shrink-0 gap-1.5", !row.archived && "text-destructive")} onClick={() => void archive(row, !row.archived)}>
              {row.archived ? <ArchiveRestore size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
              {t(row.archived ? "restore_lead" : "remove_lead")}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
