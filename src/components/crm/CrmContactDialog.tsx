"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { useLocale } from "next-intl"
import { collection, doc, addDoc, updateDoc, serverTimestamp } from "firebase/firestore"
import { Contact as ContactIcon, Plus, Trash2, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { PhoneInput } from "@/components/shared/PhoneInput"
import type { TeamMember } from "@/hooks/useCrmData"
import { renameContactReferences } from "@/lib/crm-writes"
import { cn } from "@/lib/utils"
import {
  CONTACT_TIERS,
  CONTACT_TYPES,
  CRM_CONTACTS,
  ENTITY_TYPES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  PARTY_ROLES,
  PARTY_TYPES,
  contactPeople,
  partyRoles,
  type ContactPerson,
  type ContactTier,
  type ContactType,
  type CrmContact,
  type EntityType,
  type LeadSource,
  type LeadStatus,
  type PartyRole,
  type PartyType,
} from "@/lib/crm"
import { CrmFieldGroup, CrmFormDialog, RequiredMark, type CrmFormStep } from "@/components/crm/CrmFormDialog"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NONE = "__none__"

/**
 * Create or edit a party.
 *
 * Three steps, because the form covers three separable jobs: identifying the
 * organization, recording the humans inside it, and describing how they behave
 * commercially. Only the first is required — the rest can be filled in as the
 * relationship develops, which is how these records actually get built.
 */
export function CrmContactDialog({
  open,
  onOpenChange,
  contact,
  orgId,
  teamMembers,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact?: CrmContact
  orgId: string
  teamMembers: TeamMember[]
  onSaved?: (contactId: string) => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()

  const [isSaving, setIsSaving] = useState(false)
  const [name, setName] = useState("")
  const [type, setType] = useState<ContactType>("client")
  const [entityType, setEntityType] = useState<EntityType>("company")
  const [company, setCompany] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<LeadStatus>("new")
  const [source, setSource] = useState<LeadSource>("other")
  const [ownerId, setOwnerId] = useState("")
  const [notes, setNotes] = useState("")
  const [emailError, setEmailError] = useState(false)
  const [city, setCity] = useState("")
  const [crNumber, setCrNumber] = useState("")
  const [tier, setTier] = useState<ContactTier>("B")
  const [satisfaction, setSatisfaction] = useState("")
  const [paymentDays, setPaymentDays] = useState("")
  const [overdueAmount, setOverdueAmount] = useState("")
  const [partyType, setPartyType] = useState<PartyType | "">("")
  const [roles, setRoles] = useState<PartyRole[]>(["client"])
  const [people, setPeople] = useState<ContactPerson[]>([])

  // Re-seed from `contact` every time the dialog opens. Without this the
  // "add" dialog — which stays mounted between openings — would still be
  // holding the values typed into it last time.
  useEffect(() => {
    if (!open) return
    setName(contact?.name ?? "")
    setType(contact?.type ?? "client")
    setEntityType(contact?.entityType ?? "company")
    setCompany(contact?.company ?? "")
    setPhone(contact?.phone ?? "")
    setEmail(contact?.email ?? "")
    setStatus(contact?.status ?? "new")
    setSource(contact?.source ?? "other")
    setOwnerId(contact?.ownerId ?? "")
    setNotes(contact?.notes ?? "")
    setEmailError(false)
    setCity(contact?.city ?? "")
    setCrNumber(contact?.crNumber ?? "")
    setTier(contact?.tier ?? "B")
    setSatisfaction(typeof contact?.satisfaction === "number" ? String(contact.satisfaction) : "")
    setPaymentDays(typeof contact?.paymentDays === "number" ? String(contact.paymentDays) : "")
    setOverdueAmount(typeof contact?.overdueAmount === "number" ? String(contact.overdueAmount) : "")
    setPartyType(contact?.partyType ?? "")
    setRoles(contact ? partyRoles(contact) : ["client"])
    setPeople(contact ? contactPeople(contact) : [])
  }, [open, contact])

  const toggleRole = (role: PartyRole) =>
    setRoles((prev) => {
      // A party with no role at all reads as "client" downstream anyway, so
      // refuse to clear the last one rather than store a misleading empty set.
      if (prev.includes(role)) return prev.length === 1 ? prev : prev.filter((r) => r !== role)
      return [...prev, role]
    })

  const addPerson = () => setPeople((prev) => [...prev, { name: "", title: "", phone: "", email: "" }])
  const updatePerson = (index: number, patch: Partial<ContactPerson>) =>
    setPeople((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  const removePerson = (index: number) => setPeople((prev) => prev.filter((_, i) => i !== index))

  /** Blank stays blank — an unmeasured signal must not be stored as a zero,
   * which `contactHealth` would read as "worst possible score". */
  const optionalNumber = (raw: string, max?: number): number | null => {
    const n = parseFloat(raw)
    if (!Number.isFinite(n)) return null
    return max === undefined ? Math.max(0, n) : Math.max(0, Math.min(max, n))
  }

  const handleSave = async () => {
    if (!firestore || isSaving) return
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()

    setIsSaving(true)
    try {
      const owner = teamMembers.find((m) => m.id === ownerId)
      const data = {
        name: trimmedName,
        type,
        entityType,
        company: company.trim() || null,
        phone: phone || null,
        email: trimmedEmail || null,
        status,
        source,
        ownerId: owner?.id || null,
        ownerName: owner?.name || null,
        notes: notes.trim() || null,
        city: city.trim() || null,
        crNumber: crNumber.trim() || null,
        tier,
        satisfaction: optionalNumber(satisfaction, 100),
        paymentDays: optionalNumber(paymentDays),
        overdueAmount: optionalNumber(overdueAmount),
        partyType: partyType || null,
        roles,
        // Half-typed rows are dropped rather than saved: a person with no name
        // is not a contact, and Firestore rejects `undefined` in an array.
        people: people
          .filter((p) => p.name.trim())
          .map((p) => ({
            name: p.name.trim(),
            title: p.title?.trim() || null,
            phone: p.phone?.trim() || null,
            email: p.email?.trim() || null,
          })),
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }

      if (contact) {
        await updateDoc(doc(firestore, CRM_CONTACTS, contact.id), data)
        // `contactName` is denormalised onto opportunities, quotations and
        // activities so the org-wide lists render in one query — a rename has
        // to reach them.
        if (contact.name !== trimmedName) {
          await renameContactReferences(firestore, contact.id, orgId, trimmedName)
        }
        toast({ title: t("crm_updated") })
        onSaved?.(contact.id)
      } else {
        const created = await addDoc(collection(firestore, CRM_CONTACTS), { ...data, createdAt: serverTimestamp() })
        toast({ title: t("crm_created") })
        onSaved?.(created.id)
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
      id: "identity",
      title: t("crm_contact_step_identity"),
      validate: () => (name.trim() ? null : t("crm_validation_error")),
      content: (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="crm-name">
              {t("crm_name")} <RequiredMark />
            </Label>
            <Input
              id="crm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("crm_name_placeholder")}
              disabled={isSaving}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="crm-type">{t("crm_type")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as ContactType)} disabled={isSaving}>
                <SelectTrigger id="crm-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map((ct) => (
                    <SelectItem key={ct} value={ct}>{t(`crm_type_${ct}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crm-party-type">{t("crm_party_type")}</Label>
              <Select
                value={partyType || NONE}
                onValueChange={(v) => setPartyType(v === NONE ? "" : (v as PartyType))}
                disabled={isSaving}
              >
                <SelectTrigger id="crm-party-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("crm_not_specified")}</SelectItem>
                  {PARTY_TYPES.map((pt) => (
                    <SelectItem key={pt} value={pt}>{t(`crm_party_type_${pt}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crm-entity">{t("crm_entity_type")}</Label>
              <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)} disabled={isSaving}>
                <SelectTrigger id="crm-entity"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((et) => (
                    <SelectItem key={et} value={et}>{t(`crm_entity_${et}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crm-city">{t("crm_city")}</Label>
              <Input id="crm-city" value={city} onChange={(e) => setCity(e.target.value)} disabled={isSaving} />
            </div>
          </div>

          {/* Roles are multi-valued: the same company is routinely a client on
              one job and the main contractor we subcontract for on another. */}
          <CrmFieldGroup label={t("crm_party_roles")}>
            <div className="flex flex-wrap gap-1.5">
              {PARTY_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  aria-pressed={roles.includes(role)}
                  disabled={isSaving}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    roles.includes(role) ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted"
                  )}
                >
                  {t(`crm_party_role_${role}`)}
                </button>
              ))}
            </div>
          </CrmFieldGroup>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="crm-company">{t("crm_company")}</Label>
              <Input id="crm-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t("crm_company_placeholder")} disabled={isSaving} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crm-cr">{t("crm_cr_number")}</Label>
              <Input id="crm-cr" value={crNumber} onChange={(e) => setCrNumber(e.target.value)} dir="ltr" disabled={isSaving} />
            </div>
          </div>
        </>
      ),
    },
    {
      id: "people",
      title: t("crm_contact_step_people"),
      validate: () => {
        const trimmed = email.trim()
        if (trimmed && !EMAIL_RE.test(trimmed)) {
          setEmailError(true)
          return t("crm_email_invalid")
        }
        const badPerson = people.find((p) => p.name.trim() && p.email?.trim() && !EMAIL_RE.test(p.email.trim()))
        return badPerson ? t("crm_email_invalid") : null
      },
      content: (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="crm-phone">{t("crm_phone")}</Label>
              <PhoneInput id="crm-phone" value={phone} onChange={setPhone} disabled={isSaving} locale={locale} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crm-email">{t("crm_email")}</Label>
              <Input
                id="crm-email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(false) }}
                onBlur={(e) => setEmailError(!!e.target.value.trim() && !EMAIL_RE.test(e.target.value.trim()))}
                placeholder={t("crm_email_placeholder")}
                dir="ltr"
                disabled={isSaving}
                aria-invalid={emailError}
                aria-describedby={emailError ? "crm-email-error" : undefined}
              />
              {emailError && (
                <p id="crm-email-error" className="text-xs text-destructive">{t("crm_email_invalid")}</p>
              )}
            </div>
          </div>

          {/* Parties are organizations; work happens with named individuals,
              and "who do I call" is the question this record exists to answer. */}
          <CrmFieldGroup label={t("crm_people_section")} hint={people.length === 0 ? t("crm_people_empty") : undefined}>
            <div className="space-y-2">
              {people.map((person, index) => (
                <div key={index} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="grid place-items-center h-6 w-6 shrink-0 rounded-full bg-primary/10 text-[11px] font-bold text-primary" dir="ltr">
                      {index + 1}
                    </span>
                    <Input
                      value={person.name}
                      onChange={(e) => updatePerson(index, { name: e.target.value })}
                      placeholder={t("crm_person_name")}
                      aria-label={t("crm_person_name")}
                      disabled={isSaving}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removePerson(index)}
                      disabled={isSaving}
                      aria-label={`${t("crm_person_remove")} — ${person.name || index + 1}`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input
                      value={person.title ?? ""}
                      onChange={(e) => updatePerson(index, { title: e.target.value })}
                      placeholder={t("crm_person_title")}
                      aria-label={t("crm_person_title")}
                      disabled={isSaving}
                    />
                    <Input
                      value={person.phone ?? ""}
                      onChange={(e) => updatePerson(index, { phone: e.target.value })}
                      placeholder={t("crm_person_phone")}
                      aria-label={t("crm_person_phone")}
                      dir="ltr"
                      disabled={isSaving}
                    />
                    <Input
                      value={person.email ?? ""}
                      onChange={(e) => updatePerson(index, { email: e.target.value })}
                      placeholder={t("crm_person_email")}
                      aria-label={t("crm_person_email")}
                      dir="ltr"
                      disabled={isSaving}
                    />
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="gap-1.5 w-full" onClick={addPerson} disabled={isSaving}>
                <UserPlus size={14} />
                {t("crm_person_add")}
              </Button>
            </div>
          </CrmFieldGroup>
        </>
      ),
    },
    {
      id: "commercial",
      title: t("crm_contact_step_commercial"),
      content: (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="crm-status">{t("crm_status")}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus)} disabled={isSaving}>
                <SelectTrigger id="crm-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`crm_status_${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crm-source">{t("crm_source")}</Label>
              <Select value={source} onValueChange={(v) => setSource(v as LeadSource)} disabled={isSaving}>
                <SelectTrigger id="crm-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`crm_source_${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crm-tier">{t("crm_tier")}</Label>
              <Select value={tier} onValueChange={(v) => setTier(v as ContactTier)} disabled={isSaving}>
                <SelectTrigger id="crm-tier"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTACT_TIERS.map((tr) => (
                    <SelectItem key={tr} value={tr}>{t(`crm_tier_${tr}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crm-owner">{t("crm_owner")}</Label>
              <Select value={ownerId || NONE} onValueChange={(v) => setOwnerId(v === NONE ? "" : v)} disabled={isSaving}>
                <SelectTrigger id="crm-owner"><SelectValue placeholder={t("crm_owner_placeholder")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("crm_owner_none")}</SelectItem>
                  {teamMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* These feed the relationship-health score, which treats a blank as
              "unmeasured" rather than assuming the worst. */}
          <CrmFieldGroup label={t("crm_health_inputs")} hint={t("crm_health_inputs_hint")}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="crm-satisfaction" className="text-xs">{t("crm_satisfaction")}</Label>
                <Input id="crm-satisfaction" type="number" min="0" max="100" inputMode="numeric" value={satisfaction} onChange={(e) => setSatisfaction(e.target.value)} dir="ltr" disabled={isSaving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="crm-payment-days" className="text-xs">{t("crm_payment_days")}</Label>
                <Input id="crm-payment-days" type="number" min="0" inputMode="numeric" value={paymentDays} onChange={(e) => setPaymentDays(e.target.value)} dir="ltr" disabled={isSaving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="crm-overdue" className="text-xs">{t("crm_overdue_amount")}</Label>
                <Input id="crm-overdue" type="number" min="0" step="any" inputMode="decimal" value={overdueAmount} onChange={(e) => setOverdueAmount(e.target.value)} dir="ltr" disabled={isSaving} />
              </div>
            </div>
          </CrmFieldGroup>

          <div className="space-y-1.5">
            <Label htmlFor="crm-notes">{t("crm_notes")}</Label>
            <Textarea id="crm-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("crm_notes_placeholder")} disabled={isSaving} rows={3} />
          </div>
        </>
      ),
    },
  ]

  return (
    <CrmFormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={contact ? ContactIcon : Plus}
      title={contact ? t("crm_edit_title") : t("crm_add_title")}
      description={t("crm_dialog_desc")}
      steps={steps}
      isSaving={isSaving}
      submitLabel={t("crm_save")}
      onSubmit={() => void handleSave()}
      size="lg"
    />
  )
}
