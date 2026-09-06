"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { ClipboardCheck, Truck, CheckCircle2, XCircle, Search, Loader2, Factory, Lock } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import { formatCrmDate } from "@/lib/crm"
import {
  DELIVERY_NOTES,
  DELIVERY_NOTE_STATUSES,
  confirmDeliveryNote,
  rejectDeliveryNote,
  type DeliveryNote,
  type DeliveryNoteStatus,
} from "@/lib/delivery-notes"
import type { CrmPortal } from "@/components/crm/CrmShell"

type Tab = DeliveryNoteStatus | "all"
const TABS: Tab[] = ["in_transit", ...DELIVERY_NOTE_STATUSES.filter((s) => s !== "in_transit"), "all"]

const STATUS_BADGE: Record<DeliveryNoteStatus, string> = {
  in_transit: "bg-warning/10 text-warning border-warning/20",
  received: "bg-success/10 text-success border-success/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
}

/**
 * Delivery notes (إشعارات التسليم) — finished products handed over from
 * Manufacturing, waiting for the receiving warehouse to sign. Signing lands
 * the stock; refusing sends the order back as undelivered. Stock moving
 * between warehouses is a withdrawal request, which has its own page.
 */
export function DeliveryNotesView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canReceive = can("warehouses.receive") || can("warehouses.manage")
  const { orgId, teamMembers, isLoading: isOrgLoading } = useCrmData()
  const actorName = teamMembers.find((m) => m.id === user?.uid)?.name || user?.email || ""

  const notesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, DELIVERY_NOTES), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: notesData, isLoading } = useCollection(notesQuery)
  const notes = useMemo(
    () => ((notesData || []) as DeliveryNote[]).slice().sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || "")),
    [notesData]
  )

  const [tab, setTab] = useState<Tab>("in_transit")
  const [search, setSearch] = useState("")
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { in_transit: 0, received: 0, rejected: 0, all: notes.length }
    for (const n of notes) c[n.status] += 1
    return c
  }, [notes])
  const needle = search.trim().toLowerCase()
  const visible = notes.filter(
    (n) =>
      (tab === "all" || n.status === tab) &&
      (!needle ||
        n.noteNumber.toLowerCase().includes(needle) ||
        n.item.name.toLowerCase().includes(needle) ||
        `#${n.source.workOrderNumber}`.includes(needle) ||
        n.source.title.toLowerCase().includes(needle) ||
        n.toWarehouseName.toLowerCase().includes(needle))
  )

  // ── Sign / refuse ──
  const [confirmTarget, setConfirmTarget] = useState<DeliveryNote | null>(null)
  const [rejectTarget, setRejectTarget] = useState<DeliveryNote | null>(null)
  const [noteText, setNoteText] = useState("")
  const [reason, setReason] = useState("")
  const [isWorking, setIsWorking] = useState(false)

  const confirm = async () => {
    if (!firestore || !user || !confirmTarget || isWorking) return
    setIsWorking(true)
    try {
      await confirmDeliveryNote(firestore, {
        note: confirmTarget,
        actor: { id: user.uid, name: actorName },
        receivedNote: noteText.trim() || null,
        notification: {
          title: t("dn_notif_received_title"),
          message: t("dn_notif_received_msg", { name: actorName, note: confirmTarget.noteNumber, warehouse: confirmTarget.toWarehouseName }),
        },
      })
      toast({ title: t("dn_received_toast", { note: confirmTarget.noteNumber }) })
      setConfirmTarget(null)
      setNoteText("")
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsWorking(false)
    }
  }

  const reject = async () => {
    if (!firestore || !user || !rejectTarget || isWorking) return
    if (!reason.trim()) {
      toast({ title: t("dn_reason_required"), variant: "destructive" })
      return
    }
    setIsWorking(true)
    try {
      await rejectDeliveryNote(firestore, {
        note: rejectTarget,
        actor: { id: user.uid, name: actorName },
        reason: reason.trim(),
        notification: {
          title: t("dn_notif_rejected_title"),
          message: t("dn_notif_rejected_msg", { name: actorName, note: rejectTarget.noteNumber, warehouse: rejectTarget.toWarehouseName, reason: reason.trim() }),
        },
      })
      toast({ title: t("dn_rejected_toast", { note: rejectTarget.noteNumber }) })
      setRejectTarget(null)
      setReason("")
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-primary flex items-center gap-2">
            <ClipboardCheck size={22} className="shrink-0" aria-hidden="true" />
            {t("dn_page_title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("dn_page_desc")}{" "}
            <Link href={`/${portal}/warehouses/requests`} className="text-cta font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
              {t("dn_requests_link")}
            </Link>
          </p>
          {!isOrgLoading && !canReceive && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
              <Lock size={12} aria-hidden="true" />
              {t("dn_no_permission")}
            </p>
          )}
        </div>
      </header>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {TABS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={tab === s}
              onClick={() => setTab(s)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === s ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              )}
            >
              {t(`dn_tab_${s}`)}
              <span className={cn("text-[10px] tabular-nums", tab === s ? "text-white/70" : "text-muted-foreground")}>{counts[s]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("dn_search_placeholder")} aria-label={t("dn_search_placeholder")} className="h-9 ps-9" />
        </div>
      </div>

      {isLoading || isOrgLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : visible.length === 0 ? (
        <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
          <Truck size={36} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">{t("dn_empty")}</p>
        </div>
      ) : (
        <ul className="rounded-2xl border bg-white divide-y overflow-hidden">
          {visible.map((n) => (
            <li key={n.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">{n.noteNumber}</span>
                  <Badge className={cn("text-[10px]", STATUS_BADGE[n.status])}>{t(`dn_status_${n.status}`)}</Badge>
                </div>
                <p className="text-sm font-bold text-foreground mt-1 flex items-center gap-2 flex-wrap" dir="auto">
                  {n.item.name}
                  <span className="text-xs text-muted-foreground font-normal tabular-nums" dir="ltr">{n.item.quantity} {n.item.unit}</span>
                  <span className="text-xs font-semibold text-cta">{t("dn_to", { warehouse: n.toWarehouseName })}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <Link href={`/${portal}/manufacturing`} className="flex items-center gap-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                    <Factory size={11} aria-hidden="true" />
                    {t("dn_from_order", { number: n.source.workOrderNumber, title: n.source.title })}
                  </Link>
                  <span>· {t("dn_sent_by", { name: n.sentByUserName, date: formatCrmDate(n.sentAt, locale) })}</span>
                  {n.status === "in_transit" && n.expectedReceiverName && <span>· {t("dn_expected", { name: n.expectedReceiverName })}</span>}
                  {n.status === "received" && n.receivedByUserName && n.receivedAt && (
                    <span className="text-success">· {t("dn_received_by", { name: n.receivedByUserName, date: formatCrmDate(n.receivedAt, locale) })}</span>
                  )}
                  {n.status === "rejected" && n.receivedByUserName && n.receivedAt && (
                    <span className="text-destructive">· {t("dn_rejected_by", { name: n.receivedByUserName, date: formatCrmDate(n.receivedAt, locale) })}{n.rejectedReason ? ` — ${n.rejectedReason}` : ""}</span>
                  )}
                  {n.receivedNote && <span>· {n.receivedNote}</span>}
                </p>
              </div>
              {canReceive && n.status === "in_transit" && (
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" className="h-8 gap-1.5" onClick={() => { setConfirmTarget(n); setNoteText("") }}>
                    <CheckCircle2 size={13} />
                    {t("dn_confirm_btn")}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive hover:text-white" onClick={() => { setRejectTarget(n); setReason("") }}>
                    <XCircle size={13} />
                    {t("dn_reject_btn")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!confirmTarget} onOpenChange={(open) => { if (!open && !isWorking) setConfirmTarget(null) }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck size={18} className="text-success" aria-hidden="true" />
              {t("dn_confirm_title")}
            </DialogTitle>
            <DialogDescription>
              {confirmTarget && t("dn_confirm_desc", { note: confirmTarget.noteNumber, item: `${confirmTarget.item.quantity} ${confirmTarget.item.unit} ${confirmTarget.item.name}`, warehouse: confirmTarget.toWarehouseName })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="dn-note">{t("dn_received_note")}</Label>
            <Textarea id="dn-note" value={noteText} onChange={(e) => setNoteText(e.target.value)} disabled={isWorking} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)} disabled={isWorking}>{t("crm_cancel")}</Button>
            <Button onClick={confirm} disabled={isWorking} className="gap-2 bg-success hover:bg-success/90 text-white">
              {isWorking ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {t("dn_confirm_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open && !isWorking) setRejectTarget(null) }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle size={18} className="text-destructive" aria-hidden="true" />
              {t("dn_reject_title")}
            </DialogTitle>
            <DialogDescription>{rejectTarget && t("dn_reject_desc", { note: rejectTarget.noteNumber })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="dn-reason">{t("dn_reject_reason")} *</Label>
            <Textarea id="dn-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={isWorking} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={isWorking}>{t("crm_cancel")}</Button>
            <Button onClick={reject} disabled={isWorking || !reason.trim()} variant="destructive" className="gap-2">
              {isWorking ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />}
              {t("dn_reject_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
