"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, ChevronsUpDown, FilePlus2, Loader2, Lock, Percent, Plus, Save, Send, Trash2 } from "lucide-react"
import { useRouter } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useAccounting } from "@/hooks/useAccounting"
import { cn, sanitizeDecimalInput } from "@/lib/utils"
import { POSTABLE_ACCOUNTS, accountName } from "@/lib/accounting/accounts"
import { ClosedPeriodError, isPeriodClosed, periodOf } from "@/lib/accounting/journal"
import { saveManualEntry, validateManualEntry, type EntryIssue, type LineIssue, type ManualLineInput } from "@/lib/accounting/manual-entry"
import { DEFAULT_COST_CENTERS } from "@/lib/accounting/posting-rules"
import { isoToday } from "@/lib/accounting/periods"
import { WHT_TYPES, computeWht, whtLine, whtRate, whtTypeName } from "@/lib/accounting/withholding"
import { matchesSearch } from "@/lib/search-text"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { AccountingSection, AccountingShell, Money, accountingBasePath } from "./AccountingShell"

type Row = { key: string; account: string; note: string; partyName: string; debit: string; credit: string }

const newRow = (): Row => ({ key: Math.random().toString(36).slice(2, 9), account: "", note: "", partyName: "", debit: "", credit: "" })

const TYPE_LABEL_KEY: Record<string, string> = {
  "1": "acc_type_assets",
  "2": "acc_type_liabilities",
  "3": "acc_type_equity",
  "4": "acc_type_revenue",
  "5": "acc_type_expenses",
}

