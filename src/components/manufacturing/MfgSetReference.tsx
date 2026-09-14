"use client"

// The rest of Settings: what the organisation uses of the module (switches,
// each with what disappears when it is off and what that costs — ST-02),
// Finance's and Governance's policies read with their source (FN-01), the
// module's boundaries with every other Mdmak module and the naming conflicts
// Governance must settle (BD-04, BD-05), and the read-only permissions matrix
// of the five manufacturing roles, whose last row is empty on purpose (ST-03).

import { useState, type ElementType } from "react"
import { useTranslations } from "next-intl"
import {
  AlertTriangle,
  Check,
  Contact,
  FileText,
  FolderKanban,
  Landmark,
  Lock,
  Scale,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  ToggleRight,
  Users,
  Warehouse,
  Workflow,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { MfgSettings, Persona } from "@/lib/manufacturing-engine"
import { saveMfgFeatures } from "@/lib/manufacturing-writes"
import { cn } from "@/lib/utils"
import { useMfgUi } from "./MfgUiContext"
import { reqErrorText } from "./MfgReqBits"
import { MfgChip, MfgNote, MfgPanel, MfgPill, fmtMoney, type MfgTone } from "./ui/MfgUi"

// ---------------------------------------------------------------------------
// Any Mdmak module on a chip
// ---------------------------------------------------------------------------

export type MdmakModule = "sales" | "procurement" | "projects" | "inventory" | "finance" | "hr" | "crm" | "governance"

const MODULES: Record<MdmakModule, { icon: ElementType; tone: MfgTone }> = {
  sales: { icon: FileText, tone: "warn" },
  procurement: { icon: ShoppingCart, tone: "muted" },
  projects: { icon: FolderKanban, tone: "info" },
  inventory: { icon: Warehouse, tone: "accent" },
  finance: { icon: Landmark, tone: "ok" },
  hr: { icon: Users, tone: "muted" },
  crm: { icon: Contact, tone: "info" },
  governance: { icon: Settings2, tone: "muted" },
}

export function MfgAnyModuleChip({ module, prefix = "none" }: { module: MdmakModule; prefix?: "in" | "from" | "none" }) {
  const t = useTranslations("Portal.Shared")
  const name = t(`mfg4_module_${module}`)
  const text = prefix === "in" ? t("mfg4_in_module", { module: name }) : prefix === "from" ? t("mfg4_from_module", { module: name }) : name
  return (
    <MfgChip tone={MODULES[module].tone} icon={MODULES[module].icon}>
      {text}
    </MfgChip>
  )
}

// ---------------------------------------------------------------------------
// What you use (ST-02)
// ---------------------------------------------------------------------------

type FeatureKey = keyof MfgSettings["features"]
const FEATURES: FeatureKey[] = ["time", "estimates", "checklists"]

export function MfgSetFeatures() {
  const t = useTranslations("Portal.Shared")
  const { data, perms } = useMfgUi()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [saving, setSaving] = useState<FeatureKey | null>(null)
  const canEdit = perms.canManage

  const toggle = async (k: FeatureKey, on: boolean) => {
    if (!firestore || !canEdit || saving) return
    setSaving(k)
    try {
      await saveMfgFeatures(firestore, data.orgId, { ...data.settings.features, [k]: on }, data.actor)
      toast({ title: t(on ? "mfr_set_feature_on_toast" : "mfr_set_feature_off_toast", { name: t(`mfr_set_feat_${k}`) }) })
    } catch (err) {
      console.error(err)
      toast({ title: reqErrorText(t, err), variant: "destructive" })
    } finally {
      setSaving(null)
    }
  }

  return (
    <MfgPanel icon={ToggleRight} title={t("mfr_set_features_title")} subtitle={t("mfr_set_features_sub")}>
      {FEATURES.map((k) => {
        const on = data.settings.features[k]
        const id = `mfr-feature-${k}`
        return (
          <div key={k} className="flex items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0">
            <Switch id={id} checked={on} disabled={!canEdit || saving === k} onCheckedChange={(v) => toggle(k, v)} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <label htmlFor={id} className="block text-xs font-bold text-foreground">
                {t(`mfr_set_feat_${k}`)}
              </label>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{t(on ? `mfr_set_feat_${k}_on` : `mfr_set_feat_${k}_off`)}</p>
              {!on && <p className="mt-1 text-[11px] font-semibold leading-relaxed text-warning">{t(`mfr_set_feat_${k}_price`)}</p>}
            </div>
            <MfgPill tone={on ? "ok" : "muted"}>{on ? t("mfr_set_on") : t("mfr_set_off")}</MfgPill>
          </div>
        )
      })}
      {!canEdit && (
        <div className="border-t border-border/60 px-4 py-2.5">
          <MfgNote tone="info" icon={Lock}>
            {t("mfr_set_manager_edits")}
          </MfgNote>
        </div>
      )}
    </MfgPanel>
  )
}

// ---------------------------------------------------------------------------
// Policies — read, not edited here (FN-01)
// ---------------------------------------------------------------------------

export function MfgSetPolicies() {
  const t = useTranslations("Portal.Shared")
  const { data, seesMoney } = useMfgUi()
  const s = data.settings
  const rows: Array<{ key: string; label: string; value: string; source: MdmakModule | null }> = [
    { key: "overhead", label: t("mfr_set_pol_overhead"), value: t("mfr_set_pol_overhead_value", { rate: fmtMoney(s.overheadRatePerHour) }), source: "finance" },
    { key: "scrap", label: t("mfr_set_pol_scrap"), value: t("mfr_set_pol_scrap_value", { limit: fmtMoney(s.scrapApprovalLimit) }), source: "finance" },
    { key: "valuation", label: t("mfr_set_pol_valuation"), value: t("mfr_set_pol_valuation_value"), source: "finance" },
    { key: "window", label: t("mfr_set_pol_window"), value: t("mfr_set_pol_hours", { hours: s.answerWindowHours }), source: "governance" },
    { key: "escalation", label: t("mfr_set_pol_escalation"), value: t("mfr_set_pol_hours", { hours: s.noteEscalationHours }), source: null },
    { key: "validity", label: t("mfr_set_pol_validity"), value: t("mfr_set_pol_days", { days: s.estimateValidityDays }), source: "finance" },
    { key: "remnant", label: t("mfr_set_pol_remnant"), value: t("mfr_set_pol_remnant_value", { pct: s.remnantValuePercent }), source: "finance" },
  ]
  return (
    <MfgPanel icon={Scale} title={t("mfr_set_policies_title")} subtitle={t("mfr_set_policies_sub")}>
      <dl>
        {rows.map((r) => (
          <div key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-4 py-2.5 text-xs last:border-b-0">
            <dt className="min-w-0 flex-1 font-semibold text-foreground">{r.label}</dt>
            <dd className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
              <span className="tabular-nums text-slate-700">{r.value}</span>
              {r.source && <MfgAnyModuleChip module={r.source} prefix="from" />}
            </dd>
          </div>
        ))}
      </dl>
      <div className="space-y-2 border-t border-border/60 px-4 py-3">
        <MfgNote tone="info" icon={Lock}>
          {t("mfr_set_policies_where")}
        </MfgNote>
        {seesMoney && <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">{t("mfr_set_policies_reconciliation")}</p>}
      </div>
    </MfgPanel>
  )
}

// ---------------------------------------------------------------------------
// Module boundaries (BD-04) and naming conflicts (BD-05)
// ---------------------------------------------------------------------------

const BOUNDARY_MODULES: MdmakModule[] = ["sales", "procurement", "projects", "inventory", "finance", "hr", "crm", "governance"]
const CONFLICTS = ["wo_vo", "withdrawal", "mr", "dn", "pr_po", "catalogue"] as const

export function MfgSetBoundaries() {
  const t = useTranslations("Portal.Shared")
  return (
    <MfgPanel icon={Workflow} title={t("mfr_set_bound_title")} subtitle={t("mfr_set_bound_sub")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30 text-[11px] font-bold text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 text-start">{t("mfr_set_bound_col_module")}</th>
              <th scope="col" className="px-3 py-2.5 text-start">{t("mfr_set_bound_col_read")}</th>
              <th scope="col" className="px-3 py-2.5 text-start">{t("mfr_set_bound_col_send")}</th>
              <th scope="col" className="px-4 py-2.5 text-start">{t("mfr_set_bound_col_not_ours")}</th>
            </tr>
          </thead>
          <tbody>
            {BOUNDARY_MODULES.map((m) => (
              <tr key={m} className="border-b border-border/60 align-top last:border-b-0">
                <th scope="row" className="px-4 py-2.5 text-start font-normal">
                  <MfgAnyModuleChip module={m} />
                </th>
                <td className="px-3 py-2.5 leading-relaxed text-slate-700">{t(`mfr_set_bound_${m}_read`)}</td>
                <td className="px-3 py-2.5 leading-relaxed text-slate-700">{t(`mfr_set_bound_${m}_send`)}</td>
                <td className="px-4 py-2.5 leading-relaxed text-destructive">{t(`mfr_set_bound_${m}_not`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border/60 px-4 py-3">
        <MfgNote tone="warn" icon={AlertTriangle} title={t("mfr_set_conflicts_title")}>
          <ul className="mt-1 list-disc space-y-0.5 ps-4">
            {CONFLICTS.map((k) => (
              <li key={k}>{t(`mfr_set_conflict_${k}`)}</li>
            ))}
          </ul>
        </MfgNote>
      </div>
    </MfgPanel>
  )
}

// ---------------------------------------------------------------------------
// Manufacturing permissions (ST-03) — read-only, enforced on the server
// ---------------------------------------------------------------------------

const ROLES: Array<{ persona: Persona; permission: string }> = [
  { persona: "manager", permission: "manufacturing.manage" },
  { persona: "lead", permission: "manufacturing.work" },
  { persona: "qc", permission: "manufacturing.qc" },
  { persona: "cost", permission: "manufacturing.cost" },
  { persona: "management", permission: "manufacturing.view" },
]

type Grant = "yes" | "limit" | "any"

/** The prototype's role grants — the matrix mirrors what the server enforces. */
const ACTIONS: Array<{ key: string; grants: Partial<Record<Persona, Grant>> }> = [
  { key: "answer", grants: { manager: "yes" } },
  { key: "create", grants: { manager: "yes" } },
  { key: "release", grants: { manager: "yes" } },
  { key: "submit", grants: { manager: "yes" } },
  { key: "slab", grants: { manager: "yes", qc: "yes" } },
  { key: "run", grants: { manager: "yes", lead: "yes", qc: "yes" } },
  { key: "down", grants: { manager: "yes", lead: "yes" } },
  { key: "rem", grants: { manager: "yes", lead: "yes" } },
  { key: "mat", grants: { manager: "yes", lead: "yes" } },
  { key: "recv", grants: { manager: "yes", lead: "yes" } },
  { key: "override", grants: { manager: "yes" } },
  { key: "qc", grants: { qc: "yes" } },
  { key: "block", grants: { manager: "yes", qc: "yes" } },
  { key: "scrap", grants: { manager: "limit", cost: "any" } },
  { key: "prq", grants: { manager: "yes" } },
  { key: "cost", grants: { cost: "yes" } },
  { key: "close", grants: { manager: "yes" } },
  { key: "deliver", grants: { manager: "yes" } },
  { key: "amend", grants: { manager: "yes" } },
  { key: "money", grants: { manager: "yes", cost: "yes", management: "yes" } },
  { key: "admin", grants: { manager: "yes" } },
  // Empty for every role on purpose: what belongs to another module is done there.
  { key: "noprice", grants: {} },
]

export function MfgSetPermissions() {
  const t = useTranslations("Portal.Shared")
  return (
    <MfgPanel icon={ShieldCheck} title={t("mfr_set_perm_title")} subtitle={t("mfr_set_perm_sub")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30 text-[11px] font-bold text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 text-start">{t("mfr_set_perm_action")}</th>
              {ROLES.map((r) => (
                <th key={r.persona} scope="col" className="px-2 py-2.5 text-center align-bottom">
                  <span className="block text-foreground">{t(`mfg4_persona_${r.persona}`)}</span>
                  <span className="block font-mono text-[10px] font-normal" dir="ltr">
                    {r.permission}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ACTIONS.map((a) => (
              <tr key={a.key} className={cn("border-b border-border/60", a.key === "noprice" && "bg-muted/30")}>
                <th scope="row" className="px-4 py-2.5 text-start font-semibold text-foreground">
                  {t(`mfr_set_perm_row_${a.key}`)}
                </th>
                {ROLES.map((r) => (
                  <td key={r.persona} className="px-2 py-2.5 text-center">
                    <GrantCell grant={a.grants[r.persona]} />
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-4 py-2.5 text-start font-semibold text-foreground">
                {t("mfr_set_perm_scope")}
              </th>
              {ROLES.map((r) => (
                <td key={r.persona} className="px-2 py-2.5 text-center text-[11px] text-muted-foreground">
                  {t(`mfr_set_perm_scope_${r.persona}`)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="space-y-2 border-t border-border/60 px-4 py-3">
        <MfgNote tone="info" icon={Lock}>
          {t("mfr_set_perm_empty_row")}
        </MfgNote>
        <p className="text-[11px] text-muted-foreground">{t("mfr_set_perm_assigned")}</p>
      </div>
    </MfgPanel>
  )
}

function GrantCell({ grant }: { grant: Grant | undefined }) {
  const t = useTranslations("Portal.Shared")
  if (!grant) {
    return (
      <span className="text-muted-foreground/50">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t("mfr_set_perm_no")}</span>
      </span>
    )
  }
  if (grant === "limit") return <MfgChip tone="warn">{t("mfr_set_perm_up_to_limit")}</MfgChip>
  if (grant === "any") return <MfgChip tone="ok">{t("mfr_set_perm_any_value")}</MfgChip>
  return (
    <span className="inline-grid h-6 w-6 place-items-center rounded-full bg-success/10 text-success">
      <Check size={13} aria-hidden="true" />
      <span className="sr-only">{t("mfr_set_perm_yes")}</span>
    </span>
  )
}
