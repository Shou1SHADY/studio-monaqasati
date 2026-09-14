"use client"

// Inventory issues a workshop withdrawal (T11, MAT-01). The storekeeper picks
// the warehouse and, per line, the stock row it leaves from — stone is one
// block per row, so the block the station asked for is the row. A quarantined
// block is never issued. Stock leaves now at its unit cost; the value lands on
// the order only when the station confirms receipt (MAT-02).

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { AlertTriangle, CheckCircle2, Layers, Loader2, PackageMinus, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { itemKey, round2, type WorkOrderMaterial } from "@/lib/manufacturing-engine"
import { issueWithdrawal, type Actor, type MfgBlockNotice, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { emitMfgEvent } from "@/lib/mfg-events"
import type { MfgFactsDepartment, MfgFactsWarehouse } from "@/hooks/useMfgFacts"
import { RecordedAsLine, errText } from "./MfgOutsideBits"

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })

export interface WithdrawalGroup {
  key: string
  order: WorkOrderV2
  orderRef: string
  productName: string
  requestNumber: string
  departmentId: string
  rows: WorkOrderMaterial[]
}

interface StockRow {
  id: string
  name: string
  quantity: number
  unit: string
  unitCost: number | null
  lot: string | null
  remnant: boolean
  isManufactured: boolean
}

