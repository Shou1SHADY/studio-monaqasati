"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useFirestore } from "@/firebase"
import { collection, doc, addDoc, updateDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"
import type { TeamMember } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import {
  CLASSIFICATION_ACTIVITIES,
  CONTRACT_KINDS,
  CRM_OPPORTUNITIES,
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_TRACKS,
  SCOPE_ACTIVITY,
  SCOPE_TYPES,
  TENDER_ROUTES,
  historyEntry,
  opportunityTrack,
  trackDateLabelKey,
  type ClassificationActivity,
  type ContractKind,
  type CrmContact,
  type CrmOpportunity,
  type OpportunitySource,
  type OpportunityStage,
  type OpportunityTrack,
  type ScopeType,
  type TenderRoute,
} from "@/lib/crm"

/** The probability steps a rep actually reasons in. A free-number field here
 * invites false precision — nobody's deal is 63% likely. */
const PROBABILITY_STEPS = [10, 25, 40, 55, 70, 85]

export const DATE_INPUT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50"

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
  const [isSaving, setIsSaving] = useState(false)
  const [contactId, setContactId] = useState("")
  const [title, setTitle] = useState("")
  const [track, setTrack] = useState<OpportunityTrack>("tender")
  const [stage, setStage] = useState<OpportunityStage>("new")
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

  useEffect(() => {
    if (!open) return
    setContactId(opportunity?.contactId ?? fixedContactId ?? "")
    setTitle(opportunity?.title ?? "")
    setTrack(opportunity ? opportunityTrack(opportunity) : "tender")
    setStage(opportunity?.stage ?? "new")
    setValue(opportunity?.value != null ? String(opportunity.value) : "")
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

  const handleSave = async () => {
    if (!firestore || isSaving) return
    if (!title.trim()) {
      toast({ title: t("crm_opp_validation_error"), variant: "destructive" })
      return
    }
    if (!contactId) {
      toast({ title: t("crm_opp_contact_required"), variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const contact = contacts.find((c) => c.id === contactId)
      const owner = teamMembers.find((m) => m.id === ownerId)
      const parsedValue = parseFloat(value)
      const data = {
        contactId,
        contactName: contact?.name ?? opportunity?.contactName ?? null,
        title: title.trim(),
        track,
        stage,
        value: Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0,
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
          state: "open",
          completedGates: [],
          approvalStatus: "none",
          stageHistory: [historyEntry(stage, owner?.name ?? null)],
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

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSaving) onOpenChange(next) }}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{opportunity ? t("crm_opp_edit_title") : t("crm_opp_add_title")}</DialogTitle>
          <DialogDescription>{t("crm_opp_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4 py-2" onSubmit={(e) => { e.preventDefault(); void handleSave() }}>
          {!fixedContactId && (
            <div className="space-y-1.5">
              <Label htmlFor="opp-contact">{t("crm_opp_contact")} *</Label>
              <Select value={contactId} onValueChange={setContactId} disabled={isSaving}>
                <SelectTrigger id="opp-contact"><SelectValue placeholder={t("crm_opp_contact_placeholder")} /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.company ? ` — ${c.company}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {/* The track picks the checklist this deal has to clear, so it is
              chosen before anything else and shown as cards rather than a
              select — the difference between the three actually matters. */}
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium mb-1.5">{t("crm_opp_track")}</legend>
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
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="opp-title">{t("crm_opp_title")} *</Label>
            <Input id="opp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("crm_opp_title_placeholder")} disabled={isSaving} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="opp-stage">{t("crm_opp_stage")}</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as OpportunityStage)} disabled={isSaving}>
                <SelectTrigger id="opp-stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OPPORTUNITY_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`crm_opp_stage_${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-value">{t("crm_opp_estimated_value")}</Label>
              <Input id="opp-value" type="number" min="0" step="any" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} dir="ltr" disabled={isSaving} />
              <p className="text-[11px] text-muted-foreground">{t("crm_opp_estimated_value_hint")}</p>
            </div>
          </div>
          {/* Scope of work. Multi-select because a single job routinely spans
              structure and MEP, and the FIRST pick drives which classification
              grade the bid will be judged against. */}
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium mb-1.5">{t("crm_opp_scope")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {SCOPE_TYPES.map((scope) => {
                const index = scopeTypes.indexOf(scope)
                const selected = index !== -1
                return (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => toggleScope(scope)}
                    aria-pressed={selected}
                    disabled={isSaving}
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      selected ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {t(`crm_scope_${scope}`)}
                    {index === 0 && <span className="ms-1" aria-hidden="true">★</span>}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">{t("crm_opp_scope_hint")}</p>
          </fieldset>

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
            {derivedActivity && (
              <p className="text-[11px] text-muted-foreground">
                {t("crm_opp_activity_derived", { activity: t(`crm_activity_class_${derivedActivity}`) })}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="opp-route">{t("crm_opp_route")}</Label>
              <Select value={route || "__none__"} onValueChange={(v) => setRoute(v === "__none__" ? "" : (v as TenderRoute))} disabled={isSaving}>
                <SelectTrigger id="opp-route"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("crm_not_specified")}</SelectItem>
                  {TENDER_ROUTES.map((r) => (
                    <SelectItem key={r} value={r}>{t(`crm_route_${r}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-kind">{t("crm_opp_contract_kind")}</Label>
              <Select value={contractKind || "__none__"} onValueChange={(v) => setContractKind(v === "__none__" ? "" : (v as ContractKind))} disabled={isSaving}>
                <SelectTrigger id="opp-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("crm_not_specified")}</SelectItem>
                  {CONTRACT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>{t(`crm_contract_kind_${k}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-source">{t("crm_opp_source")}</Label>
              <Select value={source || "__none__"} onValueChange={(v) => setSource(v === "__none__" ? "" : (v as OpportunitySource))} disabled={isSaving}>
                <SelectTrigger id="opp-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("crm_not_specified")}</SelectItem>
                  {OPPORTUNITY_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`crm_opp_source_${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-consultant">{t("crm_opp_consultant")}</Label>
              <Select
                value={consultantContactId || "__none__"}
                onValueChange={(v) => setConsultantContactId(v === "__none__" ? "" : v)}
                disabled={isSaving}
              >
                <SelectTrigger id="opp-consultant"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="__none__">{t("crm_not_specified")}</SelectItem>
                  {contacts
                    .filter((c) => c.id !== contactId)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium mb-1.5">{t("crm_opp_probability")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {PROBABILITY_STEPS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProbability(p)}
                  aria-pressed={probability === p}
                  disabled={isSaving}
                  dir="ltr"
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    probability === p ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted"
                  )}
                >
                  {p}%
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{t("crm_opp_probability_hint")}</p>
          </fieldset>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              {/* The same field means three different things — bid deadline,
                  offer validity, contract expiry — so it is labelled by track. */}
              <Label htmlFor="opp-date">{t(trackDateLabelKey(track))}</Label>
              <input id="opp-date" type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} dir="ltr" disabled={isSaving} className={DATE_INPUT_CLASS} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-owner">{t("crm_owner")}</Label>
              <Select value={ownerId || "__none__"} onValueChange={(v) => setOwnerId(v === "__none__" ? "" : v)} disabled={isSaving}>
                <SelectTrigger id="opp-owner"><SelectValue placeholder={t("crm_owner_placeholder")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("crm_owner_none")}</SelectItem>
                  {teamMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opp-notes">{t("crm_notes")}</Label>
            <Textarea id="opp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={isSaving} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>{t("crm_cancel")}</Button>
            <Button type="submit" disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 size={15} className="animate-spin" /> : null}
              {t("crm_save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
