"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import {
  ArrowRight,
  Building2,
  Calendar,
  FileText,
  FolderOpen,
  Loader2,
  ScrollText,
  Search,
  Truck,
  X,
} from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Link } from "@/i18n/routing"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { ComingSoon } from "@/components/shared/ComingSoon"
import { RECEIPTS_COMING_SOON } from "@/lib/feature-flags"
import { cn } from "@/lib/utils"

/**
 * The delivery-receipt register — the Finance-side read of `deliveries`.
 *
 * A "receipt" is not its own collection: `receipts/[id]` renders a printable
 * signed receipt for one `deliveries/{id}`. Until now that detail page was
 * only reachable from Goods Received and the RFQ offers view, so the Finance
 * nav item pointing at this URL 404'd. Goods Received stays the operational
 * screen (confirm a delivery, upload an attachment); this is the read-only
 * register you search and print from.
 */

type Delivery = {
  id: string
  rfqTitle?: string
  supplierName?: string
  deliveryPersonName?: string
  receivedByName?: string
  deliveryDate?: string
  confirmedAt?: unknown
  status?: string
  contractorOrgId?: string
  projectId?: string | null
  source?: string
}

/** Firestore Timestamp | ISO string | millis -> Date, or null. */
function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value && typeof value === "object" && "toDate" in value) {
    const d = (value as { toDate: () => Date }).toDate()
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(value as string | number)
  return Number.isNaN(d.getTime()) ? null : d
}

