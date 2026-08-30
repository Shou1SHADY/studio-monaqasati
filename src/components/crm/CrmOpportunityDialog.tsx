"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, addDoc, updateDoc, serverTimestamp } from "firebase/firestore"
import { CheckCircle2, Plus, Target } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { TeamMember } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import {
  CLASSIFICATION_ACTIVITIES,
  CONTRACT_KINDS,
  CRM_OPPORTUNITIES,
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STAGE_BADGE_CLASS,
  OPPORTUNITY_TRACKS,
  SCOPE_ACTIVITY,
  SCOPE_TYPES,
  TENDER_ROUTES,
  TRACK_BADGE_CLASS,
  formatSar,
  historyEntry,
  opportunityTrack,
  partyRoles,
  trackDateLabelKey,
  type ClassificationActivity,
  type ContractKind,
  type CrmContact,
  type CrmOpportunity,
  type OpportunitySource,
  type OpportunityTrack,
  type ScopeType,
  type TenderRoute,
} from "@/lib/crm"
import { CrmFieldGroup, CrmFormDialog, CrmReviewRow, RequiredMark, type CrmFormStep } from "@/components/crm/CrmFormDialog"
import { CrmContactDialog } from "@/components/crm/CrmContactDialog"

/** The probability steps a rep actually reasons in. A free-number field here
 * invites false precision — nobody's deal is 63% likely. */
const PROBABILITY_STEPS = [10, 25, 40, 55, 70, 85]

export const DATE_INPUT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50"

const NONE = "__none__"

/** Sentinel select value: the "add a contact" action at the foot of the
 * contact list, handled in onValueChange rather than stored. */
const ADD_CONTACT = "__add_contact__"

/** Chip toggle used for scope, probability and similar small option sets. */
function Chip({
  selected,
  onClick,
  disabled,
  children,
}: {
  selected: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        selected ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted"
      )}
    >
      {children}
    </button>
  )
}

/**
 * Create or edit an opportunity.
 *
 * Split into three steps because the form asks about three unrelated things:
 * what kind of deal this is and who it is with, what the work actually is, and
 * what we think it is worth. Presenting a dozen fields as one wall made a
 * routine task read as paperwork.
 *
 * The stage is deliberately NOT settable when creating. Every deal starts at
 * the first stage and earns its way forward by clearing gates; letting someone
 * open one directly at "won" would route around the entire mechanism this
 * module exists to enforce.
 */
