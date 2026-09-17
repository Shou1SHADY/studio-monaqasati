"use client"

// Finance's desk for Sales (Sales PRD INT-03, D2, D3) — the counterpart the
// PRD names a release-1 prerequisite: without it, an order waits on its
// advance forever. It lives in the FINANCE module so an accountant reaches it
// with Finance's permissions alone, and it holds the three acts that are
// Finance's and nobody else's:
//
//   1. answer a transfer notice — "deposit confirmed" or "not found" + message
//   2. hold a client's shipment, or release it (Sales sees the state only)
//   3. settle an approved return with the credit note
//
// Sales reports and requests; Finance verifies and decides.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, getDocs, query, where } from "firebase/firestore"
import { Banknote, HandCoins, Loader2, Lock, PauseCircle, PlayCircle, Receipt, RotateCcw, Truck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { formatCrmDate, formatSar } from "@/lib/crm"
import {
  SALES_DELIVERY_NOTES,
  SALES_ORDERS,
  SALES_RETURNS,
  deliveryNoteValue,
  returnValue,
  type SalesDeliveryNote,
  type SalesOrder,
  type SalesReturn,
} from "@/lib/sales-orders"
import { holdDelivery, issueCreditNote, releaseDelivery } from "@/lib/sales-order-writes"
import { SALES_TRANSFER_NOTICES, type TransferNotice } from "@/lib/sales-transfers"
import { AnswerTransferDialog, TransferNoticesList } from "@/components/sales/TransferNotices"
import { SalesDepositsToConfirm } from "@/components/sales/SalesDepositsToConfirm"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { AccountingShell } from "./AccountingShell"

export function FinanceSalesDesk({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  // Holds, releases and credit notes are the documents clerk's; an accountant
  // who posts may answer a notice too (the rules let either finish the act).
  const canDecide = can("invoices.manage")
  const canAnswer = canDecide || can("accounting.post")

  const { orgId, quotations, teamMembers, isLoading } = useCrmData({ quotations: true })
  const actorName = teamMembers.find((m) => m.id === user?.uid)?.name || user?.email || ""
  const actor = useMemo(() => ({ id: user?.uid || "", name: actorName }), [user?.uid, actorName])

  const orgQuery = (name: string) => (firestore && orgId ? query(collection(firestore, name), where("organizationId", "==", orgId)) : null)
  const noticesQ = useMemoFirebase(() => orgQuery(SALES_TRANSFER_NOTICES), [firestore, orgId])
  const ordersQ = useMemoFirebase(() => orgQuery(SALES_ORDERS), [firestore, orgId])
  const notesQ = useMemoFirebase(() => orgQuery(SALES_DELIVERY_NOTES), [firestore, orgId])
  const returnsQ = useMemoFirebase(() => orgQuery(SALES_RETURNS), [firestore, orgId])
  const { data: noticesData } = useCollection(noticesQ)
  const { data: ordersData } = useCollection(ordersQ)
  const { data: notesData } = useCollection(notesQ)
  const { data: returnsData } = useCollection(returnsQ)

  const notices = useMemo(() => (noticesData || []) as TransferNotice[], [noticesData])
  const orders = useMemo(() => (ordersData || []) as SalesOrder[], [ordersData])
  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  // What has not left yet — the only shipments a hold can still stop.
  const shipments = useMemo(
    () =>
      ((notesData || []) as SalesDeliveryNote[])
        .filter((n) => n.status === "requested" || n.status === "authorized" || n.status === "held")
        .sort((a, b) => Number(!!b.releaseRequestedAt) - Number(!!a.releaseRequestedAt) || (a.status === "held" ? -1 : 1) - (b.status === "held" ? -1 : 1) || (a.requestedAt || "").localeCompare(b.requestedAt || "")),
    [notesData]
  )
  const toSettle = useMemo(() => ((returnsData || []) as SalesReturn[]).filter((r) => r.status === "approved"), [returnsData])
  const openNotices = notices.filter((n) => n.status === "reported").length

  const [answering, setAnswering] = useState<TransferNotice | null>(null)
  const [holdFor, setHoldFor] = useState<SalesDeliveryNote | null>(null)
  const [holdReason, setHoldReason] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  const run = async (id: string, act: () => Promise<void>, done: string) => {
    if (!firestore || busyId) return
    setBusyId(id)
    try {
      await act()
      toast({ title: done })
    } catch (err) {
      console.error(err)
      toast({ title: t("so_save_error"), variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  const settle = (salesReturn: SalesReturn) =>
    run(
      salesReturn.id,
      async () => {
        const order = orderById.get(salesReturn.orderId)
        if (!order) throw new Error("order_missing")
        const note = ((notesData || []) as SalesDeliveryNote[]).find((n) => n.id === salesReturn.deliveryNoteId)
        let stockRows: Array<{ id: string; name: string; quantity: number; lot: string | null; remnant: boolean }> = []
        if (note?.warehouseId && salesReturn.disposition !== "scrap") {
          const snap = await getDocs(collection(firestore, "warehouses", note.warehouseId, "inventoryItems"))
          stockRows = snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) || "", quantity: Number(d.data().quantity) || 0, lot: (d.data().lot as string) || null, remnant: !!d.data().remnant }))
        }
        await issueCreditNote(firestore, { salesReturn, order, stockRows, warehouseId: note?.warehouseId ?? null, actor })
      },
      t("sr_credit_issued")
    )

  return (
    <AccountingShell portal={portal} title={t("fsd_title")} description={t("fsd_desc")} icon={HandCoins}>
      {!isLoading && !canAnswer && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock size={12} aria-hidden="true" />
          {t("fsd_no_permission")}
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : (
        <>
          {/* Orders gated on an advance nobody filed a notice for. */}
          {orgId && <SalesDepositsToConfirm orgId={orgId} actor={actor} canConfirm={canDecide} ordersHref={`/${portal}/sales/orders`} />}

          <Section icon={Banknote} title={t("fsd_notices_title")} sub={t("fsd_notices_sub")} count={openNotices}>
            {notices.length === 0 ? <Empty>{t("fsd_notices_empty")}</Empty> : <TransferNoticesList notices={notices} canAnswer={canAnswer} onAnswer={setAnswering} />}
          </Section>

          <Section icon={Truck} title={t("fsd_shipments_title")} sub={t("fsd_shipments_sub")} count={shipments.filter((n) => n.status === "held").length}>
            {shipments.length === 0 ? (
              <Empty>{t("fsd_shipments_empty")}</Empty>
            ) : (
              <ul className="divide-y">
                {shipments.map((note) => (
                  <li key={note.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold">{note.noteNumber}</span>
                        {note.status === "held" ? (
                          <Badge className="border-none bg-destructive/10 text-destructive">{t("sf_status_held")}</Badge>
                        ) : (
                          <Badge className="border-none bg-muted text-muted-foreground">{t(note.status === "authorized" ? "sf_status_authorized" : "sf_status_requested")}</Badge>
                        )}
                        <span className="text-xs text-muted-foreground" dir="auto">{t("so_order_no", { number: note.orderNumber })} · {note.contactName || "—"}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground" dir="auto">{note.lines.map((l) => `${l.name} × ${l.quantity}`).join(" · ")}</p>
                      {note.status === "held" && (
                        <p className="mt-0.5 text-[11px] text-destructive" dir="auto">
                          {note.holdReason || "—"}
                          {note.heldByUserName && <span className="ms-1.5 text-muted-foreground">· {note.heldByUserName}</span>}
                        </p>
                      )}
                      {note.releaseRequestedAt && (
                        <p className="mt-0.5 text-[11px] font-semibold text-warning">
                          {t("sf_release_requested_by", { name: note.releaseRequestedByUserName || "—", date: formatCrmDate(note.releaseRequestedAt, locale) })}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold tabular-nums" dir="ltr">{formatSar(deliveryNoteValue(note, orderById.get(note.orderId)), locale)}</span>
                      {canDecide &&
                        (note.status === "held" ? (
                          <Button size="sm" className="h-8 gap-1.5" disabled={busyId === note.id} onClick={() => run(note.id, () => releaseDelivery(firestore, { noteId: note.id, actor }), t("sf_released_toast", { number: note.noteNumber }))}>
                            {busyId === note.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <PlayCircle size={13} aria-hidden="true" />}
                            {t("sf_release_btn")}
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => { setHoldReason(""); setHoldFor(note) }}>
                            <PauseCircle size={13} aria-hidden="true" />
                            {t("sf_hold_btn")}
                          </Button>
                        ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={RotateCcw} title={t("fsd_returns_title")} sub={t("fsd_returns_sub")} count={toSettle.length}>
            {toSettle.length === 0 ? (
              <Empty>{t("fsd_returns_empty")}</Empty>
            ) : (
              <ul className="divide-y">
                {toSettle.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold">{r.returnNumber}</span>
                        <span className="text-xs text-muted-foreground" dir="auto">{t("so_order_no", { number: r.orderNumber })} · {r.contactName || "—"}</span>
                        {r.disposition && <Badge className="border-none bg-muted text-muted-foreground">{t(`sr_disposition_${r.disposition}`)}</Badge>}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground" dir="auto">
                        {r.lines.map((l) => `${l.name} × ${l.quantity}`).join(" · ")} — {r.reason}
                        {r.decidedByUserName && <span className="ms-1.5">· {t("fsd_approved_by", { name: r.decidedByUserName })}</span>}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold tabular-nums" dir="ltr">{formatSar(returnValue(r, orderById.get(r.orderId)), locale)}</span>
                      {canDecide && (
                        <Button size="sm" className="h-8 gap-1.5" disabled={busyId === r.id} onClick={() => settle(r)}>
                          {busyId === r.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Receipt size={13} aria-hidden="true" />}
                          {t("sr_credit_btn")}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      <AnswerTransferDialog
        notice={answering}
        quotation={answering ? quotations.find((q) => q.id === answering.quotationId) ?? null : null}
        order={answering ? orders.find((o) => o.quotationId === answering.quotationId) ?? null : null}
        onOpenChange={(open) => { if (!open) setAnswering(null) }}
        actorName={actorName}
      />

      <Dialog open={!!holdFor} onOpenChange={(open) => { if (!open) setHoldFor(null) }}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("sf_hold_title")}</DialogTitle>
            <DialogDescription>{t("sf_hold_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="fsd-hold-reason">{t("sf_hold_reason")} *</Label>
            <Input id="fsd-hold-reason" dir="auto" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoldFor(null)}>{t("crm_cancel")}</Button>
            <Button
              className="gap-1.5"
              disabled={!holdReason.trim() || !!busyId}
              onClick={() => {
                const target = holdFor
                if (!target) return
                void run(target.id, () => holdDelivery(firestore, { noteId: target.id, reason: holdReason.trim(), actor }), t("sf_held_toast")).then(() => setHoldFor(null))
              }}
            >
              <PauseCircle size={14} aria-hidden="true" />
              {t("sf_hold_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AccountingShell>
  )
}

function Section({ icon: Icon, title, sub, count, children }: { icon: typeof Banknote; title: string; sub: string; count: number; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-white">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b bg-muted/30 px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-black text-foreground">
            <Icon size={15} className="text-primary" aria-hidden="true" />
            {title}
            {count > 0 && <Badge className="border-none bg-warning/10 text-[10px] tabular-nums text-warning">{count}</Badge>}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="p-6 text-center text-sm text-muted-foreground">{children}</p>
