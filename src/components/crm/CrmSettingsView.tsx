"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc, serverTimestamp, setDoc } from "firebase/firestore"
import { AlertTriangle, Gauge, Loader2, Save, Settings, ShieldCheck, Tags } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Link } from "@/i18n/routing"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { useCrmOrgProfile } from "@/hooks/useCrmOrgProfile"
import { cn } from "@/lib/utils"
import {
  CLASSIFICATION_ACTIVITIES,
  CLASSIFICATION_GRADES,
  CRM_ORG_PROFILE,
  capacitySnapshot,
  formatSar,
  formatSarCompact,
  requiredGrade,
  type ClassificationActivity,
  type ClassificationGrade,
} from "@/lib/crm"
import {
  CrmListSkeleton,
  CrmMeter,
  CrmPanel,
  CrmRow,
  CrmShell,
  crmBasePath,
  type CrmPortal,
} from "@/components/crm/CrmShell"

const NOT_CLASSIFIED = "__none__"

/**
 * The company facts the pipeline is judged against: which classification
 * grades we hold, and how much work we can carry in a year.
 *
 * Both live in a CRM-owned document. They are entered by hand rather than
 * derived: an owner knows their certificates and their real capacity, and a
 * number they typed is one they will trust when the eligibility gate blocks a
 * bid — a number this module inferred is one they will argue with.
 */
