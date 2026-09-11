"use client"

// Manufacturing settings — the departments' capacity (the number a foreman
// understands: workers × hours), the feature switches with the honest price of
// turning each off, and Finance's policies the workshop computes WITH but does
// not own.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, Users, ToggleRight, Landmark } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { MfgData } from "@/hooks/useMfgData"
import { deptCapacity, type MfgSettings } from "@/lib/manufacturing-engine"
import { saveMfgSettings } from "@/lib/manufacturing-writes"
import { updateDepartmentCapacity } from "./MfgProductsView"

export function MfgSettingsView({ data }: { data: MfgData }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Record<string, { workers: string; hoursPerDay: string; hourlyRate: string }>>({})
  const [policies, setPolicies] = useState({
    overhead: String(data.settings.overheadRatePerHour),
    margin: String(data.settings.minMarginPercent),
    scrapLimit: String(data.settings.scrapApprovalLimit),
    window: String(data.settings.answerWindowHours),
  })

  const persist = async (settings: MfgSettings, doneMsg: string) => {
    if (!firestore || busy) return
    setBusy(true)
    try {
      await saveMfgSettings(firestore, data.orgId, settings)
      toast({ title: doneMsg })
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const toggleFeature = (key: keyof MfgSettings["features"]) =>
    persist(
      { ...data.settings, features: { ...data.settings.features, [key]: !data.settings.features[key] } },
      data.settings.features[key] ? t("mfg2_feature_off_toast") : t("mfg2_feature_on_toast")
    )

  const features: Array<{ key: keyof MfgSettings["features"]; title: string; on: string; offCost: string }> = [
    { key: "time", title: t("mfg2_feat_time"), on: t("mfg2_feat_time_on"), offCost: t("mfg2_feat_time_cost") },
    { key: "estimates", title: t("mfg2_feat_estimates"), on: t("mfg2_feat_estimates_on"), offCost: t("mfg2_feat_estimates_cost") },
    { key: "checklists", title: t("mfg2_feat_checklists"), on: t("mfg2_feat_checklists_on"), offCost: t("mfg2_feat_checklists_cost") },
  ]

  return (
    <div className="space-y-4" dir={locale === "ar" ? "rtl" : "ltr"}>
      {/* Departments & capacity */}
      <section className="rounded-xl border bg-white overflow-hidden">
        <header className="px-4 py-3 border-b bg-muted/20">
          <h2 className="text-sm font-black flex items-center gap-2">
            <Users size={14} /> {t("mfg2_set_capacity_title")}
          </h2>
          <p className="text-[11px] text-muted-foreground">{t("mfg2_set_capacity_hint")}</p>
        </header>
        {data.departments.length === 0 && <p className="px-4 py-4 text-xs text-muted-foreground">{t("mfg_no_departments")}</p>}
        {data.departments.map((d) => {
          const row = draft[d.id] || {
            workers: String(d.workers ?? 1),
            hoursPerDay: String(d.hoursPerDay ?? 8),
            hourlyRate: d.hourlyRate == null ? "" : String(d.hourlyRate),
          }
          const dirty = !!draft[d.id]
          return (
            <div key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b last:border-b-0 text-xs">
              <span className="font-semibold min-w-[140px]">{d.name}</span>
              <label className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{t("mfg2_set_workers")}</span>
                <Input type="number" min="1" className="h-7 w-16 text-xs" value={row.workers} onChange={(e) => setDraft((m) => ({ ...m, [d.id]: { ...row, workers: e.target.value } }))} />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{t("mfg2_set_hours")}</span>
                <Input type="number" min="1" max="24" className="h-7 w-16 text-xs" value={row.hoursPerDay} onChange={(e) => setDraft((m) => ({ ...m, [d.id]: { ...row, hoursPerDay: e.target.value } }))} />
              </label>
              {data.seesMoney && (
                <label className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{t("mfg2_set_rate")}</span>
                  <Input type="number" min="0" className="h-7 w-20 text-xs" value={row.hourlyRate} placeholder={t("mfg2_empty_means_unknown")} onChange={(e) => setDraft((m) => ({ ...m, [d.id]: { ...row, hourlyRate: e.target.value } }))} />
                </label>
              )}
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={!!d.onSite}
                  onCheckedChange={async (v) => {
                    await updateDepartmentCapacity(firestore, d.id, { onSite: !!v })
                    toast({ title: t("mfg2_set_saved_toast") })
                  }}
                />
                <span className="text-muted-foreground">{t("mfg2_on_site")}</span>
              </label>
              <span className="ms-auto flex items-center gap-2">
                <Badge variant="outline" className="tabular-nums text-[10px]">
                  {t("mfg2_set_capacity_value", { hours: deptCapacity({ workers: Number(row.workers) || 1, hoursPerDay: Number(row.hoursPerDay) || 8 }) })}
                </Badge>
                {dirty && (
                  <Button
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={async () => {
                      await updateDepartmentCapacity(firestore, d.id, {
                        workers: Number(row.workers) || 1,
                        hoursPerDay: Number(row.hoursPerDay) || 8,
                        hourlyRate: row.hourlyRate === "" ? null : Number(row.hourlyRate),
                      })
                      setDraft((m) => {
                        const { [d.id]: _gone, ...rest } = m
                        return rest
                      })
                      toast({ title: t("mfg2_set_saved_toast") })
                    }}
                  >
                    {t("mfg2_save")}
                  </Button>
                )}
              </span>
            </div>
          )
        })}
        <p className="px-4 py-2.5 text-[11px] text-muted-foreground bg-muted/10">{t("mfg2_set_departments_note")}</p>
      </section>

      {/* Feature switches */}
      <section className="rounded-xl border bg-white overflow-hidden">
        <header className="px-4 py-3 border-b bg-muted/20">
          <h2 className="text-sm font-black flex items-center gap-2">
            <ToggleRight size={14} /> {t("mfg2_set_features_title")}
          </h2>
          <p className="text-[11px] text-muted-foreground">{t("mfg2_set_features_hint")}</p>
        </header>
        {features.map((f) => (
          <div key={f.key} className="flex items-start gap-3 px-4 py-3 border-b last:border-b-0">
            <Switch checked={data.settings.features[f.key]} disabled={busy || !data.canManage} onCheckedChange={() => toggleFeature(f.key)} />
            <div className="text-xs flex-1">
              <p className="font-bold">{f.title}</p>
              <p className={cn("mt-0.5", data.settings.features[f.key] ? "text-muted-foreground" : "text-amber-700")}>
                {data.settings.features[f.key] ? f.on : f.offCost}
              </p>
            </div>
            <Badge className={cn("border-none", data.settings.features[f.key] ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
              {data.settings.features[f.key] ? t("mfg2_feature_on") : t("mfg2_feature_off")}
            </Badge>
          </div>
        ))}
        <p className="px-4 py-2.5 text-[11px] text-muted-foreground bg-muted/10">{t("mfg2_set_features_note")}</p>
      </section>

      {/* Finance policies */}
      <section className="rounded-xl border bg-white overflow-hidden">
        <header className="px-4 py-3 border-b bg-muted/20">
          <h2 className="text-sm font-black flex items-center gap-2">
            <Landmark size={14} /> {t("mfg2_set_policies_title")}
          </h2>
          <p className="text-[11px] text-muted-foreground">{t("mfg2_set_policies_hint")}</p>
        </header>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 px-4 py-3 text-xs">
          {[
            { key: "overhead" as const, label: t("mfg2_set_overhead"), hint: t("mfg2_set_overhead_hint") },
            { key: "margin" as const, label: t("mfg2_set_margin"), hint: t("mfg2_set_margin_hint") },
            { key: "scrapLimit" as const, label: t("mfg2_set_scrap_limit"), hint: t("mfg2_set_scrap_limit_hint") },
            { key: "window" as const, label: t("mfg2_set_window"), hint: t("mfg2_set_window_hint") },
          ].map((p) => (
            <div key={p.key} className="space-y-1">
              <p className="font-bold">{p.label}</p>
              <Input
                type="number"
                min="0"
                className="h-8 text-xs"
                value={policies[p.key]}
                disabled={!data.canManage}
                onChange={(e) => setPolicies((m) => ({ ...m, [p.key]: e.target.value }))}
              />
              <p className="text-[10px] text-muted-foreground">{p.hint}</p>
            </div>
          ))}
        </div>
        {data.canManage && (
          <div className="px-4 pb-3 flex justify-end">
            <Button
              size="sm"
              disabled={busy}
              className="gap-1.5"
              onClick={() =>
                persist(
                  {
                    ...data.settings,
                    overheadRatePerHour: Number(policies.overhead) || 0,
                    minMarginPercent: Number(policies.margin) || 0,
                    scrapApprovalLimit: Number(policies.scrapLimit) || 0,
                    answerWindowHours: Number(policies.window) || 24,
                  },
                  t("mfg2_set_saved_toast")
                )
              }
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              {t("mfg2_save_policies")}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
