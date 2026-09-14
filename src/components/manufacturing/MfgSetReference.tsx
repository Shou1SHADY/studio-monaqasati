"use client"

// The read-only half of Settings: production lines as the product routes
// define them, who may do what (a reflection of the module's gates — the
// Firestore rules enforce it), and what each workshop event posts to Finance.

import { useMemo, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check, ChevronLeft, ChevronRight, GitBranch, Landmark, Lock, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Decision, DecisionKind } from "@/lib/manufacturing-engine"
import { productionLines } from "@/lib/manufacturing-view"
import { decisionAllowed, useMfgUi, type MfgPermissions } from "./MfgUiContext"
import { familyIcon } from "./MfgPrdBits"
import { MfgChip, MfgNote, MfgPanel, departmentIcon } from "./ui/MfgUi"

// ---------------------------------------------------------------------------
// Production lines
// ---------------------------------------------------------------------------

export function MfgSetLines() {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const { data } = useMfgUi()
  const Arrow = locale === "ar" ? ChevronLeft : ChevronRight
  const lines = useMemo(() => productionLines(data.products), [data.products])

  const nameOf = (id: string): string => {
    const dept = data.departments.find((d) => d.id === id)
    if (dept) return dept.name
    for (const p of data.products) {
      const step = p.route.find((r) => r.departmentId === id)
      if (step) return step.departmentName
    }
    return "—"
  }

  return (
    <MfgPanel icon={GitBranch} title={t("mfg3_set_lines_title")} subtitle={t("mfg3_set_lines_hint")} count={lines.length}>
      {lines.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t("mfg3_set_lines_empty")}</p>}
      {lines.map((line) => {
        const Icon = familyIcon(line.family)
        const count = data.products.filter((p) => p.family === line.family).length
        return (
          <div key={line.family} className="flex flex-col gap-2 border-b border-border/60 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center">
            <span className="flex shrink-0 items-center gap-2 sm:w-52">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
                <Icon size={15} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-foreground">{t(`mfg2_family_${line.family}`)}</span>
                <span className="block text-[11px] text-muted-foreground">{t("mfg3_prd_count", { count })}</span>
              </span>
            </span>
            <ol className="flex flex-wrap items-center gap-1" aria-label={t(`mfg2_family_${line.family}`)}>
              {line.departmentIds.map((id, i) => {
                const name = nameOf(id)
                const DIcon = departmentIcon(name, data.departments.find((d) => d.id === id)?.onSite)
                return (
                  <li key={id} className="flex items-center gap-1">
                    {i > 0 && <Arrow size={12} className="text-muted-foreground/60" aria-hidden="true" />}
                    <MfgChip tone="muted" icon={DIcon}>
                      {name}
                    </MfgChip>
                  </li>
                )
              })}
            </ol>
          </div>
        )
      })}
    </MfgPanel>
  )
}

// ---------------------------------------------------------------------------
// Permissions matrix
// ---------------------------------------------------------------------------

type PermColumn = "manage" | "work" | "qc" | "cost" | "receive"

const PERM_COLUMNS: Array<{ id: PermColumn; permission: string }> = [
  { id: "manage", permission: "manufacturing.manage" },
  { id: "work", permission: "manufacturing.work" },
  { id: "qc", permission: "manufacturing.qc" },
  { id: "cost", permission: "manufacturing.cost" },
  { id: "receive", permission: "warehouses.receive" },
]

/** The module's flags for someone holding ONLY this permission — the same
 * derivation useMfgData and MfgUiProvider apply (manage implies the hand's and
 * QC's work; the cost controller also decides QC and sees money). */
function permsFor(col: PermColumn): MfgPermissions {
  const canManage = col === "manage"
  const canCost = col === "cost"
  return {
    canManage,
    canCost,
    canWork: col === "work" || canManage,
    canQc: col === "qc" || canManage || canCost,
    seesMoney: canCost || canManage,
    canReceive: col === "receive",
    canRequest: canManage,
    canCreate: canManage || canCost,
  }
}

type Cell = "yes" | "no" | "limit" | "any"

const allowed = (kind: DecisionKind, p: MfgPermissions): boolean => decisionAllowed({ kind, weight: 0 } as Decision, p)

/** Each action, gated the way the screens gate it. */
const PERM_ROWS: Array<{ key: string; cell: (p: MfgPermissions) => Cell }> = [
  { key: "answer", cell: (p) => (allowed("answer_request", p) ? "yes" : "no") },
  { key: "create_release", cell: (p) => (p.canCreate && allowed("release_ready", p) ? "yes" : "no") },
  { key: "output", cell: (p) => (p.canWork ? "yes" : "no") },
  { key: "materials", cell: (p) => (allowed("materials_missing", p) && allowed("confirm_materials", p) ? "yes" : "no") },
  { key: "qc", cell: (p) => (allowed("qc_decision", p) ? "yes" : "no") },
  { key: "slab", cell: (p) => (allowed("record_slab", p) ? "yes" : "no") },
  { key: "estimate", cell: (p) => (allowed("send_estimate", p) ? "yes" : "no") },
  // A manager's approval stops at the org's scrap limit; the cost controller's does not.
  { key: "scrap", cell: (p) => (!allowed("approve_scrap", p) ? "no" : p.canCost ? "any" : "limit") },
  { key: "money", cell: (p) => (p.seesMoney ? "yes" : "no") },
  { key: "rush", cell: (p) => (p.canManage || p.canCost ? "yes" : "no") },
  { key: "edit", cell: (p) => (p.canManage ? "yes" : "no") },
  { key: "confirm_note", cell: (p) => (allowed("confirm_note", p) ? "yes" : "no") },
  // Nobody's here — Sales price the quote.
  { key: "sale_price", cell: () => "no" },
]

