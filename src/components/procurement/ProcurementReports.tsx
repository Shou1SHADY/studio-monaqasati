"use client"

// التقارير - seven questions over the live record (PRD 2.0 §9, prototype viewRep): what we bought by supplier, by project or
// delivery site, delivery on time, competition on RFQs, exceptions, savings against the last price, and commitments and dues
// (or - without Finance - "received and paid, for the accountant"). The page opens on the prototype's two panels: this
// month's spend by supplier beside the seven reports, each with its CSV. A report opens to its table, with the period, the
// delivery site and the order TAGS (not the lowest, short competition, direct over the cap, lump sum, not VAT-registered) as
// filters, and the same tags as columns. Every table is one pure function in `src/lib/procurement/reports.ts`.
//
// Money is stated with its basis (G-18): every value here is BEFORE VAT, a commitment and not a cost - the heading of each
// money column says so, and so does the CSV. A member who may not see money is shown the reports that carry none; the others
// are removed, not masked. CSV carries plain numbers and no currency sign.

import type { ReactNode } from "react"
import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { AlertTriangle, ArrowLeft, Clock, Download, Info, Loader2, Lock, MapPin, Printer, Scale, TrendingDown, Users, Wallet, type LucideIcon, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Link, useRouter } from "@/i18n/routing"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { Chip } from "@/components/module-ui/Chip"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useModules } from "@/hooks/useCompanyModules"
import { useToast } from "@/hooks/use-toast"
import { useDeliverySiteList } from "@/hooks/useDeliverySiteList"
import { NO_SITE, orderSiteIds } from "@/lib/procurement/site-counts"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { useProcurementNeeds } from "@/hooks/useProcurementNeeds"
import { useProcurementWorld, type ProcOffer, type ProcRfq } from "@/hooks/useProcurementWorld"
import { displayDocNumber } from "@/lib/procurement/format"
import { todayOf } from "@/lib/procurement/po"
import {
  COMMITMENT_BUCKETS,
  CONCENTRATION_PERCENT,
  ORDER_TAGS,
  committedOrders,
  cycleAndCompetition,
  deliveryPerformance,
  exceptions,
  lastDays,
  openCommitments,
  orderTags,
  presetPeriod,
  priceDrift,
  receivedAndPaid,
  REPORT_PERIOD_PRESETS,
  reportWorld,
  savingsSummary,
  spendByProject,
  spendBySupplier,
  type OrderTag,
  type ProjectSpendRow,
  type RawReportOffer,
  type RawReportRfq,
  type ReportFilter,
  type ReportPeriodPreset,
  type TagCounts,
} from "@/lib/procurement/reports"
import { csvText, PROC_REPORTS_HREF, REPORT_NEEDS_PRICE, toProcWorld, visibleReports, type ReportId } from "@/lib/procurement/shell"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

