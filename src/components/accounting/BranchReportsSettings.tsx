"use client"

// Settings › Financials by branch (customer review, 27 Sep 2026). The switch
// (off by default), the org's branches — "Riyadh office", "Jeddah office" —
// and which branch each project reports under. Removing a branch releases its
// projects to "not assigned"; nothing is deleted from the books.

import { useTranslations } from "next-intl"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { useModules } from "@/hooks/useCompanyModules"
import { newBranchId } from "@/lib/accounting/branches"
import type { AccountingSettings } from "@/lib/accounting/settings"

const NONE = "__none__"

export function BranchReportsSettings({
  draft,
  setDraft,
  projects,
  canEdit,
}: {
  draft: AccountingSettings
  setDraft: (update: (d: AccountingSettings) => AccountingSettings) => void
  projects: Array<{ id: string; name: string; region?: string | null }>
  canEdit: boolean
}) {
  const t = useTranslations("Portal.Shared")
  const { on } = useModules()

  const rename = (id: string, name: string) => setDraft((d) => ({ ...d, branches: d.branches.map((b) => (b.id === id ? { ...b, name } : b)) }))
  const add = () => setDraft((d) => ({ ...d, branches: [...d.branches, { id: newBranchId(), name: "" }] }))
  const remove = (id: string) =>
    setDraft((d) => ({
      ...d,
      branches: d.branches.filter((b) => b.id !== id),
      projectBranches: Object.fromEntries(Object.entries(d.projectBranches).filter(([, b]) => b !== id)),
    }))
  const place = (project: string, branch: string) =>
    setDraft((d) => {
      const next = { ...d.projectBranches }
      if (branch === NONE) delete next[project]
      else next[project] = branch
      return { ...d, projectBranches: next }
    })

  const named = draft.branches.filter((b) => b.name.trim())
  const unassigned = projects.filter((p) => !draft.projectBranches[p.id]).length

  return (
    <div className="divide-y">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <Label htmlFor="acc-branch-reports" className="text-sm font-bold">
            {t("acc_settings_branch_reports")}
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">{t("acc_settings_branch_reports_hint")}</p>
        </div>
        <Switch id="acc-branch-reports" checked={draft.branchReports} onCheckedChange={(v) => setDraft((d) => ({ ...d, branchReports: v }))} disabled={!canEdit} />
      </div>

      {draft.branchReports && (
        <>
          <div className="space-y-3 p-5">
            <div>
              <p className="text-sm font-bold">{t("acc_settings_branches")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("acc_settings_branches_hint")}</p>
            </div>
            <ul className="space-y-2">
              {draft.branches.map((b, i) => (
                <li key={b.id} className="flex items-center gap-2">
                  <Input
                    aria-label={t("acc_settings_branch_name", { n: i + 1 })}
                    placeholder={t("acc_settings_branch_placeholder")}
                    value={b.name}
                    onChange={(e) => rename(b.id, e.target.value)}
                    disabled={!canEdit}
                    className="max-w-xs"
                  />
                  {canEdit && (
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:bg-destructive/10" onClick={() => remove(b.id)} aria-label={t("acc_settings_branch_remove", { name: b.name || String(i + 1) })}>
                      <Trash2 size={15} aria-hidden="true" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <Button type="button" variant="outline" size="sm" onClick={add} className="gap-1.5">
                <Plus size={14} aria-hidden="true" />
                {t("acc_settings_branch_add")}
              </Button>
            )}
          </div>

          {named.length > 0 && on("project-management") && (
            <div className="space-y-3 p-5">
              <div>
                <p className="text-sm font-bold">{t("acc_settings_project_branches")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("acc_settings_project_branches_hint", { count: unassigned })}</p>
              </div>
              {projects.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("acc_settings_no_projects")}</p>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {projects.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 text-sm" dir="auto">
                        <span className="font-semibold">{p.name}</span>
                        {p.region && <span className="ms-2 text-xs text-muted-foreground">{p.region}</span>}
                      </span>
                      <div className="w-48">
                        <SearchableSelect
                          size="sm"
                          className="h-9"
                          ariaLabel={t("acc_settings_project_branch_for", { name: p.name })}
                          value={draft.projectBranches[p.id] ?? NONE}
                          onChange={(v) => place(p.id, v)}
                          options={[{ value: NONE, label: t("acc_branch_unassigned") }, ...named.map((b) => ({ value: b.id, label: b.name }))]}
                          placeholder={t("acc_filter_branch")}
                          searchPlaceholder={t("acc_search_options")}
                          noResultsText={t("acc_no_options")}
                          disabled={!canEdit}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