export function MfgIssueWithdrawalDialog({
  group,
  warehouses,
  departments,
  notices,
  orgId,
  actor,
  link,
  onClose,
}: {
  group: WithdrawalGroup | null
  warehouses: MfgFactsWarehouse[]
  departments: MfgFactsDepartment[]
  notices: MfgBlockNotice[]
  orgId: string
  actor: Actor
  link: string | null
  onClose: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const stores = useMemo(() => warehouses.filter((w) => !w.isOutbound && !w.virtual), [warehouses])
  const [warehouseId, setWarehouseId] = useState("")
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A new withdrawal opens on the central store; the store list updating live
  // never resets the storekeeper's choice.
  useEffect(() => {
    setWarehouseId("")
    setPicked({})
    setError(null)
  }, [group?.key])
  useEffect(() => {
    if (!warehouseId && stores.length) setWarehouseId(stores.find((w) => w.isCentral)?.id || stores[0].id)
  }, [stores, warehouseId])

  const itemsRef = useMemoFirebase(() => (firestore && warehouseId && group ? collection(firestore, "warehouses", warehouseId, "inventoryItems") : null), [firestore, warehouseId, group?.key])
  const { data: itemsData, isLoading } = useCollection(itemsRef)
  const rows = useMemo<StockRow[]>(
    () =>
      ((itemsData || []) as Array<Record<string, unknown> & { id: string }>).map((d) => ({
        id: d.id,
        name: String(d.name || ""),
        quantity: Number(d.quantity) || 0,
        unit: String(d.unit || ""),
        unitCost: typeof d.unitCost === "number" ? d.unitCost : null,
        lot: typeof d.lot === "string" && d.lot ? d.lot : null,
        remnant: !!d.remnant,
        isManufactured: !!d.isManufactured,
      })),
    [itemsData]
  )

  const quarantined = useMemo(() => new Set(notices.filter((n) => n.quarantinedAt && !n.closedAt).map((n) => n.lot)), [notices])
  const openNotices = useMemo(() => notices.filter((n) => !n.closedAt), [notices])

  const lines = useMemo(() => {
    if (!group) return []
    return group.rows.map((m) => {
      const same = rows.filter((r) => !r.isManufactured && itemKey(r.name) === itemKey(m.itemName))
      const exact = m.lot ? same.filter((r) => r.lot === m.lot) : []
      const unlotted = same.filter((r) => !r.lot)
      // A named block is issued from that block; a store that never recorded
      // blocks for the item falls back to its unrecorded rows, said aloud.
      const candidates = m.lot ? (exact.length ? exact : unlotted) : same
      const blocked = (r: StockRow) => !!(r.lot && quarantined.has(r.lot))
      const fallback = candidates.find((r) => r.quantity >= m.quantity - 1e-9 && !blocked(r)) || candidates.find((r) => !blocked(r))
      const chosenId = picked[m.id] ?? fallback?.id ?? ""
      const chosen = candidates.find((r) => r.id === chosenId) || null
      return {
        m,
        candidates,
        chosen,
        blocked,
        unrecordedBlock: !!m.lot && !exact.length && unlotted.length > 0,
        onHand: round2(same.reduce((a, r) => a + r.quantity, 0)),
        onBlock: m.lot ? round2(exact.reduce((a, r) => a + r.quantity, 0)) : null,
        notice: m.lot ? openNotices.find((n) => n.lot === m.lot) || null : null,
        requestedQuarantined: !!(m.lot && quarantined.has(m.lot)),
      }
    })
  }, [group, rows, picked, quarantined, openNotices])

  const problem = useMemo(() => {
    if (!warehouseId) return t("mfx_issue_pick_warehouse")
    const usage = new Map<string, number>()
    for (const l of lines) {
      if (l.requestedQuarantined || (l.chosen && l.blocked(l.chosen))) return t("mfx_issue_quarantined", { lot: l.m.lot || l.chosen?.lot || "" })
      if (!l.candidates.length) return t("mfx_issue_not_here", { item: l.m.itemName })
      if (!l.chosen) return t("mfx_issue_pick_row", { item: l.m.itemName })
      if (l.chosen.quantity < l.m.quantity - 1e-9) return t("mfx_issue_row_short", { item: l.m.itemName, qty: fmt(l.chosen.quantity), unit: l.chosen.unit || l.m.unit })
      usage.set(l.chosen.id, (usage.get(l.chosen.id) || 0) + l.m.quantity)
    }
    for (const l of lines) {
      if (l.chosen && (usage.get(l.chosen.id) || 0) > l.chosen.quantity + 1e-9) return t("mfx_issue_row_short", { item: l.m.itemName, qty: fmt(l.chosen.quantity), unit: l.chosen.unit || l.m.unit })
    }
    return null
  }, [lines, warehouseId, t])

  if (!group) return null
  const station = departments.find((d) => d.id === group.departmentId)
  const warehouseName = stores.find((w) => w.id === warehouseId)?.name || ""

  const submit = async () => {
    if (!firestore || busy) return
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const seen = new Set<string>()
      const stockRows = lines
        .map((l) => l.chosen!)
        .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
        .map((r) => ({ id: r.id, name: r.name, quantity: r.quantity, unitCost: r.unitCost, lot: r.lot }))
      const rowFor = Object.fromEntries(lines.map((l) => [l.m.id, l.chosen!.id]))
      await issueWithdrawal(firestore, { orderId: group.order.id, requestNumber: group.requestNumber, warehouseId, stockRows, rowFor, quarantinedLots: Array.from(quarantined), actor })
      // inventory.materials.issued — the station confirms receipt (T11).
      await emitMfgEvent(firestore, {
        kind: "materials_issued",
        copy: t,
        organizationId: orgId,
        actor,
        to: [{ station: group.departmentId }, { users: [group.rows[0]?.requestedByUserId] }],
        params: { number: group.requestNumber, ref: group.orderRef, dept: station?.name || "", warehouse: warehouseName },
        workOrderId: group.order.id,
        link,
      })
      toast({ title: t("mfx_issue_done", { wr: group.requestNumber, warehouse: warehouseName }) })
      onClose()
    } catch (err) {
      console.error(err)
      setError(errText(t, err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!group} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageMinus size={18} className="text-cta" aria-hidden="true" />
            {t("mfx_issue_title", { wr: group.requestNumber })}
          </DialogTitle>
          <DialogDescription>
            {t("mfx_issue_desc", { order: group.orderRef, product: group.productName, station: station?.name || "—" })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="mfx-issue-wh">{t("mfx_issue_warehouse")}</Label>
            <Select value={warehouseId || undefined} onValueChange={(v) => { setWarehouseId(v); setPicked({}); setError(null) }}>
              <SelectTrigger id="mfx-issue-wh" className="h-11">
                <SelectValue placeholder={t("mfx_issue_pick_warehouse")} />
              </SelectTrigger>
              <SelectContent>
                {stores.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                    {w.projectId ? ` — ${t("mfx_wh_project_tag")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 size={22} className="animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : (
            <ul className="space-y-2">
              {lines.map((l) => {
                const enough = !!l.chosen && l.chosen.quantity >= l.m.quantity - 1e-9
                return (
                  <li key={l.m.id} className="space-y-2 rounded-xl border bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-foreground" dir="auto">{l.m.itemName}</span>
                      <span className="text-xs font-bold text-cta" dir="ltr">
                        <span className="tabular-nums">{fmt(l.m.quantity)}</span> {l.m.unit}
                      </span>
                      {l.m.lot && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-px font-mono text-[10px] font-bold text-slate-600" dir="ltr">
                          <Layers size={10} aria-hidden="true" />
                          {l.m.lot}
                        </span>
                      )}
                      <span className="ms-auto text-[11px] text-muted-foreground">
                        {l.onBlock != null
                          ? t("mfx_issue_on_block", { qty: fmt(l.onBlock), unit: l.m.unit })
                          : t("mfx_issue_on_hand", { qty: fmt(l.onHand), unit: l.m.unit })}
                      </span>
                    </div>

                    {l.m.consentNote && <p className="text-[11px] text-warning">{t("mfx_issue_consent", { note: l.m.consentNote })}</p>}

                    {l.notice && (
                      <p className="flex items-start gap-1.5 rounded-lg border border-destructive/25 bg-destructive/5 px-2.5 py-1.5 text-[11px] font-semibold text-destructive">
                        <ShieldAlert size={13} className="mt-px shrink-0" aria-hidden="true" />
                        <span>
                          {l.requestedQuarantined
                            ? t("mfx_issue_quarantined", { lot: l.notice.lot })
                            : t("mfx_issue_notice", { lot: l.notice.lot, defect: t(`mfg4_defect_${l.notice.defect}`), note: l.notice.note })}
                        </span>
                      </p>
                    )}

                    {l.candidates.length === 0 ? (
                      <p className="text-[11px] font-semibold text-destructive">{t("mfx_issue_not_here", { item: l.m.itemName })}</p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select value={l.chosen?.id} onValueChange={(v) => { setPicked((p) => ({ ...p, [l.m.id]: v })); setError(null) }}>
                          <SelectTrigger className="h-10 min-w-0 flex-1 text-xs" aria-label={t("mfx_issue_row", { item: l.m.itemName })}>
                            <SelectValue placeholder={t("mfx_issue_pick_row", { item: l.m.itemName })} />
                          </SelectTrigger>
                          <SelectContent>
                            {l.candidates.map((r) => (
                              <SelectItem key={r.id} value={r.id} disabled={l.blocked(r)} className="text-xs">
                                {(r.lot || t("mfx_issue_no_block")) + " — " + fmt(r.quantity) + " " + (r.unit || l.m.unit)}
                                {r.remnant ? ` · ${t("mfx_inv_remnant_chip")}` : ""}
                                {l.blocked(r) ? ` · ${t("mfx_block_quarantined_short")}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {l.chosen && (
                          <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold", enough ? "text-success" : "text-destructive")}>
                            {enough ? <CheckCircle2 size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}
                            {enough ? t("mfx_issue_covers") : t("mfx_issue_short")}
                          </span>
                        )}
                      </div>
                    )}
                    {l.unrecordedBlock && <p className="text-[11px] text-warning">{t("mfx_issue_unrecorded_block", { lot: l.m.lot || "" })}</p>}
                  </li>
                )
              })}
            </ul>
          )}

          <ul className="space-y-1 rounded-xl border bg-white px-3.5 py-2.5 text-xs text-slate-700">
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              {t("mfx_issue_effect_stock", { warehouse: warehouseName || "—" })}
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              {t("mfx_issue_effect_lead")}
            </li>
          </ul>

          <RecordedAsLine name={actor.name} />
        </div>

        <DialogFooter className="flex-wrap items-center gap-2">
          {(error || problem) && (
            <span className="me-auto flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-destructive">
              <AlertTriangle size={13} className="shrink-0" aria-hidden="true" /> {error || problem}
            </span>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("crm_cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !!problem || isLoading} className="gap-2">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <PackageMinus size={15} />}
            {t("mfx_issue_btn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
