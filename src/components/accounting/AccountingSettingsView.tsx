"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarRange, Eye, Loader2, Lock, Power, Save, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useAccounting } from "@/hooks/useAccounting"
import { cn } from "@/lib/utils"
import { MONEY_SCALES, formatMoney, type MoneyScale } from "@/lib/accounting/display"
import {
  MONTH_NAMES_AR,
  MONTH_NAMES_EN,
  fiscalPeriodOptions,
  fiscalYearLabel,
  fiscalYearOf,
  isoToday,
} from "@/lib/accounting/periods"
import { saveAccountingSettings, type AccountingSettings } from "@/lib/accounting/settings"
import { toIsoTimestamp } from "@/lib/accounting/analytics"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { AccountingSection, AccountingShell } from "./AccountingShell"
import { periodLabel, periodRangeText } from "./AccountingToolbar"

/**
 * Accounting system settings (إعدادات النظام المحاسبي): whether the module
 * records at all, when the company's financial year opens — which is what Q1,
 * H1 and the annual statements mean on every screen — and how figures are shown
 * by default. Editing is the period-close right: these choices change what
 * every signed statement covers.
 */
export function AccountingSettingsView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canEdit = can("accounting.close")
  const data = useAccounting()

  const [draft, setDraft] = useState<AccountingSettings>(data.settings)
  const [saving, setSaving] = useState(false)
  const settingsKey = `${data.settings.enabled}-${data.settings.fiscalYearStartMonth}-${data.settings.displayScale}`
  useEffect(() => {
    setDraft(data.settings)
    // Reset the form only when the stored settings actually change (the
    // settings object is re-created on every snapshot).
  }, [settingsKey])

  const dirty =
    draft.enabled !== data.settings.enabled ||
    draft.fiscalYearStartMonth !== data.settings.fiscalYearStartMonth ||
    draft.displayScale !== data.settings.displayScale

  const today = isoToday()
  const previewYear = fiscalYearOf(today, draft.fiscalYearStartMonth)
  const preview = useMemo(
    () => fiscalPeriodOptions({ fiscalYear: previewYear, startMonth: draft.fiscalYearStartMonth, today }).filter((p) => p.kind === "year" || p.kind === "half" || p.kind === "quarter"),
    [previewYear, draft.fiscalYearStartMonth, today]
  )
  const months = locale === "ar" ? MONTH_NAMES_AR : MONTH_NAMES_EN
  const updatedAt = toIsoTimestamp(data.settingsDoc?.updatedAt)

  const save = async () => {
    if (!firestore || !canEdit || saving) return
    setSaving(true)
    try {
      await saveAccountingSettings(firestore, {
        existingDocId: data.settingsDoc?.id ?? null,
        organizationId: data.organizationId,
        settings: draft,
        actor: { id: data.userId, name: data.userName },
      })
      toast({ title: t("acc_settings_saved") })
    } catch (err) {
      console.error(err)
      toast({ title: t("acc_save_error"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <AccountingShell
      portal={portal}
      title={t("acc_nav_settings")}
      description={t("acc_settings_desc")}
      icon={Settings2}
      action={
        canEdit && (
          <Button className="gap-2" onClick={save} disabled={!dirty || saving || !data.organizationId}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {t("acc_settings_save")}
          </Button>
        )
      }
    >
      {!canEdit && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock size={12} aria-hidden="true" />
          {t("acc_settings_read_only")}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AccountingSection title={t("acc_settings_module_title")} icon={Power}>
          <div className="flex items-start justify-between gap-4 p-5">
            <div className="min-w-0">
              <Label htmlFor="acc-enabled" className="text-sm font-bold">{t("acc_settings_enabled")}</Label>
              <p className="mt-1 text-xs text-muted-foreground">{t("acc_settings_enabled_hint")}</p>
            </div>
            <Switch id="acc-enabled" checked={draft.enabled} onCheckedChange={(v) => setDraft((d) => ({ ...d, enabled: v }))} disabled={!canEdit} />
          </div>
        </AccountingSection>

        <AccountingSection title={t("acc_settings_display_title")} icon={Eye}>
          <div className="space-y-2 p-5">
            <Label className="text-sm font-bold">{t("acc_settings_default_scale")}</Label>
            <div role="radiogroup" aria-label={t("acc_settings_default_scale")} className="grid grid-cols-3 gap-1.5">
              {MONEY_SCALES.map((s: MoneyScale) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={draft.displayScale === s}
                  disabled={!canEdit}
                  onClick={() => setDraft((d) => ({ ...d, displayScale: s }))}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                    draft.displayScale === s ? "border-primary bg-primary/5 font-bold text-primary" : "hover:bg-muted/40"
                  )}
                >
                  <span className="block">{t(`acc_scale_${s}`)}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground tabular-nums" dir="ltr">{formatMoney(1_234_567.89, s)}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{t("acc_settings_default_scale_hint")}</p>
          </div>
        </AccountingSection>

        <AccountingSection title={t("acc_settings_fiscal_title")} icon={CalendarRange} className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-[18rem_1fr]">
            <div className="space-y-2">
              <Label htmlFor="acc-fy-start" className="text-sm font-bold">{t("acc_settings_fy_start")}</Label>
              <Select
                value={String(draft.fiscalYearStartMonth)}
                onValueChange={(v) => setDraft((d) => ({ ...d, fiscalYearStartMonth: Number(v) }))}
                disabled={!canEdit}
              >
                <SelectTrigger id="acc-fy-start"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {months.map((name, i) => (
                    <SelectItem key={i} value={String(i + 1)}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{t("acc_settings_fy_start_hint")}</p>
            </div>
            <div>
              <p className="mb-2 text-xs font-bold text-muted-foreground">
                {t("acc_settings_fy_preview", { year: fiscalYearLabel(previewYear, draft.fiscalYearStartMonth) })}
              </p>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-xs">
                  <tbody>
                    {preview.map((p) => (
                      <tr key={p.key} className={cn("border-t first:border-t-0", p.kind === "year" && "bg-primary/5 font-bold")}>
                        <td className="px-3 py-2">{periodLabel(p, locale)}</td>
                        <td className="px-3 py-2 text-end tabular-nums text-muted-foreground" dir="ltr">{periodRangeText(p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </AccountingSection>
      </div>

      {data.settingsDoc?.updatedByUserName && (
        <p className="text-[11px] text-muted-foreground">
          {t("acc_settings_last_updated", {
            name: data.settingsDoc.updatedByUserName,
            date: updatedAt ? updatedAt.slice(0, 10) : "—",
          })}
        </p>
      )}
    </AccountingShell>
  )
}
