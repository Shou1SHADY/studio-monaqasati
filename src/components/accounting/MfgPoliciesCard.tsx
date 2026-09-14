"use client"

// Manufacturing policies (FN-01) — Finance owns them, the workshop reads them.
// The overhead rate costs every labour hour; the scrap limit decides which
// write-offs the workshop manager may approve alone; the windows and validity
// time requests, notes and cost statements; the remnant valuation credits
// returned offcuts. They are edited here, under the period-close right, and
// shown read-only in Manufacturing's settings with Finance as their source.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { Factory, Loader2, Lock, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { formatCrmDate } from "@/lib/crm"
import { MFG_SETTINGS, normalizeMfgSettings, type MfgSettings } from "@/lib/manufacturing-engine"
import { saveMfgPolicies, type MfgPolicies } from "@/lib/manufacturing-writes"
import { SignedInAs, mfgActError } from "@/components/shared/MfgHandoffBits"
import { AccountingSection } from "./AccountingShell"

type PolicyKey = keyof MfgPolicies

const FIELDS: Array<{ key: PolicyKey; unitKey: string; step: string; max?: number; integer?: boolean; zeroOk?: boolean }> = [
  { key: "overheadRatePerHour", unitKey: "mfy_pol_unit_sar_hour", step: "0.5", zeroOk: true },
  { key: "scrapApprovalLimit", unitKey: "mfy_pol_unit_sar", step: "100", zeroOk: true },
  { key: "answerWindowHours", unitKey: "mfy_pol_unit_hours", step: "1", integer: true },
  { key: "noteEscalationHours", unitKey: "mfy_pol_unit_hours", step: "1", integer: true },
  { key: "estimateValidityDays", unitKey: "mfy_pol_unit_days", step: "1", integer: true },
  { key: "remnantValuePercent", unitKey: "mfy_pol_unit_percent", step: "5", max: 100, zeroOk: true },
]

const LABEL: Record<PolicyKey, string> = {
  overheadRatePerHour: "mfy_pol_overhead",
  scrapApprovalLimit: "mfy_pol_scrap_limit",
  answerWindowHours: "mfy_pol_answer_window",
  noteEscalationHours: "mfy_pol_note_escalation",
  estimateValidityDays: "mfy_pol_validity",
  remnantValuePercent: "mfy_pol_remnant",
}

const pick = (s: MfgSettings): Record<PolicyKey, string> => ({
  overheadRatePerHour: String(s.overheadRatePerHour),
  scrapApprovalLimit: String(s.scrapApprovalLimit),
  answerWindowHours: String(s.answerWindowHours),
  noteEscalationHours: String(s.noteEscalationHours),
  estimateValidityDays: String(s.estimateValidityDays),
  remnantValuePercent: String(s.remnantValuePercent),
})

export function MfgPoliciesCard({
  organizationId,
  actor,
  canEdit,
}: {
  organizationId: string
  actor: { id: string; name: string }
  canEdit: boolean
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()

  const ref = useMemoFirebase(() => (firestore && organizationId ? doc(firestore, MFG_SETTINGS, organizationId) : null), [firestore, organizationId])
  const { data, isLoading } = useDoc(ref)
  const stored = useMemo(() => normalizeMfgSettings(data as Partial<MfgSettings> | null), [data])
  const meta = data as { policiesUpdatedBy?: string | null; policiesUpdatedAt?: string | null } | null

  const [draft, setDraft] = useState<Record<PolicyKey, string>>(() => pick(stored))
  const [errors, setErrors] = useState<Partial<Record<PolicyKey, string>>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const storedKey = FIELDS.map((f) => stored[f.key]).join("|")
  useEffect(() => {
    setDraft(pick(stored))
    setErrors({})
    // Reset only when the stored values change (the object is rebuilt per snapshot).
  }, [storedKey])

  const dirty = FIELDS.some((f) => draft[f.key].trim() !== String(stored[f.key]))

  const validate = (): MfgPolicies | null => {
    const next: Partial<Record<PolicyKey, string>> = {}
    const out = {} as MfgPolicies
    for (const f of FIELDS) {
      const raw = draft[f.key].trim()
      const n = Number(raw)
      if (!raw || !Number.isFinite(n) || n < 0 || (n === 0 && !f.zeroOk)) next[f.key] = t(f.zeroOk ? "mfy_pol_err_not_negative" : "mfy_pol_err_positive")
      else if (f.integer && !Number.isInteger(n)) next[f.key] = t("mfy_pol_err_whole")
      else if (f.max != null && n > f.max) next[f.key] = t("mfy_pol_err_max", { max: f.max })
      else out[f.key] = n
    }
    setErrors(next)
    return Object.keys(next).length ? null : out
  }

  const save = async () => {
    if (!firestore || !canEdit || saving || !organizationId) return
    setFormError(null)
    const policies = validate()
    if (!policies) return
    setSaving(true)
    try {
      await saveMfgPolicies(firestore, organizationId, policies, actor)
      toast({ title: t("mfy_pol_saved") })
    } catch (err) {
      console.error(err)
      setFormError(mfgActError(t, err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AccountingSection
      title={t("mfy_pol_title")}
      icon={Factory}
      action={
        canEdit ? (
          <Button size="sm" className="h-8 gap-1.5" onClick={save} disabled={!dirty || saving || isLoading || !organizationId}>
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
            {t("mfy_pol_save")}
          </Button>
        ) : (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock size={11} aria-hidden="true" />
            {t("mfy_pol_read_only")}
          </span>
        )
      }
    >
      <div className="space-y-4 p-5">
        <p className="text-xs text-muted-foreground">{t("mfy_pol_desc")}</p>
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
          {FIELDS.map((f) => {
            const id = `mfg-pol-${f.key}`
            return (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={id} className="text-sm font-bold">{t(LABEL[f.key])}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={id}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step={f.step}
                    max={f.max}
                    dir="ltr"
                    className="h-10 w-32 tabular-nums"
                    value={draft[f.key]}
                    disabled={!canEdit || saving}
                    aria-invalid={!!errors[f.key]}
                    aria-describedby={`${id}-hint`}
                    onChange={(e) => {
                      const v = e.target.value
                      setDraft((d) => ({ ...d, [f.key]: v }))
                      setErrors((er) => ({ ...er, [f.key]: undefined }))
                    }}
                  />
                  <span className="text-xs text-muted-foreground">{t(f.unitKey)}</span>
                </div>
                <p id={`${id}-hint`} className={errors[f.key] ? "text-[11px] font-semibold text-destructive" : "text-[11px] text-muted-foreground"}>
                  {errors[f.key] || t(`${LABEL[f.key]}_hint`)}
                </p>
              </div>
            )
          })}
        </div>
        {canEdit && dirty && <SignedInAs name={actor.name} />}
        {formError && <p className="text-xs font-semibold text-destructive" role="alert">{formError}</p>}
        {meta?.policiesUpdatedBy && (
          <p className="text-[11px] text-muted-foreground">
            {t("mfy_pol_last_updated", { name: meta.policiesUpdatedBy, date: meta.policiesUpdatedAt ? formatCrmDate(meta.policiesUpdatedAt, locale) : "—" })}
          </p>
        )}
      </div>
    </AccountingSection>
  )
}
