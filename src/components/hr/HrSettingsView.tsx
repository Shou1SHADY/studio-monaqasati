"use client"

// Settings (PRD ST-01…06, WF-26): the business type (which sets the default
// features once), the six optional features (off hides their tab, decisions
// and sections; data kept) with each one's default for the type and a reset
// to them, the company's policies (editable, every change logged), the
// statutory values (read-only — the law, not a choice), and the establishment
// file with its Saudization band — the band entered by hand from Qiwa, the
// Saudi ratio and the safety margin computed from the record (ST-04).

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { BookLock, Building2, History, Loader2, RotateCcw, Save, ShieldCheck, SlidersHorizontal, ToggleRight, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrPeople } from "@/hooks/useHrPeople"
import { usePermissions } from "@/hooks/usePermissions"
import { pmPct } from "@/lib/pm/format"
import { publicHolidays } from "@/lib/hr/holidays"
import { HR_GUARD, HR_ROLES } from "@/lib/hr/access"
import type { HrEmployee } from "@/lib/hr/employee"
import { BUSINESS_TYPES, defaultFeatures, differsFromDefaults, HR_FEATURES, HR_PLATFORMS, isGreenBand, NITAQAT_BANDS, nitaqatOf, withBusinessType, withDefaultFeatures, type BusinessType, type Establishment, type HrSettings, type NitaqatBand } from "@/lib/hr/settings"
import { hrDate, todayDay } from "@/lib/hr/format"
import { saveHrSettings } from "@/lib/hr/settings-writes"
import { STATUTORY, type HrPolicies } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"

/** Features whose screens arrive in a later release — their switch is kept, and says so. */
const LATER: ReadonlySet<string> = new Set<string>([])

/** ST-04 — «ملف المنشأة»: the band (by hand, from Qiwa), the Saudi ratio from the record, the green threshold, and
 * the safety margin; the registrations and the visas with their as-of day. Settings and government relations' Today. */
export function NitaqatPanel({ access, employees, compact = false }: { access: HrAccess; employees: HrEmployee[]; compact?: boolean }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const est = access.settings.establishment
  const n = nitaqatOf(employees, est)
  const dash = "—"
  return (
    <Panel title={t("settings.nitaqat")} icon={ShieldCheck}>
      <p className="mb-2 text-xs text-muted-foreground">{t("settings.nitaqat_note")}</p>
      <KeyValueRow
        label={t("settings.est.band")}
        value={est.band ? <StatusPill tone={isGreenBand(est.band) ? "ok" : "warn"}>{`${t(`settings.band.${est.band}`)}${est.bandAsOf ? ` · ${hrDate(est.bandAsOf, locale)}` : ""}`}</StatusPill> : dash}
      />
      <KeyValueRow label={t("settings.saudi_ratio")} value={t("settings.saudi_ratio_v", { pct: n.pct, sa: n.saudis, total: n.total })} />
      <KeyValueRow label={t("settings.est.minPct")} value={n.min != null ? `${n.min}%` : dash} ltr />
      <KeyValueRow
        label={t("settings.margin")}
        value={n.short == null ? t("settings.margin_unknown") : n.short > 0 ? <StatusPill tone="bad">{t("settings.margin_short", { n: n.short })}</StatusPill> : <StatusPill tone="ok">{t("settings.margin_spare", { n: n.spare ?? 0 })}</StatusPill>}
      />
      {!compact && <KeyValueRow label={t("settings.registrations")} value={[est.cr, est.mol, est.gosi, est.mudad].map((x) => x || dash).join(" · ")} ltr />}
      <KeyValueRow label={t("settings.est.visas")} value={est.visas != null ? t("settings.visas_v", { n: est.visas, date: hrDate(est.visasAsOf, locale) }) : dash} />
    </Panel>
  )
}