export function MfgSetPermissions() {
  const t = useTranslations("Portal.Shared")
  const matrix = useMemo(() => PERM_COLUMNS.map((c) => ({ ...c, perms: permsFor(c.id) })), [])

  return (
    <MfgPanel icon={ShieldCheck} title={t("mfg3_set_perm_title")} subtitle={t("mfg3_set_perm_hint")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30 text-[11px] font-bold text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 text-start">{t("mfg3_set_perm_action")}</th>
              {matrix.map((c) => (
                <th key={c.id} scope="col" className="px-2 py-2.5 text-center align-bottom">
                  <span className="block text-foreground">{t(`mfg3_set_role_${c.id}`)}</span>
                  <span className="block font-mono text-[10px] font-normal" dir="ltr">
                    {c.permission}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERM_ROWS.map((row) => (
              <tr key={row.key} className={cn("border-b border-border/60 last:border-b-0", row.key === "sale_price" && "bg-muted/20")}>
                <th scope="row" className="px-4 py-2.5 text-start font-semibold text-foreground">
                  {t(`mfg3_set_perm_row_${row.key}`)}
                </th>
                {matrix.map((c) => (
                  <td key={c.id} className="px-2 py-2.5 text-center">
                    <PermCell cell={row.cell(c.perms)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 border-t border-border/60 px-4 py-3">
        <MfgNote tone="warn" icon={Lock} title={t("mfg3_set_perm_price_title")}>
          {t("mfg3_set_perm_price_body")}
        </MfgNote>
        <MfgNote tone="info">{t("mfg3_set_perm_note")}</MfgNote>
      </div>
    </MfgPanel>
  )
}

function PermCell({ cell }: { cell: Cell }) {
  const t = useTranslations("Portal.Shared")
  if (cell === "no") {
    return (
      <span className="text-muted-foreground/50">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t("mfg3_set_perm_no")}</span>
      </span>
    )
  }
  if (cell === "limit") return <MfgChip tone="warn">{t("mfg3_set_perm_up_to_limit")}</MfgChip>
  if (cell === "any") return <MfgChip tone="ok">{t("mfg3_set_perm_any_value")}</MfgChip>
  return (
    <span className="inline-grid h-6 w-6 place-items-center rounded-full bg-success/10 text-success">
      <Check size={13} aria-hidden="true" />
      <span className="sr-only">{t("mfg3_set_perm_yes")}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// What goes to Finance
// ---------------------------------------------------------------------------

// Mirrors src/lib/accounting/posting-rules.ts: postMfgMaterialReceipt,
// postMfgScrap and postWorkOrderDelivery post; hours and variances do not.
const FINANCE_ROWS: Array<{ key: string; posted: boolean }> = [
  { key: "materials", posted: true },
  { key: "hours", posted: false },
  { key: "scrap", posted: true },
  { key: "to_project", posted: true },
  { key: "to_stock", posted: true },
  { key: "breakage", posted: false },
  { key: "variance", posted: false },
]

export function MfgSetFinance() {
  const t = useTranslations("Portal.Shared")
  return (
    <MfgPanel icon={Landmark} title={t("mfg3_set_fin_title")} subtitle={t("mfg3_set_fin_hint")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30 text-[11px] font-bold text-muted-foreground">
              <th scope="col" className="w-2/5 px-4 py-2.5 text-start">{t("mfg3_set_fin_col_event")}</th>
              <th scope="col" className="px-4 py-2.5 text-start">{t("mfg3_set_fin_col_posted")}</th>
            </tr>
          </thead>
          <tbody>
            {FINANCE_ROWS.map((row) => (
              <tr key={row.key} className="border-b border-border/60 last:border-b-0">
                <th scope="row" className="px-4 py-2.5 text-start font-semibold text-foreground">
                  {t(`mfg3_set_fin_${row.key}_event`)}
                </th>
                <td className="px-4 py-2.5">
                  <FinanceEffect posted={row.posted}>{t(`mfg3_set_fin_${row.key}_posted`)}</FinanceEffect>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border/60 px-4 py-3">
        <MfgNote tone="info">{t("mfg3_set_fin_note")}</MfgNote>
      </div>
    </MfgPanel>
  )
}

function FinanceEffect({ posted, children }: { posted: boolean; children: ReactNode }) {
  const t = useTranslations("Portal.Shared")
  return (
    <span className="flex flex-wrap items-center gap-2">
      <MfgChip tone={posted ? "ok" : "muted"}>{posted ? t("mfg3_set_fin_posts") : t("mfg3_set_fin_no_entry")}</MfgChip>
      <span className={cn(posted ? "text-foreground" : "text-muted-foreground")}>{children}</span>
    </span>
  )
}