export function CrmOpportunityDialog({
  open,
  onOpenChange,
  orgId,
  opportunity,
  contacts,
  teamMembers,
  /** Pre-selected (and locked) when opened from a contact's own page. */
  fixedContactId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  opportunity?: CrmOpportunity
  contacts: CrmContact[]
  teamMembers: TeamMember[]
  fixedContactId?: string
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const isEdit = !!opportunity

  const [isSaving, setIsSaving] = useState(false)
  const [contactId, setContactId] = useState("")
  const [title, setTitle] = useState("")
  const [track, setTrack] = useState<OpportunityTrack>("tender")
  const [value, setValue] = useState("")
  const [probability, setProbability] = useState(40)
  const [expectedCloseDate, setExpectedCloseDate] = useState("")
  const [ownerId, setOwnerId] = useState("")
  const [notes, setNotes] = useState("")
  const [scopeTypes, setScopeTypes] = useState<ScopeType[]>([])
  const [customScopeType, setCustomScopeType] = useState("")
  const [customScopeActivity, setCustomScopeActivity] = useState<ClassificationActivity>("buildings")
  const [route, setRoute] = useState<TenderRoute | "">("")
  const [contractKind, setContractKind] = useState<ContractKind | "">("")
  const [source, setSource] = useState<OpportunitySource | "">("")
  const [consultantContactId, setConsultantContactId] = useState("")
  const [showAddContact, setShowAddContact] = useState(false)

  useEffect(() => {
    if (!open) return
    setContactId(opportunity?.contactId ?? fixedContactId ?? "")
    setTitle(opportunity?.title ?? "")
    setTrack(opportunity ? opportunityTrack(opportunity) : "tender")
    setValue(opportunity?.value != null && opportunity.value > 0 ? String(opportunity.value) : "")
    setProbability(typeof opportunity?.probability === "number" ? opportunity.probability : 40)
    setExpectedCloseDate(opportunity?.expectedCloseDate ?? "")
    setOwnerId(opportunity?.ownerId ?? "")
    setNotes(opportunity?.notes ?? "")
    setScopeTypes(opportunity?.scopeTypes ?? [])
    setCustomScopeType(opportunity?.customScopeType ?? "")
    setCustomScopeActivity(opportunity?.customScopeActivity ?? "buildings")
    setRoute(opportunity?.route ?? "")
    setContractKind(opportunity?.contractKind ?? "")
    setSource(opportunity?.source ?? "")
    setConsultantContactId(opportunity?.consultantContactId ?? "")
  }, [open, opportunity, fixedContactId])

  /** The first scope picked is the primary one, so selection order is
   * preserved rather than sorted — it decides the classification activity. */
  const toggleScope = (scope: ScopeType) =>
    setScopeTypes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]))

  const derivedActivity: ClassificationActivity | null =
    scopeTypes.length > 0 ? SCOPE_ACTIVITY[scopeTypes[0]] : customScopeType.trim() ? customScopeActivity : null

  const selectedContact = contacts.find((c) => c.id === contactId)

  // Consultants first — that is what this field is for — but the whole list
  // stays reachable, because the role may simply not have been recorded yet.
  const consultantOptions = useMemo(() => {
    const others = contacts.filter((c) => c.id !== contactId)
    const isConsultant = (c: CrmContact) => partyRoles(c).includes("consultant")
    return [...others.filter(isConsultant), ...others.filter((c) => !isConsultant(c))]
  }, [contacts, contactId])

  const parsedValue = parseFloat(value)
  const numericValue = Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0

  const handleSave = async () => {
    if (!firestore || isSaving) return
    setIsSaving(true)
    try {
      const contact = contacts.find((c) => c.id === contactId)
      const owner = teamMembers.find((m) => m.id === ownerId)
      const data = {
        contactId,
        contactName: contact?.name ?? opportunity?.contactName ?? null,
        title: title.trim(),
        track,
        value: numericValue,
        probability,
        expectedCloseDate: expectedCloseDate || null,
        ownerId: owner?.id || null,
        ownerName: owner?.name || null,
        notes: notes.trim() || null,
        scopeTypes,
        customScopeType: customScopeType.trim() || null,
        // Only meaningful alongside a custom scope — a picked scope carries its
        // own activity, and storing a second answer invites them to disagree.
        customScopeActivity: !scopeTypes.length && customScopeType.trim() ? customScopeActivity : null,
        route: route || null,
        contractKind: contractKind || null,
        source: source || null,
        consultantContactId: consultantContactId || null,
        consultantName: contacts.find((c) => c.id === consultantContactId)?.name ?? null,
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }
      if (opportunity) {
        await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opportunity.id), data)
      } else {
        await addDoc(collection(firestore, CRM_OPPORTUNITIES), {
          ...data,
          stage: "new",
          state: "open",
          completedGates: [],
          approvalStatus: "none",
          stageHistory: [historyEntry("new", owner?.name ?? null)],
          addenda: [],
          createdAt: serverTimestamp(),
        })
      }
      toast({ title: t("crm_opp_saved") })
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
      title: t("crm_opp_step_basics"),
      validate: () => {
        if (!contactId) return t("crm_opp_contact_required")
        if (!title.trim()) return t("crm_opp_validation_error")
        return null
      },
      content: (
        <>
          {/* The track picks the checklist this deal has to clear, so it comes
              first and is shown as cards — the difference actually matters. */}
          <CrmFieldGroup label={t("crm_opp_track")}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                  <span className="block text-[11px] text-muted-foreground mt-0.5">{t(`crm_track_${tr}_desc`)}</span>
                </button>
              ))}
            </div>
          </CrmFieldGroup>

          {!fixedContactId && (
            <div className="space-y-1.5">
              <Label htmlFor="opp-contact">
                {t("crm_opp_contact")} <RequiredMark />
              </Label>
              <Select
                value={contactId}
                onValueChange={(value) => {
                  // The last entry is an action, not a contact — opening the
                  // contact form must not leave the sentinel in the field.
                  if (value === ADD_CONTACT) {
                    setShowAddContact(true)
                    return
                  }
                  setContactId(value)
                }}
                disabled={isSaving}
              >
                <SelectTrigger id="opp-contact"><SelectValue placeholder={t("crm_opp_contact_placeholder")} /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.company ? ` — ${c.company}` : ""}
                    </SelectItem>
                  ))}
                  {/* A deal needs a party, and the one you want is often the one
                      that isn't recorded yet. Leaving to the contacts page would
                      throw away everything typed into this form so far. */}
                  <SelectItem
                    value={ADD_CONTACT}
                    className={cn(contacts.length > 0 && "mt-1 border-t border-border", "font-semibold text-primary focus:text-primary")}
                  >
                    <span className="flex items-center gap-1.5">
                      <Plus size={14} />
                      {t("crm_add_btn")}
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="opp-title">
              {t("crm_opp_title")} <RequiredMark />
            </Label>
            <Input
              id="opp-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("crm_opp_title_placeholder")}
              disabled={isSaving}
              autoFocus
            />
          </div>

          {/* The stage is shown, never edited, here. A deal moves by clearing
              its gates on the detail page (or one step at a time on the
              board); an edit form that could set "won" was the back door
              every rule elsewhere was written to close. */}
          {isEdit && opportunity && (
            <div className="space-y-1.5">
              <Label>{t("crm_opp_stage")}</Label>
              <div className="flex flex-wrap items-center gap-2 min-h-10 rounded-md border bg-muted/30 px-3 py-2">
                <Badge className={cn("text-[10px]", OPPORTUNITY_STAGE_BADGE_CLASS[opportunity.stage])}>
                  {t(`crm_opp_stage_${opportunity.stage}`)}
                </Badge>
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
            <Input
              id="opp-custom-scope"
              value={customScopeType}
              onChange={(e) => setCustomScopeType(e.target.value)}
              placeholder={t("crm_opp_custom_scope_placeholder")}
              disabled={isSaving}
            />
            {/* A custom scope has no activity mapping, so the one thing the
                eligibility check needs has to be asked for outright. */}
            {!scopeTypes.length && customScopeType.trim() && (
              <div className="pt-1.5 space-y-1.5">
                <Label htmlFor="opp-custom-activity">{t("crm_opp_custom_activity")}</Label>
                <Select
                  value={customScopeActivity}
                  onValueChange={(v) => setCustomScopeActivity(v as ClassificationActivity)}
                  disabled={isSaving}
                >
                  <SelectTrigger id="opp-custom-activity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CLASSIFICATION_ACTIVITIES.map((a) => (
                      <SelectItem key={a} value={a}>{t(`crm_activity_class_${a}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {derivedActivity ? (
              <p className="text-[11px] text-muted-foreground">
                {t("crm_opp_activity_derived", { activity: t(`crm_activity_class_${derivedActivity}`) })}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">{t("crm_opp_scope_none_hint")}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="opp-route">{t("crm_opp_route")}</Label>
              <Select value={route || NONE} onValueChange={(v) => setRoute(v === NONE ? "" : (v as TenderRoute))} disabled={isSaving}>
                <SelectTrigger id="opp-route"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("crm_not_specified")}</SelectItem>
                  {TENDER_ROUTES.map((r) => (
                    <SelectItem key={r} value={r}>{t(`crm_route_${r}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-kind">{t("crm_opp_contract_kind")}</Label>
              <Select value={contractKind || NONE} onValueChange={(v) => setContractKind(v === NONE ? "" : (v as ContractKind))} disabled={isSaving}>
                <SelectTrigger id="opp-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("crm_not_specified")}</SelectItem>
                  {CONTRACT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>{t(`crm_contract_kind_${k}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-source">{t("crm_opp_source")}</Label>
              <Select value={source || NONE} onValueChange={(v) => setSource(v === NONE ? "" : (v as OpportunitySource))} disabled={isSaving}>
                <SelectTrigger id="opp-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("crm_not_specified")}</SelectItem>
                  {OPPORTUNITY_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`crm_opp_source_${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-consultant">{t("crm_opp_consultant")}</Label>
              <Select
                value={consultantContactId || NONE}
                onValueChange={(v) => setConsultantContactId(v === NONE ? "" : v)}
                disabled={isSaving}
              >
                <SelectTrigger id="opp-consultant"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>{t("crm_not_specified")}</SelectItem>
                  {consultantOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            {/* The same field means three different things — bid deadline,
                offer validity, contract expiry — so it is labelled by track. */}
            <Label htmlFor="opp-date">{t(trackDateLabelKey(track))}</Label>
            <input
              id="opp-date"
              type="date"
              value={expectedCloseDate}
              onChange={(e) => setExpectedCloseDate(e.target.value)}
              dir="ltr"
              disabled={isSaving}
              className={DATE_INPUT_CLASS}
            />
          </div>
        </>
      ),
    },
    {
      id: "value",
      title: t("crm_opp_step_value"),
      content: (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="opp-value">{t("crm_opp_estimated_value")}</Label>
            <Input
              id="opp-value"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              dir="ltr"
              disabled={isSaving}
            />
            <p className="text-[11px] text-muted-foreground">{t("crm_opp_estimated_value_hint")}</p>
          </div>

          <CrmFieldGroup label={t("crm_opp_probability")} hint={t("crm_opp_probability_hint")}>
            <div className="flex flex-wrap gap-1.5">
              {PROBABILITY_STEPS.map((p) => (
                <Chip key={p} selected={probability === p} onClick={() => setProbability(p)} disabled={isSaving}>
                  <span dir="ltr">{p}%</span>
                </Chip>
              ))}
            </div>
          </CrmFieldGroup>

          <div className="space-y-1.5">
            <Label htmlFor="opp-owner">{t("crm_owner")}</Label>
            <Select value={ownerId || NONE} onValueChange={(v) => setOwnerId(v === NONE ? "" : v)} disabled={isSaving}>
              <SelectTrigger id="opp-owner"><SelectValue placeholder={t("crm_owner_placeholder")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("crm_owner_none")}</SelectItem>
                {teamMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="opp-notes">{t("crm_notes")}</Label>
            <Textarea id="opp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={isSaving} rows={3} />
          </div>

          {/* What saving will produce, before it is produced. */}
          <div className="rounded-lg border bg-muted/30">
            <p className="px-3 py-2 text-[11px] font-bold text-muted-foreground border-b">{t("crm_opp_review")}</p>
            <CrmReviewRow label={t("crm_opp_track")}>
              <Badge variant="outline" className={cn("text-[10px]", TRACK_BADGE_CLASS[track])}>
                {t(`crm_track_${track}`)}
              </Badge>
            </CrmReviewRow>
            <CrmReviewRow label={t("crm_opp_contact")}>
              {selectedContact?.name || <span className="text-muted-foreground font-normal">—</span>}
            </CrmReviewRow>
            <CrmReviewRow label={t("crm_opp_scope")}>
              {scopeTypes.length || customScopeType.trim() ? (
                [...scopeTypes.map((s) => t(`crm_scope_${s}`)), customScopeType.trim()].filter(Boolean).join(" · ")
              ) : (
                <span className="text-muted-foreground font-normal">{t("crm_not_specified")}</span>
              )}
            </CrmReviewRow>
            <CrmReviewRow label={t("crm_opp_estimated_value")}>
              {numericValue > 0 ? (
                <span dir="ltr">{formatSar(numericValue, locale)}</span>
              ) : (
                <span className="text-muted-foreground font-normal">{t("crm_opp_no_estimate_note")}</span>
              )}
            </CrmReviewRow>
            {!isEdit && (
              <p className="px-3 py-2 flex items-start gap-2 text-[11px] text-muted-foreground border-t">
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
      {/* Opens over this form, which keeps its state — the point of adding a
          contact from here is not having to abandon the deal being written.
          The new party lands in `contacts` through the parent's listener; the
          id comes back on save so it is already selected when this closes. */}
      <CrmContactDialog
        open={showAddContact}
        onOpenChange={setShowAddContact}
        orgId={orgId}
        teamMembers={teamMembers}
        onSaved={(newContactId) => setContactId(newContactId)}
      />
    </>
  )
}

