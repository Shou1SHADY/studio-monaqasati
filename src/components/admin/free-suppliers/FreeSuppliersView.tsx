"use client"

// Admin → Free suppliers: the supplier companies on the FREE journey, apart from the subscribed ones (Admin → Suppliers).
// The admin sees who joined and how, whose documents wait for approval, who is quoting, and moves a company up to the full
// plan. Nothing here deletes an account.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowRight, CheckCircle2, Eye, Loader2, Rocket, Search, Users } from "lucide-react"
import { Link } from "@/i18n/routing"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Chip } from "@/components/module-ui/Chip"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { IconButton } from "@/components/module-ui/IconButton"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { ShowMoreRow } from "@/components/module-ui/ShowMoreRow"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { LtrValue } from "@/components/admin/crm/parts"
import { SupplierFileDialog, type SupplierFile } from "@/components/admin/SupplierFileDialog"
import { useFirestore, useUser } from "@/firebase"
import { useFreeSuppliers, useSupplierOrderCounts } from "@/hooks/useFreeSuppliers"
import { useToast } from "@/hooks/use-toast"
import {
  FREE_FILTERS,
  describeSource,
  filterCounts,
  filterFreeRows,
  freeKpis,
  quotaState,
  sortFreeRows,
  type FreeFilter,
  type FreeSort,
  type FreeSupplierRow,
} from "@/lib/admin-free-suppliers"
import { decideSupplierSpecs, setSupplierApproval, standingRefOfCompany } from "@/lib/supplier-admin-writes"
import type { ApprovalState } from "@/lib/supplier-approval"
import { setSupplierPlan } from "@/lib/supplier-plan-writes"
import { PAID_TRIAL_DEFAULT_DAYS, parseTrialDays } from "@/lib/subscription-status"
import { TrialDaysInput } from "@/components/admin/TrialDaysInput"
import { cn } from "@/lib/utils"

const PAGE = 20

const APPROVAL_TONE: Record<ApprovalState, PillTone> = { approved: "ok", pending: "warn", ready: "info", missing: "mute" }

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

function fileOf(r: FreeSupplierRow): SupplierFile {
  const d = r.doc
  const legal = (d.legalDocuments ?? {}) as Record<string, unknown>
  const docs: SupplierFile["legalDocuments"] = {}
  for (const [k, v] of Object.entries(legal)) docs[k] = typeof v === "string" ? { url: v } : (v as { url?: string; expiryDate?: string })
  const pendingSpecs = Array.isArray(d.pendingSpecializations) ? strings(d.pendingSpecializations) : null
  const pendingCities = Array.isArray(d.pendingCoverageCities) ? strings(d.pendingCoverageCities) : null
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    contact: r.phone,
    city: r.city,
    crNumber: r.crNumber,
    taxNumber: r.taxNumber,
    category: r.specializations[0] ?? "",
    specializations: r.specializations,
    coverageCities: strings(d.coverageCities),
    pendingSpecializations: pendingSpecs,
    pendingCoverageCities: pendingCities,
    hasSpecsRequest: pendingSpecs != null || pendingCities != null,
    legalDocuments: docs,
    certificates: Array.isArray(d.certificates) ? (d.certificates as SupplierFile["certificates"]) : [],
    hasAllRequiredDocs: r.hasAllRequiredDocs,
    verified: r.verified,
  }
}