/** Searchable picker over the postable accounts, by number or name, grouped by type. */
export function AccountPicker({
  value,
  onChange,
  invalid,
  id,
  accounts = POSTABLE_ACCOUNTS.map((a) => a.code),
}: {
  value: string
  onChange: (code: string) => void
  invalid?: boolean
  id?: string
  accounts?: string[]
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const allowed = new Set(accounts)
  const matches = POSTABLE_ACCOUNTS.filter((a) => allowed.has(a.code) && matchesSearch(query, [a.code, a.nameAr, a.nameEn]))
  const groups = ["1", "2", "3", "4", "5"].map((type) => ({ type, items: matches.filter((a) => a.type === type) })).filter((g) => g.items.length > 0)

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery("") }}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-white px-2.5 text-xs text-start",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            invalid && "border-destructive ring-1 ring-destructive"
          )}
        >
          {value ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="font-mono tabular-nums text-muted-foreground shrink-0" dir="ltr">{value}</span>
              <span className="truncate">{accountName(value, locale)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{t("acc_je_pick_account")}</span>
          )}
          <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0" dir={locale === "ar" ? "rtl" : "ltr"}>
        <div className="border-b p-2">
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("acc_coa_search")} aria-label={t("acc_coa_search")} className="h-8 text-xs" />
        </div>
        <div className="max-h-72 overflow-y-auto p-1" role="listbox">
          {groups.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">{t("acc_je_no_account_match")}</p>}
          {groups.map((g) => (
            <div key={g.type}>
              <p className="px-2 pt-2 pb-1 text-[10px] font-bold text-muted-foreground">{t(TYPE_LABEL_KEY[g.type])}</p>
              {g.items.map((a) => (
                <button
                  key={a.code}
                  type="button"
                  role="option"
                  aria-selected={a.code === value}
                  onClick={() => { onChange(a.code); setOpen(false); setQuery("") }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-start hover:bg-muted focus-visible:outline-none focus-visible:bg-muted",
                    a.code === value && "bg-primary/10 text-primary font-semibold"
                  )}
                >
                  <span className="font-mono tabular-nums text-muted-foreground w-14 shrink-0" dir="ltr">{a.code}</span>
                  <span className="truncate">{locale === "ar" ? a.nameAr : a.nameEn}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const LINE_ISSUE_KEY: Record<LineIssue, string> = {
  no_account: "acc_je_issue_no_account",
  not_postable: "acc_je_issue_not_postable",
  both_sides: "acc_je_issue_both_sides",
  no_amount: "acc_je_issue_no_amount",
}

const ENTRY_ISSUE_KEY: Record<EntryIssue, string> = {
  bad_date: "acc_je_issue_bad_date",
  no_description: "acc_je_issue_no_description",
  min_lines: "acc_je_issue_min_lines",
  unbalanced: "acc_je_issue_unbalanced",
}

/**
 * New journal entry (قيد يومية جديد). Balanced before it can be posted, blocked
 * on a closed period, and written through the same path as every automatic
 * entry — so the moment it posts, every statement, ledger and check reads it.
 */
export function NewJournalEntryView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const router = useRouter()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can, isLoading: permsLoading } = usePermissions()
  const canPost = can("accounting.post")
  const data = useAccounting()

  const [date, setDate] = useState(isoToday())
  const [reference, setReference] = useState("")
  const [description, setDescription] = useState("")
  const [project, setProject] = useState("")
  const [costCenter, setCostCenter] = useState<string>(DEFAULT_COST_CENTERS[2].code)
  const [rows, setRows] = useState<Row[]>([newRow(), newRow()])
  const [saving, setSaving] = useState<"draft" | "posted" | null>(null)
  const [showIssues, setShowIssues] = useState(false)
  // Withholding tax (finance review, 23 Sep 2026): a payment to a non-resident
  // withholds tax at the payment type's rate; the component adds the credit to
  // 210302 and the entry's other lines carry the gross cost and the net paid.
  const [whtOn, setWhtOn] = useState(false)
  const [whtType, setWhtType] = useState("technical_services")
  const [whtRatePct, setWhtRatePct] = useState<string | null>(null)
  const [whtBaseInput, setWhtBaseInput] = useState<string | null>(null)
  const [whtParty, setWhtParty] = useState("")

  const projectName = data.projects.find((p) => p.id === project)?.name ?? null
  const userLines: ManualLineInput[] = rows.map((r) => ({
    account: r.account,
    debit: r.debit,
    credit: r.credit,
    note: r.note,
    partyName: r.partyName,
    project: project || null,
    projectName,
    costCenter,
  }))
  // The base defaults to the expense debits — the gross cost of the service —
  // until the accountant types their own.
  const expenseDebits = Math.round(rows.filter((r) => r.account.startsWith("5")).reduce((sum, r) => sum + (Number(r.debit) || 0), 0) * 100) / 100
  const whtBase = whtBaseInput !== null ? Number(whtBaseInput) || 0 : expenseDebits
  const whtRateValue = whtRatePct !== null ? (Number(whtRatePct) || 0) / 100 : whtRate(whtType, data.settings.whtRates)
  const whtAmount = whtOn ? computeWht(whtBase, whtRateValue) : 0
  const whtInvalid = whtOn && whtAmount <= 0
  const lines: ManualLineInput[] =
    whtOn && whtAmount > 0
      ? [
          ...userLines,
          {
            ...whtLine({ type: whtType, rate: whtRateValue, base: whtBase, partyName: whtParty, note: `${whtTypeName(whtType, "ar")} — ${Math.round(whtRateValue * 10000) / 100}%` }),
            project: project || null,
            projectName,
            costCenter,
          },
        ]
      : userLines
  const validation = validateManualEntry({ date, description, lines })
  const closed = useMemo(() => isPeriodClosed(data.periods, date), [data.periods, date])
  const balanced = Math.round(validation.totalDebit * 100) === Math.round(validation.totalCredit * 100) && validation.totalDebit > 0

  const update = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  /** Put the difference on the row being edited, on whichever side closes the entry. */
  const balanceInto = (key: string) => {
    const diff = validation.difference
    if (diff === 0) return
    const row = rows.find((r) => r.key === key)
    if (!row) return
    const current = diff > 0 ? Number(row.credit) || 0 : Number(row.debit) || 0
    const next = Math.round((current + Math.abs(diff)) * 100) / 100
    update(key, diff > 0 ? { credit: String(next), debit: "" } : { debit: String(next), credit: "" })
  }

  const save = async (status: "draft" | "posted") => {
    if (!firestore || saving) return
    setShowIssues(true)
    if (!validation.ok || closed || whtInvalid) return
    setSaving(status)
    try {
      const res = await saveManualEntry(firestore, {
        organizationId: data.organizationId,
        userId: data.userId,
        userName: data.userName,
        date,
        description,
        reference,
        lines,
        status,
        costCenter,
      })
      toast({ title: status === "posted" ? t("acc_je_saved_posted", { number: res.entryNumber }) : t("acc_je_saved_draft", { number: res.entryNumber }) })
      router.push(`${accountingBasePath(portal)}/journal?entry=${encodeURIComponent(res.id)}`)
    } catch (err) {
      console.error(err)
      toast({
        title: err instanceof ClosedPeriodError ? t("acc_entry_closed_period", { period: err.period }) : t("acc_save_error"),
        variant: "destructive",
      })
    } finally {
      setSaving(null)
    }
  }

  const issueFor = (index: number): LineIssue | undefined => (showIssues ? validation.lineIssues[index] : undefined)

  return (
    <AccountingShell portal={portal} title={t("acc_je_title")} description={t("acc_je_desc")} icon={FilePlus2}>
      {!permsLoading && !canPost ? (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
          <Lock size={18} className="mt-0.5 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-bold">{t("acc_je_no_permission_title")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("acc_je_no_permission_desc")}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <AccountingSection title={t("acc_je_header_section")} icon={FilePlus2}>
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="je-date">{t("acc_date")} *</Label>
                <Input id="je-date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} className={cn(showIssues && validation.entryIssues.includes("bad_date") && "border-destructive")} />
                {closed && (
                  <p className="flex items-center gap-1 text-[11px] text-destructive">
                    <Lock size={11} aria-hidden="true" />
                    {t("acc_entry_closed_period", { period: periodOf(date) })}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="je-ref">{t("acc_entry_reference")}</Label>
                <Input id="je-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("acc_je_reference_placeholder")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="je-cc">{t("acc_je_cost_center")}</Label>
                <SearchableSelect
                  id="je-cc"
                  size="md"
                  value={costCenter}
                  onChange={setCostCenter}
                  options={DEFAULT_COST_CENTERS.map((c) => ({ value: c.code, label: `${c.code} — ${locale === "ar" ? c.nameAr : c.nameEn}` }))}
                  placeholder={t("acc_je_cost_center")}
                  searchPlaceholder={t("acc_search_options")}
                  noResultsText={t("acc_no_options")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="je-project">{t("acc_filter_project")}</Label>
                <SearchableSelect
                  id="je-project"
                  size="md"
                  value={project || "__none__"}
                  onChange={(v) => setProject(v === "__none__" ? "" : v)}
                  options={[{ value: "__none__", label: t("acc_je_no_project") }, ...data.projects.map((p) => ({ value: p.id, label: p.name }))]}
                  placeholder={t("acc_filter_project")}
                  searchPlaceholder={t("acc_search_options")}
                  noResultsText={t("acc_no_options")}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
                <Label htmlFor="je-desc">{t("acc_description")} *</Label>
                <Textarea
                  id="je-desc"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("acc_je_description_placeholder")}
                  className={cn(showIssues && validation.entryIssues.includes("no_description") && "border-destructive")}
                />
              </div>
            </div>
          </AccountingSection>

          <AccountingSection
            title={t("acc_je_wht_title")}
            icon={Percent}
            action={
              <div className="flex items-center gap-2">
                <Label htmlFor="je-wht-on" className="text-xs font-semibold">{t("acc_je_wht_toggle")}</Label>
                <Switch id="je-wht-on" checked={whtOn} onCheckedChange={setWhtOn} />
              </div>
            }
          >
            {whtOn ? (
              <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
                <div className="space-y-1.5 lg:col-span-2">
                  <Label htmlFor="je-wht-type">{t("acc_wht_type")} *</Label>
                  <SearchableSelect
                    id="je-wht-type"
                    size="md"
                    value={whtType}
                    onChange={(v) => { setWhtType(v); setWhtRatePct(null) }}
                    options={WHT_TYPES.map((w) => ({
                      value: w.id,
                      label: `${whtTypeName(w.id, locale)} — ${Math.round(whtRate(w.id, data.settings.whtRates) * 10000) / 100}%`,
                    }))}
                    placeholder={t("acc_wht_type")}
                    searchPlaceholder={t("acc_search_options")}
                    noResultsText={t("acc_no_options")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="je-wht-rate">{t("acc_wht_rate_pct")}</Label>
                  <Input
                    id="je-wht-rate"
                    dir="ltr"
                    inputMode="decimal"
                    value={whtRatePct ?? String(Math.round(whtRateValue * 10000) / 100)}
                    onChange={(e) => setWhtRatePct(sanitizeDecimalInput(e.target.value))}
                    className="text-end tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="je-wht-base">{t("acc_wht_base")} *</Label>
                  <Input
                    id="je-wht-base"
                    dir="ltr"
                    inputMode="decimal"
                    value={whtBaseInput ?? (expenseDebits ? String(expenseDebits) : "")}
                    onChange={(e) => setWhtBaseInput(sanitizeDecimalInput(e.target.value))}
                    className={cn("text-end tabular-nums", showIssues && whtInvalid && "border-destructive")}
                  />
                  <p className="text-[11px] text-muted-foreground">{t("acc_je_wht_base_hint")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="je-wht-party">{t("acc_wht_supplier")}</Label>
                  <Input id="je-wht-party" value={whtParty} onChange={(e) => setWhtParty(e.target.value)} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-xs sm:col-span-2 lg:col-span-5">
                  <span className="text-muted-foreground">{t("acc_je_wht_explain", { account: "210302" })}</span>
                  <span className="flex items-center gap-2 font-bold">
                    {t("acc_wht_amount")} <Money value={whtAmount} scale="units" />
                    <span className="font-normal text-muted-foreground">· {t("acc_je_wht_net")}</span> <Money value={Math.max(0, whtBase - whtAmount)} scale="units" />
                  </span>
                </div>
                {showIssues && whtInvalid && <p className="text-[11px] text-destructive sm:col-span-2 lg:col-span-5">{t("acc_je_wht_issue")}</p>}
              </div>
            ) : (
              <p className="px-5 py-3 text-xs text-muted-foreground">{t("acc_je_wht_off_hint")}</p>
            )}
          </AccountingSection>

          <AccountingSection title={t("acc_je_lines_section")} icon={FilePlus2}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-muted/40 text-xs font-black text-muted-foreground">
                  <tr>
                    <th className="w-8 px-3 py-2.5 text-start">#</th>
                    <th className="w-72 px-3 py-2.5 text-start">{t("acc_account_name")}</th>
                    <th className="px-3 py-2.5 text-start">{t("acc_je_line_note")}</th>
                    <th className="w-40 px-3 py-2.5 text-start">{t("acc_je_party")}</th>
                    <th className="w-32 px-3 py-2.5 text-end">{t("acc_debit")}</th>
                    <th className="w-32 px-3 py-2.5 text-end">{t("acc_credit")}</th>
                    <th className="w-20 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const issue = issueFor(i)
                    return (
                      <tr key={row.key} className="border-t align-top">
                        <td className="px-3 py-2 pt-4 text-xs tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2">
                          <AccountPicker value={row.account} onChange={(code) => update(row.key, { account: code })} invalid={issue === "no_account" || issue === "not_postable"} />
                          {issue && <p className="mt-1 text-[11px] text-destructive">{t(LINE_ISSUE_KEY[issue])}</p>}
                        </td>
                        <td className="px-3 py-2">
                          <Input value={row.note} onChange={(e) => update(row.key, { note: e.target.value })} className="h-9 text-xs" aria-label={t("acc_je_line_note")} />
                        </td>
                        <td className="px-3 py-2">
                          <Input value={row.partyName} onChange={(e) => update(row.key, { partyName: e.target.value })} className="h-9 text-xs" aria-label={t("acc_je_party")} />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            dir="ltr"
                            inputMode="decimal"
                            value={row.debit}
                            onChange={(e) => update(row.key, { debit: sanitizeDecimalInput(e.target.value), ...(e.target.value ? { credit: "" } : {}) })}
                            className={cn("h-9 text-end text-xs tabular-nums", (issue === "both_sides" || issue === "no_amount") && "border-destructive")}
                            aria-label={t("acc_debit")}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            dir="ltr"
                            inputMode="decimal"
                            value={row.credit}
                            onChange={(e) => update(row.key, { credit: sanitizeDecimalInput(e.target.value), ...(e.target.value ? { debit: "" } : {}) })}
                            className={cn("h-9 text-end text-xs tabular-nums", (issue === "both_sides" || issue === "no_amount") && "border-destructive")}
                            aria-label={t("acc_credit")}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {validation.difference !== 0 && (
                              <button
                                type="button"
                                onClick={() => balanceInto(row.key)}
                                title={t("acc_je_balance_here")}
                                aria-label={t("acc_je_balance_here")}
                                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <CheckCircle2 size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setRows((prev) => (prev.length > 2 ? prev.filter((r) => r.key !== row.key) : prev))}
                              disabled={rows.length <= 2}
                              aria-label={t("acc_je_remove_line")}
                              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:text-destructive disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {whtOn && whtAmount > 0 && (
                    <tr className="border-t bg-cta/5 align-top">
                      <td className="px-3 py-2 pt-4 text-xs tabular-nums text-muted-foreground">{rows.length + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex h-9 items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs">
                          <span className="font-mono tabular-nums text-muted-foreground" dir="ltr">210302</span>
                          <span className="truncate">{accountName("210302", locale)}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-cta">{t("acc_je_wht_line_auto")}</p>
                      </td>
                      <td className="px-3 py-2 pt-4 text-xs text-muted-foreground">{whtTypeName(whtType, locale)} — {Math.round(whtRateValue * 10000) / 100}%</td>
                      <td className="px-3 py-2 pt-4 text-xs">{whtParty}</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 pt-4 text-end text-xs tabular-nums"><Money value={whtAmount} scale="units" /></td>
                      <td className="px-3 py-2" />
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30 font-black">
                    <td className="px-3 py-3" colSpan={4}>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => setRows((prev) => [...prev, newRow()])}>
                          <Plus size={13} />
                          {t("acc_je_add_line")}
                        </Button>
                        <span
                          className={cn(
                            "flex items-center gap-1.5 text-xs",
                            balanced ? "text-success" : validation.totalDebit + validation.totalCredit > 0 ? "text-destructive" : "text-muted-foreground"
                          )}
                        >
                          {balanced ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                          {balanced ? t("acc_je_balanced") : t("acc_je_difference")}
                          {!balanced && <Money value={Math.abs(validation.difference)} scale="units" />}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-end"><Money value={validation.totalDebit} scale="units" /></td>
                    <td className="px-3 py-3 text-end"><Money value={validation.totalCredit} scale="units" /></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </AccountingSection>

          {showIssues && validation.entryIssues.length > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-destructive" />
              <ul className="space-y-0.5 text-xs text-destructive">
                {validation.entryIssues.map((issue) => (
                  <li key={issue}>{t(ENTRY_ISSUE_KEY[issue])}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => router.push(`${accountingBasePath(portal)}/journal`)} disabled={!!saving}>
              {t("acc_cancel")}
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => save("draft")} disabled={!!saving || closed || data.isLoading}>
              {saving === "draft" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {t("acc_je_save_draft")}
            </Button>
            <Button className="gap-1.5" onClick={() => save("posted")} disabled={!!saving || closed || data.isLoading}>
              {saving === "posted" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {t("acc_je_post")}
            </Button>
          </div>
          <p className="text-end text-[11px] text-muted-foreground">{t("acc_je_post_hint")}</p>
        </div>
      )}
    </AccountingShell>
  )
}
