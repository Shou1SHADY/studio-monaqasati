"use client"

import { useRef, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Link } from "@/i18n/routing"
import { useCollection, useFirestore, useStorage, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc, updateDoc, arrayUnion, addDoc, serverTimestamp } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import { useToast } from "@/hooks/use-toast"
import {
  Loader2,
  PackageCheck,
  Calendar,
  Truck,
  Building2,
  FileText,
  ArrowRight,
  Upload,
  Paperclip,
  ExternalLink,
  PlusCircle,
} from "lucide-react"

function fmtDate(val: unknown, locale: string) {
  if (!val) return "–"
  const d =
    val && typeof val === "object" && "toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function"
      ? (val as { toDate: () => Date }).toDate()
      : new Date(val as string | number)
  if (isNaN(d.getTime())) return "–"
  return d.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

type Delivery = {
  id: string
  rfqTitle?: string
  supplierName?: string
  deliveryPersonName?: string
  handoverRecipientName?: string
  receivedByName?: string
  deliveryDate?: string
  confirmedAt?: unknown
  status?: string
  contractorOrgId?: string
  attachmentUrls?: string[]
  notes?: string
  source?: string
}

function DeliveryCard({ delivery, locale, t }: { delivery: Delivery; locale: string; t: ReturnType<typeof useTranslations<"Portal.Contractor">> }) {
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const storage = useStorage()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !firestore || !storage) return
    setUploading(true)
    try {
      const storageRef = ref(storage, `deliveries/${delivery.id}/attachments/${Date.now()}_${file.name}`)
      await uploadBytes(storageRef, file)
      const url = await getDownloadURL(storageRef)
      await updateDoc(doc(firestore, "deliveries", delivery.id), {
        attachmentUrls: arrayUnion(url),
      })
      toast({ title: t("goods_attachment_uploaded") })
    } catch (err) {
      console.error(err)
      toast({ title: t("goods_upload_error"), variant: "destructive" })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <Card className="border-success/20 bg-success/5 hover:shadow-md transition-shadow">
      <CardContent className="p-5" dir={isRtl ? "rtl" : "ltr"}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Icon */}
          <div className="h-12 w-12 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
            <PackageCheck size={22} className="text-success" />
          </div>

          {/* Details */}
          <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-0.5 flex items-center gap-1">
                <FileText size={11} />
                {delivery.source === "manual" ? t("goods_manual_description_label") : t("goods_rfq")}
              </p>
              <p className="font-bold text-slate-800 text-sm truncate">
                {delivery.source === "manual" ? (delivery.notes || "—") : (delivery.rfqTitle || "—")}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-0.5 flex items-center gap-1">
                <Building2 size={11} />
                {t("goods_supplier")}
              </p>
              <p className="font-semibold text-slate-700 text-sm truncate">{delivery.supplierName || "—"}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-0.5 flex items-center gap-1">
                <Truck size={11} />
                {t("goods_handover_by")}
              </p>
              <p className="text-slate-700 text-sm truncate">{delivery.deliveryPersonName || "—"}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-0.5 flex items-center gap-1">
                <Calendar size={11} />
                {t("goods_confirmed_at")}
              </p>
              <p className="text-slate-700 text-sm" suppressHydrationWarning>
                {fmtDate(delivery.confirmedAt, locale)}
              </p>
            </div>
          </div>

          {/* Right side */}
          <div className="flex flex-col sm:items-end gap-2 shrink-0">
            <Badge className="bg-success/10 text-success border-success/20 text-xs font-bold w-fit">
              ✓ {t("goods_received_confirmed_badge")}
            </Badge>
            {delivery.source === "manual" && (
              <Badge variant="outline" className="text-slate-500 border-slate-200 bg-white text-xs font-semibold w-fit">
                {t("goods_manual_badge")}
              </Badge>
            )}
            <Button
              asChild
              size="sm"
              variant="outline"
              className="gap-1.5 border-success/30 text-success hover:bg-success hover:text-white hover:border-success"
            >
              <Link href={`/contractor/receipts/${delivery.id}`} className="flex items-center gap-1.5">
                <FileText size={14} />
                {t("goods_view_receipt")}
                <ArrowRight size={13} className={cn(isRtl ? "rotate-180" : "")} />
              </Link>
            </Button>

            {/* Upload attachment */}
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="gap-1.5 text-slate-500 hover:text-primary h-7 px-2 text-xs"
            >
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {uploading ? t("goods_uploading") : t("goods_upload_receipt")}
            </Button>
          </div>
        </div>

        {/* Handover recipient */}
        {(delivery.handoverRecipientName || delivery.receivedByName) && (
          <div className={cn("mt-3 pt-3 border-t border-success/10 text-xs text-slate-500", isRtl ? "text-right" : "")}>
            <span className="font-bold">{t("goods_received_by")}:</span>{" "}
            {delivery.handoverRecipientName || delivery.receivedByName}
          </div>
        )}

        {/* Attachments */}
        {delivery.attachmentUrls && delivery.attachmentUrls.length > 0 && (
          <div className={cn("mt-3 pt-3 border-t border-success/10", isRtl ? "text-right" : "")}>
            <p className="text-[11px] font-bold text-slate-400 uppercase mb-1.5 flex items-center gap-1">
              <Paperclip size={11} />
              {t("goods_attachments")} ({delivery.attachmentUrls.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {delivery.attachmentUrls.map((url, idx) => (
                <a
                  key={idx}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline bg-primary/5 px-2 py-1 rounded-md"
                >
                  <FileText size={11} />
                  {t("goods_received_document_label", { num: idx + 1 })}
                  <ExternalLink size={10} />
                </a>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ManualReceiptDialog({
  open,
  onOpenChange,
  locale,
  t,
  myOrgId,
  defaultReceiverName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  locale: string
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  myOrgId?: string
  defaultReceiverName?: string
}) {
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const today = new Date().toISOString().split("T")[0]

  const [supplierName, setSupplierName] = useState("")
  const [deliveryDate, setDeliveryDate] = useState(today)
  const [deliveryPersonName, setDeliveryPersonName] = useState("")
  const [receivedByName, setReceivedByName] = useState(defaultReceiverName || "")
  const [notes, setNotes] = useState("")

  const resetForm = () => {
    setSupplierName("")
    setDeliveryDate(today)
    setDeliveryPersonName("")
    setReceivedByName(defaultReceiverName || "")
    setNotes("")
  }

  const handleSave = async () => {
    if (!firestore || !user || !myOrgId) return
    if (!supplierName.trim() || !deliveryDate || !receivedByName.trim() || !notes.trim()) {
      toast({ title: t("goods_manual_validation_error"), variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      await addDoc(collection(firestore, "deliveries"), {
        contractorOrgId: myOrgId,
        contractorId: user.uid,
        supplierName: supplierName.trim(),
        deliveryPersonName: deliveryPersonName.trim() || null,
        receivedByName: receivedByName.trim(),
        deliveryDate,
        notes: notes.trim(),
        status: "confirmed",
        confirmedByUserId: user.uid,
        confirmedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        source: "manual",
      })
      toast({ title: t("goods_manual_success") })
      resetForm()
      onOpenChange(false)
    } catch (err) {
      console.error("Failed to log manual receipt:", err)
      toast({ title: t("goods_manual_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSaving) { onOpenChange(next); if (!next) resetForm() } }}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{t("goods_manual_title")}</DialogTitle>
          <DialogDescription>{t("goods_manual_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="manual-supplier">{t("goods_manual_supplier_name")} *</Label>
            <Input
              id="manual-supplier"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder={t("goods_manual_supplier_placeholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-date">{t("goods_manual_delivery_date")} *</Label>
            <input
              id="manual-date"
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              max={today}
              dir="ltr"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-delivery-person">{t("goods_manual_delivery_person")}</Label>
            <Input
              id="manual-delivery-person"
              value={deliveryPersonName}
              onChange={(e) => setDeliveryPersonName(e.target.value)}
              placeholder={t("goods_manual_delivery_person_placeholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-receiver">{t("goods_manual_receiver_name")} *</Label>
            <Input
              id="manual-receiver"
              value={receivedByName}
              onChange={(e) => setReceivedByName(e.target.value)}
              placeholder={t("goods_manual_receiver_placeholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-notes">{t("goods_manual_description_label")} *</Label>
            <Textarea
              id="manual-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("goods_manual_description_placeholder")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("goods_manual_cancel")}
          </Button>
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <PlusCircle size={16} />}
            {t("goods_manual_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function GoodsReceivedPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false)

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const typedProfile = profile as { organizationId?: string; name?: string } | null
  const myOrgId = typedProfile?.organizationId || user?.uid

  const deliveriesQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || !myOrgId) return null
    return query(
      collection(firestore, "deliveries"),
      where("contractorOrgId", "==", myOrgId),
      where("status", "==", "confirmed")
    )
  }, [firestore, user, isUserLoading, myOrgId])

  const { data: deliveries, isLoading } = useCollection(deliveriesQuery)
  const confirmedDeliveries = ((deliveries || []) as Delivery[]).sort((a, b) => {
    const getTime = (v: unknown) =>
      v && typeof v === "object" && "toDate" in v
        ? (v as { toDate: () => Date }).toDate().getTime()
        : v ? new Date(v as string).getTime() : 0
    return getTime(b.confirmedAt) - getTime(a.confirmedAt)
  })

  const pageLoading = isUserLoading || (isLoading && !deliveries)

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("goods_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("goods_desc")}</p>
          </div>
          <Button className="gap-2" onClick={() => setIsManualDialogOpen(true)}>
            <PlusCircle size={18} />
            {t("goods_manual_add_button")}
          </Button>
        </div>

        <ManualReceiptDialog
          open={isManualDialogOpen}
          onOpenChange={setIsManualDialogOpen}
          locale={locale}
          t={t}
          myOrgId={myOrgId}
          defaultReceiverName={typedProfile?.name}
        />

        {pageLoading ? (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="animate-spin text-muted-foreground" size={40} />
          </div>
        ) : confirmedDeliveries.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-20 bg-slate-50 rounded-xl border border-dashed text-center gap-3">
            <PackageCheck size={48} className="text-muted-foreground/30" />
            <div>
              <p className="text-muted-foreground font-medium">{t("goods_empty")}</p>
              <p className="text-sm text-muted-foreground mt-1">{t("goods_empty_desc")}</p>
            </div>
            <Button className="gap-2 mt-2" onClick={() => setIsManualDialogOpen(true)}>
              <PlusCircle size={16} />
              {t("goods_manual_add_button")}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {confirmedDeliveries.map((delivery) => (
              <DeliveryCard key={delivery.id} delivery={delivery} locale={locale} t={t} />
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  )
}
