"use client"

// Settings (PRD ST-01…06, WF-26): the business type (which sets the default
// features once), the six optional features (off hides their tab, decisions
// and sections; data kept), the company's policies (editable), the statutory
// values (read-only — the law, not a choice), and the establishment file.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { BookLock, Building2, Loader2, Save, SlidersHorizontal, ToggleRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { pmPct } from "@/lib/pm/format"
import { BUSINESS_TYPES, HR_FEATURES, withBusinessType, type BusinessType, type HrSettings } from "@/lib/hr/settings"
import { saveHrSettings } from "@/lib/hr/settings-writes"
import { STATUTORY, type HrPolicies } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"

/** Features whose screens arrive in a later release — their switch is kept, and says so. */
const LATER: ReadonlySet<string> = new Set(["hire", "perf", "train", "punch", "gov"])

export function HrSettingsView({ access }: { access: HrAccess }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { toast } = useToast()
  const canEdit = access.allowed("settings.manage")
  const [draft, setDraft] = useState<HrSettings>(access.settings)
  const [busy, setBusy] = useState(false)
  const stored = JSON.stringify(access.settings)
  // Reset the form only when the stored settings actually change (the object is re-created every render).
  useEffect(() => setDraft(access.settings), [stored])
  const dirty = JSON.stringify(draft) !== stored

  const setPolicy = <K extends keyof HrPolicies>(k: K, v: HrPolicies[K]) => setDraft((d) => ({ ...d, policies: { ...d.policies, [k]: v } }))
  const pct = (f: number) => String(Math.round(f * 10000) / 100)

  const save = async () => {
    if (!firestore || !access.orgId || !canEdit) return
    setBusy(true)
    try {
      await saveHrSettings(firestore, access.ctx, access.orgId, draft)
      toast({ title: t("settings.saved") })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? `err.${err.code}` : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const S = STATUTORY
  return (
    <div className="space-y-6">
      <Panel title={t("settings.establishment")} icon={Building2}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="hr-type">{t("settings.business_type")}</Label>
            <Select value={draft.businessType ?? ""} onValueChange={(v) => setDraft((d) => withBusinessType(d, v as BusinessType))} disabled={!canEdit || busy}>
              <SelectTrigger id="hr-type">
                <SelectValue placeholder={t("settings.pick_type")} />
              </SelectTrigger>
              <SelectContent>
                {BUSINESS_TYPES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {t(`business_type.${b}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{t("settings.type_note")}</p>
          </div>
          {(["name", "cr", "mol", "gosi"] as const).map((k) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`hr-est-${k}`}>{t(`settings.est.${k}`)}</Label>
              <Input
                id={`hr-est-${k}`}
                dir={k === "name" ? "auto" : "ltr"}
                value={draft.establishment[k] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, establishment: { ...d.establishment, [k]: e.target.value } }))}
                disabled={!canEdit || busy}
              />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="hr-est-visas">{t("settings.est.visas")}</Label>
            <Input
              id="hr-est-visas"
              type="number"
              min="0"
              step="1"
              dir="ltr"
              value={draft.establishment.visas ?? ""}
              onChange={(e) => {
                const v = e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value)))
                // A new count is as of today unless the manager says otherwise.
                setDraft((d) => ({ ...d, establishment: { ...d.establishment, visas: v, visasAsOf: v == null ? null : d.establishment.visasAsOf || new Date().toISOString().slice(0, 10) } }))
              }}
              disabled={!canEdit || busy}
            />
            <p className="text-[11px] text-muted-foreground">{t("settings.est.visas_note")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hr-est-visas-asof">{t("settings.est.visasAsOf")}</Label>
            <Input
              id="hr-est-visas-asof"
              type="date"
              dir="ltr"
              value={draft.establishment.visasAsOf ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, establishment: { ...d.establishment, visasAsOf: e.target.value || null } }))}
              disabled={!canEdit || busy || draft.establishment.visas == null}
            />
          </div>
        </div>
      </Panel>

      <Panel title={t("settings.features")} icon={ToggleRight}>
        <p className="mb-3 text-xs text-muted-foreground">{t("settings.features_note")}</p>
        <ul className="divide-y rounded-xl border">
          {HR_FEATURES.map((f) => (
            <li key={f} className="flex items-start justify-between gap-4 px-3 py-2.5">
              <div className="min-w-0">
                <Label htmlFor={`hr-f-${f}`} className="text-sm font-bold">
                  {t(`feature.${f}`)}
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  {t(`feature_desc.${f}`)}
                  {LATER.has(f) ? ` · ${t("settings.later_release")}` : ""}
                </p>
              </div>
              <Switch
                id={`hr-f-${f}`}
                checked={draft.features.includes(f)}
                onCheckedChange={(on) => setDraft((d) => ({ ...d, features: on ? [...d.features, f] : d.features.filter((x) => x !== f) }))}
                disabled={!canEdit || busy}
              />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={t("settings.policies")} icon={SlidersHorizontal}>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["housingShare", "transportShare"] as const).map((k) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`hr-p-${k}`}>{t(`policy.${k}`)}</Label>
              <Input id={`hr-p-${k}`} type="number" min="0" max="100" step="any" dir="ltr" value={pct(draft.policies[k])} onChange={(e) => setPolicy(k, Number(e.target.value) / 100)} disabled={!canEdit || busy} />
            </div>
          ))}
          {(["payDay", "renewWindowDays", "advanceMaxMonths"] as const).map((k) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`hr-p-${k}`}>{t(`policy.${k}`)}</Label>
              <Input id={`hr-p-${k}`} type="number" min="1" step="1" dir="ltr" value={String(draft.policies[k])} onChange={(e) => setPolicy(k, Number(e.target.value))} disabled={!canEdit || busy} />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="hr-p-close">{t("policy.closeMissing")}</Label>
            <Select value={draft.policies.closeMissing} onValueChange={(v) => setPolicy("closeMissing", v as HrPolicies["closeMissing"])} disabled={!canEdit || busy}>
              <SelectTrigger id="hr-p-close">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="block">{t("policy.block")}</SelectItem>
                <SelectItem value="warn">{t("policy.warn")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Panel>

      {canEdit && (
        <div className="sticky bottom-0 z-10 flex items-center justify-end gap-3 rounded-xl border bg-card/95 p-3 backdrop-blur">
          {dirty && <span className="text-xs text-muted-foreground">{t("settings.unsaved")}</span>}
          <Button onClick={() => void save()} disabled={!dirty || busy}>
            {busy ? <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" /> : <Save size={16} className="me-1.5" aria-hidden="true" />}
            {t("save")}
          </Button>
        </div>
      )}

      <Panel title={t("settings.statutory")} icon={BookLock}>
        <p className="mb-3 text-xs text-muted-foreground">{t("settings.statutory_note")}</p>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <KeyValueRow label={t("law.overtime")} value={t("law.overtime_v", { share: pmPct(S.overtimeBasicShare), div: S.overtimeDivisor, cap: S.overtimeMonthlyCapHours })} />
          <KeyValueRow label={t("law.gosi_old")} value={`${pmPct(S.gosi.saudiOld.employee)} / ${pmPct(S.gosi.saudiOld.employer)}`} ltr />
          <KeyValueRow label={t("law.gosi_new")} value={`${pmPct(S.gosi.saudiNew.employee)} / ${pmPct(S.gosi.saudiNew.employer)}`} ltr />
          <KeyValueRow label={t("law.gosi_non")} value={pmPct(S.gosi.nonSaudi.employer)} ltr />
          <KeyValueRow label={t("law.leave")} value={t("law.leave_v", { base: S.leave.base, after: S.leave.afterFive })} />
          <KeyValueRow label={t("law.sick")} value={t("law.sick_v", { full: S.sick.full, q: S.sick.threeQuarters, u: S.sick.unpaid })} />
          <KeyValueRow label={t("law.probation")} value={t("law.probation_v", { days: S.probation.days, max: S.probation.maxDays })} />
          <KeyValueRow label={t("law.eos")} value={t("law.eos_v")} />
          <KeyValueRow label={t("law.advance")} value={t("law.advance_v", { share: pmPct(S.advance.instalmentShare) })} />
          <KeyValueRow label={t("law.penalty")} value={t("law.penalty_v", { cap: S.penalties.monthlyCapDays, days: S.penalties.objectionDays })} />
        </div>
      </Panel>
    </div>
  )
}
