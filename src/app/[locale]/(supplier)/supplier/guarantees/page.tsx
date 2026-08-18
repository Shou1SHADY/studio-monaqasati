"use client"

import { useState, useEffect } from "react"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useCollection, useFirestore, useStorage, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc, addDoc, updateDoc, serverTimestamp } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import { useToast } from "@/hooks/use-toast"
import {
  Loader2,
  ShieldCheck,
  ShieldX,
  ShieldQuestion,
  Trash2,
  Package,
  ExternalLink,
  FileText,
} from "lucide-react"

type RfqProduct = {
  name?: string
  nameEn?: string
  boqItemNo?: string
  requiresWarranty?: boolean
}

function itemKey(item: RfqProduct, idx: number) {
  return item.boqItemNo || item.name || String(idx)
}

function GuaranteeItemRow({
  offer,
  item,
  existingDoc,
  t,
}: {
  offer: any
  item: RfqProduct
  existingDoc: any | null
  t: ReturnType<typeof useTranslations<"Portal.Supplier">>
}) {
  const firestore = useFirestore()
  const storage = useStorage()
  const { user } = useUser()
  const { toast } = useToast()

  const [isEditing, setIsEditing] = useState(!existingDoc)
  const [hasGuarantee, setHasGuarantee] = useState<boolean | null>(existingDoc ? existingDoc.hasGuarantee : null)
  const [expirationDate, setExpirationDate] = useState(existingDoc?.expirationDate || "")
  const [fileUrl, setFileUrl] = useState<string | null>(existingDoc?.fileUrl || null)
  const [filePath, setFilePath] = useState<string | null>(existingDoc?.filePath || null)
  const [fileType, setFileType] = useState<string | null>(existingDoc?.fileType || null)
  const [isUploading, setIsUploading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !storage) return
    const isPdf = file.type === "application/pdf"
    const isImage = file.type.startsWith("image/")
    if (!isPdf && !isImage) {
      toast({ title: t("error_title"), description: t("guarantee_file_type_error"), variant: "destructive" })
      return
    }
    setIsUploading(true)
    try {
      const storagePath = `guarantees/${offer.id}/${Date.now()}-${file.name}`
      const fileRef = ref(storage, storagePath)
      await uploadBytes(fileRef, file)
      const downloadUrl = await getDownloadURL(fileRef)
      setFileUrl(downloadUrl)
      setFilePath(storagePath)
      setFileType(isPdf ? "pdf" : "image")
    } catch (err) {
      console.error("Guarantee file upload failed:", err)
      toast({ title: t("error_title"), description: t("guarantee_upload_failed"), variant: "destructive" })
    } finally {
      setIsUploading(false)
    }
  }

  const handleSave = async () => {
    if (!firestore || !user) return
    if (hasGuarantee === null) {
      toast({ title: t("error_title"), description: t("guarantee_answer_required"), variant: "destructive" })
      return
    }
    if (hasGuarantee && (!fileUrl || !expirationDate)) {
      toast({ title: t("error_title"), description: t("guarantee_details_required"), variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const status = hasGuarantee ? "pending_review" : "none"
      if (existingDoc) {
        await updateDoc(doc(firestore, "guarantees", existingDoc.id), {
          hasGuarantee,
          fileUrl: hasGuarantee ? fileUrl : null,
          filePath: hasGuarantee ? filePath : null,
          fileType: hasGuarantee ? fileType : null,
          expirationDate: hasGuarantee ? expirationDate : null,
          status,
        })
      } else {
        await addDoc(collection(firestore, "guarantees"), {
          rfqId: offer.rfqId || null,
          rfqTitle: offer.rfqTitle || "",
          projectId: offer.projectId || null,
          offerId: offer.id,
          contractorOrgId: offer.contractorOrgId || offer.contractorId,
          contractorId: offer.contractorId || null,
          supplierOrgId: offer.organizationId || user.uid,
          supplierId: user.uid,
          supplierName: offer.supplierName || offer.companyName || "",
          itemName: item.name || null,
          itemNameEn: item.nameEn || null,
          boqItemNo: item.boqItemNo || null,
          hasGuarantee,
          fileUrl: hasGuarantee ? fileUrl : null,
          filePath: hasGuarantee ? filePath : null,
          fileType: hasGuarantee ? fileType : null,
          expirationDate: hasGuarantee ? expirationDate : null,
          status,
          createdAt: serverTimestamp(),
        })
      }

      if (hasGuarantee && offer.contractorId) {
        await addDoc(collection(firestore, "users", offer.contractorId, "notifications"), {
          userId: offer.contractorId,
          organizationId: offer.contractorOrgId || offer.contractorId,
          type: "guarantee_submitted",
          title: "🛡 ضمان جديد بانتظار المراجعة",
          message: `قام المورد بإرفاق مستند ضمان لبند: ${item.name || item.nameEn || ""}`,
          offerId: offer.id,
          rfqId: offer.rfqId || null,
          createdAt: new Date().toISOString(),
          read: false,
        }).catch(() => {})
      }

      toast({ title: t("guarantee_save_success") })
      setIsEditing(false)
    } catch (err) {
      console.error("Failed to save guarantee:", err)
      toast({ title: t("error_title"), description: t("guarantee_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const statusBadge = () => {
    if (!existingDoc || existingDoc.status === "none") return null
    if (existingDoc.status === "accepted") {
      return (
        <Badge className="bg-success/10 text-success border-success/20 text-xs font-bold gap-1">
          <ShieldCheck size={12} />
          {t("guarantee_status_accepted")}
        </Badge>
      )
    }
    if (existingDoc.status === "rejected") {
      return (
        <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-xs font-bold gap-1">
          <ShieldX size={12} />
          {t("guarantee_status_rejected")}
        </Badge>
      )
    }
    return (
      <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs font-bold gap-1">
        <ShieldQuestion size={12} />
        {t("guarantee_status_pending")}
      </Badge>
    )
  }

  const canEdit = !existingDoc || existingDoc.status !== "accepted"

  if (!isEditing) {
    return (
      <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/40 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{item.name || item.nameEn}</p>
          <div className="flex items-center gap-2 mt-1">
            {statusBadge()}
            {existingDoc?.expirationDate && (
              <span className="text-xs text-muted-foreground">
                {t("guarantee_expiration_label")}: {existingDoc.expirationDate}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {existingDoc?.fileUrl && (
            <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
              <a href={existingDoc.fileUrl} target="_blank" rel="noopener noreferrer">
                <FileText size={13} />
                {t("guarantee_view_file")}
                <ExternalLink size={11} />
              </a>
            </Button>
          )}
          {canEdit && (
            <Button size="sm" variant="outline" className="h-8" onClick={() => setIsEditing(true)}>
              {existingDoc ? t("guarantee_edit_btn") : t("guarantee_submit_btn")}
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/40 space-y-2.5">
      <p className="text-sm font-semibold text-slate-800">{item.name || item.nameEn}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={hasGuarantee === true ? "default" : "outline"}
          className={cn("h-8 px-4", hasGuarantee === true && "bg-success hover:bg-success/90")}
          onClick={() => setHasGuarantee(true)}
          disabled={isSaving}
        >
          {t("guarantee_yes")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={hasGuarantee === false ? "default" : "outline"}
          className="h-8 px-4"
          onClick={() => { setHasGuarantee(false); setFileUrl(null); setFilePath(null); setFileType(null); setExpirationDate("") }}
          disabled={isSaving}
        >
          {t("guarantee_no")}
        </Button>
      </div>

      {hasGuarantee === true && (
        <div className="space-y-2 pt-1">
          <div className="space-y-1">
            <Label className="text-xs">{t("guarantee_expiration_label")} <span className="text-destructive">*</span></Label>
            <input
              type="date"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              dir="ltr"
              disabled={isSaving}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("guarantee_file_label")} <span className="text-destructive">*</span></Label>
            {fileUrl ? (
              <div className="flex items-center gap-2 p-2 bg-white border border-amber-200 rounded-lg text-xs">
                <ShieldCheck size={14} className="text-amber-600 shrink-0" />
                <span className="flex-1 font-medium text-amber-800">{t("guarantee_file_attached")}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-destructive"
                  onClick={() => { setFileUrl(null); setFilePath(null); setFileType(null) }}
                  disabled={isSaving}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="file"
                  accept=".pdf,image/*"
                  onChange={handleFileUpload}
                  disabled={isUploading || isSaving}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex items-center justify-center gap-2 h-16 rounded-lg border-2 border-dashed border-amber-300 bg-white text-amber-700 text-xs font-semibold">
                  {isUploading ? <Loader2 size={16} className="animate-spin" /> : t("guarantee_upload_prompt")}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={handleSave} disabled={isSaving} className="h-8 gap-1.5">
          {isSaving ? <Loader2 size={13} className="animate-spin" /> : null}
          {t("guarantee_save_btn")}
        </Button>
        {existingDoc && (
          <Button size="sm" variant="outline" className="h-8" onClick={() => setIsEditing(false)} disabled={isSaving}>
            {t("cancel")}
          </Button>
        )}
      </div>
    </div>
  )
}

function OfferGuaranteeSection({
  offer,
  t,
  onVisibilityChange,
}: {
  offer: any
  t: ReturnType<typeof useTranslations<"Portal.Supplier">>
  onVisibilityChange: (offerId: string, visible: boolean) => void
}) {
  const firestore = useFirestore()

  const rfqDocRef = useMemoFirebase(() => {
    if (!firestore || !offer.rfqId) return null
    return doc(firestore, "rfqs", offer.rfqId)
  }, [firestore, offer.rfqId])
  const { data: rfq, isLoading: isRfqLoading } = useDoc(rfqDocRef)

  const guaranteesQuery = useMemoFirebase(() => {
    if (!firestore) return null
    return query(collection(firestore, "guarantees"), where("offerId", "==", offer.id))
  }, [firestore, offer.id])
  const { data: guarantees } = useCollection(guaranteesQuery)

  const items = (((rfq as any)?.products || []) as RfqProduct[]).filter((p) => p.requiresWarranty)

  useEffect(() => {
    if (isRfqLoading) return
    onVisibilityChange(offer.id, items.length > 0)
  }, [offer.id, items.length, isRfqLoading])

  if (items.length === 0) return null

  const guaranteeByKey: Record<string, any> = {}
  ;(guarantees || []).forEach((g: any) => {
    const key = g.boqItemNo || g.itemName || ""
    guaranteeByKey[key] = g
  })

  return (
    <Card className="border-slate-200">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-primary" />
          <p className="font-bold text-slate-800 text-sm">{offer.rfqTitle}</p>
        </div>
        <div className="space-y-2">
          {items.map((item, idx) => {
            const key = itemKey(item, idx)
            return (
              <GuaranteeItemRow key={key} offer={offer} item={item} existingDoc={guaranteeByKey[key] || null} t={t} />
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

export default function SupplierGuaranteesPage() {
  const t = useTranslations("Portal.Supplier")
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    if ((profile as any)?.organizationId) {
      return query(collection(firestore, "offers"), where("organizationId", "==", (profile as any).organizationId))
    }
    return query(collection(firestore, "offers"), where("supplierId", "==", user.uid))
  }, [firestore, user, isUserLoading, profile])
  const { data: offers, isLoading } = useCollection(offersQuery)

  const acceptedOffers = ((offers || []) as any[]).filter(
    (o) => o.status === "مقبول" || o.status === "تم التسليم"
  )

  const [visibleOffers, setVisibleOffers] = useState<Record<string, boolean>>({})
  const handleVisibilityChange = (offerId: string, visible: boolean) => {
    setVisibleOffers((prev) => (prev[offerId] === visible ? prev : { ...prev, [offerId]: visible }))
  }
  const hasAnyVisible = Object.values(visibleOffers).some(Boolean)

  const pageLoading = isUserLoading || (isLoading && !offers)

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-black text-foreground font-headline">{t("guarantees_page_title")}</h1>
          <p className="text-muted-foreground mt-1">{t("guarantees_page_desc")}</p>
        </div>

        {pageLoading ? (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="animate-spin text-muted-foreground" size={40} />
          </div>
        ) : (
          <>
            {(acceptedOffers.length === 0 || !hasAnyVisible) && (
              <div className="flex flex-col items-center justify-center p-20 bg-slate-50 rounded-xl border border-dashed text-center gap-3">
                <ShieldCheck size={48} className="text-muted-foreground/30" />
                <div>
                  <p className="text-muted-foreground font-medium">{t("guarantees_page_empty")}</p>
                  <p className="text-sm text-muted-foreground mt-1">{t("guarantees_page_empty_desc")}</p>
                </div>
              </div>
            )}
            <div className={cn("grid grid-cols-1 gap-4 max-w-3xl", (acceptedOffers.length === 0 || !hasAnyVisible) && "hidden")}>
              {acceptedOffers.map((offer) => (
                <OfferGuaranteeSection key={offer.id} offer={offer} t={t} onVisibilityChange={handleVisibilityChange} />
              ))}
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  )
}
