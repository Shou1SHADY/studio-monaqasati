"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useFirestore, useUser } from "@/firebase"
import { collection, getDocs } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useOrgWarehouseRequests } from "@/hooks/useOrgWarehouseRequests"
import type { OrgWarehouse } from "@/hooks/useCentralWarehouse"
import {
  releaseWarehouseRequest,
  confirmWarehouseRequestReceipt,
  cancelWarehouseRequest,
  itemMergeKey,
  type WarehouseRequestStatus,
} from "@/lib/warehouse-requests"
import { ClipboardList, Loader2, Check, X, Send } from "lucide-react"
import { cn } from "@/lib/utils"

export type RequestEntry = {
  id: string
  centralWarehouseId: string
  requestNumber: string
  itemName: string
  unit: string
  quantity: number
  releasedQuantity?: number | null
  fromWarehouseId: string
  toWarehouseId: string
  toProjectName?: string | null
  status: WarehouseRequestStatus
  requestedByName: string
  expectedReceiverName: string
  releasedByName?: string | null
  receivedByName?: string | null
  cancelledReason?: string | null
  createdAt?: { toDate?: () => Date } | null
  requestedAt?: { toDate?: () => Date } | null
}

function ReleaseDialog({
  open,
  onOpenChange,
  request,
  byUserId,
  byUserName,
  t,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: RequestEntry
  byUserId: string
  byUserName: string
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
}) {
  const firestore = useFirestore()
  const { toast } = useToast()
  const [qty, setQty] = useState(String(request.quantity))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const quantity = parseFloat(qty) || 0

  const handleSubmit = async () => {
    if (!firestore) return
    if (quantity <= 0 || quantity > request.quantity) {
      toast({ title: t("transfer_err_invalid_quantity"), variant: "destructive" })
      return
    }
    setIsSubmitting(true)
    try {
      await releaseWarehouseRequest({
        firestore,
        centralWarehouseId: request.centralWarehouseId,
        requestId: request.id,
        byUserId,
        byUserName,
        releasedQuantity: quantity,
      })
      toast({ title: t("request_released") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("transfer_error"), variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSubmitting) onOpenChange(next) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send size={17} className="text-primary" />
            {t("release_dialog_title", { item: request.itemName })}
          </DialogTitle>
          <DialogDescription>{t("release_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="p-3 rounded-xl bg-muted border border-border text-sm">
            <p><span className="text-muted-foreground">{t("request_number_label")}: </span><span className="font-mono font-bold">{request.requestNumber}</span></p>
            <p className="mt-1"><span className="text-muted-foreground">{t("release_requested_label")}: </span><span className="font-bold" dir="ltr">{request.quantity} {request.unit}</span></p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="release-qty">{t("release_quantity_label")} *</Label>
            <Input id="release-qty" type="number" min="0" max={request.quantity} value={qty}
              onChange={(e) => setQty(e.target.value)} dir="ltr" disabled={isSubmitting} />
            <p className="text-[11px] text-muted-foreground">{t("release_quantity_hint")}</p>
            {quantity > 0 && quantity < request.quantity && (
              <p className="text-xs text-warning font-semibold">{t("release_partial_note", { qty: quantity, unit: request.unit })}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>{t("wh_cancel")}</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || quantity <= 0 || quantity > request.quantity} className="gap-2">
            {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {t("request_release_btn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CancelDialog({
  open,
  onOpenChange,
  request,
  t,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: RequestEntry
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
}) {
  const firestore = useFirestore()
  const { toast } = useToast()
  const [reason, setReason] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!firestore || !reason.trim()) return
    setIsSubmitting(true)
    try {
      await cancelWarehouseRequest({ firestore, centralWarehouseId: request.centralWarehouseId, requestId: request.id, reason })
      toast({ title: t("request_cancelled") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("transfer_error"), variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSubmitting) onOpenChange(next) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <X size={17} />
            {t("cancel_dialog_title", { item: request.itemName })}
          </DialogTitle>
          <DialogDescription>{t("cancel_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label htmlFor="cancel-reason">{t("cancel_reason_label")} *</Label>
          <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={t("cancel_reason_placeholder")} disabled={isSubmitting} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>{t("wh_cancel")}</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !reason.trim()} variant="destructive" className="gap-2">
            {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
            {t("cancel_confirm_btn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmReceiptDialog({
  open,
  onOpenChange,
  request,
  byUserId,
  byUserName,
  t,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: RequestEntry
  byUserId: string
  byUserName: string
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
}) {
  const firestore = useFirestore()
  const { toast } = useToast()
  const [note, setNote] = useState("")
  const [isConfirming, setIsConfirming] = useState(false)
  const creditedQty = request.releasedQuantity ?? request.quantity

  const handleConfirm = async () => {
    if (!firestore) return
    setIsConfirming(true)
    try {
      const destItems = await getDocs(collection(firestore, "warehouses", request.toWarehouseId, "inventoryItems"))
      const key = itemMergeKey({ name: request.itemName, unit: request.unit })
      const match = destItems.docs.find((d) => {
        const data = d.data() as { name?: string; unit?: string; trackingMode?: string | null }
        return data.name && data.unit && data.trackingMode !== "unit" && itemMergeKey({ name: data.name, unit: data.unit }) === key
      })
      await confirmWarehouseRequestReceipt({
        firestore,
        centralWarehouseId: request.centralWarehouseId,
        requestId: request.id,
        byUserId,
        byUserName,
        note: note.trim() || null,
        existingDestItemId: match?.id ?? null,
      })
      toast({ title: t("request_confirmed") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("transfer_error"), variant: "destructive" })
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isConfirming) onOpenChange(next) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check size={17} className="text-success" />
            {t("confirm_receipt_title")}
          </DialogTitle>
          <DialogDescription>
            {t("confirm_receipt_desc", { qty: creditedQty, unit: request.unit, item: request.itemName })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="p-3 rounded-xl bg-muted border border-border text-sm space-y-1">
            <p><span className="text-muted-foreground">{t("request_number_label")}: </span><span className="font-mono font-bold">{request.requestNumber}</span></p>
            <p><span className="text-muted-foreground">{t("request_expected_receiver_label")}: </span><span className="font-semibold">{request.expectedReceiverName}</span></p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="receipt-note">{t("confirm_receipt_note_label")}</Label>
            <Textarea id="receipt-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("confirm_receipt_note_placeholder")} disabled={isConfirming} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isConfirming}>{t("wh_cancel")}</Button>
          <Button onClick={handleConfirm} disabled={isConfirming} className="gap-2 bg-success hover:bg-success/90">
            {isConfirming ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {t("confirm_receipt_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Withdrawal requests touching this warehouse (or every request across the
 * org, when `warehouseId` is omitted — used by the dedicated Requests page).
 * Release/confirm/cancel all live here so both call sites share one
 * implementation instead of duplicating the state machine's UI.
 */
export function WarehouseRequestsSection({
  centrals,
  warehouseId,
  warehouseNameById,
  canManage,
  t,
  locale,
}: {
  centrals: OrgWarehouse[]
  /** Omit to show every request across the org instead of just one warehouse's. */
  warehouseId?: string
  warehouseNameById: Map<string, string>
  canManage: boolean
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  locale: string
}) {
  const isRtl = locale === "ar"
  const { user } = useUser()
  const byUserId = user?.uid || ""
  const byUserName = user?.displayName || user?.email || ""

  const [releasingRequest, setReleasingRequest] = useState<RequestEntry | null>(null)
  const [cancellingRequest, setCancellingRequest] = useState<RequestEntry | null>(null)
  const [confirmingRequest, setConfirmingRequest] = useState<RequestEntry | null>(null)

  const centralIds = centrals.map((c) => c.id)
  const { requests: allOrgRequests } = useOrgWarehouseRequests(centralIds)
  const allRequests = (allOrgRequests as RequestEntry[])
    .filter((r) => !warehouseId || r.fromWarehouseId === warehouseId || r.toWarehouseId === warehouseId)
    .sort((a, b) => (b.requestedAt?.toDate?.()?.getTime() ?? 0) - (a.requestedAt?.toDate?.()?.getTime() ?? 0))

  const active = allRequests.filter((r) => r.status === "pending" || r.status === "released")
  const history = allRequests.filter((r) => r.status === "received" || r.status === "cancelled").slice(0, 20)

  const statusBadge = (status: WarehouseRequestStatus) => {
    if (status === "pending") return <Badge className="bg-warning/10 text-warning border-warning/20">{t("request_status_pending")}</Badge>
    if (status === "released") return <Badge className="bg-cta/10 text-cta border-cta/20">{t("request_status_released")}</Badge>
    if (status === "received") return <Badge className="bg-success/10 text-success border-success/20">{t("request_status_received")}</Badge>
    return <Badge variant="outline" className="text-muted-foreground">{t("request_status_cancelled")}</Badge>
  }

  const otherName = (r: RequestEntry, forWarehouseId: string) => {
    const isSourceHere = r.fromWarehouseId === forWarehouseId
    const otherId = isSourceHere ? r.toWarehouseId : r.fromWarehouseId
    return (isSourceHere ? r.toProjectName : null) || warehouseNameById.get(otherId) || otherId
  }

  const RequestRow = ({ r, showHistory }: { r: RequestEntry; showHistory?: boolean }) => {
    const perspectiveWarehouseId = warehouseId || r.fromWarehouseId
    const isSourceHere = r.fromWarehouseId === perspectiveWarehouseId
    const canRelease = isSourceHere && r.status === "pending" && canManage
    const canConfirm = !isSourceHere && r.status === "released" && canManage
    const canCancel = isSourceHere && r.status === "pending" && canManage
    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 text-sm">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-muted-foreground">{r.requestNumber}</span>
            {statusBadge(r.status)}
            {!warehouseId && (
              <span className="text-[11px] text-muted-foreground">
                {warehouseNameById.get(r.fromWarehouseId) || r.fromWarehouseId} ← {warehouseNameById.get(r.toWarehouseId) || r.toProjectName || r.toWarehouseId}
              </span>
            )}
          </div>
          <p className="mt-1">
            <span className="font-bold" dir="ltr">{r.quantity} {r.unit}</span>
            {r.status !== "pending" && (r.releasedQuantity ?? r.quantity) !== r.quantity && (
              <span className="text-warning font-semibold"> ({t("release_partial_badge", { qty: r.releasedQuantity ?? r.quantity })})</span>
            )}
            {" — "}
            <span className="font-semibold">{r.itemName}</span>
            {warehouseId && (
              <>
                {" "}
                <span className="text-muted-foreground">
                  {isSourceHere ? t("transfers_log_to", { name: otherName(r, perspectiveWarehouseId) }) : t("transfers_log_from", { name: otherName(r, perspectiveWarehouseId) })}
                </span>
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("request_expected_receiver_label")}: <span className="font-semibold">{r.expectedReceiverName}</span>
          </p>
          {r.status === "cancelled" && r.cancelledReason && (
            <p className="text-xs text-destructive mt-0.5">{t("cancel_reason_label")}: {r.cancelledReason}</p>
          )}
        </div>
        {!showHistory && (
          <div className="flex items-center gap-2 shrink-0">
            {canRelease && (
              <Button size="sm" onClick={() => setReleasingRequest(r)} className="gap-1.5 h-8">
                <Send size={13} />
                {t("request_release_btn")}
              </Button>
            )}
            {canConfirm && (
              <Button size="sm" onClick={() => setConfirmingRequest(r)} className="gap-1.5 h-8 bg-success hover:bg-success/90">
                <Check size={13} />
                {t("request_confirm_btn")}
              </Button>
            )}
            {canCancel && (
              <Button size="sm" variant="ghost" onClick={() => setCancellingRequest(r)} className="gap-1.5 h-8 text-muted-foreground hover:text-destructive">
                <X size={13} />
                {t("wh_cancel")}
              </Button>
            )}
          </div>
        )}
      </div>
    )
  }

  if (allRequests.length === 0) {
    return warehouseId ? null : (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <ClipboardList size={48} className="text-muted-foreground/20" />
        <p className="font-bold text-muted-foreground">{t("requests_empty_title")}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3" dir={isRtl ? "rtl" : "ltr"}>
      <h3 className="font-bold text-sm flex items-center gap-2 text-foreground">
        <ClipboardList size={15} className="text-primary" />
        {t("requests_section_title")}
        {active.length > 0 && (
          <Badge variant="secondary" className="bg-primary/10 text-primary font-bold border-none">{active.length}</Badge>
        )}
      </h3>

      {active.length > 0 && (
        <div className={cn("border rounded-xl divide-y overflow-hidden", !warehouseId && "border-2 border-warning/20")}>
          {active.map((r) => <RequestRow key={r.id} r={r} />)}
        </div>
      )}

      {history.length > 0 && (
        <details className="group">
          <summary className="text-xs font-bold text-muted-foreground cursor-pointer hover:text-foreground select-none">
            {t("requests_history_toggle", { count: history.length })}
          </summary>
          <div className="border rounded-xl divide-y overflow-hidden mt-2">
            {history.map((r) => <RequestRow key={r.id} r={r} showHistory />)}
          </div>
        </details>
      )}

      {releasingRequest && (
        <ReleaseDialog
          open={!!releasingRequest}
          onOpenChange={(open) => { if (!open) setReleasingRequest(null) }}
          request={releasingRequest}
          byUserId={byUserId}
          byUserName={byUserName}
          t={t}
        />
      )}
      {cancellingRequest && (
        <CancelDialog
          open={!!cancellingRequest}
          onOpenChange={(open) => { if (!open) setCancellingRequest(null) }}
          request={cancellingRequest}
          t={t}
        />
      )}
      {confirmingRequest && (
        <ConfirmReceiptDialog
          open={!!confirmingRequest}
          onOpenChange={(open) => { if (!open) setConfirmingRequest(null) }}
          request={confirmingRequest}
          byUserId={byUserId}
          byUserName={byUserName}
          t={t}
        />
      )}
    </div>
  )
}
