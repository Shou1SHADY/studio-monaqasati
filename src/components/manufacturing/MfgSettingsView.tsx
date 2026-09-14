"use client"

// Manufacturing settings — the departments and their capacity (the number a
// foreman understands: workers × hours), what the org uses of the module with
// the honest price of turning each part off, Finance's policies the workshop
// computes WITH but does not own, and the read-only references: production
// lines, who may do what, and what reaches the books.

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, SlidersHorizontal, ToggleRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { MfgData } from "@/hooks/useMfgData"
import type { MfgSettings } from "@/lib/manufacturing-engine"
import { saveMfgSettings } from "@/lib/manufacturing-writes"
import { useMfgUi } from "./MfgUiContext"
import { MfgSetDepartments } from "./MfgSetDepartments"
import { MfgSetFinance, MfgSetLines, MfgSetPermissions } from "./MfgSetReference"
import { MfgChip, MfgNote, MfgPanel, MfgPill } from "./ui/MfgUi"

type FeatureKey = keyof MfgSettings["features"]
type PolicyKey = "overhead" | "margin" | "scrapLimit" | "window"

const policiesOf = (s: MfgSettings): Record<PolicyKey, string> => ({
  overhead: String(s.overheadRatePerHour),
  margin: String(s.minMarginPercent),
  scrapLimit: String(s.scrapApprovalLimit),
  window: String(s.answerWindowHours),
})