/** On screen: the sign, isolated LTR. */
const money = (n: number | null | undefined) => (n == null ? "—" : sarLtr(Math.round(n).toLocaleString("en-US")))
const money2 = (n: number | null | undefined) => (n == null ? "—" : sarLtr(n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })))
const signed = (n: number) => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : money(0))
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`)
const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"))

const REPORT_PAGE = 50

/** The prototype's order of the seven. */
const REPORT_ORDER: readonly ReportId[] = ["supplier", "project", "delivery", "cycle", "exceptions", "drift", "commitments"]

const TAG_TONE = { not_lowest: "warn", short_competition: "warn", direct_over: "bad", lump: "info", unregistered: "mute" } as const

function fmtDay(day: string | null | undefined, locale: string): string {
  if (!day) return "—"
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" })
}

function downloadCsv(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ProcurementReports() {
  const t = useTranslations("Portal.ProcReports")
  const tProc = useTranslations("Portal.Procurement")
  const tPay = useTranslations("Portal.ProcOrders.pay")
  const locale = useLocale()
  const RowChevron = locale === "ar" ? ChevronLeft : ChevronRight
  const router = useRouter()
  const params = useSearchParams()
  const { on } = useModules()
  const { toast } = useToast()
  const loaded = useProcurementWorld()
  const { actor, loading } = loaded
  const [now] = useState(() => new Date())
  const today = todayOf(now)

  const { orders, deliveries, rfqs, offers, policies, supplierFacts, supplierRecords } = loaded
  const firestore = useFirestore()
  const pmOn = on("project-management")
  const financeOn = on("payments")
  const projectsQ = useMemoFirebase(() => (firestore && loaded.orgId && pmOn ? query(collection(firestore, "projects"), where("organizationId", "==", loaded.orgId)) : null), [firestore, loaded.orgId, pmOn])
  const { data: projectDocs } = useCollection<{ pm?: { no?: string | null } | null }>(projectsQ)
  // The project's own number (PM 1.0 `pm.no`, PJ-yyyy/NNN) beside its name, as the prototype lists them.
  const projectNo = useMemo(() => new Map((projectDocs || []).map((p) => [p.id, p.pm?.no || ""])), [projectDocs])
  // When each RFQ's need reached us - the cycle report counts from there. The
  // page head already reads the same needs desk, so its listeners are shared.
  const { needs } = useProcurementNeeds(loaded)
  const needArrivals = useMemo(() => {
    const out: Record<string, string> = {}
    for (const n of needs) if (n.rfqId && n.at && (!out[n.rfqId] || n.at < out[n.rfqId])) out[n.rfqId] = n.at
    return out
  }, [needs])
  const world = useMemo(
    () =>
      reportWorld(toProcWorld({ orders, deliveries, rfqs, offers, policies, supplierFacts }), {
        // The raw documents carry what the Today world drops: an early close, a
        // keyed-in offer, the offer's credit days, advance and quoted rates.
        rfqs: rfqs as Array<ProcRfq & RawReportRfq>,
        offers: offers as Array<ProcOffer & RawReportOffer>,
        supplierRecords,
        needArrivals,
      }),
    [orders, deliveries, rfqs, offers, policies, supplierFacts, supplierRecords, needArrivals]
  )

  const sees = actor.seesPrices
  const reports = useMemo(() => REPORT_ORDER.filter((id) => visibleReports(sees).includes(id)), [sees])
  const asked = params.get("report")
  const overview = !asked || !reports.includes(asked as ReportId)
  const report: ReportId = overview ? reports[0] : (asked as ReportId)
  const setReport = useCallback((id: ReportId | null) => router.replace(id ? `${PROC_REPORTS_HREF}?report=${id}` : PROC_REPORTS_HREF), [router])

  // A link may name the period (Today's drift tile counts the last 30 days: `?period=30`).
  const [preset, setPreset] = useState<ReportPeriodPreset>(() => {
    const requested = params.get("period")
    return (REPORT_PERIOD_PRESETS as readonly string[]).includes(requested || "") && requested !== "custom" ? (requested as ReportPeriodPreset) : "90"
  })
  const [customFrom, setCustomFrom] = useState(() => lastDays(90, now).from || "")
  const [customTo, setCustomTo] = useState(today)
  const period = useMemo(() => presetPeriod(preset, now, { from: customFrom, to: customTo }), [preset, now, customFrom, customTo])
  const periodFiltered = report !== "commitments"
  const [tag, setTag] = useState<OrderTag | null>(null)
  const [siteId, setSiteId] = useState("all")
  // Hundreds of rows stay light: 50 at a time, then the next 50 (NFR-03). The CSV always carries every row.
  const [limits, setLimits] = useState<Record<string, number>>({})
  useEffect(() => setLimits({}), [report, tag, siteId, preset, customFrom, customTo])
  const lim = (k: string) => limits[k] ?? REPORT_PAGE
  const moreRows = (k: string, total: number) =>
    total > lim(k) ? (
      <button
        type="button"
        onClick={() => setLimits((l) => ({ ...l, [k]: lim(k) + REPORT_PAGE }))}
        className="w-full border-t py-3 text-sm font-bold text-module transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring print:hidden"
      >
        {t("showMore", { count: Math.min(REPORT_PAGE, total - lim(k)) })}
      </button>
    ) : null

  const { sites: siteList } = useDeliverySiteList(loaded.orgId, pmOn, !overview)
  const siteName = useCallback((id: string) => siteList.find((x) => x.id === id)?.name || tProc("rfqpo.list.site_unknown"), [siteList, tProc])
  const siteOf = useCallback((po: PurchaseOrder) => orderSiteIds(po, rfqs as Array<{ id: string; products?: Array<{ deliverySiteId?: string | null }> | null }>), [rfqs])
  // One filter for every order-based report: the period, a tag, a delivery site.
  const filter = useMemo<ReportFilter>(() => ({ ...period, tag, siteId: siteId === "all" ? null : siteId, siteOf }), [period, tag, siteId, siteOf])
  const orderBased = report === "project" || report === "supplier" || report === "delivery" || report === "exceptions" || report === "commitments"

  // Without Project Management the project report groups by delivery site (PUR-10).
  const siteBy = useMemo(
    () => (pmOn ? undefined : { site: (po: PurchaseOrder) => { const id = siteOf(po)[0]; return id ? { id, name: siteName(id) } : null } }),
    [pmOn, siteOf, siteName]
  )
  const project = useMemo(() => (!overview && report === "project" ? spendByProject(world, filter, siteBy) : null), [overview, report, world, filter, siteBy])
  const supplier = useMemo(() => (!overview && report === "supplier" ? spendBySupplier(world, filter, now) : null), [overview, report, world, filter, now])
  const delivery = useMemo(() => (!overview && report === "delivery" ? deliveryPerformance(world, filter, now) : null), [overview, report, world, filter, now])
  const drift = useMemo(() => (!overview && report === "drift" ? priceDrift(world, period) : null), [overview, report, world, period])
  const cycle = useMemo(() => (!overview && report === "cycle" ? cycleAndCompetition(world, period) : null), [overview, report, world, period])
  const exc = useMemo(() => (!overview && report === "exceptions" ? exceptions(world, filter) : null), [overview, report, world, filter])
  const commit = useMemo(() => (!overview && report === "commitments" && financeOn ? openCommitments(world, now, filter) : null), [overview, report, financeOn, world, now, filter])
  const paid = useMemo(() => (!overview && report === "commitments" && !financeOn ? receivedAndPaid(world, filter) : null), [overview, report, financeOn, world, filter])

  // What each tag would leave, under the period and the site chosen.
  const tagCounts = useMemo<TagCounts | null>(() => {
    if (overview || !orderBased) return null
    const out: TagCounts = { not_lowest: 0, short_competition: 0, direct_over: 0, lump: 0, unregistered: 0 }
    for (const po of committedOrders(world, { ...filter, tag: null })) for (const x of orderTags(po)) out[x]++
    return out
  }, [overview, orderBased, world, filter])

  // This month's spend by supplier - the overview's left panel.
  const monthSpend = useMemo(() => (overview && sees ? spendBySupplier(world, { from: `${today.slice(0, 7)}-01`, to: today }, now) : null), [overview, sees, world, today, now])

  const docNo = (n: string) => displayDocNumber(n, locale)
  const basis = t("basis.excl")
  const mh = (key: string) => `${t(`cols.${key}`)} (${basis})`
  const requesterHead = t(pmOn ? "cols.requester" : "cols.site")
  const reportLabel = (id: ReportId) => t(id === "project" && !pmOn ? "report.project_site" : id === "commitments" && !financeOn ? "report.commitments_nofin" : `report.${id}`)
  const requester = (r: ProjectSpendRow) => {
    if (r.kind === "site") return r.projectName || t("requester.site")
    if (r.kind !== "project") return t(`requester.${r.kind}`)
    const no = r.projectId ? projectNo.get(r.projectId) : ""
    const name = r.projectName || r.projectId || ""
    return no ? `${displayDocNumber(no, locale)} · ${name}` : name
  }
  const excText = (kind: string, p: Record<string, string | number>) => {
    const text = tProc(`exception.${kind}`, p)
    return kind === "early_close" && p.reason ? `${text} - ${p.reason}` : text
  }
  const termsText = (days: number, source: string) => (source === "none" ? t("terms.none") : t("terms.days", { count: days }))
  const sitesText = (ids: string[]) => (ids.length ? ids.map(siteName).join(" · ") : "—")
  const tagsText = (tags: OrderTag[]) => tags.map((x) => t(`tag.${x}`)).join(" · ")
  const bucketsShown = commit ? COMMITMENT_BUCKETS.filter((b) => b !== "noDate" || commit.buckets.noDate.total > 0) : []
  const payText = (s: string) => tPay(`state_${s}`)

  /** The CSV of one report over the current filter - plain numbers, the basis in the headings. */
  const csvOf = (id: ReportId): { head: string[]; rows: Array<Array<string | number | null | undefined>> } => {
    if (id === "project") {
      const r = spendByProject(world, filter, siteBy)
      return { head: [requesterHead, t("cols.orders"), t("cols.lines"), mh("ordered"), mh("received"), mh("open"), t("cols.tags")], rows: [...r.rows.map((x) => [requester(x), x.orders, x.lines, x.ordered, x.receivedUnknown ? null : x.received, x.open, ORDER_TAGS.filter((g) => x.tags[g]).map((g) => `${t(`tag.${g}`)} ${x.tags[g]}`).join(" · ")]), [t("total"), r.totals.orders, r.totals.lines, r.totals.ordered, r.totals.received, r.totals.open, ""]] }
    }
    if (id === "supplier") {
      const r = spendBySupplier(world, filter, now)
      return { head: [t("cols.supplier"), t("cols.orders"), mh("value"), t("cols.share"), t("cols.onTime"), t("cols.tags")], rows: [...r.rows.map((x) => [x.supplierName, x.orders, x.value, x.sharePercent, x.onTimePercent, ORDER_TAGS.filter((g) => x.tags[g]).map((g) => `${t(`tag.${g}`)} ${x.tags[g]}`).join(" · ")]), [t("total"), r.totals.orders, r.totals.value, 100, null, ""]] }
    }
    if (id === "delivery") {
      const r = deliveryPerformance(world, filter, now)
      return { head: [t("cols.po"), t("cols.supplier"), t("cols.siteCol"), t("cols.promised"), t("cols.lastReceipt"), t("cols.gap"), t("cols.tags")], rows: r.orders.map((x) => [x.docNumber, x.supplierName, sitesText(x.siteIds), x.promisedDate, x.lastReceiptDay, x.gap, tagsText(x.tags)]) }
    }
    if (id === "drift") {
      const r = priceDrift(world, period)
      return { head: [t("cols.material"), t("cols.po"), t("cols.supplier"), t("cols.day"), mh("previous"), mh("current"), t("cols.qty"), mh("impact")], rows: [...r.rows.map((x) => [`${x.name} (${x.unit})`, x.docNumber, x.supplierName, x.day, x.previous, x.current, x.quantity, x.impact]), [t("total"), null, null, null, null, null, null, r.totals.impact]] }
    }
    if (id === "cycle") {
      const r = cycleAndCompetition(world, period)
      return { head: [t("cols.rfq"), t("cols.invited"), t("cols.offers"), t("cols.awarded"), t("cols.days"), mh("lowest"), mh("average"), mh("awardedValue"), mh("saving"), t("cols.competition")], rows: r.rows.map((x) => [x.title, x.invitedCount, x.offersCount, x.awarded ? 1 : 0, x.daysToAward, sees ? x.lowestTotal : null, sees ? x.averageOffer : null, sees ? x.awardedTotal : null, sees ? x.saving : null, x.shortCompetition ? 1 : 0]) }
    }
    if (id === "exceptions") {
      const r = exceptions(world, filter)
      return { head: [t("cols.day"), t("cols.document"), t("cols.supplier"), t("cols.siteCol"), t("cols.exception"), t("cols.tags"), t("cols.by"), t("cols.approvedBy")], rows: r.map((x) => [x.day, x.docNumber, x.supplierName, sitesText(x.siteIds), excText(x.kind, x.params), tagsText(x.tags), x.byName, x.approvedByName]) }
    }
    if (!financeOn) {
      const r = receivedAndPaid(world, filter)
      return { head: [t("cols.po"), t("cols.supplier"), t("cols.approved"), mh("exVat"), mh("vat"), mh("total"), mh("receivedValue"), t("cols.payment"), t("cols.paidDay")], rows: [...r.rows.map((x) => [x.docNumber, x.supplierName, x.approvedDay, x.exVat, x.vat, x.total, x.received, payText(x.payment), x.paidDay]), [t("total"), null, null, r.totals.exVat, r.totals.vat, r.totals.total, r.totals.received, null, null]] }
    }
    const r = openCommitments(world, now, filter)
    return { head: [t("cols.po"), t("cols.supplier"), t("cols.part"), t("cols.terms"), t("cols.dueDate"), mh("value"), t("cols.bucket")], rows: [...r.rows.map((x) => [x.docNumber, x.supplierName, t(`part.${x.part}`), x.termsSource === "none" ? null : x.termsDays, x.dueDate, x.value, tProc(`commitmentBucket.${x.bucket}`)]), [t("total"), null, null, null, null, r.totals.total, null]] }
  }
  const exportCsv = (id: ReportId) => {
    const { head, rows } = csvOf(id)
    downloadCsv(`procurement-${id}.csv`, csvText(head, rows))
    toast({ title: t("csv_done") })
  }

  const periodLabel = preset === "custom" ? `${fmtDay(period.from, locale)} – ${fmtDay(period.to, locale)}` : t(`period.${preset}`)
  const monthLabel = now.toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { month: "long", year: "numeric" })
  const tagPills = (counts: TagCounts) => (
    <span className="flex flex-wrap gap-1">
      {ORDER_TAGS.filter((x) => counts[x] > 0).map((x) => (
        <StatusPill key={x} tone={TAG_TONE[x]} className="px-2 py-0 text-[10.5px]">
          {t(`tag.${x}`)} {counts[x]}
        </StatusPill>
      ))}
      {!ORDER_TAGS.some((x) => counts[x] > 0) && <span className="text-muted-foreground">—</span>}
    </span>
  )
  const rowTags = (tags: OrderTag[]) => (
    <span className="flex flex-wrap gap-1">
      {tags.map((x) => (
        <StatusPill key={x} tone={TAG_TONE[x]} className="px-2 py-0 text-[10.5px]">
          {t(`tag.${x}`)}
        </StatusPill>
      ))}
      {!tags.length && <span className="text-muted-foreground">—</span>}
    </span>
  )

  return (
    <div className="space-y-6">
      {/* The printed report is the report: the portal's header and sidebar stay on screen. */}
      <style media="print">{`header, [data-sidebar], [data-mobile], nav { display: none !important; } main { padding: 0 !important; margin: 0 !important; }`}</style>
      {/* The shell's tiles, search, tab rail and buttons are the screen's, not the report's. */}
      <div className="print:hidden">
        <ProcurementHeader title={t("page.title")} description={t("page.subtitle")} />
      </div>

      {!sees && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock size={11} aria-hidden="true" />
          {t("noPrices")}
        </p>
      )}

      {overview ? (
        loading ? (
          <div className="flex items-center justify-center p-16">
            <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
          </div>
        ) : (
          // items-start: an empty panel is as tall as what it says, not stretched to the seven reports beside it.
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            {monthSpend && (
              <Panel title={t("report.supplier")} sub={`${monthLabel} · ${basis}`}>
                {monthSpend.rows.length === 0 ? (
                  <EmptyState icon={Users} title={t("empty")} description={t("empty_supplier_hint")} className="m-4" />
                ) : (
                  <Table head={[t("cols.supplier"), t("cols.orders"), mh("value")]}>
                    {monthSpend.rows.slice(0, 8).map((r) => (
                      <tr key={r.supplierKey} className="border-t">
                        <Td>
                          <span className="font-semibold" dir="auto">{r.supplierName}</span>
                        </Td>
                        <Td end num>{num(r.orders)}</Td>
                        <Td end num>{money(r.value)}</Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Panel>
            )}
            <Panel title={t("overview.seven")} sub="">
              <ul>
                {reports.map((id) => (
                  <li key={id} className="flex items-center gap-2 border-t px-2 py-1.5 first:border-t-0">
                    {/* The whole row opens the report — it reads as a link (chevron, hover), on a phone too; CSV stays its own button. */}
                    <button
                      type="button"
                      onClick={() => setReport(id)}
                      data-testid={`report-row-${id}`}
                      aria-label={reportLabel(id)}
                      aria-describedby={REPORT_NEEDS_PRICE[id] ? `proc-rep-basis-${id}` : undefined}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ReportIcon id={id} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold">{reportLabel(id)}</span>
                        {REPORT_NEEDS_PRICE[id] && <span id={`proc-rep-basis-${id}`} className="block text-[11px] text-muted-foreground">{basis}</span>}
                      </span>
                      <RowChevron size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                    <Button variant="outline" size="sm" className="h-11 shrink-0 gap-1.5 sm:h-9" onClick={() => exportCsv(id)} aria-label={`${t("csv")} - ${reportLabel(id)}`}>
                      <Download size={14} aria-hidden="true" />
                      {t("csv")}
                    </Button>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        )
      ) : (
        <>
          <div className="print:hidden">
            <button
              type="button"
              onClick={() => setReport(null)}
              className="inline-flex items-center gap-1.5 rounded text-sm font-semibold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft size={14} className="rtl-flip" aria-hidden="true" />
              {t("overview.seven")}
            </button>
          </div>

          {/* ── Which report, and over which days ── */}
          <div className="flex flex-col gap-3 print:hidden xl:flex-row xl:items-center xl:justify-between">
            <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:thin] sm:mx-0 sm:px-0">
              <ProcChipGroup items={reports.map((id) => ({ id, label: reportLabel(id) }))} active={report} onPick={(id) => setReport(id)} label={t("page.title")} />
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              {periodFiltered && (
                <ProcChipGroup items={REPORT_PERIOD_PRESETS.map((p) => ({ id: p, label: t(`period.${p}`) }))} active={preset} onPick={setPreset} label={t("period.label")} />
              )}
              {!loading && (
                <>
                  <Button variant="outline" className="h-10 gap-2 border border-border bg-card text-foreground shadow-none hover:bg-muted" onClick={() => exportCsv(report)}>
                    <Download size={15} aria-hidden="true" />
                    {t("csv")}
                  </Button>
                  <Button variant="outline" className="h-10 gap-2 border border-border bg-card text-foreground shadow-none hover:bg-muted" onClick={() => window.print()}>
                    <Printer size={15} aria-hidden="true" />
                    {t("print")}
                  </Button>
                </>
              )}
            </div>
          </div>

          {periodFiltered && preset === "custom" && (
            <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 print:hidden">
              <div className="grid gap-1">
                <Label htmlFor="proc-rep-from" className="text-[11px]">{t("period.from")}</Label>
                <Input id="proc-rep-from" type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 w-40" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="proc-rep-to" className="text-[11px]">{t("period.to")}</Label>
                <Input id="proc-rep-to" type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} className="h-9 w-40" />
              </div>
            </div>
          )}

          {orderBased && tagCounts && (
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <NativeSelect aria-label={t("site.label")} value={siteId} onChange={(e) => setSiteId(e.target.value)} className={cn("max-w-full", siteId !== "all" && "border-module text-module")}>
                <option value="all">{t("site.all")}</option>
                {siteList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value={NO_SITE}>{t("site.none")}</option>
              </NativeSelect>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("tag.label")}>
                <Chip selected={tag == null} onClick={() => setTag(null)}>
                  {t("tag.all")}
                </Chip>
                {ORDER_TAGS.map((x) => (
                  <Chip key={x} selected={tag === x} count={tagCounts[x]} onClick={() => setTag(tag === x ? null : x)}>
                    {t(`tag.${x}`)}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center p-16">
              <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
            </div>
          ) : (
            <Panel title={reportLabel(report)} sub={`${periodFiltered ? periodLabel : t("period.notApplied")}${REPORT_NEEDS_PRICE[report] && sees ? ` · ${basis}` : ""}`}>
              {/* 1 · Spend by project / delivery site */}
              {project && (
                <>
                  {project.rows.length === 0 ? (
                    <Empty>{t("empty")}</Empty>
                  ) : (
                    <Table head={[requesterHead, t("cols.orders"), t("cols.lines"), mh("ordered"), mh("received"), mh("open"), t("cols.tags")]}>
                      {project.rows.slice(0, lim("project")).map((r) => (
                        <tr key={r.key} className="border-t">
                          <Td>
                            {r.projectId && pmOn ? (
                              <Link href={`/contractor/projects/${r.projectId}`} className="font-semibold hover:underline" dir="auto">
                                {requester(r)}
                              </Link>
                            ) : (
                              <span className="font-semibold">{requester(r)}</span>
                            )}
                          </Td>
                          <Td end num>{num(r.orders)}</Td>
                          <Td end num>{num(r.lines)}</Td>
                          <Td end num>{money(r.ordered)}</Td>
                          <Td end num>{r.receivedUnknown ? <span title={t("cols.receivedUnknownNote")}>{money(r.received)}*</span> : money(r.received)}</Td>
                          <Td end num>{money(r.open)}</Td>
                          <Td end>{tagPills(r.tags)}</Td>
                        </tr>
                      ))}
                      <TotalsRow cells={[t("total"), num(project.totals.orders), num(project.totals.lines), money(project.totals.ordered), money(project.totals.received), money(project.totals.open), ""]} />
                    </Table>
                  )}
                  {moreRows("project", project.rows.length)}
                  {project.rows.some((r) => r.receivedUnknown) && <Note>* {t("cols.receivedUnknownNote")}</Note>}
                  <Note>{t(financeOn ? "notes.project" : "notes.project_nofin")}</Note>
                </>
              )}

              {/* 2 · Spend by supplier */}
              {supplier && (
                <>
                  {supplier.rows.length === 0 ? (
                    <Empty>{t("empty")}</Empty>
                  ) : (
                    <Table head={[t("cols.supplier"), t("cols.orders"), mh("value"), t("cols.share"), t("cols.onTime"), t("cols.tags")]}>
                      {supplier.rows.slice(0, lim("supplier")).map((r) => (
                        <tr key={r.supplierKey} className="border-t">
                          <Td>
                            <span className="flex items-center gap-2">
                              <span className="font-semibold" dir="auto">{r.supplierName}</span>
                              {r.concentrated && <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold text-warning">{t("concentrated")}</span>}
                            </span>
                          </Td>
                          <Td end num>{num(r.orders)}</Td>
                          <Td end num>{money(r.value)}</Td>
                          <Td end>
                            <span className="flex items-center justify-end gap-2">
                              <Bar value={r.sharePercent} max={100} tone={r.concentrated ? "bg-warning" : "bg-module"} />
                              <span className="tabular-nums" dir="ltr">{pct(r.sharePercent)}</span>
                            </span>
                          </Td>
                          <Td end num>{pct(r.onTimePercent)}</Td>
                          <Td end>{tagPills(r.tags)}</Td>
                        </tr>
                      ))}
                      <TotalsRow cells={[t("total"), num(supplier.totals.orders), money(supplier.totals.value), "100%", "", ""]} />
                    </Table>
                  )}
                  {moreRows("supplier", supplier.rows.length)}
                  {supplier.concentration && <Note tone="warn">{t("concentration", { supplier: supplier.concentration.supplierName, percent: supplier.concentration.sharePercent })}</Note>}
                  <Note>{t("notes.supplier", { percent: CONCENTRATION_PERCENT })}</Note>
                </>
              )}

              {/* 3 · On-time delivery */}
              {delivery && (
                <>
                  {delivery.suppliers.length > 0 && (
                    <Table head={[t("cols.supplier"), t("cols.orders"), t("cols.onTime"), t("cols.avgLate"), t("cols.rejectPct")]}>
                      {delivery.suppliers.map((r) => (
                        <tr key={r.supplierKey} className="border-t">
                          <Td><span className="font-semibold" dir="auto">{r.supplierName}</span></Td>
                          <Td end num>{num(r.orders)}</Td>
                          <Td end num><span className={cn(r.onTimePercent != null && r.onTimePercent < 85 && "font-bold text-destructive")}>{pct(r.onTimePercent)}</span></Td>
                          <Td end num>{r.avgDaysLate == null ? "—" : t("days", { count: r.avgDaysLate })}</Td>
                          <Td end num>{pct(r.rejectPercent)}</Td>
                        </tr>
                      ))}
                    </Table>
                  )}
                  {delivery.orders.length === 0 ? (
                    <Empty>{t("empty")}</Empty>
                  ) : (
                    <Table head={[t("cols.po"), t("cols.siteCol"), t("cols.promised"), t("cols.lastReceipt"), t("cols.gap"), t("cols.tags")]} className="border-t">
                      {delivery.orders.slice(0, lim("delivery")).map((r) => (
                        <tr key={r.orderId} className="border-t">
                          <Td>
                            <Link href={`/contractor/rfqs/orders?po=${r.orderId}`} className="font-mono text-xs font-semibold hover:underline" dir="ltr">{docNo(r.docNumber)}</Link>
                            <span className="block text-[11px] text-muted-foreground" dir="auto">{r.supplierName}</span>
                          </Td>
                          <Td><span className="text-xs" dir="auto">{sitesText(r.siteIds)}</span></Td>
                          <Td end num>{fmtDay(r.promisedDate, locale)}</Td>
                          <Td end num>{fmtDay(r.lastReceiptDay, locale)}</Td>
                          <Td end>
                            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", r.state === "late" ? "bg-destructive/10 text-destructive" : r.state === "on_time" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
                              {tProc(`deliveryState.${r.state}`, { days: r.gap ?? 0 })}
                            </span>
                          </Td>
                          <Td end>{rowTags(r.tags)}</Td>
                        </tr>
                      ))}
                    </Table>
                  )}
                  {moreRows("delivery", delivery.orders.length)}
                  <Note>{t("notes.delivery")}</Note>
                </>
              )}

              {/* 4 · Savings against the last price */}
              {drift && (
                <>
                  {drift.rows.length === 0 ? (
                    <Empty>{t("empty")}</Empty>
                  ) : (
                    <Table head={[t("cols.material"), t("cols.po"), mh("previous"), mh("current"), t("cols.qty"), mh("impact")]}>
                      {drift.rows.slice(0, lim("drift")).map((r, i) => (
                        <tr key={`${r.orderId}-${r.name}-${i}`} className="border-t">
                          <Td>
                            <span className="font-semibold" dir="auto">{r.name}</span>
                            <span className="ms-1 text-muted-foreground">({r.unit})</span>
                          </Td>
                          <Td>
                            <Link href={`/contractor/rfqs/orders?po=${r.orderId}`} className="font-mono text-xs font-semibold hover:underline" dir="ltr">{docNo(r.docNumber)}</Link>
                            <span className="block text-[11px] text-muted-foreground" dir="auto">{r.supplierName} · {fmtDay(r.day, locale)}</span>
                          </Td>
                          <Td end num>{money2(r.previous)}</Td>
                          <Td end num>{money2(r.current)}</Td>
                          <Td end num>{num(r.quantity)}</Td>
                          <Td end num><b className={r.impact > 0 ? "text-warning" : r.impact < 0 ? "text-success" : ""}>{signed(r.impact)}</b></Td>
                        </tr>
                      ))}
                      <TotalsRow cells={[t("total"), "", "", "", "", signed(drift.totals.impact)]} />
                    </Table>
                  )}
                  {moreRows("drift", drift.rows.length)}
                  <Note>
                    {(() => {
                      const s = savingsSummary(drift)
                      if (s.percent == null) return t("drift.noBase")
                      return t(`drift.${s.direction}`, { amount: money(s.amount), percent: s.percent })
                    })()}
                  </Note>
                  <Note>{t("notes.drift")}</Note>
                </>
              )}

              {/* 5 · Competition on RFQs - and what the competition saved */}
              {cycle && (
                <>
                  {cycle.rows.length === 0 ? (
                    <Empty>{t("empty")}</Empty>
                  ) : (
                    <Table head={[t("cols.rfq"), t("cols.invited"), t("cols.offers"), t("cols.days"), mh("saving")]}>
                      {cycle.rows.slice(0, lim("cycle")).map((r) => (
                        <tr key={r.rfqId} className="border-t">
                          <Td>
                            <span className="flex flex-wrap items-center gap-1.5">
                              <Link href={`/contractor/rfqs/${r.rfqId}/offers`} className="font-semibold hover:underline" dir="auto">{r.title || r.rfqId}</Link>
                              {r.shortCompetition && <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold text-warning">{t("shortCompetition")}</span>}
                              {!r.awarded && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">{t("notAwarded")}</span>}
                            </span>
                            {sees && r.awarded && r.averageOffer != null && (
                              <span className="mt-0.5 block text-[11px] text-muted-foreground" dir="auto">
                                {t("cycle.against", { average: money(r.averageOffer), awarded: money(r.awardedTotal) })}
                              </span>
                            )}
                          </Td>
                          <Td end num>{num(r.invitedCount)}</Td>
                          <Td end num>{num(r.offersCount)}</Td>
                          <Td end num>{r.daysToAward == null ? "—" : t("days", { count: r.daysToAward })}</Td>
                          <Td end num>{sees && r.saving != null ? <b className={r.saving > 0 ? "text-success" : r.saving < 0 ? "text-warning" : ""}>{signed(r.saving)}</b> : "—"}</Td>
                        </tr>
                      ))}
                      <TotalsRow
                        cells={[
                          t("cycle.totals", { rfqs: cycle.totals.rfqs, awarded: cycle.totals.awarded, short: cycle.totals.shortCompetition }),
                          "",
                          num(cycle.totals.avgOffers),
                          cycle.totals.avgDays == null ? "—" : t("days", { count: cycle.totals.avgDays }),
                          sees ? signed(cycle.totals.saving) : "—",
                        ]}
                      />
                    </Table>
                  )}
                  {moreRows("cycle", cycle.rows.length)}
                  <Note>{t("notes.cycleArrival")}</Note>
                  <Note>{t("notes.cycle", { threshold: policies.competitionThreshold.toLocaleString("en-US"), min: policies.minOffers })}</Note>
                  {sees && <Note>{t("notes.saving")}</Note>}
                </>
              )}

              {/* 6 · Exceptions */}
              {exc && (
                <>
                  {exc.length === 0 ? (
                    <Empty>{t("empty")}</Empty>
                  ) : (
                    <Table head={[t("cols.document"), t("cols.siteCol"), t("cols.exception"), t("cols.tags"), t("cols.by"), t("cols.approvedBy"), t("cols.day")]}>
                      {exc.slice(0, lim("exc")).map((r, i) => (
                        <tr key={`${r.kind}-${r.orderId || r.receiptId || r.rfqId}-${i}`} className="border-t">
                          <Td>
                            <Link href={r.href} className={cn("text-xs font-semibold hover:underline", !r.rfqId || r.orderId ? "font-mono" : "")} dir={r.orderId || r.receiptId ? "ltr" : "auto"}>
                              {(r.orderId || r.receiptId ? docNo(r.docNumber) : r.docNumber) || "—"}
                            </Link>
                            <span className="block text-[11px] text-muted-foreground" dir="auto">{r.supplierName || "—"}</span>
                          </Td>
                          <Td><span className="text-xs" dir="auto">{sitesText(r.siteIds)}</span></Td>
                          <Td>
                            <span className="me-1.5 inline-block rounded-md bg-module/10 px-1.5 py-0.5 text-[10px] font-bold text-module">{t(`kind.${r.kind}`)}</span>
                            <span dir="auto">{excText(r.kind, r.params)}</span>
                          </Td>
                          <Td>{rowTags(r.tags)}</Td>
                          <Td><span dir="auto">{r.byName || "—"}</span></Td>
                          <Td><span dir="auto">{r.approvedByName || "—"}</span></Td>
                          <Td end num>{fmtDay(r.day, locale)}</Td>
                        </tr>
                      ))}
                      <TotalsRow cells={[t("exceptionsTotal", { count: exc.length }), "", "", "", "", "", ""]} />
                    </Table>
                  )}
                  {moreRows("exc", exc.length)}
                  <Note>{t("notes.exceptions")}</Note>
                </>
              )}

              {/* 7 · Commitments and dues (with Finance) */}
              {commit && (
                <>
                  <Table head={[t("cols.due"), mh("advances"), mh("receivedUnpaid"), mh("undelivered")]}>
                    {bucketsShown.map((b) => (
                      <tr key={b} className={cn("border-t", b === "within7" && commit.buckets[b].total > 0 && "bg-warning/5")}>
                        <Td><span className="font-semibold">{tProc(`commitmentBucket.${b}`)}</span></Td>
                        <Td end num>{money(commit.buckets[b].advance)}</Td>
                        <Td end num>{money(commit.buckets[b].received)}</Td>
                        <Td end num>{money(commit.buckets[b].undelivered)}</Td>
                      </tr>
                    ))}
                    <TotalsRow cells={[t("total"), money(commit.totals.advance), money(commit.totals.received), money(commit.totals.undelivered)]} />
                  </Table>
                  {commit.rows.length === 0 ? (
                    <Empty>{t("emptyCommitments")}</Empty>
                  ) : (
                    <Table head={[t("cols.po"), t("cols.part"), t("cols.terms"), t("cols.dueDate"), mh("value")]} className="border-t">
                      {commit.rows.slice(0, lim("commit")).map((r) => (
                        <tr key={`${r.orderId}-${r.part}`} className="border-t">
                          <Td>
                            <Link href={`/contractor/rfqs/orders?po=${r.orderId}`} className="font-mono text-xs font-semibold hover:underline" dir="ltr">{docNo(r.docNumber)}</Link>
                            <span className="block text-[11px] text-muted-foreground" dir="auto">{r.supplierName}</span>
                          </Td>
                          <Td>
                            <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold", r.part === "advance" ? "bg-warning/10 text-warning" : r.part === "received" ? "bg-success/10 text-success" : "bg-module/10 text-module")}>{t(`part.${r.part}`)}</span>
                          </Td>
                          <Td>
                            <span className="text-xs">{r.part === "advance" ? t("terms.advanceNow") : termsText(r.termsDays, r.termsSource)}</span>
                            {r.part !== "advance" && r.termsSource !== "none" && <span className="block text-[10px] text-muted-foreground">{t(`terms.source.${r.termsSource}`)}</span>}
                          </Td>
                          <Td end>
                            <span className="block tabular-nums" dir="ltr">{fmtDay(r.dueDate, locale)}</span>
                            <span className={cn("mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums", r.daysToDue != null && r.daysToDue < 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                              {r.daysToDue == null ? tProc("commitmentBucket.noDate") : r.daysToDue < 0 ? t("overdueBy", { days: -r.daysToDue }) : t("dueIn", { days: r.daysToDue })}
                            </span>
                          </Td>
                          <Td end num>{money(r.value)}</Td>
                        </tr>
                      ))}
                      <TotalsRow cells={[t("total"), "", "", "", money(commit.totals.total)]} />
                    </Table>
                  )}
                  {moreRows("commit", commit.rows.length)}
                  {commit.receivedUnknown > 0 && <Note>{t("commitReceivedUnknown", { count: commit.receivedUnknown })}</Note>}
                  <Note>{t("notes.commitments")}</Note>
                  <Note>{t("notes.commitmentsTerms")}</Note>
                </>
              )}

              {/* 7 · Received and paid - for the accountant (without Finance) */}
              {paid && (
                <>
                  {paid.rows.length === 0 ? (
                    <Empty>{t("empty")}</Empty>
                  ) : (
                    <Table head={[t("cols.po"), t("cols.approved"), mh("exVat"), mh("vat"), mh("total"), mh("receivedValue"), t("cols.payment")]}>
                      {paid.rows.slice(0, lim("paid")).map((r) => (
                        <tr key={r.orderId} className="border-t">
                          <Td>
                            <Link href={`/contractor/rfqs/orders?po=${r.orderId}`} className="font-mono text-xs font-semibold hover:underline" dir="ltr">{docNo(r.docNumber)}</Link>
                            <span className="block text-[11px] text-muted-foreground" dir="auto">{r.supplierName}</span>
                          </Td>
                          <Td end num>{fmtDay(r.approvedDay, locale)}</Td>
                          <Td end num>{money2(r.exVat)}</Td>
                          <Td end num>{money2(r.vat)}</Td>
                          <Td end num>{money2(r.total)}</Td>
                          <Td end num>{money2(r.received)}</Td>
                          <Td end>
                            <StatusPill tone={r.payment === "paid" ? "ok" : r.payment === "part" ? "warn" : "mute"}>{payText(r.payment)}</StatusPill>
                            {r.paidDay && <span className="block text-[11px] text-muted-foreground tabular-nums" dir="ltr">{fmtDay(r.paidDay, locale)}</span>}
                          </Td>
                        </tr>
                      ))}
                      <TotalsRow cells={[t("total"), "", money2(paid.totals.exVat), money2(paid.totals.vat), money2(paid.totals.total), money2(paid.totals.received), ""]} />
                    </Table>
                  )}
                  {moreRows("paid", paid.rows.length)}
                  <Note>{t("notes.received_paid")}</Note>
                </>
              )}
            </Panel>
          )}

          {REPORT_NEEDS_PRICE[report] && !sees && <Empty>{t("noPrices")}</Empty>}

          {/* The project report's own note already says this. */}
          {sees && report !== "project" && (
            <p className="flex items-start gap-2 rounded-2xl border border-cta/20 bg-cta/5 px-4 py-3 text-sm text-cta">
              <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t(financeOn ? "commitNotCost" : "commitNotCost_nofin")}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function Panel({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border bg-card">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3.5">
        <h2 className="text-base font-black text-foreground">{title}</h2>
        {sub && <span className="text-xs tabular-nums text-muted-foreground">{sub}</span>}
      </header>
      {children}
    </section>
  )
}

function Table({ head, children, className }: { head: string[]; children: ReactNode; className?: string }) {
  const id = `rt${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  // On a phone every row becomes a card whose cells are labelled by their column heading: the table never scrolls sideways.
  const labels = head.map((h, i) => `.${id} td:nth-child(${i + 1})::before{content:${JSON.stringify(h)}}`).join("")
  const phone = `@media (max-width:767px){.${id} table,.${id} tbody,.${id} tfoot,.${id} tr,.${id} td{display:block;width:100%;min-width:0}.${id} thead{display:none}.${id} tr{padding:.5rem 1rem}.${id} td{display:flex;justify-content:space-between;gap:1rem;padding:.25rem 0}.${id} td::before{flex:none;font-size:.75rem;font-weight:600;color:hsl(var(--muted-foreground))}${labels}}`
  return (
    <div className={cn("overflow-x-auto", id, className)}>
      <style>{phone}</style>
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            {head.map((h, i) => (
              <th key={i} scope="col" className={cn("whitespace-nowrap px-4 py-3 font-semibold", i === 0 ? "text-start" : "text-end")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Td({ children, end, num: isNum }: { children?: ReactNode; end?: boolean; num?: boolean }) {
  return (
    <td className={cn("px-4 py-3 align-top", end && "text-end", isNum && "whitespace-nowrap tabular-nums")} dir={isNum ? "ltr" : undefined}>
      {children}
    </td>
  )
}

function TotalsRow({ cells }: { cells: string[] }) {
  return (
    <tr className="border-t bg-muted/30 font-bold">
      {cells.map((c, i) => (
        <td key={i} className={cn("px-4 py-2 tabular-nums", i === 0 ? "text-start" : "whitespace-nowrap text-end")} dir={i === 0 ? undefined : "ltr"}>
          {c}
        </td>
      ))}
    </tr>
  )
}

function Bar({ value, max, tone }: { value: number; max: number; tone?: string }) {
  return (
    <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-muted align-middle" aria-hidden="true">
      <span className={cn("block h-full rounded-full", tone || "bg-module")} style={{ width: `${Math.min(100, max > 0 ? (value / max) * 100 : 0)}%` }} />
    </span>
  )
}

function Note({ children, tone }: { children: ReactNode; tone?: "warn" }) {
  return (
    <p className={cn("border-t px-4 py-2.5 text-[11px] leading-relaxed", tone === "warn" ? "bg-warning/5 text-warning" : "text-muted-foreground")} dir="auto">
      {children}
    </p>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>
}

/** «التقارير السبعة» (ST-06): each report opens with its icon, in the module's colour. */
const REPORT_ICON: Record<ReportId, LucideIcon> = { supplier: Users, project: MapPin, delivery: Clock, cycle: Scale, exceptions: AlertTriangle, drift: TrendingDown, commitments: Wallet }

function ReportIcon({ id }: { id: ReportId }) {
  const Icon = REPORT_ICON[id]
  return <Icon size={16} className="shrink-0 text-module" aria-hidden="true" data-report-icon={id} />
}
