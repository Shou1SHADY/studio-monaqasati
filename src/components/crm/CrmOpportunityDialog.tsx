"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { Building2, CheckCircle2, Hammer, Package, Paperclip, Plus, Target, Trash2, UserRound, Wrench } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Chip } from "@/components/module-ui/Chip"
import { IconButton } from "@/components/module-ui/IconButton"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { useFirestore, useStorage } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { TeamMember } from "@/hooks/useCrmData"
import { useCrmOrgProfile } from "@/hooks/useCrmOrgProfile"
import { cn } from "@/lib/utils"
import {
  CLASSIFICATION_ACTIVITIES,
  CONTRACT_KINDS,
  CRM_OPPORTUNITIES,
  DEFAULT_STAGE_PROBABILITY,
  OPPORTUNITY_DELIVERABLES,
  OPPORTUNITY_FILE_KINDS,
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STAGE_BADGE_CLASS,
  OPPORTUNITY_TRACKS,
  SCOPE_ACTIVITY,
  SCOPE_TYPES,
  TENDER_ROUTES,
  TRACK_BADGE_CLASS,
  formatSar,
  opportunityDeliverables,
  opportunityTrack,
  partyRoles,
  trackDateLabelKey,
  type ClassificationActivity,
  type ContractKind,
  type CrmContact,
  type CrmOpportunity,
  type OpportunityDeliverable,
  type OpportunityFileKind,
  type OpportunitySource,
  type OpportunityTrack,
  type ScopeType,
  type TenderRoute,
} from "@/lib/crm"
import { addOpportunityFiles, createOpportunity, oppFileAllowed, type OppActor } from "@/lib/crm-opportunity-writes"
import { CrmFieldGroup, CrmFormDialog, CrmReviewRow, RequiredMark, type CrmFormStep } from "@/components/crm/CrmFormDialog"
import { CrmContactDialog } from "@/components/crm/CrmContactDialog"
import { guessFileKind } from "@/components/crm/OppFilesPanel"
import { iso } from "@/components/crm/OppBits"
import { displayDocNumber } from "@/lib/sales-numbering"
import type { CrmPortal } from "@/components/crm/CrmShell"

/** The probability steps a rep actually reasons in. A free-number field invites false precision. */
const PROBABILITY_STEPS = [10, 25, 40, 55, 70, 85]

export const DATE_INPUT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50"

const DELIVERABLE_ICON: Record<OpportunityDeliverable, typeof Hammer> = { project: Hammer, supply: Package, service: Wrench }

/**
 * Add or edit an opportunity (Opportunity journey v1.1, OPP-01). Three steps: the track and the CLIENT (a company or a
 * person from the clients list — never a contact person; those live in the client's file), what we deliver if we win
 * and the details Sales will price from; then the scope, source and deadline, with the files; then the optional estimate
 * and probability, and a review. There is no owner: the deal is recorded in the name of whoever creates it, and its
 * manager is chosen once, at handover. The stage is never set here.
 */