function fmtDate(value: unknown, locale: string) {
  const d = toDate(value)
  if (!d) return "—"
  // Western digits in both locales — these sit next to receipt numbers and
  // are read against invoices and delivery notes.
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export default function ContractorReceiptsPage() {
  // Gate BEFORE the register mounts — it must be a separate component, not an
  // early return inside one, or the hooks below would run conditionally.
  if (RECEIPTS_COMING_SOON) {
    return (
      <PortalLayout>
        <ComingSoon />
      </PortalLayout>
    )
  }
  return <ReceiptsRegister />
}

function ReceiptsRegister() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { organizationId, isLoading: isProfileLoading } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const myOrgId = organizationId || ""

  const [search, setSearch] = useState("")
  const [supplierFilter, setSupplierFilter] = useState("all")
  const [projectFilter, setProjectFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  // Same query Goods Received uses — a receipt exists only for a confirmed
  // delivery, so an unconfirmed one has nothing to print.
  const deliveriesQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId) return null
    return query(
      collection(firestore, "deliveries"),
      where("contractorOrgId", "==", myOrgId),
      where("status", "==", "confirmed")
    )
  }, [firestore, myOrgId])
  const { data: deliveriesData, isLoading: deliveriesLoading } = useCollection(deliveriesQuery)

  const projectsQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId) return null
    return query(collection(firestore, "projects"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId])
  const { data: projectsData } = useCollection(projectsQuery)

  const projectNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of (projectsData || []) as { id: string; name?: string }[]) {
      map.set(p.id, p.name || p.id)
    }
    return map
  }, [projectsData])

  const receipts = useMemo(() => {
    return ((deliveriesData || []) as Delivery[])
      .slice()
      .sort((a, b) => (toDate(b.confirmedAt)?.getTime() ?? 0) - (toDate(a.confirmedAt)?.getTime() ?? 0))
  }, [deliveriesData])

  const suppliers = useMemo(() => {
    const set = new Set<string>()
    for (const r of receipts) if (r.supplierName) set.add(r.supplierName)
    return Array.from(set).sort((a, b) => a.localeCompare(b, locale === "ar" ? "ar" : "en"))
  }, [receipts, locale])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    // Date bounds are inclusive of the whole day the user picked.
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null
    const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null

    return receipts.filter((r) => {
      if (supplierFilter !== "all" && r.supplierName !== supplierFilter) return false
      if (projectFilter !== "all") {
        if (projectFilter === "__none__" ? !!r.projectId : r.projectId !== projectFilter) return false
      }
      if (from || to) {
        const confirmed = toDate(r.confirmedAt)
        if (!confirmed) return false
        if (from && confirmed < from) return false
        if (to && confirmed > to) return false
      }
      if (!q) return true
      return [r.supplierName, r.rfqTitle, r.receivedByName, r.deliveryPersonName, r.id].some((f) =>
        (f || "").toLowerCase().includes(q)
      )
    })
  }, [receipts, search, supplierFilter, projectFilter, dateFrom, dateTo])

  const stats = useMemo(() => {
    const now = new Date()
    let thisMonth = 0
    const projectIds = new Set<string>()
    for (const r of receipts) {
      const d = toDate(r.confirmedAt)
      if (d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) thisMonth++
      if (r.projectId) projectIds.add(r.projectId)
    }
    return { total: receipts.length, thisMonth, suppliers: suppliers.length, projects: projectIds.size }
  }, [receipts, suppliers])

  const hasActiveFilters =
    !!search || supplierFilter !== "all" || projectFilter !== "all" || !!dateFrom || !!dateTo

  const clearFilters = () => {
    setSearch("")
    setSupplierFilter("all")
    setProjectFilter("all")
    setDateFrom("")
    setDateTo("")
  }

  const isLoading = isUserLoading || isProfileLoading || (deliveriesLoading && !deliveriesData)

  const dateInputClass =
    "h-10 rounded-md border border-input bg-background px-3 py-2 text-sm w-[140px] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

  return (
    <PortalLayout>
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        <div>
          <h1 className="text-3xl font-black text-foreground font-headline flex items-center gap-2">
            <ScrollText size={26} className="text-primary shrink-0" />
            {t("receipts_title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("receipts_desc")}</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile icon={ScrollText} label={t("receipts_stat_total")} value={stats.total} accent="bg-primary/10 text-primary" />
          <StatTile icon={Calendar} label={t("receipts_stat_this_month")} value={stats.thisMonth} accent="bg-cta/10 text-cta" />
          <StatTile icon={Truck} label={t("receipts_stat_suppliers")} value={stats.suppliers} accent="bg-accent/10 text-accent" />
          <StatTile icon={FolderOpen} label={t("receipts_stat_projects")} value={stats.projects} accent="bg-success/10 text-success" />
        </div>

        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("receipts_search_placeholder")}
              className="ps-9"
              aria-label={t("receipts_search_placeholder")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="w-[170px]" aria-label={t("receipts_filter_supplier")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">{t("receipts_all_suppliers")}</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-[170px]" aria-label={t("receipts_filter_project")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">{t("receipts_all_projects")}</SelectItem>
                <SelectItem value="__none__">{t("receipts_no_project")}</SelectItem>
                {Array.from(projectNames.entries()).map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t("receipts_date_from")}
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} dir="ltr" className={dateInputClass} />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t("receipts_date_to")}
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} dir="ltr" className={dateInputClass} />
            </label>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground hover:text-destructive">
                <X size={13} />
                {t("receipts_clear_filters")}
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        ) : receipts.length === 0 ? (
          <EmptyState
            title={t("receipts_empty_title")}
            description={t("receipts_empty_desc")}
            action={
              <Link href="/contractor/goods-received">
                <Button variant="outline" className="gap-2">
                  {t("receipts_go_to_goods")}
                  <ArrowRight size={14} className={cn(isRtl ? "rotate-180" : "")} />
                </Button>
              </Link>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={t("receipts_no_results")}
            description={t("receipts_no_results_desc")}
            action={<Button variant="outline" size="sm" onClick={clearFilters}>{t("receipts_clear_filters")}</Button>}
          />
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {t("receipts_showing_count", { shown: visible.length, total: receipts.length })}
            </p>
            <div className="rounded-xl border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("receipts_col_number")}</TableHead>
                    <TableHead>{t("receipts_col_description")}</TableHead>
                    <TableHead>{t("receipts_col_supplier")}</TableHead>
                    <TableHead>{t("receipts_col_delivery_date")}</TableHead>
                    <TableHead>{t("receipts_col_confirmed")}</TableHead>
                    <TableHead>{t("receipts_col_project")}</TableHead>
                    <TableHead className="text-end">{t("receipts_col_actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        {/* Same document number the printable receipt prints
                            (receipts/[id]/page.tsx) — the two must match or
                            the register cannot be reconciled against a
                            printed copy. */}
                        <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                          DEL-{r.id.substring(0, 8).toUpperCase()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <p className="font-bold text-sm text-foreground line-clamp-2">
                          {r.rfqTitle || t("receipts_untitled")}
                        </p>
                        {r.receivedByName && (
                          <p className="text-[11px] text-muted-foreground truncate">{r.receivedByName}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="flex items-center gap-1.5">
                          <Building2 size={12} className="text-muted-foreground shrink-0" />
                          <span className="truncate">{r.supplierName || "—"}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground" suppressHydrationWarning>
                        {fmtDate(r.deliveryDate, locale)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground" suppressHydrationWarning>
                        {fmtDate(r.confirmedAt, locale)}
                      </TableCell>
                      <TableCell>
                        {r.projectId ? (
                          <Badge variant="outline" className="text-primary border-primary/20 bg-primary/5 text-[10px] gap-1 max-w-[160px]">
                            <FolderOpen size={9} className="shrink-0" />
                            <span className="truncate">{projectNames.get(r.projectId) || r.projectId}</span>
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button asChild size="sm" variant="outline"
                            className="gap-1.5 border-success/30 text-success hover:bg-success hover:text-white hover:border-success">
                            <Link href={`/contractor/receipts/${r.id}`}>
                              <FileText size={13} />
                              {t("receipts_view")}
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  )
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType
  label: string
  value: number
  accent: string
}) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-center gap-3">
      <span className={cn("grid place-items-center h-10 w-10 rounded-lg shrink-0", accent)} aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted-foreground truncate">{label}</p>
        <p className="text-lg font-black text-foreground" dir="ltr">{value}</p>
      </div>
    </div>
  )
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      <ScrollText size={48} className="text-muted-foreground/20" aria-hidden="true" />
      <p className="font-bold text-muted-foreground">{title}</p>
      <p className="text-sm text-muted-foreground/70 max-w-sm">{description}</p>
      <div className="mt-2">{action}</div>
    </div>
  )
}
