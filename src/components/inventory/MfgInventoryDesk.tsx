"use client"

// Inventory's manufacturing desk — what the workshop asks of Inventory, acted
// on here and only read back by Manufacturing (D9, BD-01):
//   · withdrawals to issue (T11, MAT-01) — the storekeeper issues the station's
//     request from a chosen store and block; the station confirms receipt
//   · usable remnants returned from manufacturing (T26, MAT-07)
//   · what the workshop holds of the shelf (MAT-04) — reserved, requested, short
//   · block quality notices (T25, FL-11) — quarantine the block
// Finished goods arrive on delivery notes, which have their own page.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Factory,
  Layers,
  Loader2,
  Lock,
  PackageMinus,
  PackagePlus,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react"
import { Link } from "@/i18n/routing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useMfgFacts } from "@/hooks/useMfgFacts"
import { useOrgStock } from "@/hooks/useOrgStock"
import { cn } from "@/lib/utils"
import { formatCrmDate } from "@/lib/crm"
import { markBlockQuarantined, type MfgBlockNotice, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { emitMfgEvent } from "@/lib/mfg-events"
import { stockIndexFrom, workshopHolds } from "@/lib/manufacturing-view"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { MfgIssueWithdrawalDialog, type WithdrawalGroup } from "./MfgIssueWithdrawalDialog"
import { MfgRemnantReceiveDialog, type RemnantTarget } from "./MfgRemnantReceiveDialog"
import { ageText, errText, useNowMs } from "./MfgOutsideBits"

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })
const refOf = (o: Pick<WorkOrderV2, "docNumber" | "orderNumber">) => o.docNumber || `#${o.orderNumber}`
const productNameOf = (o: WorkOrderV2, products: Map<string, { name: string }>) => o.productName || products.get(o.productId || "")?.name || o.title || ""
const hoursSince = (iso: string | null | undefined, nowMs: number) => (iso ? Math.max(0, (nowMs - new Date(iso).getTime()) / 3600000) : 0)

