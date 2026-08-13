"use client"

// Internal purchase requests (طلبات شراء داخلية) — a team member raises a
// request for materials from inside the project; the person who manages the
// project's warehouse (warehouses.manage) approves or rejects it. Bare-bones
// by design: no automatic conversion into an RFQ or warehouse consumption —
// approval just unblocks the requester to proceed (outside the system, or via
// the existing "Pull from Warehouse" / BOQ-publish flows already on this page).

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useCollection, useDoc, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, addDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { PlusCircle, ClipboardList, Loader2, CheckCircle2, XCircle, Plus, Trash2 } from "lucide-react"

type RequestItem = { name: string; quantity: string; unit: string }

type PurchaseRequest = {
  id: string
  title: string
  items: RequestItem[]
  notes?: string
  status: "pending" | "approved" | "rejected"
  requestedByUserId: string
  requestedByUserName: string
  decidedByUserName?: string
  createdAt?: unknown
}

function fmtDate(val: unknown, locale: string) {
  if (!val) return "–"
  const d =
    val && typeof val === "object" && "toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function"
      ? (val as { toDate: () => Date }).toDate()
      : new Date(val as string | number)
  if (isNaN(d.getTime())) return "–"
  return d.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", { year: "numeric", month: "short", day: "numeric" })
}

function makeEmptyItem(): RequestItem {
  return { name: "", quantity: "", unit: "" }
}

interface PurchaseRequestsTabProps {
  projectId: string
  canDecide: boolean
}

export function PurchaseRequestsTab({ projectId, canDecide }: PurchaseRequestsTabProps) {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()

  const userDocRef = useMemoFirebase(() => {
    if (!firestore || !user) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user])
  const { data: profile } = useDoc(userDocRef)

  const [showCreate, setShowCreate] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [items, setItems] = useState<RequestItem[]>([makeEmptyItem()])
  const [decidingId, setDecidingId] = useState<string | null>(null)

  const requestsQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return collection(firestore, "projects", projectId, "purchaseRequests")
  }, [firestore, projectId])
  const { data: requestsData, isLoading } = useCollection(requestsQuery)
  const requests = ((requestsData || []) as PurchaseRequest[]).sort((a, b) => {
    const getTime = (v: unknown) =>
      v && typeof v === "object" && "toDate" in v ? (v as { toDate: () => Date }).toDate().getTime() : 0
    return getTime(b.createdAt) - getTime(a.createdAt)
  })

  const resetForm = () => {
    setTitle("")
    setNotes("")
    setItems([makeEmptyItem()])
  }

  const updateItem = (index: number, field: keyof RequestItem, value: string) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)))
  }
  const addItem = () => setItems((prev) => [...prev, makeEmptyItem()])
  const removeItem = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index))

  const handleSubmit = async () => {
    if (!firestore || !user) return
    const validItems = items.filter((it) => it.name.trim() && Number(it.quantity) > 0)
    if (!title.trim() || validItems.length === 0) {
      toast({ title: t("pr_validation_error"), variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      await addDoc(collection(firestore, "projects", projectId, "purchaseRequests"), {
        title: title.trim(),
        items: validItems,
        notes: notes.trim() || null,
        status: "pending",
        requestedByUserId: user.uid,
        requestedByUserName: profile?.name || user.email || "عضو الفريق",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      toast({ title: t("pr_submit_success") })
      resetForm()
      setShowCreate(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("pr_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDecide = async (requestId: string, approve: boolean) => {
    if (!firestore || !user) return
    setDecidingId(requestId)
    try {
      await updateDoc(doc(firestore, "projects", projectId, "purchaseRequests", requestId), {
        status: approve ? "approved" : "rejected",
        decidedByUserId: user.uid,
        decidedByUserName: profile?.name || user.email || "عضو الفريق",
        decidedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      toast({ title: approve ? t("pr_approved_toast") : t("pr_rejected_toast") })
    } catch (err) {
      console.error(err)
      toast({ title: t("pr_save_error"), variant: "destructive" })
    } finally {
      setDecidingId(null)
    }
  }

  const statusBadge = (status: PurchaseRequest["status"]) => {
    if (status === "approved") return <Badge className="bg-success text-white border-none">{t("pr_status_approved")}</Badge>
    if (status === "rejected") return <Badge variant="outline" className="text-destructive border-destructive/30">{t("pr_status_rejected")}</Badge>
    return <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">{t("pr_status_pending")}</Badge>
  }

  return (
    <div className="space-y-4" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-lg flex items-center gap-2">
            <ClipboardList size={18} className="text-primary" />
            {t("pr_list_title")}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">{t("pr_list_desc")}</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
          <PlusCircle size={15} />
          {t("pr_new_btn")}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : requests.length === 0 ? (
        <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
          <ClipboardList size={36} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">{t("pr_empty_state")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((req) => (
            <div key={req.id} className="p-4 rounded-xl border border-slate-200/70 bg-white space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-slate-800">{req.title}</span>
                    {statusBadge(req.status)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("pr_requested_by", { name: req.requestedByUserName })} · <span suppressHydrationWarning>{fmtDate(req.createdAt, locale)}</span>
                  </p>
                </div>
                {canDecide && req.status === "pending" && (
                  <div className="flex gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 h-8 border-success/30 text-success hover:bg-success hover:text-white hover:border-success"
                      onClick={() => handleDecide(req.id, true)}
                      disabled={decidingId === req.id}
                    >
                      {decidingId === req.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                      {t("pr_approve_btn")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 h-8 border-destructive/30 text-destructive hover:bg-destructive hover:text-white hover:border-destructive"
                      onClick={() => handleDecide(req.id, false)}
                      disabled={decidingId === req.id}
                    >
                      <XCircle size={13} />
                      {t("pr_reject_btn")}
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {req.items.map((it, i) => (
                  <span key={i} className="text-xs bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1 text-slate-600">
                    {it.name} — {it.quantity} {it.unit}
                  </span>
                ))}
              </div>
              {req.notes && <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2">{req.notes}</p>}
            </div>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={(open) => { if (!isSaving) { setShowCreate(open); if (!open) resetForm() } }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("pr_new_title")}</DialogTitle>
            <DialogDescription>{t("pr_new_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pr-title">{t("pr_title_label")} *</Label>
              <Input id="pr-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("pr_items_label")} *</Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-7 px-2 text-xs gap-1">
                  <Plus size={12} />
                  {t("pr_add_item")}
                </Button>
              </div>
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input value={it.name} onChange={(e) => updateItem(idx, "name", e.target.value)} placeholder={t("pr_item_name_placeholder")} className="h-9 text-sm flex-1" />
                    <Input type="number" min={0} value={it.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} placeholder="0" dir="ltr" className="h-9 text-sm w-20" />
                    <Input value={it.unit} onChange={(e) => updateItem(idx, "unit", e.target.value)} placeholder={t("pr_item_unit_placeholder")} className="h-9 text-sm w-24" />
                    {items.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive/50 hover:text-destructive shrink-0" onClick={() => removeItem(idx)}>
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pr-notes">{t("pr_notes_label")}</Label>
              <Textarea id="pr-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={isSaving}>{t("cancel")}</Button>
            <Button onClick={handleSubmit} disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 size={15} className="animate-spin" /> : null}
              {t("pr_new_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
