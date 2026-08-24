"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Link } from "@/i18n/routing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  ArrowDown,
  Banknote,
  Box,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  File,
  Languages,
  Loader2,
  MapPin,
  Package,
  Truck,
  Upload,
  Trash2,
  User,
  XCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { displayCity } from "@/lib/constants"
import { OFFER_STATUS, SAMPLE_STATUS } from "@/utils/guest-offer-workflow"

type GuestOfferData = {
  offer: {
    id: string
    companyName: string
    contactName: string
    price: string | number | null
    status: string
    sampleStatus: string | null
    targetPrice: number | null
    reductionNote: string | null
    decidedAt: string | null
    sampleUpdatedAt: string | null
    deliveryLocation: string
    executionDuration: string | null
    executionDurationUnit: string | null
    offerPdfUrl: string | null
    guestReplyNote: string | null
    priceHistory: Array<{ price: string; replacedAt: string; by: string }>
    createdAt: string | null
  }
  rfq: {
    title: string
    city: string | null
    deadline: string | null
    notes: string | null
    pdfUrl: string | null
    products: Array<{ name: string; quantity: number | string | null; unitOfMeasure: string | null }>
    quantity: number | string | null
    unitOfMeasure: string | null
  } | null
  contractorName: string
  delivery: { status: string; deliveryPersonName: string; deliveryDate: string | null } | null
  availability: {
    canRevisePrice: boolean
    canMarkSampleSent: boolean
    canSendDeliveryNotice: boolean
    isClosed: boolean
  }
}

const priceSchema = z.object({
  price: z.coerce.number().positive().finite(),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
})
const sampleSchema = z.object({
  note: z.string().trim().max(1000).optional().or(z.literal("")),
})
const deliverySchema = z.object({
  deliveryPersonName: z.string().trim().min(2).max(200),
  deliveryDate: z.string().trim().min(1),
  handoverRecipientName: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
})

type PriceFormValues = z.infer<typeof priceSchema>
type SampleFormValues = z.infer<typeof sampleSchema>
type DeliveryFormValues = z.infer<typeof deliverySchema>

const MAX_PDF_BYTES = 10 * 1024 * 1024

