"use client"

// الإعدادات والحدود — what the Sales module owns, what it reads and what will
// never be built here (PRD §4 "Settings & boundary"). The screen has no form:
// it is the map a new seller reads once and a manager points at when someone
// asks Sales to invoice, create a client or book the workshop's capacity.
//
// Nothing here is typed by hand twice: the discount caps come from the policy
// function the composer enforces, the VAT from the document default, and the
// plant's answer window from Finance's manufacturing policy.

import type { ElementType } from "react"
import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  Factory,
  FileText,
  Info,
  Link2,
  Lock,
  Ruler,
  Settings2,
  ShieldCheck,
  Tags,
  Truck,
  Undo2,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { cn } from "@/lib/utils"
import { MFG_SETTINGS, normalizeMfgSettings, type MfgSettings } from "@/lib/manufacturing-engine"
import { DEFAULT_QUOTATION_VAT_PERCENT } from "@/lib/quotation-document"
import { discountCapPercent } from "@/lib/sales-transfers"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { SalesSection, SalesShell } from "./SalesShell"
import { QuotationLogoField } from "./QuotationLogoField"
import { useQuotationBrandingDefaults } from "@/hooks/useQuotationBranding"

type Module = "crm" | "sal" | "mfg" | "inv" | "fin" | "gov"

const MODULE_BADGE: Record<Module, string> = {
  crm: "bg-accent/15 text-secondary",
  sal: "bg-cta/10 text-cta",
  mfg: "bg-warning/10 text-warning",
  inv: "bg-success/10 text-success",
  fin: "bg-primary/10 text-primary",
  gov: "bg-muted text-muted-foreground",
}

/** The twelve steps in four phases, each with the module that performs it. */
const FLOW: Array<{ phase: number; icon: ElementType; steps: Array<{ n: number; module: Module; icon: ElementType }> }> = [
  { phase: 1, icon: FileText, steps: [{ n: 1, module: "crm", icon: ArrowDownLeft }, { n: 2, module: "sal", icon: Tags }, { n: 3, module: "sal", icon: FileText }] },
  { phase: 2, icon: ClipboardList, steps: [{ n: 4, module: "sal", icon: ClipboardList }, { n: 5, module: "sal", icon: Banknote }] },
  { phase: 3, icon: Factory, steps: [{ n: 6, module: "mfg", icon: Factory }, { n: 7, module: "mfg", icon: Ruler }, { n: 8, module: "mfg", icon: Factory }] },
  { phase: 4, icon: Truck, steps: [{ n: 9, module: "inv", icon: Truck }, { n: 10, module: "sal", icon: Banknote }, { n: 11, module: "fin", icon: ShieldCheck }, { n: 12, module: "sal", icon: Undo2 }] },
]

const READS: Module[] = ["crm", "gov", "fin", "fin", "inv", "mfg", "mfg"]

/** Who is on the other end of each boundary event, and which way it travels. */
const EVENTS: Array<{ module: Module; out: boolean }> = [
  { module: "crm", out: false },
  { module: "crm", out: true },
  { module: "sal", out: true },
  { module: "crm", out: true },
  { module: "crm", out: true },
  { module: "mfg", out: true },
  { module: "mfg", out: true },
  { module: "mfg", out: false },
  { module: "mfg", out: false },
  { module: "inv", out: true },
  { module: "fin", out: true },
  { module: "fin", out: false },
  { module: "fin", out: false },
  { module: "fin", out: true },
]

const DOC_SOURCES: Module[] = ["gov", "gov", "crm", "mfg", "sal"]