export function HrSettingsView({ access }: { access: HrAccess }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile } = usePermissions()
  const { toast } = useToast()
  const year = Number(todayDay().slice(0, 4))
  const canEdit = access.allowed("settings.manage")
  const { employees } = useHrPeople(access)
  const [draft, setDraft] = useState<HrSettings>(access.settings)
  const [busy, setBusy] = useState(false)
  const stored = JSON.stringify(access.settings)
  // Reset the form only when the stored settings actually change (the object is re-created every render).
  useEffect(() => setDraft(access.settings), [stored])
  const dirty = JSON.stringify(draft) !== stored

  const setPolicy = <K extends keyof HrPolicies>(k: K, v: HrPolicies[K]) => setDraft((d) => ({ ...d, policies: { ...d.policies, [k]: v } }))
  const setEst = <K extends keyof Establishment>(k: K, v: Establishment[K]) => setDraft((d) => ({ ...d, establishment: { ...d.establishment, [k]: v } }))
  const pct = (f: number) => String(Math.round(f * 10000) / 100)
  const off = !canEdit || busy
  const defaults = new Set(defaultFeatures(draft.businessType))

  const save = async () => {
    if (!firestore || !access.orgId || !canEdit) return
    setBusy(true)
    try {
      await saveHrSettings(firestore, access.ctx, access.orgId, draft, { name: (profile?.name as string) || user?.displayName || null })
      toast({ title: t("settings.saved") })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? `err.${err.code}` : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const textField = (k: "name" | "nameEn" | "cr" | "mol" | "gosi" | "mudad") => (
    <div key={k} className="space-y-1.5">
      <Label htmlFor={`hr-est-${k}`}>{t(`settings.est.${k}`)}</Label>
      <Input id={`hr-est-${k}`} dir={k === "name" ? "auto" : "ltr"} value={draft.establishment[k] ?? ""} onChange={(e) => setEst(k, e.target.value)} disabled={off} />
    </div>
  )

  const S = STATUTORY
  const log = [...(access.settings.log ?? [])].reverse()
  const logValue = (field: string, v: string | number | boolean | null) => {
    if (v == null || v === "") return "—"
    if (typeof v === "boolean") return t(v ? "settings.log_on" : "settings.log_off")
    if (field === "policies.housingShare" || field === "policies.transportShare" || field === "policies.offerBandLow" || field === "policies.offerBandHigh" || field === "policies.recordWeight") return `${pct(Number(v))}%`
    if (/^policies\.raise[ABCD]$/.test(field)) return `${v}%`
    if (field === "businessType") return t(`business_type.${v}` as "business_type.contractor")
    if (field === "establishment.band") return t(`settings.band.${v}` as "settings.band.red")
    if (field === "policies.closeMissing" || field === "policies.jobApprove" || field === "policies.offerBand") return t(`policy.${v}` as "policy.block")
    return String(v)
  }
  const logField = (field: string) => {
    const [head, key] = field.split(".")
    if (head === "features") return t(`feature.${key}` as "feature.hire")
    if (head === "platforms") return t(`pf.name.${key}` as "pf.name.qiwa")
    if (head === "policies") return t(`policy.${key}` as "policy.payDay")
    if (head === "establishment") return t(`settings.est.${key}` as "settings.est.name")
    return t("settings.business_type")
  }

  return (
    <div className="space-y-6">
      <Panel title={t("settings.establishment")} icon={Building2}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="hr-type">{t("settings.business_type")}</Label>
            <Select value={draft.businessType ?? ""} onValueChange={(v) => setDraft((d) => withBusinessType(d, v as BusinessType))} disabled={off}>
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
          {(["name", "nameEn", "cr", "mol", "gosi", "mudad"] as const).map(textField)}
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
                setDraft((d) => ({ ...d, establishment: { ...d.establishment, visas: v, visasAsOf: v == null ? null : d.establishment.visasAsOf || todayDay() } }))
              }}
              disabled={off}
            />
            <p className="text-[11px] text-muted-foreground">{t("settings.est.visas_note")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hr-est-visas-asof">{t("settings.est.visasAsOf")}</Label>
            <Input id="hr-est-visas-asof" type="date" dir="ltr" value={draft.establishment.visasAsOf ?? ""} onChange={(e) => setEst("visasAsOf", e.target.value || null)} disabled={off || draft.establishment.visas == null} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hr-est-band">{t("settings.est.band")}</Label>
            <Select value={draft.establishment.band ?? ""} onValueChange={(v) => setDraft((d) => ({ ...d, establishment: { ...d.establishment, band: v as NitaqatBand, bandAsOf: d.establishment.bandAsOf || todayDay() } }))} disabled={off}>
              <SelectTrigger id="hr-est-band">
                <SelectValue placeholder={t("settings.pick_band")} />
              </SelectTrigger>
              <SelectContent>
                {NITAQAT_BANDS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {t(`settings.band.${b}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hr-est-bandasof">{t("settings.est.bandAsOf")}</Label>
            <Input id="hr-est-bandasof" type="date" dir="ltr" value={draft.establishment.bandAsOf ?? ""} onChange={(e) => setEst("bandAsOf", e.target.value || null)} disabled={off || !draft.establishment.band} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hr-est-minpct">{t("settings.est.minPct")}</Label>
            <Input
              id="hr-est-minpct"
              type="number"
              min="0"
              max="100"
              step="any"
              dir="ltr"
              value={draft.establishment.minPct ?? ""}
              onChange={(e) => setEst("minPct", e.target.value === "" ? null : Math.min(100, Math.max(0, Number(e.target.value))))}
              disabled={off}
            />
            <p className="text-[11px] text-muted-foreground">{t("settings.est.minPct_note")}</p>
          </div>
        </div>
      </Panel>

      <NitaqatPanel access={access} employees={employees} />

      <Panel
        title={t("settings.features")}
        icon={ToggleRight}
        actions={
          canEdit && differsFromDefaults(draft) ? (
            <Button size="sm" variant="outline" onClick={() => setDraft((d) => withDefaultFeatures(d))} disabled={busy}>
              <RotateCcw size={14} className="me-1.5" aria-hidden="true" />
              {t("settings.reset_defaults")}
            </Button>
          ) : undefined
        }
      >
        <p className="mb-1 text-xs text-muted-foreground">{t("settings.features_note")}</p>
        {draft.businessType && <p className="mb-3 text-xs text-muted-foreground">{t(`settings.why.${draft.businessType}`)}</p>}
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
                  {draft.businessType ? ` · ${t(defaults.has(f) ? "settings.default_on" : "settings.default_off")}` : ""}
                </p>
              </div>
              <Switch
                id={`hr-f-${f}`}
                checked={draft.features.includes(f)}
                onCheckedChange={(on) => setDraft((d) => ({ ...d, features: on ? [...d.features, f] : d.features.filter((x) => x !== f) }))}
                disabled={off}
              />
            </li>
          ))}
        </ul>
        {/* GV-03 — the platforms the company follows, with the `gov` feature (HRDF off by default). */}
        {draft.features.includes("gov") && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-bold">{t("settings.platforms")}</p>
            <p className="text-[11px] text-muted-foreground">{t("settings.platforms_note")}</p>
            <ul className="divide-y rounded-xl border">
              {HR_PLATFORMS.map((pf) => (
                <li key={pf} className="flex items-start justify-between gap-4 px-3 py-2.5">
                  <div className="min-w-0">
                    <Label htmlFor={`hr-pf-${pf}`} className="text-sm font-bold">
                      {t(`pf.name.${pf}`)}
                    </Label>
                    <p className="text-[11px] text-muted-foreground">{t(`pf.out.${pf}`)}</p>
                  </div>
                  <Switch
                    id={`hr-pf-${pf}`}
                    checked={draft.platforms?.[pf] ?? pf !== "hrdf"}
                    onCheckedChange={(on) => setDraft((d) => ({ ...d, platforms: { ...(d.platforms ?? {}), [pf]: on } }))}
                    disabled={off}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <Panel title={t("settings.policies")} icon={SlidersHorizontal}>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["housingShare", "transportShare"] as const).map((k) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`hr-p-${k}`}>{t(`policy.${k}`)}</Label>
              <Input id={`hr-p-${k}`} type="number" min="0" max="100" step="any" dir="ltr" value={pct(draft.policies[k])} onChange={(e) => setPolicy(k, Number(e.target.value) / 100)} disabled={off} />
            </div>
          ))}
          {(["payDay", "renewWindowDays"] as const).map((k) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`hr-p-${k}`}>{t(`policy.${k}`)}</Label>
              <Input id={`hr-p-${k}`} type="number" min="1" step="1" dir="ltr" value={String(draft.policies[k])} onChange={(e) => setPolicy(k, Number(e.target.value))} disabled={off} />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="hr-p-advanceMaxMonths">{t("policy.advanceMaxMonths")}</Label>
            {/* Half a month is a limit too (the prototype's step 0.5). */}
            <Input id="hr-p-advanceMaxMonths" type="number" min="0.5" max="12" step="0.5" dir="ltr" value={String(draft.policies.advanceMaxMonths)} onChange={(e) => setPolicy("advanceMaxMonths", Number(e.target.value))} disabled={off} />
            <p className="text-[11px] text-muted-foreground">{t("policy.advanceMaxMonths_note")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hr-p-close">{t("policy.closeMissing")}</Label>
            <Select value={draft.policies.closeMissing} onValueChange={(v) => setPolicy("closeMissing", v as HrPolicies["closeMissing"])} disabled={off}>
              <SelectTrigger id="hr-p-close">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="block">{t("policy.block")}</SelectItem>
                <SelectItem value="warn">{t("policy.warn")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-xl border px-3 py-2.5">
            <div className="min-w-0">
              <Label htmlFor="hr-p-ajeer" className="text-sm font-bold">
                {t("policy.ajeerAllowed")}
              </Label>
              <p className="text-[11px] text-muted-foreground">{t("policy.ajeerAllowed_note")}</p>
            </div>
            <Switch id="hr-p-ajeer" checked={draft.policies.ajeerAllowed} onCheckedChange={(on) => setPolicy("ajeerAllowed", on)} disabled={off} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hr-p-ajeerFactor">{t("policy.ajeerFactor")}</Label>
            <Input id="hr-p-ajeerFactor" type="number" min="1" max="5" step="0.1" dir="ltr" value={String(draft.policies.ajeerFactor)} onChange={(e) => setPolicy("ajeerFactor", Number(e.target.value))} disabled={off || !draft.policies.ajeerAllowed} />
          </div>
          {/* Hiring (optional: hire) — the offer band and the two block-or-warning switches (ST-03, HI-01/05). */}
          {draft.features.includes("hire") && (
            <>
              {(["offerBandLow", "offerBandHigh"] as const).map((k) => (
                <div key={k} className="space-y-1.5">
                  <Label htmlFor={`hr-p-${k}`}>{t(`policy.${k}`)}</Label>
                  <Input id={`hr-p-${k}`} type="number" min={k === "offerBandLow" ? 50 : 100} max={k === "offerBandLow" ? 100 : 200} step="5" dir="ltr" value={pct(draft.policies[k])} onChange={(e) => setPolicy(k, Number(e.target.value) / 100)} disabled={off} />
                </div>
              ))}
              {(["jobApprove", "offerBand"] as const).map((k) => (
                <div key={k} className="space-y-1.5">
                  <Label htmlFor={`hr-p-${k}`}>{t(`policy.${k}`)}</Label>
                  <Select value={draft.policies[k]} onValueChange={(v) => setPolicy(k, v as HrPolicies["jobApprove"])} disabled={off}>
                    <SelectTrigger id={`hr-p-${k}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="block">{t(`policy.${k}_block`)}</SelectItem>
                      <SelectItem value="warn">{t(`policy.${k}_warn`)}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </>
          )}
        </div>
        {draft.features.includes("perf") && (
          // PF-04 / PF-06 — the review's record weight and the raise by band: company policies, logged like any other.
          <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hr-p-recordWeight">{t("policy.recordWeight")}</Label>
              <Input id="hr-p-recordWeight" type="number" min="0" max="50" step="5" dir="ltr" value={pct(draft.policies.recordWeight)} onChange={(e) => setPolicy("recordWeight", Number(e.target.value) / 100)} disabled={off} />
              <p className="text-[11px] text-muted-foreground">{t("policy.recordWeight_note", { m: 100 - Math.round(draft.policies.recordWeight * 100), w: Math.round(draft.policies.recordWeight * 100) })}</p>
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">{t("policy.raise")}</legend>
              <div className="grid grid-cols-4 gap-2">
                {(["raiseA", "raiseB", "raiseC", "raiseD"] as const).map((k) => (
                  <div key={k} className="space-y-1">
                    <Label htmlFor={`hr-p-${k}`} className="text-[11px] text-muted-foreground">
                      {t(`perf.band.${k.slice(-1)}` as "perf.band.A")}
                    </Label>
                    <Input id={`hr-p-${k}`} type="number" min="0" max="25" step="0.5" dir="ltr" value={String(draft.policies[k])} onChange={(e) => setPolicy(k, Number(e.target.value))} disabled={off} />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{t("policy.raise_note")}</p>
            </fieldset>
          </div>
        )}
        {draft.features.includes("train") && <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">{t("policy.certs_note")}</p>}
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

      <Panel title={t("settings.log")} icon={History} count={log.length || undefined} bodyClassName="p-0">
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("settings.log_note")}</p>
        {log.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">{t("settings.log_none")}</p>
        ) : (
          <ul className="divide-y">
            {log.slice(0, 20).map((x, i) => (
              <li key={`${x.at}-${x.field}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold">{logField(x.field)}</span>
                  <span className="text-muted-foreground" dir="auto">
                    {" "}
                    {t("settings.log_change", { from: logValue(x.field, x.from), to: logValue(x.field, x.to) })}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground" dir="auto">
                  {t("settings.log_by", { name: x.byName || "—", date: hrDate(x.at, locale) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t("settings.roles")} icon={UsersRound}>
        <p className="mb-2 text-xs text-muted-foreground">{t("settings.roles_note")}</p>
        <ul className="divide-y rounded-xl border">
          {HR_ROLES.map((r) => (
            <li key={r} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block font-semibold">{t(`settings.role.${r}`)}</span>
                <span className="block text-[11px] text-muted-foreground">{t(`settings.role_desc.${r}`)}</span>
              </span>
              <StatusPill tone={(HR_GUARD["pay.view"].roles as readonly string[]).includes(r) ? "module" : "mute"}>{t((HR_GUARD["pay.view"].roles as readonly string[]).includes(r) ? "settings.sees_pay" : "settings.no_pay")}</StatusPill>
            </li>
          ))}
          <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block font-semibold">{t("settings.role.employee")}</span>
              <span className="block text-[11px] text-muted-foreground">{t("settings.role_desc.employee")}</span>
            </span>
            <StatusPill tone="mute">{t("settings.own_pay")}</StatusPill>
          </li>
        </ul>
      </Panel>

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
          <KeyValueRow label={t("law.hours")} value={t("law.hours_v", { normal: S.normalHours, ramadan: S.ramadanHours })} />
          <KeyValueRow label={t("law.week")} value={t("law.week_v", { hours: S.normalHours * 6 })} />
          <KeyValueRow label={t("law.iqama")} value={t("law.iqama_v", { days: S.iqamaIssueDays })} />
        </div>
        <div className="mt-3 border-t pt-3">
          <p className="mb-1 text-xs font-bold text-muted-foreground">{t("law.holidays", { year })}</p>
          {publicHolidays(year).map((h) => (
            <KeyValueRow key={h.key} label={t(`holiday.${h.key}`)} value={h.days > 1 ? t("law.holiday_days", { date: hrDate(h.from, locale), n: h.days }) : hrDate(h.from, locale)} />
          ))}
        </div>
      </Panel>
    </div>
  )
}