// The guest supplier's private workspace for one offer: the whole RFQ workflow
// after submission — the contractor's decision, price-reduction rounds, sample
// requests and delivery notices — without ever creating an account.
export function GuestOfferContent() {
  const params = useParams()
  const token = params.token as string
  const t = useTranslations("GuestOffer")
  const locale = useLocale()
  const isRTL = locale === "ar"
  const { toast } = useToast()

  const [data, setData] = useState<GuestOfferData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [doneAction, setDoneAction] = useState<string | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  const priceForm = useForm<PriceFormValues>({ resolver: zodResolver(priceSchema), defaultValues: { note: "" } })
  const sampleForm = useForm<SampleFormValues>({ resolver: zodResolver(sampleSchema), defaultValues: { note: "" } })
  const deliveryForm = useForm<DeliveryFormValues>({
    resolver: zodResolver(deliverySchema),
    defaultValues: { deliveryPersonName: "", deliveryDate: "", handoverRecipientName: "", notes: "" },
  })

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/guest-offer/${token}`)
      const json = await res.json()
      if (!res.ok || json.error) {
        setErrorCode(json.code || "NOT_FOUND")
        return
      }
      setData(json.data as GuestOfferData)
      setErrorCode(null)
    } catch {
      setErrorCode("NETWORK")
    } finally {
      setIsLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    load()
  }, [token, load])

  const handlePdfSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== "application/pdf") {
      toast({ title: t("error_title"), description: t("pdf_only"), variant: "destructive" })
      return
    }
    if (file.size > MAX_PDF_BYTES) {
      toast({ title: t("error_title"), description: t("pdf_too_large"), variant: "destructive" })
      return
    }
    setPdfFile(file)
  }

  const submitAction = async (action: string, fields: Record<string, string>, pdf?: File | null) => {
    const form = new FormData()
    form.set("action", action)
    Object.entries(fields).forEach(([key, value]) => {
      if (value) form.set(key, value)
    })
    if (pdf) form.set("pdf", pdf)

    const res = await fetch(`/api/guest-offer/${token}/action`, { method: "POST", body: form })
    const json = await res.json().catch(() => null)
    if (!res.ok || json?.error) {
      const code = json?.code as string | undefined
      toast({
        title: t("error_title"),
        description:
          code === "ACTION_NOT_ALLOWED"
            ? t("error_action_stale")
            : code === "LINK_EXPIRED" || code === "NOT_FOUND" || code === "INVALID_TOKEN"
              ? t("error_link_expired")
              : t("error_generic"),
        variant: "destructive",
      })
      // The offer moved on under us — resync so the page shows the real state.
      if (code === "ACTION_NOT_ALLOWED") await load()
      return false
    }
    setDoneAction(action)
    setPdfFile(null)
    if (pdfInputRef.current) pdfInputRef.current.value = ""
    await load()
    window.scrollTo({ top: 0, behavior: "smooth" })
    return true
  }

  const onRevisePrice = (values: PriceFormValues) =>
    submitAction("revise_price", { price: String(values.price), note: values.note || "" }, pdfFile)

  const onSampleSent = (values: SampleFormValues) =>
    submitAction("sample_sent", { note: values.note || "" })

  const onDeliveryNotice = (values: DeliveryFormValues) =>
    submitAction("delivery_notice", {
      deliveryPersonName: values.deliveryPersonName,
      deliveryDate: values.deliveryDate,
      handoverRecipientName: values.handoverRecipientName || "",
      notes: values.notes || "",
    })

  const offer = data?.offer
  const rfq = data?.rfq
  const availability = data?.availability

  const statusLabel = (status: string) => {
    switch (status) {
      case OFFER_STATUS.pending:
        return t("status_pending")
      case OFFER_STATUS.accepted:
        return t("status_accepted")
      case OFFER_STATUS.rejected:
        return t("status_rejected")
      case OFFER_STATUS.reductionRequested:
        return t("status_reduction")
      case OFFER_STATUS.delivered:
        return t("status_delivered")
      default:
        return status
    }
  }

  const statusTone = (status: string) => {
    switch (status) {
      case OFFER_STATUS.accepted:
        return "bg-success/10 text-success border-success/20"
      case OFFER_STATUS.rejected:
        return "bg-destructive/10 text-destructive border-destructive/20"
      case OFFER_STATUS.reductionRequested:
        return "bg-amber-100 text-amber-700 border-amber-200"
      case OFFER_STATUS.delivered:
        return "bg-blue-100 text-blue-700 border-blue-200"
      default:
        return "bg-slate-100 text-slate-700 border-slate-200"
    }
  }

  const formatMoney = (value: string | number | null | undefined) => {
    const num = Number(value)
    if (!value || Number.isNaN(num)) return "—"
    return num.toLocaleString(locale)
  }

  const fmtDate = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleDateString(locale) : t("not_specified")

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 font-body" dir={isRTL ? "rtl" : "ltr"}>
      {/* ===== Top bar ===== */}
      <header className="sticky top-0 z-40 bg-white/85 backdrop-blur-xl border-b border-slate-200/70">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 shrink-0" aria-label="Mdmak Tech">
            <span className="text-lg font-black text-primary">{isRTL ? "مدماك تيك" : "Mdmak Tech"}</span>
            <span className="hidden sm:inline text-xs font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full">
              {t("brand_tagline")}
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href={`/offer/${token}`} locale={isRTL ? "en" : "ar"}>
              <Button variant="ghost" size="sm" className="gap-1.5 text-slate-600 rounded-lg">
                <Languages size={15} />
                {isRTL ? "English" : "العربية"}
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm" className="rounded-lg bg-cta hover:bg-cta/90 text-white font-bold shadow-sm">
                {t("register_cta")}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {isLoading && (
          <div className="py-32 flex flex-col items-center justify-center gap-4 text-muted-foreground">
            <Loader2 className="animate-spin text-primary" size={40} />
            <p className="font-medium animate-pulse">{t("loading")}</p>
          </div>
        )}

        {/* ===== Invalid / expired link ===== */}
        {!isLoading && errorCode && (
          <div className="max-w-lg mx-auto py-16 text-center space-y-6">
            <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-3xl flex items-center justify-center mx-auto border border-amber-200">
              <Clock size={36} />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-slate-800">
                {errorCode === "LINK_EXPIRED" ? t("link_expired_title") : t("invalid_title")}
              </h1>
              <p className="text-slate-600 leading-relaxed">
                {errorCode === "LINK_EXPIRED" ? t("link_expired_desc") : t("invalid_desc")}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Link href="/register">
                <Button className="rounded-xl h-11 px-6 font-bold shadow-lg shadow-primary/20">
                  {t("register_cta_long")}
                </Button>
              </Link>
              <Link href="/">
                <Button variant="outline" className="rounded-xl h-11 px-6">
                  {t("go_home")}
                </Button>
              </Link>
            </div>
          </div>
        )}

        {!isLoading && !errorCode && offer && (
          <>
            {/* ===== Action confirmation ===== */}
            {doneAction && (
              <div className="flex items-start gap-3 p-4 rounded-2xl border border-success/25 bg-success/5">
                <CheckCircle2 size={20} className="text-success shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-slate-800 text-sm">
                    {doneAction === "revise_price"
                      ? t("done_price_title")
                      : doneAction === "sample_sent"
                        ? t("done_sample_title")
                        : t("done_delivery_title")}
                  </p>
                  <p className="text-sm text-slate-600 leading-relaxed mt-0.5">{t("done_desc")}</p>
                </div>
              </div>
            )}

            {/* ===== Status hero ===== */}
            <section className="bg-white rounded-2xl border border-slate-200/70 shadow-xl shadow-primary/5 overflow-hidden">
              <div className="relative px-5 py-5 border-b bg-gradient-to-bl from-primary/8 via-primary/3 to-white overflow-hidden">
                <div className="absolute -top-8 -end-8 w-32 h-32 bg-primary/5 rounded-full blur-2xl pointer-events-none" />
                <div className="relative space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={cn("font-black border", statusTone(offer.status))}>
                      {statusLabel(offer.status)}
                    </Badge>
                    {offer.sampleStatus && (
                      <Badge variant="outline" className="bg-white/70 text-slate-600 border-slate-200 gap-1.5 font-bold">
                        <Box size={11} />
                        {offer.sampleStatus === SAMPLE_STATUS.requested
                          ? t("sample_requested")
                          : offer.sampleStatus === SAMPLE_STATUS.sent
                            ? t("sample_sent")
                            : t("sample_received")}
                      </Badge>
                    )}
                    <span className="text-[10px] text-slate-400 font-mono bg-white/70 px-2 py-0.5 rounded-md border border-slate-200">
                      #{offer.id.substring(0, 8).toUpperCase()}
                    </span>
                  </div>
                  <h1 className="text-lg sm:text-xl font-black text-slate-800 leading-tight">
                    {rfq?.title || t("offer_fallback_title")}
                  </h1>
                  <p className="text-sm text-slate-600">
                    {data?.contractorName ? t("from_contractor", { name: data.contractorName }) : t("from_contractor_generic")}
                  </p>
                </div>
              </div>

              <div className="px-5 py-5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="flex flex-col gap-1.5 p-3.5 rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/5 to-transparent">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    <Banknote size={11} className="text-primary" />
                    <span>{t("your_price")}</span>
                  </div>
                  <p className="text-base font-black text-slate-800 leading-tight">
                    {formatMoney(offer.price)} <span className="text-xs font-bold">{t("sar")}</span>
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 p-3.5 rounded-2xl border border-slate-200 bg-slate-50/60">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    <MapPin size={11} className="text-primary" />
                    <span>{t("delivery_location")}</span>
                  </div>
                  <p className="text-sm font-bold text-slate-800 leading-tight">
                    {offer.deliveryLocation || t("not_specified")}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 p-3.5 rounded-2xl border border-slate-200 bg-slate-50/60">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    <CalendarClock size={11} className="text-primary" />
                    <span>{t("submitted_on")}</span>
                  </div>
                  <p className="text-sm font-bold text-slate-800 leading-tight" suppressHydrationWarning>
                    {fmtDate(offer.createdAt)}
                  </p>
                </div>
              </div>
            </section>

            {/* ===== What's needed from you ===== */}
            {availability?.canRevisePrice && (
              <section className="bg-white rounded-2xl border border-amber-200 shadow-lg shadow-amber-500/5 overflow-hidden">
                <div className="px-5 py-4 border-b border-amber-100 bg-amber-50/70 flex items-start gap-2.5">
                  <div className="h-9 w-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                    <ArrowDown size={16} className="text-amber-700" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-black text-slate-800">{t("reduction_title")}</h2>
                    <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">{t("reduction_desc")}</p>
                  </div>
                </div>

                <div className="px-5 py-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/60">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        {t("current_price")}
                      </p>
                      <p className="text-base font-black text-slate-800 mt-1">
                        {formatMoney(offer.price)} {t("sar")}
                      </p>
                    </div>
                    {offer.targetPrice != null && (
                      <div className="p-3.5 rounded-2xl border border-amber-200 bg-amber-50">
                        <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">
                          {t("target_price")}
                        </p>
                        <p className="text-base font-black text-amber-800 mt-1">
                          {formatMoney(offer.targetPrice)} {t("sar")}
                        </p>
                      </div>
                    )}
                  </div>

                  {offer.reductionNote && (
                    <div className="p-3.5 rounded-2xl border border-slate-200 bg-white">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                        {t("contractor_note")}
                      </p>
                      <p className="text-sm text-slate-700 leading-relaxed" dir="auto">{offer.reductionNote}</p>
                    </div>
                  )}

                  <form onSubmit={priceForm.handleSubmit(onRevisePrice)} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="revised-price" className="text-sm font-bold text-slate-700">
                        {t("new_price_label")} <span className="text-destructive">*</span>
                      </Label>
                      <div className="relative">
                        <Input
                          id="revised-price"
                          type="number"
                          step="0.01"
                          min="0"
                          dir="ltr"
                          className="h-11 rounded-xl border-slate-200 text-start pe-14"
                          {...priceForm.register("price")}
                        />
                        <span className="absolute inset-y-0 end-3 flex items-center text-xs font-bold text-muted-foreground">
                          {t("sar")}
                        </span>
                      </div>
                      {priceForm.formState.errors.price && (
                        <p className="text-xs text-destructive font-medium">{t("invalid_price")}</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="revised-note" className="text-sm font-bold text-slate-700">
                        {t("note_label")}{" "}
                        <span className="text-muted-foreground text-xs font-normal">({t("optional")})</span>
                      </Label>
                      <Textarea
                        id="revised-note"
                        rows={3}
                        dir="auto"
                        placeholder={t("note_placeholder")}
                        className="rounded-xl border-slate-200 resize-none"
                        {...priceForm.register("note")}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-sm font-bold text-slate-700">
                        {t("updated_quote_pdf")}{" "}
                        <span className="text-muted-foreground text-xs font-normal">({t("optional")})</span>
                      </Label>
                      {pdfFile ? (
                        <div className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50">
                          <File size={16} className="text-primary shrink-0" />
                          <span className="text-sm text-slate-700 truncate flex-1" dir="ltr">{pdfFile.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setPdfFile(null)
                              if (pdfInputRef.current) pdfInputRef.current.value = ""
                            }}
                            className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 rounded-lg"
                            aria-label={t("remove")}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => pdfInputRef.current?.click()}
                          className="w-full flex items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 text-sm text-slate-600 hover:border-primary hover:text-primary transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          <Upload size={15} />
                          {t("click_to_upload_pdf")}
                        </button>
                      )}
                      <input
                        ref={pdfInputRef}
                        type="file"
                        accept="application/pdf"
                        onChange={handlePdfSelect}
                        className="hidden"
                        aria-hidden="true"
                        tabIndex={-1}
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={priceForm.formState.isSubmitting}
                      className="w-full h-11 rounded-xl bg-amber-600 hover:bg-amber-700 font-bold gap-2"
                    >
                      {priceForm.formState.isSubmitting ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <ArrowDown size={16} />
                      )}
                      {t("submit_new_price")}
                    </Button>
                  </form>
                </div>
              </section>
            )}

            {availability?.canMarkSampleSent && (
              <section className="bg-white rounded-2xl border border-blue-200 shadow-lg shadow-blue-500/5 overflow-hidden">
                <div className="px-5 py-4 border-b border-blue-100 bg-blue-50/70 flex items-start gap-2.5">
                  <div className="h-9 w-9 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                    <Box size={16} className="text-blue-700" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-black text-slate-800">{t("sample_title")}</h2>
                    <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">{t("sample_desc")}</p>
                  </div>
                </div>
                <form onSubmit={sampleForm.handleSubmit(onSampleSent)} className="px-5 py-5 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="sample-note" className="text-sm font-bold text-slate-700">
                      {t("sample_note_label")}{" "}
                      <span className="text-muted-foreground text-xs font-normal">({t("optional")})</span>
                    </Label>
                    <Textarea
                      id="sample-note"
                      rows={3}
                      dir="auto"
                      placeholder={t("sample_note_placeholder")}
                      className="rounded-xl border-slate-200 resize-none"
                      {...sampleForm.register("note")}
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={sampleForm.formState.isSubmitting}
                    className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 font-bold gap-2"
                  >
                    {sampleForm.formState.isSubmitting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={16} />
                    )}
                    {t("confirm_sample_sent")}
                  </Button>
                </form>
              </section>
            )}

            {availability?.canSendDeliveryNotice && (
              <section className="bg-white rounded-2xl border border-success/25 shadow-lg shadow-success/5 overflow-hidden">
                <div className="px-5 py-4 border-b border-success/15 bg-success/5 flex items-start gap-2.5">
                  <div className="h-9 w-9 rounded-xl bg-success/15 flex items-center justify-center shrink-0">
                    <Truck size={16} className="text-success" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-black text-slate-800">{t("delivery_title")}</h2>
                    <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">{t("delivery_desc")}</p>
                  </div>
                </div>
                <form onSubmit={deliveryForm.handleSubmit(onDeliveryNotice)} className="px-5 py-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="delivery-person" className="text-sm font-bold text-slate-700">
                        {t("delivery_person")} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="delivery-person"
                        dir="auto"
                        placeholder={t("delivery_person_placeholder")}
                        className="h-11 rounded-xl border-slate-200"
                        {...deliveryForm.register("deliveryPersonName")}
                      />
                      {deliveryForm.formState.errors.deliveryPersonName && (
                        <p className="text-xs text-destructive font-medium">{t("field_required")}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="delivery-date" className="text-sm font-bold text-slate-700">
                        {t("delivery_date")} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="delivery-date"
                        type="date"
                        dir="ltr"
                        className="h-11 rounded-xl border-slate-200"
                        {...deliveryForm.register("deliveryDate")}
                      />
                      {deliveryForm.formState.errors.deliveryDate && (
                        <p className="text-xs text-destructive font-medium">{t("field_required")}</p>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="delivery-recipient" className="text-sm font-bold text-slate-700">
                      {t("delivery_recipient")}{" "}
                      <span className="text-muted-foreground text-xs font-normal">({t("optional")})</span>
                    </Label>
                    <Input
                      id="delivery-recipient"
                      dir="auto"
                      className="h-11 rounded-xl border-slate-200"
                      {...deliveryForm.register("handoverRecipientName")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="delivery-notes" className="text-sm font-bold text-slate-700">
                      {t("note_label")}{" "}
                      <span className="text-muted-foreground text-xs font-normal">({t("optional")})</span>
                    </Label>
                    <Textarea
                      id="delivery-notes"
                      rows={3}
                      dir="auto"
                      className="rounded-xl border-slate-200 resize-none"
                      {...deliveryForm.register("notes")}
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={deliveryForm.formState.isSubmitting}
                    className="w-full h-11 rounded-xl bg-success hover:bg-success/90 font-bold gap-2"
                  >
                    {deliveryForm.formState.isSubmitting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Truck size={16} />
                    )}
                    {t("send_delivery_notice")}
                  </Button>
                </form>
              </section>
            )}

            {/* ===== Passive states ===== */}
            {data?.delivery && (
              <div className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-white">
                <Truck size={18} className="text-primary shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-bold text-slate-800 text-sm">
                    {data.delivery.status === "confirmed" ? t("delivery_confirmed") : t("delivery_pending")}
                  </p>
                  <p className="text-sm text-slate-600 mt-0.5" suppressHydrationWarning>
                    {t("delivery_person")}: {data.delivery.deliveryPersonName} · {fmtDate(data.delivery.deliveryDate)}
                  </p>
                </div>
              </div>
            )}

            {offer.sampleStatus === SAMPLE_STATUS.sent && (
              <div className="flex items-start gap-3 p-4 rounded-2xl border border-blue-200 bg-blue-50/60">
                <Box size={18} className="text-blue-600 shrink-0 mt-0.5" />
                <p className="text-sm text-slate-700 leading-relaxed">{t("sample_awaiting_receipt")}</p>
              </div>
            )}

            {offer.status === OFFER_STATUS.pending && !availability?.canMarkSampleSent && (
              <div className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-white">
                <Clock size={18} className="text-slate-400 shrink-0 mt-0.5" />
                <p className="text-sm text-slate-600 leading-relaxed">{t("awaiting_decision")}</p>
              </div>
            )}

            {offer.status === OFFER_STATUS.rejected && (
              <div className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50">
                <XCircle size={18} className="text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-slate-700 leading-relaxed">{t("rejected_desc")}</p>
                  <Link href="/register" className="inline-block pt-2">
                    <Button size="sm" className="rounded-lg bg-cta hover:bg-cta/90 font-bold">
                      {t("register_cta_long")}
                    </Button>
                  </Link>
                </div>
              </div>
            )}

            {offer.status === OFFER_STATUS.delivered && (
              <div className="flex items-start gap-3 p-4 rounded-2xl border border-blue-200 bg-blue-50/60">
                <CheckCircle2 size={18} className="text-blue-600 shrink-0 mt-0.5" />
                <p className="text-sm text-slate-700 leading-relaxed">{t("completed_desc")}</p>
              </div>
            )}

            {/* ===== RFQ recap ===== */}
            {rfq && (
              <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
                  <Package size={16} className="text-primary" />
                  <h2 className="text-base font-black text-slate-800">{t("rfq_recap_title")}</h2>
                </div>
                <div className="px-5 py-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin size={14} className="text-primary shrink-0" />
                      <span className="text-muted-foreground">{t("city_label")}:</span>
                      <span className="font-bold text-slate-800">
                        {rfq.city ? displayCity(rfq.city, locale) : t("not_specified")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar size={14} className="text-primary shrink-0" />
                      <span className="text-muted-foreground">{t("deadline_label")}:</span>
                      <span className="font-bold text-slate-800" suppressHydrationWarning>{fmtDate(rfq.deadline)}</span>
                    </div>
                  </div>

                  {rfq.products.length > 0 && (
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                      {rfq.products.map((product, index) => (
                        <li key={index} className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white">
                          <span className="text-sm font-medium text-slate-800 min-w-0 truncate" dir="auto">
                            {product.name}
                          </span>
                          {product.quantity != null && (
                            <span className="text-xs font-bold text-muted-foreground shrink-0">
                              {product.quantity} {product.unitOfMeasure || ""}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {rfq.notes && (
                    <p className="text-sm text-slate-600 leading-relaxed" dir="auto">{rfq.notes}</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {rfq.pdfUrl && (
                      <a href={rfq.pdfUrl} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" className="rounded-lg gap-2">
                          <Download size={14} />
                          {t("rfq_pdf")}
                        </Button>
                      </a>
                    )}
                    {offer.offerPdfUrl && (
                      <a href={offer.offerPdfUrl} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" className="rounded-lg gap-2">
                          <File size={14} />
                          {t("offer_pdf")}
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* ===== Price history ===== */}
            {offer.priceHistory.length > 0 && (
              <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
                  <Banknote size={16} className="text-primary" />
                  <h2 className="text-base font-black text-slate-800">{t("price_history_title")}</h2>
                </div>
                <ul className="divide-y divide-slate-100">
                  {offer.priceHistory.map((entry, index) => (
                    <li key={index} className="flex items-center justify-between gap-3 px-5 py-3">
                      <span className="text-sm text-slate-600" suppressHydrationWarning>
                        {fmtDate(entry.replacedAt)}
                      </span>
                      <span className="text-sm font-bold text-slate-500 line-through">
                        {formatMoney(entry.price)} {t("sar")}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
              <User size={12} />
              {t("private_link_note")}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