export function MfgSettingsView({ data }: { data: MfgData }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const { perms } = useMfgUi()
  const firestore = useFirestore()
  const { toast } = useToast()
  const canEdit = perms.canManage

  const [busy, setBusy] = useState<"features" | "policies" | null>(null)
  const [policies, setPolicies] = useState(() => policiesOf(data.settings))
  const [policiesDirty, setPoliciesDirty] = useState(false)
  const [policyError, setPolicyError] = useState<string | null>(null)

  // The settings doc arrives after the first render; follow it until the
  // manager starts typing.
  useEffect(() => {
    if (!policiesDirty) setPolicies(policiesOf(data.settings))
  }, [data.settings, policiesDirty])

  const persist = async (settings: MfgSettings, doneMsg: string, which: "features" | "policies"): Promise<boolean> => {
    if (!firestore || busy) return false
    setBusy(which)
    try {
      await saveMfgSettings(firestore, data.orgId, settings)
      toast({ title: doneMsg })
      return true
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
      return false
    } finally {
      setBusy(null)
    }
  }

  const toggleFeature = (key: FeatureKey) =>
    persist(
      { ...data.settings, features: { ...data.settings.features, [key]: !data.settings.features[key] } },
      data.settings.features[key] ? t("mfg2_feature_off_toast") : t("mfg2_feature_on_toast"),
      "features"
    )

  const savePolicies = async () => {
    const overhead = Number(policies.overhead)
    const margin = Number(policies.margin)
    const scrapLimit = Number(policies.scrapLimit)
    const answerWindow = Number(policies.window)
    if (!(overhead >= 0) || !(margin >= 0 && margin < 100) || !(scrapLimit >= 0) || !(answerWindow >= 1)) {
      setPolicyError(t("mfg3_set_err_policies"))
      return
    }
    setPolicyError(null)
    const ok = await persist(
      { ...data.settings, overheadRatePerHour: overhead, minMarginPercent: margin, scrapApprovalLimit: scrapLimit, answerWindowHours: answerWindow },
      t("mfg2_set_saved_toast"),
      "policies"
    )
    if (ok) setPoliciesDirty(false)
  }

  const features: Array<{ key: FeatureKey; title: string; on: string; offCost: string }> = [
    { key: "time", title: t("mfg2_feat_time"), on: t("mfg2_feat_time_on"), offCost: t("mfg2_feat_time_cost") },
    { key: "estimates", title: t("mfg2_feat_estimates"), on: t("mfg2_feat_estimates_on"), offCost: t("mfg2_feat_estimates_cost") },
    { key: "checklists", title: t("mfg2_feat_checklists"), on: t("mfg2_feat_checklists_on"), offCost: t("mfg2_feat_checklists_cost") },
  ]

  const policyFields: Array<{ key: PolicyKey; label: string; hint: string; owner: "finance" | "workshop"; unused?: boolean }> = [
    { key: "overhead", label: t("mfg2_set_overhead"), hint: t("mfg2_set_overhead_hint"), owner: "finance", unused: !data.settings.features.time },
    { key: "margin", label: t("mfg2_set_margin"), hint: t("mfg2_set_margin_hint"), owner: "finance" },
    { key: "scrapLimit", label: t("mfg2_set_scrap_limit"), hint: t("mfg2_set_scrap_limit_hint"), owner: "finance" },
    { key: "window", label: t("mfg2_set_window"), hint: t("mfg2_set_window_hint"), owner: "workshop" },
  ]

  return (
    <div className="space-y-4" dir={locale === "ar" ? "rtl" : "ltr"}>
      {!canEdit && <MfgNote tone="info">{t("mfg3_set_read_only")}</MfgNote>}

      <MfgSetDepartments />

      <MfgPanel icon={ToggleRight} title={t("mfg2_set_features_title")} subtitle={t("mfg2_set_features_hint")}>
        {features.map((f) => {
          const on = data.settings.features[f.key]
          const id = `mfg-feature-${f.key}`
          return (
            <div key={f.key} className="flex items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0">
              <Switch id={id} className="mt-0.5" checked={on} disabled={!!busy || !canEdit} onCheckedChange={() => toggleFeature(f.key)} />
              <div className="min-w-0 flex-1 text-xs">
                <label htmlFor={id} className={cn("block font-bold text-foreground", canEdit && "cursor-pointer")}>
                  {f.title}
                </label>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">{f.on}</p>
                {!on && (
                  <MfgNote tone="warn" className="mt-2">
                    {f.offCost}
                  </MfgNote>
                )}
              </div>
              <MfgPill tone={on ? "ok" : "muted"} dot>
                {on ? t("mfg2_feature_on") : t("mfg2_feature_off")}
              </MfgPill>
            </div>
          )
        })}
        <div className="border-t border-border/60 px-4 py-3">
          <MfgNote tone="info">{t("mfg2_set_features_note")}</MfgNote>
        </div>
      </MfgPanel>

      <MfgPanel icon={SlidersHorizontal} title={t("mfg3_set_policies_title")} subtitle={t("mfg2_set_policies_hint")}>
        <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
          {policyFields.map((p) => {
            const id = `mfg-policy-${p.key}`
            return (
              <div key={p.key} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <label htmlFor={id} className="text-xs font-bold text-slate-700">
                    {p.label}
                  </label>
                  <MfgChip tone={p.owner === "finance" ? "info" : "mfg"}>
                    {p.owner === "finance" ? t("mfg3_set_owner_finance") : t("mfg3_set_owner_workshop")}
                  </MfgChip>
                </div>
                <Input
                  id={id}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  className="h-9 text-xs"
                  value={policies[p.key]}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setPolicies((m) => ({ ...m, [p.key]: e.target.value }))
                    setPoliciesDirty(true)
                  }}
                />
                <p className="text-[11px] text-muted-foreground">{p.hint}</p>
                {p.unused && <p className="text-[11px] font-semibold text-warning">{t("mfg3_set_overhead_unused")}</p>}
              </div>
            )
          })}
        </div>
        <div className="flex flex-col gap-3 border-t border-border/60 px-4 py-3 sm:flex-row sm:items-center">
          <MfgNote tone="info" className="flex-1">
            {t("mfg3_set_policies_finance_note")}
          </MfgNote>
          {canEdit && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {policyError && <span className="text-[11px] font-semibold text-destructive">{policyError}</span>}
              <Button size="sm" disabled={!!busy || !policiesDirty} className="gap-1.5" onClick={savePolicies}>
                {busy === "policies" && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
                {t("mfg2_save_policies")}
              </Button>
            </div>
          )}
        </div>
      </MfgPanel>

      <MfgSetLines />
      <MfgSetPermissions />
      <MfgSetFinance />
    </div>
  )
}
