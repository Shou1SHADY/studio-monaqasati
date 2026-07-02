"use client"

import { useParams } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { useRouter } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { doc } from "firebase/firestore"
import { Loader2, Printer, FileX, ArrowRight, Truck } from "lucide-react"

function fmtDate(val: unknown, locale: string) {
  if (!val) return "–"
  const d =
    val && typeof val === "object" && "toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function"
      ? (val as { toDate: () => Date }).toDate()
      : new Date(val as string | number)
  if (isNaN(d.getTime())) return "–"
  return d.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

type Delivery = {
  id: string
  rfqId?: string
  rfqTitle?: string
  supplierName?: string
  deliveryPersonName?: string
  handoverRecipientName?: string
  deliveryDate?: string
  receivedByName?: string
  confirmedAt?: unknown
  notes?: string
  items?: { name?: string; quantity?: number; unitOfMeasure?: string; unit?: string }[]
  status?: string
}

export default function DeliveryReceiptPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const router = useRouter()
  const params = useParams()
  const deliveryId = params.id as string
  const firestore = useFirestore()

  const deliveryDocRef = useMemoFirebase(() => {
    if (!firestore || !deliveryId) return null
    return doc(firestore, "deliveries", deliveryId)
  }, [firestore, deliveryId])
  const { data: delivery, isLoading } = useDoc(deliveryDocRef)
  const d = delivery as Delivery | null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin text-muted-foreground" size={40} />
      </div>
    )
  }

  if (!d) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-6">
        <FileX size={48} className="text-muted-foreground/30" />
        <p className="text-muted-foreground font-medium">{t("receipt_not_found")}</p>
        <Button variant="outline" onClick={() => router.back()} className="gap-2">
          <ArrowRight size={14} className={isRtl ? "" : "rotate-180"} />
          {t("receipt_back")}
        </Button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100 py-10 print:bg-white print:py-0" dir={isRtl ? "rtl" : "ltr"}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .receipt-card { box-shadow: none !important; border: none !important; }
        }
      `}</style>

      <div className="max-w-2xl mx-auto px-4">
        {/* Toolbar */}
        <div className="no-print flex items-center justify-between mb-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
            <ArrowRight size={14} className={isRtl ? "" : "rotate-180"} />
            {t("receipt_back")}
          </Button>
          <Button onClick={() => window.print()} className="gap-2">
            <Printer size={16} />
            {t("receipt_print")}
          </Button>
        </div>

        {/* Receipt card */}
        <div className="receipt-card bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
          {/* Header */}
          <div className="bg-primary text-white p-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-white/15 flex items-center justify-center">
                <Truck size={24} />
              </div>
              <div>
                <h1 className="text-xl font-black">{t("receipt_title")}</h1>
                <p className="text-white/70 text-sm font-mono mt-0.5">
                  {t("receipt_number")}: DEL-{d.id.substring(0, 8).toUpperCase()}
                </p>
              </div>
            </div>
            {d.status === "confirmed" && (
              <span className="bg-white/15 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                ✓ {locale === "ar" ? "مؤكد" : "Confirmed"}
              </span>
            )}
          </div>

          {/* Body */}
          <div className="p-8 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">{t("receipt_from")}</p>
                <p className="font-bold text-slate-800">{d.supplierName || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">{t("receipt_rfq")}</p>
                <p className="font-bold text-slate-800">{d.rfqTitle || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">{t("receipt_driver")}</p>
                <p className="font-bold text-slate-800">{d.deliveryPersonName || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">{t("receipt_delivery_date")}</p>
                <p className="font-bold text-slate-800" suppressHydrationWarning>{fmtDate(d.deliveryDate, locale)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">{t("receipt_received_by")}</p>
                <p className="font-bold text-slate-800">{d.receivedByName || d.handoverRecipientName || "—"}</p>
              </div>
              {d.handoverRecipientName && (
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase mb-1">{t("receipt_handover_recipient")}</p>
                  <p className="font-bold text-slate-800">{d.handoverRecipientName}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">{t("receipt_confirmed_date")}</p>
                <p className="font-bold text-slate-800" suppressHydrationWarning>{fmtDate(d.confirmedAt, locale)}</p>
              </div>
            </div>

            {/* Items */}
            {d.items && d.items.length > 0 && (
              <div className="pt-4 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-400 uppercase mb-3">{t("receipt_items")}</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className={cn("py-2 font-bold text-slate-600", isRtl ? "text-right" : "text-left")}>{t("receipt_item_name")}</th>
                      <th className="py-2 font-bold text-slate-600 text-center w-24">{t("receipt_item_qty")}</th>
                      <th className="py-2 font-bold text-slate-600 text-center w-24">{t("receipt_item_unit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((item, idx) => (
                      <tr key={idx} className="border-b border-slate-50">
                        <td className="py-2 text-slate-700">{item.name || "—"}</td>
                        <td className="py-2 text-slate-700 text-center" dir="ltr">{item.quantity ?? "—"}</td>
                        <td className="py-2 text-slate-700 text-center">{item.unitOfMeasure || item.unit || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Notes */}
            {d.notes && (
              <div className="pt-4 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-400 uppercase mb-2">{t("receipt_notes")}</p>
                <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-lg">{d.notes}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bg-slate-50 px-8 py-4 text-center border-t border-slate-100">
            <p className="text-[11px] text-slate-400">
              {t("receipt_footer")} • {new Date().toLocaleString(locale === "ar" ? "ar-SA" : "en-US")}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