export function FreeSuppliersView() {
  const t = useTranslations("Portal.Admin.FreeSuppliers")
  const tS = useTranslations("Portal.Admin.Suppliers")
  const tPlan = useTranslations("Portal.AdminModules")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const { rows, limit, isLoading } = useFreeSuppliers()

  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<FreeFilter>("all")
  const [sort, setSort] = useState<FreeSort>("attention")
  const [shownCount, setShownCount] = useState(PAGE)
  const [openId, setOpenId] = useState<string | null>(null)
  const [upgrading, setUpgrading] = useState<FreeSupplierRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const kpis = useMemo(() => freeKpis(rows, Date.now()), [rows])
  const counts = useMemo(() => filterCounts(rows), [rows])
  const filtered = useMemo(() => sortFreeRows(filterFreeRows(rows, { filter, search }), sort), [rows, filter, search, sort])
  const shown = filtered.slice(0, shownCount)
  const orders = useSupplierOrderCounts(useMemo(() => shown.map((r) => r.id), [shown]))
  const open = openId ? (rows.find((r) => r.id === openId) ?? null) : null

  const day = (ms: number | null) => (ms == null ? "—" : new Date(ms).toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { year: "numeric", month: "short", day: "numeric" }))
  const ordersOf = (r: FreeSupplierRow) => (orders.has(r.id) ? String(orders.get(r.id)) : "…")
  const quotesOf = (r: FreeSupplierRow) => (limit != null ? `${r.quotesThisMonth} / ${limit}` : String(r.quotesThisMonth))
  const notifyTarget = (r: FreeSupplierRow) => r.ownerUserId ?? r.id

  const approve = async (r: FreeSupplierRow, verify: boolean) => {
    if (!firestore) return
    setBusyId(r.id)
    try {
      await setSupplierApproval(firestore, { standing: standingRefOfCompany(firestore, r), notifyUserId: notifyTarget(r), verify })
      toast({ title: verify ? tS("verified_success") : tS("unverified_success"), description: tS("update_desc") })
    } catch (e) {
      toast({ title: tS("error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  const decideSpecs = async (r: FreeSupplierRow, approveIt: boolean) => {
    if (!firestore) return
    const file = fileOf(r)
    setBusyId(r.id)
    try {
      await decideSupplierSpecs(firestore, {
        standing: standingRefOfCompany(firestore, r),
        notifyUserId: notifyTarget(r),
        approve: approveIt,
        pendingSpecializations: file.pendingSpecializations,
        pendingCoverageCities: file.pendingCoverageCities,
        notice: approveIt
          ? { title: tS("specs_approved_notif_title"), message: tS("specs_approved_notif_msg") }
          : { title: tS("specs_rejected_notif_title"), message: tS("specs_rejected_notif_msg") },
      })
      toast({ title: approveIt ? tS("specs_approved_toast") : tS("specs_rejected_toast") })
    } catch (e) {
      toast({ title: tS("error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  const [asTrial, setAsTrial] = useState(false)
  const [trialDays, setTrialDays] = useState(String(PAID_TRIAL_DEFAULT_DAYS))
  const trialLength = asTrial ? parseTrialDays(trialDays) : null
  const switchToFull = async () => {
    if (!firestore || !user || !upgrading) return
    if (asTrial && trialLength === null) return
    const target = upgrading
    setBusyId(target.id)
    try {
      await setSupplierPlan(firestore, target.id, "full", { uid: user.uid, name: user.displayName || user.email || "" }, trialLength ?? undefined)
      toast({ title: trialLength !== null ? t("upgrade_trial_done", { name: target.name, days: trialLength }) : t("upgrade_done", { name: target.name }) })
      setUpgrading(null)
      setAsTrial(false)
    } catch (e) {
      toast({ title: t("upgrade_failed"), description: e instanceof Error ? e.message : String(e), variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  const sourcePill = (r: FreeSupplierRow) => {
    const s = describeSource(r.signup)
    return <StatusPill tone={s.tone}>{t(s.labelKey)}</StatusPill>
  }
  const approvalPill = (r: FreeSupplierRow) => <StatusPill tone={APPROVAL_TONE[r.approval]}>{t(`approval_${r.approval}`)}</StatusPill>

  const columns: DataColumn<FreeSupplierRow>[] = [
    {
      key: "company",
      header: t("col_company"),
      label: t("col_company"),
      cell: (r) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-bold">{r.name || tS("unspecified")}</span>
          {r.ownerName && <span className="text-xs text-muted-foreground">{r.ownerName}</span>}
          <span className="text-xs text-muted-foreground">
            <LtrValue value={r.phone} />
          </span>
        </div>
      ),
    },
    {
      key: "field",
      header: t("col_field"),
      label: t("col_field"),
      hideBelow: "lg",
      cell: (r) => {
        const first = r.specializations[0]
        const more = r.specializations.length - 1
        return r.city || first ? (
          <div className="flex min-w-0 flex-col text-xs">
            {r.city && <span className="font-semibold">{r.city}</span>}
            {first && (
              <span className="text-muted-foreground">
                {first}
                {more > 0 && <bdi dir="ltr"> +{more}</bdi>}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )
      },
    },
    { key: "source", header: t("col_source"), label: t("col_source"), cell: sourcePill },
    { key: "approval", header: t("col_approval"), label: t("col_approval"), cell: approvalPill },
    {
      key: "quotes",
      header: t("col_quotes"),
      label: t("col_quotes"),
      numeric: true,
      cell: (r) => <span className={cn(limit != null && quotaState(r.quotesThisMonth, limit).full && "font-bold text-warning")}>{quotesOf(r)}</span>,
    },
    { key: "orders", header: t("col_orders"), label: t("col_orders"), numeric: true, cell: ordersOf },
    { key: "activity", header: t("col_activity"), label: t("col_activity"), hideBelow: "xl", cell: (r) => <span className="text-xs">{day(r.lastActivityAt)}</span> },
    { key: "joined", header: t("col_joined"), label: t("col_joined"), hideBelow: "xl", cell: (r) => <span className="text-xs">{day(r.joinedAt)}</span> },
    {
      key: "actions",
      header: <span className="sr-only">{t("col_actions")}</span>,
      label: t("col_actions"),
      className: "w-px",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <IconButton variant="outline" label={t("action_view")} icon={Eye} onClick={() => setOpenId(r.id)} />
          {r.approval !== "approved" && (
            <IconButton
              variant="default"
              label={r.hasAllRequiredDocs ? t("action_approve") : `${t("action_approve")} — ${tS("verify_needs_docs")}`}
              icon={CheckCircle2}
              disabled={!r.hasAllRequiredDocs || busyId === r.id}
              onClick={() => void approve(r, true)}
            />
          )}
          <IconButton variant="outline" label={t("action_upgrade")} icon={Rocket} disabled={busyId === r.id} onClick={() => setUpgrading(r)} />
        </div>
      ),
    },
  ]

  const kpiCards = [
    { id: "total", label: t("kpi_total"), n: kpis.total, warn: false },
    { id: "waiting", label: t("kpi_waiting"), n: kpis.waiting, warn: true },
    { id: "joined7", label: t("kpi_joined7"), n: kpis.joined7, warn: false },
    { id: "joined30", label: t("kpi_joined30"), n: kpis.joined30, warn: false },
    { id: "active", label: t("kpi_active"), n: kpis.active, warn: false },
  ]

  return (
    <div className="space-y-6 text-start">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-headline text-3xl font-black text-foreground">{t("page_title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("page_subtitle")}</p>
        </div>
        <Link href="/admin/suppliers" className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-1 text-sm font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("link_subscribed")}
          <ArrowRight size={16} className="rtl-flip" aria-hidden="true" />
        </Link>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" data-testid="free-kpis">
        {kpiCards.map((c) => (
          <li key={c.id} data-kpi={c.id} className={cn("rounded-xl border bg-card p-4 shadow-sm", c.warn && c.n > 0 && "border-warning/40 bg-warning/5")}>
            <small className="block text-xs text-muted-foreground">{c.label}</small>
            <b className="text-2xl font-black tabular-nums">{c.n}</b>
          </li>
        ))}
      </ul>

      <section className="space-y-3" aria-labelledby="free-list-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="free-list-heading" className="text-lg font-bold">{t("list_title")}</h2>
          <p className="text-sm text-muted-foreground" data-testid="free-allowance">
            {limit != null ? t("allowance_on", { limit }) : t("allowance_off")}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder={t("search_placeholder")}
              aria-label={t("search_placeholder")}
              className="ps-10"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setShownCount(PAGE)
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="shrink-0">{t("sort_label")}</span>
            <NativeSelect value={sort} onChange={(e) => setSort(e.target.value as FreeSort)} className="sm:w-56">
              <option value="attention">{t("sort_attention")}</option>
              <option value="newest">{t("sort_newest")}</option>
              <option value="activity">{t("sort_activity")}</option>
            </NativeSelect>
          </label>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label={t("filters_label")}>
          {FREE_FILTERS.map((f) => (
            <Chip
              key={f}
              selected={filter === f}
              count={counts[f]}
              onClick={() => {
                setFilter(f)
                setShownCount(PAGE)
              }}
            >
              {t(`filter_${f}`)}
            </Chip>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center rounded-xl border bg-card p-20">
            <Loader2 className="animate-spin text-primary" size={32} aria-hidden="true" />
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <DataTable
              columns={columns}
              rows={shown}
              rowKey={(r) => r.id}
              caption={t("list_title")}
              labels={{ sortBy: (column) => t("sort_by", { column }), showMore: (count) => t("show_more_count", { count }) }}
              bordered={false}
              empty={<EmptyState icon={Users} title={t("empty_title")} description={t("empty_hint")} className="rounded-none border-0" />}
            />
            {filtered.length > shown.length && (
              <ShowMoreRow onClick={() => setShownCount((n) => n + PAGE)}>{t("show_more_count", { count: Math.min(PAGE, filtered.length - shown.length) })}</ShowMoreRow>
            )}
          </div>
        )}
        {!isLoading && filtered.length > 0 && (
          <p className="text-sm text-muted-foreground" data-testid="free-shown">
            {t("companies_shown", { shown: shown.length, total: filtered.length })}
          </p>
        )}
      </section>

      <SupplierFileDialog
        supplier={open ? fileOf(open) : null}
        open={open !== null}
        onOpenChange={(o) => !o && setOpenId(null)}
        statusBadge={open ? approvalPill(open) : null}
        onVerify={open ? (verify) => void approve(open, verify) : undefined}
        canWithdraw={false}
        onSpecsDecision={open ? (a) => void decideSpecs(open, a) : undefined}
      >
        {open && (
          <section className="rounded-xl border p-4" aria-label={t("facts_title")} data-testid="free-facts">
            <h4 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800">
              {t("facts_title")}
              <Badge variant="secondary" className="text-[11px]">{t("plan_free")}</Badge>
            </h4>
            <KeyValueRow label={t("col_source")} value={sourcePill(open)} />
            <KeyValueRow label={t("col_quotes")} value={quotesOf(open)} ltr />
            <KeyValueRow label={t("col_orders")} value={ordersOf(open)} ltr />
            <KeyValueRow label={t("col_activity")} value={day(open.lastActivityAt)} />
            <KeyValueRow label={t("col_joined")} value={day(open.joinedAt)} />
          </section>
        )}
      </SupplierFileDialog>

      <AlertDialog open={upgrading !== null} onOpenChange={(o) => !o && busyId === null && setUpgrading(null)}>
        <AlertDialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("upgrade_title", { name: upgrading?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              <b className="block text-foreground">{tPlan("plan_full")}</b>
              {tPlan("plan_full_desc")}
              <span className="mt-2 block">{t("upgrade_note")}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 rounded-lg border px-3 py-2.5 text-sm">
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" className="mt-1" checked={asTrial} onChange={(e) => setAsTrial(e.target.checked)} disabled={busyId !== null} />
              <span>
                <b className="block">{t("upgrade_trial")}</b>
                <span className="text-xs text-muted-foreground">{t("upgrade_trial_desc")}</span>
              </span>
            </label>
            {asTrial && <TrialDaysInput id="fs-trial-days" label={t("upgrade_trial_days")} value={trialDays} onChange={setTrialDays} disabled={busyId !== null} />}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>{t("upgrade_cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyId !== null || (asTrial && trialLength === null)}
              onClick={(e) => {
                e.preventDefault()
                void switchToFull()
              }}
            >
              {busyId !== null && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
              {t(asTrial ? "upgrade_trial_confirm" : "upgrade_confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
