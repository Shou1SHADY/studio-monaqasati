"use client"

import { useState, useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { useFirestore, useUser, useStorage } from "@/firebase"
import { doc, getDoc } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Loader2, TrendingUp, Percent, Calculator, CheckCircle2, Paperclip, X } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
  calcCommission,
  createMdmakOffer,
  getCommissionRate,
  PLATFORM_SETTINGS_DOC,
} from "@/lib/mdmak-procurement"

interface Props {
  open: boolean
  onClose: () => void
  rfq: { id: string; title?: string; contractorId?: string; organizationId?: string } | null
  onSuccess?: () => void
}

export function CreateMdmakOfferDialog({ open, onClose, rfq, onSuccess }: Props) {
  const t = useTranslations("Portal.Admin.Procurement")
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()

  const [internalCost, setInternalCost] = useState("")
  const [commissionRate, setCommissionRate] = useState(10)
  const [notes, setNotes] = useState("")
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingRate, setLoadingRate] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const storage = useStorage()

  const cost = parseFloat(internalCost.replace(/,/g, "")) || 0
  const { commissionAmount, finalPrice } = calcCommission(cost, commissionRate)

  useEffect(() => {
    if (!open || !firestore) return
    setLoadingRate(true)
    getCommissionRate(firestore)
      .then(r => setCommissionRate(r))
      .finally(() => setLoadingRate(false))
  }, [open, firestore])

  const handleSend = async () => {
    if (!rfq || !firestore || !user || cost <= 0) return
    setLoading(true)
    try {
      let contractorId = rfq.contractorId ?? ""
      let contractorOrgId = rfq.organizationId ?? ""

      if (!contractorId || !contractorOrgId) {
        const rfqSnap = await getDoc(doc(firestore, "rfqs", rfq.id))
        if (rfqSnap.exists()) {
          const data = rfqSnap.data()
          contractorId = data.contractorId ?? ""
          contractorOrgId = data.organizationId ?? contractorId
        }
      }

      let pdfUrl: string | undefined
      if (pdfFile && storage) {
        const storageRef = ref(storage, `mdmak-offers/${rfq.id}/${Date.now()}_${pdfFile.name}`)
        const snap = await uploadBytes(storageRef, pdfFile)
        pdfUrl = await getDownloadURL(snap.ref)
      }

      await createMdmakOffer(firestore, user.uid, {
        rfqId: rfq.id,
        rfqTitle: rfq.title ?? rfq.id,
        contractorId,
        contractorOrgId,
        internalCost: cost,
        commissionRate,
        adminNotes: notes,
        pdfUrl,
      })

      toast({ title: t("offer_sent_toast"), description: t("offer_sent_desc") })
      setInternalCost("")
      setNotes("")
      setPdfFile(null)
      onSuccess?.()
      onClose()
    } catch {
      toast({ title: t("offer_error"), variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const fmtSAR = (n: number) =>
    n > 0 ? n.toLocaleString("ar-SA", { maximumFractionDigits: 2 }) : "—"

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-accent/10 flex items-center justify-center">
              <TrendingUp size={18} className="text-accent" />
            </div>
            {t("dialog_title")}
          </DialogTitle>
          <DialogDescription>{t("dialog_desc")}</DialogDescription>
        </DialogHeader>

        {rfq && (
          <div className="px-1 py-2 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("rfq_ref")}:</span>
            <span className="font-bold text-foreground truncate">{rfq.title ?? rfq.id}</span>
          </div>
        )}

        <div className="space-y-5 pt-1">
          {/* Internal cost */}
          <div className="space-y-1.5">
            <Label className="font-semibold">{t("internal_cost_label")}</Label>
            <div className="relative">
              <Input
                type="number"
                min={0}
                value={internalCost}
                onChange={e => setInternalCost(e.target.value)}
                placeholder={t("internal_cost_placeholder")}
                className="h-12 text-base rounded-xl border-border pr-14"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                {t("sar")}
              </span>
            </div>
          </div>

          {/* Commission rate */}
          <div className="space-y-1.5">
            <Label className="font-semibold flex items-center gap-1.5">
              <Percent size={14} className="text-accent" />
              {t("commission_rate_label")}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                value={commissionRate}
                onChange={e => setCommissionRate(parseFloat(e.target.value) || 0)}
                className="h-10 rounded-xl w-28 text-center font-bold"
                disabled={loadingRate}
              />
              <div className="flex gap-1.5">
                {[5, 10, 15, 20].map(r => (
                  <button
                    key={r}
                    onClick={() => setCommissionRate(r)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                      commissionRate === r
                        ? "bg-accent text-white shadow-sm"
                        : "bg-muted text-muted-foreground hover:bg-accent/10 hover:text-accent"
                    )}
                  >
                    {r}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Calculated breakdown */}
          <div className={cn(
            "rounded-xl border-2 p-4 space-y-3 transition-all",
            cost > 0 ? "border-accent/30 bg-accent/5" : "border-border bg-muted/30"
          )}>
            <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wide">
              <Calculator size={13} />
              {t("commission_amount_label")}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-2 bg-background rounded-lg border border-border">
                <p className="text-[10px] text-muted-foreground mb-1">{t("internal_cost_label").split(" (")[0]}</p>
                <p className="font-black text-sm text-foreground">{fmtSAR(cost)}</p>
              </div>
              <div className="text-center p-2 bg-background rounded-lg border border-amber-200">
                <p className="text-[10px] text-muted-foreground mb-1">{t("commission_amount_label")}</p>
                <p className="font-black text-sm text-amber-600">{fmtSAR(commissionAmount)}</p>
              </div>
              <div className="text-center p-2 bg-accent/10 rounded-lg border border-accent/30">
                <p className="text-[10px] text-muted-foreground mb-1">{t("final_price_label")}</p>
                <p className="font-black text-base text-accent">{fmtSAR(finalPrice)}</p>
              </div>
            </div>
            {cost > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-accent font-semibold">
                <CheckCircle2 size={13} />
                {t("contractor_sees_msg", { price: fmtSAR(finalPrice) })}
              </div>
            )}
          </div>

          {/* PDF attachment */}
          <div className="space-y-1.5">
            <Label className="font-semibold text-muted-foreground">{t("pdf_label")}</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={e => setPdfFile(e.target.files?.[0] ?? null)}
            />
            {pdfFile ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-accent/30 bg-accent/5 text-sm">
                <Paperclip size={14} className="text-accent shrink-0" />
                <span className="flex-1 truncate text-foreground font-medium">{pdfFile.name}</span>
                <button
                  type="button"
                  onClick={() => { setPdfFile(null); if (fileInputRef.current) fileInputRef.current.value = "" }}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl gap-2 w-full border-dashed"
              >
                <Paperclip size={14} />
                {t("pdf_btn")}
              </Button>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="font-semibold text-muted-foreground">{t("notes_label")}</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t("notes_placeholder")}
              className="rounded-xl resize-none border-border text-sm"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={loading} className="rounded-xl">
            {t("cancel")}
          </Button>
          <Button
            onClick={handleSend}
            disabled={loading || cost <= 0}
            className="rounded-xl gap-2 bg-accent hover:bg-accent/90 text-primary font-bold shadow-lg shadow-accent/25 px-6"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <TrendingUp size={15} />}
            {loading ? t("sending") : t("send_offer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