function SectionHead({ id, icon: Icon, title, desc, count, tone = "cta" }: { id: string; icon: typeof Factory; title: string; desc: string; count: number; tone?: "cta" | "destructive" | "success" }) {
  return (
    <div className="flex items-start gap-3">
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", tone === "destructive" ? "bg-destructive/10 text-destructive" : tone === "success" ? "bg-success/10 text-success" : "bg-cta/10 text-cta")}>
        <Icon size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id={id} className="flex flex-wrap items-center gap-2 text-sm font-black text-foreground">
          {title}
          <span className="text-xs font-bold tabular-nums text-muted-foreground">{count}</span>
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">{text}</p>
}

export function MfgInventoryDesk({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can, isLoading: permsLoading } = usePermissions()
  const canManage = can("warehouses.manage")
  const canReceive = canManage || can("warehouses.receive")
  const seesValue = canManage || can("accounting.view") || can("invoices.manage")
  const facts = useMfgFacts({ orders: true, notices: true, warehouses: true })
  const nowMs = useNowMs()
  const workshopLink = (orderId: string) => `/${portal}/manufacturing/workshop?order=${orderId}`

  const stationName = (id: string) => facts.departments.find((d) => d.id === id)?.name || ""

  // ── Withdrawals: requested (to issue) and issued (awaiting the station) ──
  const { toIssue, issued } = useMemo(() => {
    const toIssue: WithdrawalGroup[] = []
    const issued: Array<WithdrawalGroup & { releasedBy: string; releasedAt: string; warehouseId: string | null }> = []
    for (const o of facts.orders) {
      if (o.status !== "open") continue
      const byNumber = new Map<string, NonNullable<WorkOrderV2["materials"]>>()
      for (const m of o.materials || []) {
        if (m.state === "received") continue
        const k = `${m.requestNumber}__${m.state}`
        byNumber.set(k, [...(byNumber.get(k) || []), m])
      }
      for (const [k, rows] of byNumber) {
        const group: WithdrawalGroup = { key: `${o.id}__${k}`, order: o, orderRef: refOf(o), productName: productNameOf(o, facts.productById), requestNumber: rows[0].requestNumber, departmentId: rows[0].departmentId, rows }
        if (rows[0].state === "requested") toIssue.push(group)
        else issued.push({ ...group, releasedBy: rows[0].releasedByName || "", releasedAt: rows[0].releasedAt || "", warehouseId: rows[0].warehouseId })
      }
    }
    toIssue.sort((a, b) => (a.rows[0].requestedAt < b.rows[0].requestedAt ? -1 : 1))
    issued.sort((a, b) => (a.releasedAt < b.releasedAt ? 1 : -1))
    return { toIssue, issued }
  }, [facts.orders, facts.productById])

  // ── Remnants returned, waiting for Inventory ──
  const remnants = useMemo<RemnantTarget[]>(() => {
    const out: RemnantTarget[] = []
    for (const o of facts.orders) for (const r of o.remnants || []) if (r.state === "returned") out.push({ key: `${o.id}__${r.id}`, order: o, orderRef: refOf(o), remnant: r })
    return out.sort((a, b) => (a.remnant.at < b.remnant.at ? -1 : 1))
  }, [facts.orders])

  // ── Block notices ──
  const openNotices = useMemo(() => facts.notices.filter((n) => !n.closedAt), [facts.notices])
  const quarantinedLots = useMemo(() => new Set(openNotices.filter((n) => n.quarantinedAt).map((n) => n.lot)), [openNotices])
  const orderRefById = useMemo(() => new Map(facts.orders.map((o) => [o.id, refOf(o)])), [facts.orders])
  // Where the block sits, so it can be isolated on the shelf.
  const stock = useOrgStock(
    facts.warehouses,
    facts.ready,
    [openNotices.map((n) => `${n.id}:${n.quarantinedAt || ""}`).join(","), toIssue.length, issued.length, remnants.length].join("|")
  )
  const warehouseName = (id: string | null | undefined) => (id && facts.warehouses.find((w) => w.id === id)?.name) || ""
  const blockLocations = (lot: string) => {
    const out: Array<{ warehouse: string; qty: number; unit: string }> = []
    for (const [whId, rows] of stock.byWarehouse) for (const r of rows) if (r.lot === lot && r.quantity > 0) out.push({ warehouse: warehouseName(whId), qty: r.quantity, unit: r.unit })
    return out
  }

  // ── What the workshop holds of the shelf (MAT-04) — the same allocation it plans on ──
  const holds = useMemo(() => {
    if (stock.loading) return []
    const rows = Array.from(stock.byWarehouse.values()).flat()
    return workshopHolds({ orders: facts.orders, products: facts.productById, departments: facts.departments, stock: stockIndexFrom(rows, quarantinedLots) })
  }, [stock, facts.orders, facts.productById, facts.departments, quarantinedLots])

  const [issueTarget, setIssueTarget] = useState<WithdrawalGroup | null>(null)
  const [remnantTarget, setRemnantTarget] = useState<RemnantTarget | null>(null)
  const [quarantineTarget, setQuarantineTarget] = useState<MfgBlockNotice | null>(null)
  const [quarantining, setQuarantining] = useState(false)

  const quarantine = async () => {
    if (!firestore || !quarantineTarget || quarantining) return
    setQuarantining(true)
    try {
      await markBlockQuarantined(firestore, { noticeId: quarantineTarget.id, actor: facts.actor })
      await emitMfgEvent(firestore, {
        kind: "block_quarantined",
        copy: t,
        organizationId: facts.orgId,
        actor: facts.actor,
        to: [{ users: [quarantineTarget.byId] }, { permission: "manufacturing.manage" }],
        params: { lot: quarantineTarget.lot },
      })
      toast({ title: t("mfx_block_quarantined_toast", { lot: quarantineTarget.lot }) })
      setQuarantineTarget(null)
    } catch (err) {
      console.error(err)
      toast({ title: errText(t, err), variant: "destructive" })
    } finally {
      setQuarantining(false)
    }
  }

  const loading = !facts.ready || permsLoading

  return (
    <div className="space-y-8" dir={isRtl ? "rtl" : "ltr"}>
      <header className="min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-black text-primary">
          <Factory size={22} className="shrink-0" aria-hidden="true" />
          {t("mfx_desk_title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("mfx_desk_desc")}{" "}
          <Link href={`/${portal}/warehouses/delivery-notes`} className="rounded-sm font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("mfx_desk_notes_link")}
          </Link>
        </p>
        {!loading && !canReceive && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock size={12} aria-hidden="true" />
            {t("mfx_desk_no_permission")}
          </p>
        )}
      </header>

      {loading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
        </div>
      ) : (
        <>
          {/* a) Withdrawals to issue */}
          <section className="space-y-3" aria-labelledby="mfx-desk-issue">
            <SectionHead id="mfx-desk-issue" icon={PackageMinus} title={t("mfx_desk_issue_title")} desc={t("mfx_desk_issue_desc")} count={toIssue.length} />
            {toIssue.length === 0 ? (
              <Empty text={t("mfx_desk_issue_empty")} />
            ) : (
              <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
                {toIssue.map((g) => {
                  const first = g.rows[0]
                  const hours = hoursSince(first.requestedAt, nowMs)
                  const notice = openNotices.find((n) => g.rows.some((m) => m.lot && m.lot === n.lot))
                  return (
                    <li key={g.key} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-foreground" dir="ltr">{g.requestNumber || "—"}</span>
                          <Badge variant="outline" className="font-mono text-[10px]" dir="ltr">{g.orderRef}</Badge>
                          <span className="text-sm font-bold text-foreground" dir="auto">{g.productName}</span>
                          <Badge className="gap-1 border-none bg-cta/10 text-[10px] text-cta">
                            <Factory size={10} aria-hidden="true" />
                            {stationName(g.departmentId) || "—"}
                          </Badge>
                        </div>
                        <ul className="flex flex-wrap gap-1.5">
                          {g.rows.map((m) => (
                            <li key={m.id} className="inline-flex flex-wrap items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                              <span dir="auto">{m.itemName}</span>
                              <span className="font-bold tabular-nums" dir="ltr">{fmt(m.quantity)} {m.unit}</span>
                              {m.lot && (
                                <span className={cn("inline-flex items-center gap-1 font-mono text-[10px] font-bold", quarantinedLots.has(m.lot) ? "text-destructive" : "text-muted-foreground")} dir="ltr">
                                  <Layers size={10} aria-hidden="true" />
                                  {m.lot}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                        {first.consentNote && <p className="text-[11px] text-warning">{t("mfx_issue_consent", { note: first.consentNote })}</p>}
                        {notice && (
                          <p className="flex items-start gap-1.5 text-[11px] font-semibold text-destructive">
                            <ShieldAlert size={12} className="mt-px shrink-0" aria-hidden="true" />
                            {notice.quarantinedAt
                              ? t("mfx_issue_quarantined", { lot: notice.lot })
                              : t("mfx_issue_notice", { lot: notice.lot, defect: t(`mfg4_defect_${notice.defect}`), note: notice.note })}
                          </p>
                        )}
                        <p className={cn("flex items-center gap-1.5 text-xs", hours >= 24 ? "text-warning" : "text-muted-foreground")}>
                          <Clock size={11} aria-hidden="true" />
                          {t("mfx_desk_requested_by", { name: first.requestedByName, age: ageText(t, hours) })}
                        </p>
                      </div>
                      {canManage ? (
                        <Button size="sm" className="h-10 shrink-0 gap-1.5" onClick={() => setIssueTarget(g)}>
                          <PackageMinus size={14} aria-hidden="true" />
                          {t("mfx_issue_btn")}
                        </Button>
                      ) : (
                        <span className="shrink-0 text-[11px] text-muted-foreground">{t("mfx_desk_issue_storekeeper")}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {issued.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-muted-foreground">{t("mfx_desk_issued_title", { count: issued.length })}</p>
                <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
                  {issued.map((g) => (
                    <li key={g.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
                      <span className="font-mono font-bold text-foreground" dir="ltr">{g.requestNumber || "—"}</span>
                      <span className="font-mono text-muted-foreground" dir="ltr">{g.orderRef}</span>
                      <span className="text-muted-foreground">{stationName(g.departmentId)}</span>
                      <Badge className="border-none bg-warning/10 text-[10px] text-warning">{t("mfx_desk_issued_awaiting")}</Badge>
                      <span className="ms-auto text-muted-foreground">
                        {t("mfx_desk_issued_by", { name: g.releasedBy, age: ageText(t, hoursSince(g.releasedAt, nowMs)), warehouse: warehouseName(g.warehouseId) || "—" })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* b) Remnants returned from manufacturing */}
          <section className="space-y-3" aria-labelledby="mfx-desk-remnants">
            <SectionHead id="mfx-desk-remnants" icon={PackagePlus} tone="success" title={t("mfx_desk_rem_title")} desc={t("mfx_desk_rem_desc")} count={remnants.length} />
            {remnants.length === 0 ? (
              <Empty text={t("mfx_desk_rem_empty")} />
            ) : (
              <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
                {remnants.map((x) => (
                  <li key={x.key} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]" dir="ltr">{x.orderRef}</Badge>
                        <span className="text-sm font-bold text-foreground" dir="auto">{x.remnant.itemName}</span>
                        <span className="text-xs font-bold tabular-nums text-cta" dir="ltr">{fmt(x.remnant.area)} {x.remnant.unit}</span>
                        {x.remnant.lot && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-px font-mono text-[10px] font-bold text-slate-600" dir="ltr">
                            <Layers size={10} aria-hidden="true" />
                            {x.remnant.lot}
                          </span>
                        )}
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">{t(`mfx_rem_source_${x.remnant.source}`)}</Badge>
                        {seesValue && (
                          <span className="text-xs font-semibold tabular-nums text-success" dir="ltr">{fmt(x.remnant.value)} {t("mfg4_sar")}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{t("mfx_desk_rem_by", { name: x.remnant.by, date: formatCrmDate(x.remnant.at, locale) })}</p>
                    </div>
                    {canReceive && (
                      <Button size="sm" className="h-10 shrink-0 gap-1.5 bg-success text-white hover:bg-success/90" onClick={() => setRemnantTarget(x)}>
                        <PackagePlus size={14} aria-hidden="true" />
                        {t("mfx_rem_btn")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* c) Held for the workshop */}
          <section className="space-y-3" aria-labelledby="mfx-desk-holds">
            <SectionHead id="mfx-desk-holds" icon={Lock} title={t("mfx_desk_holds_title")} desc={t("mfx_desk_holds_desc")} count={holds.length} />
            {stock.loading ? (
              <div className="flex justify-center p-6">
                <Loader2 className="animate-spin text-muted-foreground" size={20} aria-hidden="true" />
              </div>
            ) : holds.length === 0 ? (
              <Empty text={t("mfx_desk_holds_empty")} />
            ) : (
              <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
                {holds.map((h) => (
                  <li key={h.itemKey} className="space-y-1.5 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-bold text-foreground" dir="auto">{h.itemName}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("mfx_hold_on_hand")} <b className="tabular-nums text-foreground" dir="ltr">{fmt(h.onHand)} {h.unit}</b>
                      </span>
                      {h.requested > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {t("mfx_hold_requested")} <b className="tabular-nums text-warning" dir="ltr">{fmt(h.requested)}</b>
                        </span>
                      )}
                      {h.reserved > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {t("mfx_hold_reserved")} <b className="tabular-nums text-cta" dir="ltr">{fmt(h.reserved)}</b>
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {t("mfx_hold_free")} <b className="tabular-nums text-success" dir="ltr">{fmt(h.free)}</b>
                      </span>
                      {h.short > 0 && (
                        <Badge className="gap-1 border-none bg-destructive/10 text-[10px] text-destructive">
                          <AlertTriangle size={10} aria-hidden="true" />
                          {t(h.purchaseRequested ? "mfx_hold_short" : "mfx_hold_short_unrequested", { qty: `${fmt(h.short)} ${h.unit}` })}
                        </Badge>
                      )}
                    </div>
                    {h.orders.length > 0 && (
                      <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        {h.orders.map((o) => (
                          <Link
                            key={o.id}
                            href={workshopLink(o.id)}
                            className="rounded bg-muted px-1.5 font-mono text-[10px] font-bold text-slate-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            dir="ltr"
                          >
                            {o.ref} · {fmt(o.quantity)}
                          </Link>
                        ))}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* d) Block quality notices */}
          <section className="space-y-3" aria-labelledby="mfx-desk-notices">
            <SectionHead id="mfx-desk-notices" icon={ShieldAlert} tone="destructive" title={t("mfx_desk_blocks_title")} desc={t("mfx_desk_blocks_desc")} count={openNotices.length} />
            {openNotices.length === 0 ? (
              <Empty text={t("mfx_desk_blocks_empty")} />
            ) : (
              <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
                {openNotices.map((n) => {
                  const where = blockLocations(n.lot)
                  const refs = n.orderIds.map((id) => orderRefById.get(id)).filter(Boolean) as string[]
                  return (
                    <li key={n.id} className={cn("flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start", !n.quarantinedAt && "border-s-2 border-destructive")}>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 font-mono text-sm font-black text-foreground" dir="ltr">
                            <Layers size={13} aria-hidden="true" />
                            {n.lot}
                          </span>
                          {n.itemName && <span className="text-sm font-semibold text-slate-700" dir="auto">{n.itemName}</span>}
                          <Badge className="border-none bg-destructive/10 text-[10px] text-destructive">{t(`mfg4_defect_${n.defect}`)}</Badge>
                          {n.quarantinedAt ? (
                            <Badge className="gap-1 border-none bg-success/10 text-[10px] text-success">
                              <ShieldCheck size={10} aria-hidden="true" />
                              {t("mfx_block_quarantined_short")}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-destructive/30 text-[10px] text-destructive">{t("mfx_block_not_quarantined")}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-700" dir="auto">{n.note}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("mfx_desk_block_raised", { name: n.by, date: formatCrmDate(n.at, locale) })}
                          {n.photosAttached ? ` · ${t("mfx_block_photos")}` : ""}
                        </p>
                        {refs.length > 0 && (
                          <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                            {t("mfx_block_orders")}
                            {refs.map((r) => (
                              <span key={r} className="rounded bg-muted px-1.5 font-mono text-[10px] font-bold text-slate-600" dir="ltr">{r}</span>
                            ))}
                          </p>
                        )}
                        {where.length > 0 && (
                          <p className="text-[11px] text-muted-foreground">
                            {t("mfx_block_where", { places: where.map((w) => `${w.warehouse} (${fmt(w.qty)} ${w.unit})`).join(" · ") })}
                          </p>
                        )}
                        {n.quarantinedAt && (
                          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-success">
                            <CheckCircle2 size={12} aria-hidden="true" />
                            {t("mfx_block_quarantined_by", { name: n.quarantinedBy || "", date: formatCrmDate(n.quarantinedAt, locale) })}
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                          {n.claimRaisedAt ? t("mfx_block_claim_raised", { name: n.claimRaisedBy || "" }) : t("mfx_block_claim_waiting")}
                        </p>
                      </div>
                      {!n.quarantinedAt && canManage && (
                        <Button size="sm" variant="destructive" className="h-10 shrink-0 gap-1.5" onClick={() => setQuarantineTarget(n)}>
                          <ShieldAlert size={14} aria-hidden="true" />
                          {t("mfx_block_quarantine_btn")}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <MfgIssueWithdrawalDialog
        group={issueTarget}
        warehouses={facts.warehouses}
        departments={facts.departments}
        notices={facts.notices}
        orgId={facts.orgId}
        actor={facts.actor}
        link={issueTarget ? workshopLink(issueTarget.order.id) : null}
        onClose={() => setIssueTarget(null)}
      />
      <MfgRemnantReceiveDialog
        target={remnantTarget}
        warehouses={facts.warehouses}
        orgId={facts.orgId}
        actor={facts.actor}
        seesValue={seesValue}
        onClose={() => setRemnantTarget(null)}
      />

      <AlertDialog open={!!quarantineTarget} onOpenChange={(open) => { if (!open && !quarantining) setQuarantineTarget(null) }}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-destructive" aria-hidden="true" />
              {quarantineTarget && t("mfx_block_quarantine_title", { lot: quarantineTarget.lot })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("mfx_block_quarantine_desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
            <ClipboardCheck size={13} aria-hidden="true" />
            {t("mfg4_recorded_as", { name: facts.actor.name })} — {t("mfg4_from_signin")}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={quarantining}>{t("crm_cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void quarantine()
              }}
              disabled={quarantining}
              className="gap-2 bg-destructive text-white hover:bg-destructive/90"
            >
              {quarantining ? <Loader2 size={14} className="animate-spin" /> : <ShieldAlert size={14} />}
              {t("mfx_block_quarantine_btn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