type RoleKey = "owner" | "manager" | "rep"
/** quotes · orders · delivery & payments · prices & returns · cost & margin · document identity */
const ROLE_CAN: Record<RoleKey, boolean[]> = {
  owner: [true, true, true, true, true, true],
  manager: [true, true, true, true, true, false],
  rep: [true, true, true, false, false, false],
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

export function SalesSettingsView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { can, isOrgOwner } = usePermissions()

  const userDocRef = useMemoFirebase(() => (isUserLoading || !user || !firestore ? null : doc(firestore, "users", user.uid)), [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const orgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""

  const settingsRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, MFG_SETTINGS, orgId) : null), [firestore, orgId])
  const { data: settingsData } = useDoc(settingsRef)
  const answerWindowHours = useMemo(() => normalizeMfgSettings(settingsData as Partial<MfgSettings> | null).answerWindowHours, [settingsData])

  const { branding: defaultBranding } = useQuotationBrandingDefaults()
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  useEffect(() => {
    // Follow the stored default until the owner picks a file here.
    setLogoUrl((current) => (current && current.startsWith("blob:") ? current : defaultBranding.logoUrl ?? null))
  }, [defaultBranding.logoUrl])

  const myRole: RoleKey | null = isOrgOwner ? "owner" : can("sales.approve") ? "manager" : can("sales.manage") ? "rep" : null
  const capOf = (role: RoleKey) => discountCapPercent({ isOwner: role === "owner", canApprove: role === "manager" })
  const Chevron = isRtl ? ChevronLeft : ChevronRight

  const moduleBadge = (m: Module) => <Badge className={cn("shrink-0 border-none text-[10px]", MODULE_BADGE[m])}>{t(`sset_mod_${m}`)}</Badge>

  return (
    <SalesShell portal={portal} title={t("sset_title")} description={t("sset_desc")} icon={Settings2}>
      {/* The flow strip: four phases, then every step with who does it and what blocks it. */}
      <ol className="flex flex-wrap items-stretch gap-2" aria-label={t("sset_title")}>
        {FLOW.map((f, i) => (
          <li key={f.phase} className="flex min-w-40 flex-1 items-center gap-2">
            {i > 0 && <Chevron size={16} className="hidden shrink-0 text-muted-foreground sm:block" aria-hidden="true" />}
            <div className="flex-1 rounded-xl border bg-white px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-black text-foreground">
                <f.icon size={15} className="text-primary" aria-hidden="true" />
                {t(`sset_phase_${f.phase}`)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t("sset_steps_range", { from: f.steps[0].n, to: f.steps[f.steps.length - 1].n })}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-2">
        {FLOW.map((f) => (
          <SalesSection key={f.phase} title={t(`sset_phase_${f.phase}`)} icon={f.icon}>
            <ol className="divide-y">
              {f.steps.map((s) => (
                <li key={s.n} className="flex gap-3 px-5 py-3.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-black tabular-nums text-primary">{s.n}</span>
                  <div className="min-w-0 space-y-1.5">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
                      <s.icon size={14} className="text-muted-foreground" aria-hidden="true" />
                      {t(`sset_step_${s.n}_title`)}
                      {moduleBadge(s.module)}
                    </p>
                    <p className="text-xs text-slate-700">{t(`sset_step_${s.n}_body`)}</p>
                    <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <Lock size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
                      {t(`sset_step_${s.n}_guard`)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </SalesSection>
        ))}
      </div>

      <SalesSection title={t("sset_rule_title")} icon={ShieldCheck}>
        <div className="space-y-3 p-5">
          <p className="flex items-start gap-2 rounded-lg border border-cta/20 bg-cta/5 px-3 py-2.5 text-xs text-slate-700">
            <Info size={14} className="mt-0.5 shrink-0 text-cta" aria-hidden="true" />
            {t("sset_rule_body")}
          </p>
          <p className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2.5 text-xs text-slate-700">
            <Info size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            {t("sset_rule_names")}
          </p>
        </div>
      </SalesSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <SalesSection title={t("sset_boundary_title")} icon={ShieldCheck} action={<span className="text-[11px] text-muted-foreground">{t("sset_boundary_sub")}</span>}>
            <BoundaryList icon={Check} tone="bg-cta/5 text-cta" head={t("sset_owns_head")}>
              {range(12).map((i) => (
                <li key={i} className="px-5 py-2.5 text-xs text-slate-700">{t(`sset_owns_${i}`)}</li>
              ))}
            </BoundaryList>
            <BoundaryList icon={Eye} tone="bg-muted/40 text-foreground" head={t("sset_reads_head")}>
              {READS.map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-5 py-2.5 text-xs text-slate-700">
                  <span>{t(`sset_reads_${i + 1}`)}</span>
                  {moduleBadge(m)}
                </li>
              ))}
            </BoundaryList>
            <BoundaryList icon={Ban} tone="bg-destructive/5 text-destructive" head={t("sset_notown_head")}>
              {range(10).map((i) => (
                <li key={i} className="px-5 py-2.5 text-xs text-slate-700">{t(`sset_notown_${i}`)}</li>
              ))}
            </BoundaryList>
          </SalesSection>

          <SalesSection title={t("sset_events_title")} icon={Link2} action={<span className="text-[11px] text-muted-foreground">{t("sset_events_sub")}</span>}>
            <ul className="divide-y">
              {EVENTS.map((e, i) => {
                const Dir = e.out ? ArrowUpRight : ArrowDownLeft
                return (
                  <li key={i} className="space-y-1 px-5 py-3">
                    <p className="flex flex-wrap items-center gap-2 text-xs font-bold text-foreground">
                      {moduleBadge(e.module)}
                      {t(`sset_event_${i + 1}_name`)}
                      <span className={cn("ms-auto inline-flex items-center gap-1 text-[10px] font-semibold", e.out ? "text-cta" : "text-success")}>
                        <Dir size={11} className="rtl-flip" aria-hidden="true" />
                        {t(e.out ? "sset_dir_out" : "sset_dir_in")}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">{t(`sset_event_${i + 1}_effect`)}</p>
                  </li>
                )
              })}
            </ul>
          </SalesSection>
        </div>

        <div className="space-y-4">
          <SalesSection title={t("sset_doc_title")} icon={FileText} action={<span className="text-[11px] text-muted-foreground">{t("sset_doc_sub")}</span>}>
            <ul className="divide-y">
              {DOC_SOURCES.map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-5 py-2.5 text-xs text-slate-700">
                  <span>{t(`sset_doc_${i + 1}`)}</span>
                  {moduleBadge(m)}
                </li>
              ))}
            </ul>
            {/* The document's logo is the owner's to set — here, once, for every
                quotation, instead of only from inside a new quote's composer. */}
            <div className="border-t px-5 py-4 space-y-2">
              <p className="text-xs font-bold text-slate-700">{t("sset_logo_title")}</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{t(isOrgOwner ? "sset_logo_hint" : "sset_logo_owner_only")}</p>
              {isOrgOwner && orgId ? <QuotationLogoField orgId={orgId} value={logoUrl} onChange={setLogoUrl} /> : null}
            </div>
          </SalesSection>

          <SalesSection title={t("sset_roles_title")} icon={Lock} action={<span className="text-[11px] text-muted-foreground">{t("sset_roles_sub")}</span>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="border-b bg-muted/20 text-[11px] text-muted-foreground">
                    <th scope="col" className="px-5 py-2 text-start font-semibold">{t("sset_roles_col_role")}</th>
                    <th scope="col" className="px-2 py-2 text-start font-semibold">{t("sset_roles_col_discount")}</th>
                    {(["quotes", "orders", "delivery", "prices", "cost", "identity"] as const).map((c) => (
                      <th key={c} scope="col" className="px-2 py-2 text-center font-semibold">{t(`sset_roles_col_${c}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(["owner", "manager", "rep"] as RoleKey[]).map((role) => {
                    const cap = capOf(role)
                    return (
                      <tr key={role} className={cn(myRole === role && "bg-cta/5")}>
                        <th scope="row" className="px-5 py-2.5 text-start font-normal">
                          <span className="flex flex-wrap items-center gap-1.5 font-bold text-foreground">
                            {t(`sset_role_${role}`)}
                            {myRole === role && <Badge className="border-none bg-cta/10 text-[10px] text-cta">{t("sset_role_you")}</Badge>}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{t(`sset_role_${role}_desc`)}</span>
                        </th>
                        <td className="px-2 py-2.5 font-bold tabular-nums text-foreground" dir="ltr">{cap == null ? t("sset_role_cap_none") : `${cap}%`}</td>
                        {ROLE_CAN[role].map((yes, i) => (
                          <td key={i} className="px-2 py-2.5 text-center">
                            {yes ? (
                              <Check size={14} className="mx-auto text-success" role="img" aria-label={t("sset_yes")} />
                            ) : (
                              <X size={13} className="mx-auto text-muted-foreground/50" role="img" aria-label={t("sset_no")} />
                            )}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </SalesSection>

          <SalesSection title={t("sset_defaults_title")} icon={Settings2}>
            <dl className="divide-y text-xs">
              <DefaultRow label={t("sset_def_vat")} value={<span dir="ltr">{DEFAULT_QUOTATION_VAT_PERCENT}%</span>} />
              <DefaultRow label={t("sset_def_below_cost")} value={<Badge className="border-none bg-destructive/10 text-[10px] text-destructive">{t("sset_def_below_cost_v")}</Badge>} />
              <DefaultRow label={t("sset_def_advance")} value={<Badge className="border-none bg-warning/10 text-[10px] text-warning">{t("sset_def_advance_v")}</Badge>} />
              <DefaultRow label={t("sset_def_plant_window")} value={t("sset_def_plant_window_v", { hours: answerWindowHours })} />
              <DefaultRow label={t("sset_def_invoicing")} value={<Badge className="border-none bg-muted text-[10px] text-muted-foreground">{t("sset_def_invoicing_v")}</Badge>} />
            </dl>
          </SalesSection>

          <SalesSection title={t("sset_notbuilt_title")} icon={ClipboardList} action={<span className="text-[11px] text-muted-foreground">{t("sset_notbuilt_sub")}</span>}>
            <ul className="divide-y">
              {range(8).map((i) => (
                <li key={i} className="px-5 py-2.5 text-xs text-slate-700">{t(`sset_notbuilt_${i}`)}</li>
              ))}
            </ul>
          </SalesSection>
        </div>
      </div>
    </SalesShell>
  )
}

function BoundaryList({ icon: Icon, tone, head, children }: { icon: ElementType; tone: string; head: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className={cn("flex items-center gap-2 px-5 py-2 text-xs font-black", tone)}>
        <Icon size={13} aria-hidden="true" />
        {head}
      </h3>
      <ul className="divide-y">{children}</ul>
    </div>
  )
}

function DefaultRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-bold text-foreground">{value}</dd>
    </div>
  )
}