export function CrmSettingsView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManage = can("crm.manage")
  const { orgId, profile, isLoading: profileLoading } = useCrmOrgProfile()
  const { opportunities, isLoading: dealsLoading } = useCrmData({ opportunities: true })
  const base = crmBasePath(portal)

  const [grades, setGrades] = useState<Partial<Record<ClassificationActivity, ClassificationGrade>>>({})
  const [ceiling, setCeiling] = useState("")
  const [underExecution, setUnderExecution] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setGrades(profile?.classifications ?? {})
    setCeiling(profile?.annualCeiling != null ? String(profile.annualCeiling) : "")
    setUnderExecution(profile?.underExecution != null ? String(profile.underExecution) : "")
  }, [profile])

  // Previewed against what is being typed, not what is saved — the point of
  // the panel is to see the consequence before committing to it.
  const draft = useMemo(
    () => ({
      id: orgId,
      organizationId: orgId,
      classifications: grades,
      annualCeiling: parseFloat(ceiling) || 0,
      underExecution: parseFloat(underExecution) || 0,
    }),
    [orgId, grades, ceiling, underExecution]
  )
  const capacity = useMemo(() => capacitySnapshot(opportunities, draft), [opportunities, draft])

  // Anything a user typed under "Other" that an admin has not yet folded into
  // the official scope list. Left unreviewed it becomes a private taxonomy.
  const customScopes = useMemo(
    () => opportunities.filter((o) => !!o.customScopeType),
    [opportunities]
  )

  const handleSave = async () => {
    if (!firestore || !orgId || isSaving) return
    setIsSaving(true)
    try {
      await setDoc(
        doc(firestore, CRM_ORG_PROFILE, orgId),
        {
          organizationId: orgId,
          classifications: grades,
          annualCeiling: parseFloat(ceiling) || null,
          underExecution: parseFloat(underExecution) || null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
      toast({ title: t("crm_settings_saved") })
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  if (profileLoading || dealsLoading) {
    return (
      <CrmShell portal={portal} icon={Settings} title={t("crm_settings_page_title")} description={t("crm_settings_page_desc")}>
        <CrmListSkeleton rows={5} />
      </CrmShell>
    )
  }

  return (
    <CrmShell
      portal={portal}
      icon={Settings}
      title={t("crm_settings_page_title")}
      description={t("crm_settings_page_desc")}
      action={
        canManage ? (
          <Button onClick={() => void handleSave()} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {t("crm_save")}
          </Button>
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CrmPanel icon={ShieldCheck} title={t("crm_settings_classification")} subtitle={t("crm_settings_classification_desc")}>
          <div className="p-4 space-y-3">
            {CLASSIFICATION_ACTIVITIES.map((activity) => (
              <div key={activity} className="flex items-center gap-3">
                <Label htmlFor={`grade-${activity}`} className="flex-1 min-w-0 text-sm font-semibold">
                  {t(`crm_activity_class_${activity}`)}
                </Label>
                <Select
                  value={grades[activity] != null ? String(grades[activity]) : NOT_CLASSIFIED}
                  onValueChange={(v) =>
                    setGrades((prev) => {
                      const next = { ...prev }
                      if (v === NOT_CLASSIFIED) delete next[activity]
                      else next[activity] = Number(v) as ClassificationGrade
                      return next
                    })
                  }
                  disabled={!canManage}
                >
                  <SelectTrigger id={`grade-${activity}`} className="w-[180px] shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_CLASSIFIED}>{t("crm_grade_none")}</SelectItem>
                    {CLASSIFICATION_GRADES.map((g) => (
                      <SelectItem key={g} value={String(g)}>{t("crm_grade_n", { grade: g })}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground pt-1">{t("crm_settings_grade_hint")}</p>
          </div>

          {/* The thresholds the eligibility gate applies, stated plainly so a
              blocked bid is never a mystery. */}
          <div className="border-t">
            <p className="px-4 pt-3 pb-1 text-[11px] font-bold text-muted-foreground">{t("crm_settings_thresholds")}</p>
            {[30_000_000, 15_000_000, 5_000_000, 1_000_000].map((value) => (
              <CrmRow key={value} label={t("crm_settings_threshold_row", { value: formatSarCompact(value, locale) })}>
                {t("crm_grade_n", { grade: requiredGrade(value) })}
              </CrmRow>
            ))}
          </div>
        </CrmPanel>

        <CrmPanel icon={Gauge} title={t("crm_settings_capacity")} subtitle={t("crm_settings_capacity_desc")}>
          <div className="p-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cap-ceiling">{t("crm_settings_ceiling")}</Label>
              <Input
                id="cap-ceiling"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={ceiling}
                onChange={(e) => setCeiling(e.target.value)}
                dir="ltr"
                disabled={!canManage}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cap-under">{t("crm_settings_under_execution")}</Label>
              <Input
                id="cap-under"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={underExecution}
                onChange={(e) => setUnderExecution(e.target.value)}
                dir="ltr"
                disabled={!canManage}
              />
              <p className="text-[11px] text-muted-foreground">{t("crm_settings_under_execution_hint")}</p>
            </div>
          </div>

          {capacity.configured ? (
            <div className="border-t">
              <div className="px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-foreground">{t("crm_capacity_used")}</span>
                  <span className="ms-auto font-black" dir="ltr">{capacity.usedPercent}%</span>
                </div>
                <CrmMeter
                  percent={capacity.usedPercent}
                  tone={capacity.usedPercent > 85 ? "destructive" : capacity.usedPercent > 65 ? "warning" : "success"}
                />
              </div>
              <CrmRow label={t("crm_dash_weighted")}>
                <span dir="ltr">{formatSar(capacity.weighted, locale)}</span>
              </CrmRow>
              <CrmRow label={t("crm_capacity_projected")}>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    capacity.projectedPercent > 100
                      ? "bg-destructive/10 text-destructive border-destructive/20"
                      : capacity.projectedPercent > 85
                        ? "bg-warning/10 text-warning border-warning/20"
                        : "bg-success/10 text-success border-success/20"
                  )}
                >
                  <span dir="ltr">{capacity.projectedPercent}%</span>
                </Badge>
              </CrmRow>
              {capacity.projectedPercent > 100 && (
                <p className="px-4 py-3 border-t flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <span>{t("crm_capacity_over")}</span>
                </p>
              )}
            </div>
          ) : (
            <p className="px-4 py-6 border-t text-sm text-muted-foreground text-center">{t("crm_capacity_unset")}</p>
          )}
        </CrmPanel>
      </div>

      <CrmPanel
        icon={Tags}
        title={t("crm_settings_custom_scopes")}
        subtitle={t("crm_settings_custom_scopes_desc")}
        action={
          customScopes.length > 0 ? (
            <span className="text-xs font-bold text-muted-foreground" dir="ltr">{customScopes.length}</span>
          ) : undefined
        }
      >
        {customScopes.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted-foreground text-center">{t("crm_settings_no_custom_scopes")}</p>
        ) : (
          <ul className="divide-y">
            {customScopes.map((opp) => (
              <li key={opp.id} className="px-4 py-3 flex items-center gap-3">
                <Badge variant="outline" className="shrink-0 text-[10px] bg-warning/10 text-warning border-warning/20">
                  {opp.customScopeType}
                </Badge>
                <span className="min-w-0 flex-1">
                  <Link
                    href={`${base}/opportunities/${opp.id}`}
                    className="block text-sm font-bold text-primary hover:underline truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  >
                    {opp.title}
                  </Link>
                  <span className="block text-[11px] text-muted-foreground truncate">{opp.contactName || "—"}</span>
                </span>
                {opp.customScopeActivity && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {t(`crm_activity_class_${opp.customScopeActivity}`)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CrmPanel>
    </CrmShell>
  )
}