export function CrmOpportunityDialog({
  open,
  onOpenChange,
  orgId,
  opportunity,
  contacts,
  teamMembers,
  portal = "contractor",
  actor,
  /** Pre-selected (and locked) when opened from a client's own page. */
  fixedContactId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  opportunity?: CrmOpportunity
  contacts: CrmContact[]
  teamMembers: TeamMember[]
  portal?: CrmPortal
  /** Who records it — the deal is in their name (OPP-01 #2). */
  actor: OppActor
  fixedContactId?: string
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const storage = useStorage()
  const { toast } = useToast()
  const { profile } = useCrmOrgProfile()
  const isEdit = !!opportunity
  // A supplier has no projects to hand over to — what it wins is supplied or serviced.
  const deliverableOptions = OPPORTUNITY_DELIVERABLES.filter((d) => portal === "contractor" || d !== "project")

  const [isSaving, setIsSaving] = useState(false)
  const [contactId, setContactId] = useState("")
  const [title, setTitle] = useState("")
  const [details, setDetails] = useState("")
  const [track, setTrack] = useState<OpportunityTrack>("tender")
  const [deliverables, setDeliverables] = useState<OpportunityDeliverable[]>([])
  const [value, setValue] = useState("")
  const [probability, setProbability] = useState<number | null>(null)
  const [expectedCloseDate, setExpectedCloseDate] = useState("")
  const [scopeTypes, setScopeTypes] = useState<ScopeType[]>([])
  const [customScopeType, setCustomScopeType] = useState("")
  const [customScopeActivity, setCustomScopeActivity] = useState<ClassificationActivity>("buildings")
  const [route, setRoute] = useState<TenderRoute | "">("")
  const [contractKind, setContractKind] = useState<ContractKind | "">("")
  const [source, setSource] = useState<OpportunitySource | "">("")
  const [consultantContactId, setConsultantContactId] = useState("")
  const [files, setFiles] = useState<Array<{ file: File; kind: OpportunityFileKind }>>([])
  const [showAddContact, setShowAddContact] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setContactId(opportunity?.contactId ?? fixedContactId ?? "")
    setTitle(opportunity?.title ?? "")
    setDetails(opportunity?.details ?? opportunity?.notes ?? "")
    setTrack(opportunity ? opportunityTrack(opportunity) : "tender")
    setDeliverables(opportunity ? opportunityDeliverables(opportunity).filter((d) => deliverableOptions.includes(d)) : [])
    setValue(opportunity?.value != null && opportunity.value > 0 ? String(opportunity.value) : "")
    // Nothing picked in advance (OPP-01 #6): an empty probability counts «by stage».
    setProbability(typeof opportunity?.probability === "number" ? opportunity.probability : null)
    setExpectedCloseDate(opportunity?.expectedCloseDate ?? "")
    setScopeTypes(opportunity?.scopeTypes ?? [])
    setCustomScopeType(opportunity?.customScopeType ?? "")
    setCustomScopeActivity(opportunity?.customScopeActivity ?? "buildings")
    setRoute(opportunity?.route ?? "")
    setContractKind(opportunity?.contractKind ?? "")
    // An old record's «open tender / direct invitation» source is how it was put to market — that is the route now.
    setSource(opportunity?.source && OPPORTUNITY_SOURCES.includes(opportunity.source) ? opportunity.source : "")
    setConsultantContactId(opportunity?.consultantContactId ?? "")
    setFiles([])
  }, [open, opportunity, fixedContactId])

  const toggleScope = (scope: ScopeType) => setScopeTypes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]))
  // A project stands alone; supply and service combine (supply and install).
  const toggleDeliverable = (d: OpportunityDeliverable) =>
    setDeliverables((prev) =>
      d === "project" ? (prev.includes("project") ? [] : ["project"]) : prev.includes(d) ? prev.filter((x) => x !== d) : [...prev.filter((x) => x !== "project"), d]
    )

  const derivedActivity: ClassificationActivity | null = scopeTypes.length > 0 ? SCOPE_ACTIVITY[scopeTypes[0]] : customScopeType.trim() ? customScopeActivity : null
  const selectedContact = contacts.find((c) => c.id === contactId)
  const clientOptions = useMemo(
    () =>
      contacts.map((c) => ({
        value: c.id,
        label: c.company && c.company !== c.name ? `${c.name} — ${c.company}` : c.name,
        group: t(c.entityType === "individual" ? "crm_client_individuals" : "crm_client_companies"),
        keywords: [c.phone, c.email].filter(Boolean).join(" "),
      })),
    [contacts, t]
  )
  const consultantOptions = useMemo(() => {
    const others = contacts.filter((c) => c.id !== contactId)
    const isConsultant = (c: CrmContact) => partyRoles(c).includes("consultant")
    return [...others.filter(isConsultant), ...others.filter((c) => !isConsultant(c))]
  }, [contacts, contactId])

  const parsedValue = parseFloat(value)
  const numericValue = Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0

  const pickFiles = (list: FileList | null) => {
    if (!list) return
    const next: Array<{ file: File; kind: OpportunityFileKind }> = []
    for (const file of Array.from(list)) {
      const check = oppFileAllowed(file)
      if (check !== "ok") {
        toast({ variant: "destructive", title: t(`crm_file_err_${check}`, { name: file.name }) })
        continue
      }
      next.push({ file, kind: guessFileKind(file) })
    }
    setFiles((p) => [...p, ...next])
    if (fileInput.current) fileInput.current.value = ""
  }

  const handleSave = async () => {
    if (!firestore || isSaving) return
    setIsSaving(true)
    try {
      const contact = contacts.find((c) => c.id === contactId)
      const data = {
        contactId,
        contactName: contact?.name ?? opportunity?.contactName ?? null,
        title: title.trim(),
        details: details.trim() || null,
        track,
        deliverables,
        value: numericValue,
        probability,
        expectedCloseDate: expectedCloseDate || null,
        scopeTypes,
        customScopeType: customScopeType.trim() || null,
        customScopeActivity: !scopeTypes.length && customScopeType.trim() ? customScopeActivity : null,
        route: route || null,
        contractKind: contractKind || null,
        source: source || null,
        consultantContactId: consultantContactId || null,
        consultantName: contacts.find((c) => c.id === consultantContactId)?.name ?? null,
      }
      if (opportunity) {
        await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opportunity.id), { ...data, updatedAt: serverTimestamp() })
        toast({ title: t("crm_opp_saved") })
      } else {
        const created = await createOpportunity(firestore, orgId, actor, data)
        if (files.length) {
          // The record exists already; a failed upload is reported, never a lost deal.
          await addOpportunityFiles(firestore, storage, { id: created.id, organizationId: orgId }, actor, files, "add").catch((err) => {
            console.error(err)
            toast({ variant: "destructive", title: t("crm_files_failed") })
          })
        }
        toast({ title: t("crm_opp_created", { number: iso(displayDocNumber(created.docNumber, locale)) }) })
      }
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const steps: CrmFormStep[] = [
    {
      id: "basics",
      title: t("crm_opp_step_client"),
      validate: () => {
        if (!deliverables.length) return t("crm_deliverable_required")
        if (!contactId) return t("crm_client_required")
        if (!title.trim()) return t("crm_opp_validation_error")
        return null
      },
      content: (
        <>
          <CrmFieldGroup label={t("crm_opp_track")}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {OPPORTUNITY_TRACKS.map((tr) => (
                <button
                  key={tr}
                  type="button"
                  onClick={() => setTrack(tr)}
                  aria-pressed={track === tr}
                  disabled={isSaving}
                  className={cn(
                    "rounded-lg border p-3 text-start transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    track === tr ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  )}
                >
                  <span className="block text-sm font-bold text-foreground">{t(`crm_track_${tr}`)}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{t(`crm_track_${tr}_desc`)}</span>
                </button>
              ))}
            </div>
          </CrmFieldGroup>

          <CrmFieldGroup label={`${t("crm_deliverable_question")} *`} hint={portal === "contractor" ? t("crm_deliverable_hint") : undefined}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {deliverableOptions.map((d) => {
                const Icon = DELIVERABLE_ICON[d]
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDeliverable(d)}
                    aria-pressed={deliverables.includes(d)}
                    disabled={isSaving}
                    className={cn(
                      "rounded-lg border p-3 text-start transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      deliverables.includes(d) ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                      <Icon size={14} aria-hidden="true" />
                      {t(`crm_deliverable_${d}`)}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{t(`crm_deliverable_${d}_desc`)}</span>
                  </button>
                )
              })}
            </div>
          </CrmFieldGroup>

          {!fixedContactId && (
            <div className="space-y-1.5">
              <Label htmlFor="opp-client">
                {t("crm_client")} <RequiredMark />
              </Label>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <SearchableSelect
                    id="opp-client"
                    value={contactId}
                    onChange={setContactId}
                    options={clientOptions}
                    placeholder={t("crm_client_placeholder")}
                    searchPlaceholder={t("crm_client_search")}
                    noResultsText={t("crm_no_results")}
                    disabled={isSaving}
                  />
                </div>
                <Button type="button" variant="outline" className="shrink-0 gap-1.5" onClick={() => setShowAddContact(true)} disabled={isSaving}>
                  <Plus size={14} aria-hidden="true" />
                  {t("crm_client_add")}
                </Button>
              </div>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                {selectedContact?.entityType === "individual" ? <UserRound size={11} aria-hidden="true" /> : <Building2 size={11} aria-hidden="true" />}
                {t("crm_client_hint")}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="opp-title">
              {t("crm_opp_title")} <RequiredMark />
            </Label>
            <Input id="opp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("crm_opp_title_placeholder")} disabled={isSaving} autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="opp-details">{t("crm_details_optional")}</Label>
            <Textarea id="opp-details" value={details} onChange={(e) => setDetails(e.target.value)} rows={4} disabled={isSaving} />
            <p className="text-[11px] text-muted-foreground">{t("crm_details_hint")}</p>
          </div>

          {isEdit && opportunity && (
            <div className="space-y-1.5">
              <Label>{t("crm_opp_stage")}</Label>
              <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                <Badge className={cn("text-[10px]", OPPORTUNITY_STAGE_BADGE_CLASS[opportunity.stage])}>{t(`crm_opp_stage_${opportunity.stage}`)}</Badge>
                <span className="text-[11px] text-muted-foreground">{t("crm_opp_stage_readonly_hint")}</span>
              </div>
            </div>
          )}
        </>
      ),
    },
    {
      id: "scope",
      title: t("crm_opp_step_scope"),
      content: (
        <>
          <CrmFieldGroup label={t("crm_opp_scope")} hint={t("crm_opp_scope_hint")}>
            <div className="flex flex-wrap gap-1.5">
              {SCOPE_TYPES.map((scope) => {
                const index = scopeTypes.indexOf(scope)
                return (
                  <Chip key={scope} selected={index !== -1} onClick={() => toggleScope(scope)} disabled={isSaving}>
                    {t(`crm_scope_${scope}`)}
                    {index === 0 && <span className="ms-1" aria-hidden="true">★</span>}
                  </Chip>
                )
              })}
            </div>
          </CrmFieldGroup>

          <div className="space-y-1.5">
            <Label htmlFor="opp-custom-scope">{t("crm_opp_custom_scope")}</Label>
            <Input id="opp-custom-scope" value={customScopeType} onChange={(e) => setCustomScopeType(e.target.value)} placeholder={t("crm_opp_custom_scope_placeholder")} disabled={isSaving} />
            {!scopeTypes.length && customScopeType.trim() && (
              <div className="space-y-1.5 pt-1.5">
                <Label htmlFor="opp-custom-activity">{t("crm_opp_custom_activity")}</Label>
                <NativeSelect id="opp-custom-activity" className="w-full" value={customScopeActivity} onChange={(e) => setCustomScopeActivity(e.target.value as ClassificationActivity)} disabled={isSaving}>
                  {CLASSIFICATION_ACTIVITIES.map((a) => (
                    <option key={a} value={a}>
                      {t(`crm_activity_class_${a}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              {derivedActivity ? t("crm_opp_activity_derived", { activity: t(`crm_activity_class_${derivedActivity}`) }) : t("crm_opp_scope_none_hint")}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="opp-route">{t("crm_opp_route")}</Label>
              <NativeSelect id="opp-route" className="w-full" value={route} onChange={(e) => setRoute(e.target.value as TenderRoute | "")} disabled={isSaving}>
                <option value="">{t("crm_not_specified")}</option>
                {TENDER_ROUTES.map((r) => (
                  <option key={r} value={r}>
                    {t(`crm_route_${r}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-source">{t("crm_opp_source")}</Label>
              <NativeSelect id="opp-source" className="w-full" value={source} onChange={(e) => setSource(e.target.value as OpportunitySource | "")} disabled={isSaving}>
                <option value="">{t("crm_not_specified")}</option>
                {OPPORTUNITY_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {t(`crm_opp_source_${s}`)}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-[11px] text-muted-foreground">{t("crm_opp_source_hint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-kind">{t("crm_opp_contract_kind")}</Label>
              <NativeSelect id="opp-kind" className="w-full" value={contractKind} onChange={(e) => setContractKind(e.target.value as ContractKind | "")} disabled={isSaving}>
                <option value="">{t("crm_not_specified")}</option>
                {CONTRACT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`crm_contract_kind_${k}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-consultant">{t("crm_opp_consultant")}</Label>
              <NativeSelect id="opp-consultant" className="w-full" value={consultantContactId} onChange={(e) => setConsultantContactId(e.target.value)} disabled={isSaving}>
                <option value="">{t("crm_not_specified")}</option>
                {consultantOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="opp-date">{t(trackDateLabelKey(track))}</Label>
              <input id="opp-date" type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} dir="ltr" disabled={isSaving} className={DATE_INPUT_CLASS} />
            </div>
          </div>

          {!isEdit && (
            <CrmFieldGroup label={t("crm_files_optional")} hint={t("crm_files_add_hint")}>
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                {files.map((f, i) => (
                  <div key={`${f.file.name}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                    <Paperclip size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                    <bdi dir="auto" className="min-w-0 flex-1 truncate">{f.file.name}</bdi>
                    <NativeSelect
                      aria-label={t("crm_file_kind")}
                      className="h-8 w-40 text-xs"
                      value={f.kind}
                      onChange={(e) => setFiles((list) => list.map((x, j) => (j === i ? { ...x, kind: e.target.value as OpportunityFileKind } : x)))}
                    >
                      {OPPORTUNITY_FILE_KINDS.filter((k) => k !== "quotation").map((k) => (
                        <option key={k} value={k}>
                          {t(`crm_file_kind_${k}`)}
                        </option>
                      ))}
                    </NativeSelect>
                    <IconButton icon={Trash2} iconSize={13} label={t("crm_delete_btn")} onClick={() => setFiles((list) => list.filter((_, j) => j !== i))} />
                  </div>
                ))}
                <input ref={fileInput} type="file" multiple className="sr-only" aria-label={t("crm_files_attach")} onChange={(e) => pickFiles(e.target.files)} />
                <Button type="button" size="sm" variant="ghost" className="gap-1.5 text-cta" onClick={() => fileInput.current?.click()} disabled={isSaving}>
                  <Paperclip size={13} aria-hidden="true" />
                  {t("crm_files_attach")}
                </Button>
              </div>
            </CrmFieldGroup>
          )}
        </>
      ),
    },
    {
      id: "value",
      title: t("crm_opp_step_estimate"),
      content: (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="opp-value">{t("crm_estimate_optional")}</Label>
            <Input id="opp-value" type="number" min="0" step="any" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} dir="ltr" disabled={isSaving} />
            <p className="text-[11px] text-muted-foreground">{t("crm_estimate_hint")}</p>
          </div>

          <CrmFieldGroup
            label={t("crm_probability_optional")}
            hint={
              probability === null
                ? t("crm_probability_by_stage_hint", { stage: t("crm_opp_stage_new"), percent: profile?.stageProbabilities?.new ?? DEFAULT_STAGE_PROBABILITY.new })
                : undefined
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {PROBABILITY_STEPS.map((p) => (
                <Chip key={p} selected={probability === p} onClick={() => setProbability(probability === p ? null : p)} disabled={isSaving}>
                  <span dir="ltr">{p}%</span>
                </Chip>
              ))}
            </div>
          </CrmFieldGroup>

          {/* No owner here (OPP-01 #2): the deal is the creator's record; its manager is chosen at handover. */}
          <p className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-[11px] text-muted-foreground">
            <UserRound size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t("crm_no_owner_note")}
          </p>

          <div className="rounded-lg border bg-muted/30">
            <p className="border-b px-3 py-2 text-[11px] font-bold text-muted-foreground">{t("crm_opp_review")}</p>
            <CrmReviewRow label={t("crm_opp_track")}>
              <Badge variant="outline" className={cn("text-[10px]", TRACK_BADGE_CLASS[track])}>
                {t(`crm_track_${track}`)}
              </Badge>
            </CrmReviewRow>
            <CrmReviewRow label={t("crm_deliverable")}>
              {deliverables.length ? deliverables.map((d) => t(`crm_deliverable_${d}`)).join(" · ") : <span className="font-normal text-muted-foreground">—</span>}
            </CrmReviewRow>
            <CrmReviewRow label={t("crm_client")}>{selectedContact?.name || <span className="font-normal text-muted-foreground">—</span>}</CrmReviewRow>
            <CrmReviewRow label={t("crm_details_and_files")}>
              {[details.trim() ? t("crm_details_written") : t("crm_details_none"), !isEdit && files.length ? t("crm_files_count", { count: files.length }) : null]
                .filter(Boolean)
                .join(" · ")}
            </CrmReviewRow>
            <CrmReviewRow label={t("crm_value_estimate_label")}>
              {numericValue > 0 ? <span dir="ltr">{formatSar(numericValue, locale)}</span> : <span className="font-normal text-muted-foreground">{t("crm_no_estimate_yet")}</span>}
            </CrmReviewRow>
            {!isEdit && <CrmReviewRow label={t("crm_recorded_as")}>{actor.name || "—"}</CrmReviewRow>}
            {!isEdit && (
              <p className="flex items-start gap-2 border-t px-3 py-2 text-[11px] text-muted-foreground">
                <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-cta" aria-hidden="true" />
                <span>{t("crm_opp_starts_at_first_stage")}</span>
              </p>
            )}
          </div>
        </>
      ),
    },
  ]

  return (
    <>
      <CrmFormDialog
        open={open}
        onOpenChange={onOpenChange}
        icon={Target}
        title={isEdit ? t("crm_opp_edit_title") : t("crm_opp_add_title")}
        description={t("crm_opp_dialog_desc")}
        steps={steps}
        isSaving={isSaving}
        submitLabel={t("crm_save")}
        onSubmit={() => void handleSave()}
        size="lg"
      />
      {/* Opens over this form, which keeps its state; the new client comes back selected. */}
      <CrmContactDialog open={showAddContact} onOpenChange={setShowAddContact} orgId={orgId} teamMembers={teamMembers} onSaved={(newContactId) => setContactId(newContactId)} />
    </>
  )
}
