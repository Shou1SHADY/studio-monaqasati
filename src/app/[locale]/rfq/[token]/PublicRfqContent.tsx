"use client"

import { useState, useEffect, useRef } from "react"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  MapPin,
  Calendar,
  CalendarClock,
  Banknote,
  Package,
  File,
  Download,
  Upload,
  Loader2,
  Trash2,
  Tag,
  ShieldCheck,
  Globe,
  CheckCircle2,
  MessageCircle,
  Building2,
  User,
  Mail,
  Phone,
  LinkIcon,
  Clock,
  AlertCircle,
  Languages,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { displayCategory, displayCity, displaySubcategory } from "@/lib/constants"

type SharedRfq = {
  id: string
  title: string
  category: string | null
  subCategory: string | null
  city: string | null
  district: string | null
  deadline: string | null
  products: Array<{
    name: string
    description: string | null
    subCategory: string | null
    quantity: number | string | null
    unitOfMeasure: string | null
  }>
  quantity: number | string | null
  unitOfMeasure: string | null
  notes: string | null
  pdfUrl: string | null
  paymentTerms: string | null
  requiresWarranty: boolean
  locationCoords: { lat: number; lng: number } | null
  status: string
}

type LookupData = {
  rfq: SharedRfq
  contractorName: string
  linkExpiresAt: string
  deadlinePassed: boolean
  canSubmit: boolean
}

const offerSchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  contactName: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(7).max(20).regex(/^[+\d][\d\s-]+$/),
  price: z.coerce.number().positive().finite(),
  deliveryLocation: z.string().trim().max(300).optional().or(z.literal("")),
  deliveryDate: z.string().optional().or(z.literal("")),
  executionDuration: z.string().trim().max(10).optional().or(z.literal("")),
  website: z.string().trim().max(300).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
})

type OfferFormValues = z.infer<typeof offerSchema>

const MAX_PDF_BYTES = 10 * 1024 * 1024

export function PublicRfqContent() {
  const params = useParams()
  const token = params.token as string
  const t = useTranslations("PublicRfq")
  const locale = useLocale()
  const isRTL = locale === "ar"
  const { toast } = useToast()

  const [lookup, setLookup] = useState<LookupData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [isSubmitted, setIsSubmitted] = useState(false)
  // Private follow-up link handed back on submit — the supplier's page for the
  // rest of the workflow (revised prices, samples, delivery notices).
  const [offerUrl, setOfferUrl] = useState<string | null>(null)
  const [offerUrlCopied, setOfferUrlCopied] = useState(false)
  const [executionDurationUnit, setExecutionDurationUnit] = useState("أيام")
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OfferFormValues>({
    resolver: zodResolver(offerSchema),
    defaultValues: { deliveryLocation: "", deliveryDate: "", executionDuration: "", website: "", message: "" },
  })

  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/rfq-share/${token}`)
        const json = await res.json()
        if (cancelled) return
        if (!res.ok || json.error) {
          setErrorCode(json.code || "NOT_FOUND")
        } else {
          setLookup(json.data as LookupData)
        }
      } catch {
        if (!cancelled) setErrorCode("NETWORK")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const getRemainingTime = (dateString: string) => {
    const deadline = new Date(dateString)
    deadline.setHours(23, 59, 59, 999)
    const diff = deadline.getTime() - Date.now()
    if (diff < 0) return t("expired")
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    if (days === 0) return t("expires_today")
    if (days === 1) return t("expires_tomorrow")
    if (days === 2) return t("expires_in_two_days")
    return t("remaining_days", { count: days })
  }

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

  const removePdf = () => {
    setPdfFile(null)
    if (pdfInputRef.current) pdfInputRef.current.value = ""
  }

  const onSubmit = async (values: OfferFormValues) => {
    try {
      const form = new FormData()
      form.set("companyName", values.companyName)
      form.set("contactName", values.contactName)
      form.set("email", values.email)
      form.set("phone", values.phone)
      form.set("price", String(values.price))
      if (values.deliveryLocation) form.set("deliveryLocation", values.deliveryLocation)
      if (values.deliveryDate) form.set("deliveryDate", values.deliveryDate)
      if (values.executionDuration) {
        form.set("executionDuration", values.executionDuration)
        form.set("executionDurationUnit", executionDurationUnit)
      }
      if (values.website) form.set("website", values.website)
      if (values.message) form.set("message", values.message)
      if (pdfFile) form.set("pdf", pdfFile)

      const res = await fetch(`/api/rfq-share/${token}/offer`, { method: "POST", body: form })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.error) {
        const code = json?.code as string | undefined
        const description =
          code === "DUPLICATE_OFFER"
            ? t("error_duplicate")
            : code === "DEADLINE_PASSED" || code === "RFQ_CLOSED"
              ? t("error_closed")
              : code === "LINK_EXPIRED" || code === "NOT_FOUND" || code === "INVALID_TOKEN"
                ? t("error_link_expired")
                : t("error_generic")
        toast({ title: t("error_title"), description, variant: "destructive" })
        return
      }
      setOfferUrl((json?.data?.offerUrl as string) || null)
      setIsSubmitted(true)
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch {
      toast({ title: t("error_title"), description: t("error_generic"), variant: "destructive" })
    }
  }

  const rfq = lookup?.rfq

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 font-body" dir={isRTL ? "rtl" : "ltr"}>
      {/* ===== Top bar ===== */}
      <header className="sticky top-0 z-40 bg-white/85 backdrop-blur-xl border-b border-slate-200/70">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 shrink-0" aria-label="Mdmak Tech">
            <span className="text-lg font-black text-primary">{isRTL ? "مدماك تيك" : "Mdmak Tech"}</span>
            <span className="hidden sm:inline text-xs font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full">
              {t("brand_tagline")}
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href={`/rfq/${token}`} locale={isRTL ? "en" : "ar"}>
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

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* ===== Loading ===== */}
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

        {/* ===== Success ===== */}
        {!isLoading && !errorCode && isSubmitted && (
          <div className="max-w-lg mx-auto py-16 text-center space-y-6">
            <div className="w-20 h-20 bg-success/10 text-success rounded-3xl flex items-center justify-center mx-auto border border-success/20">
              <CheckCircle2 size={36} />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-slate-800">{t("success_title")}</h1>
              <p className="text-slate-600 leading-relaxed">{t("success_desc")}</p>
            </div>
            {offerUrl && (
              <div className="p-5 bg-white rounded-2xl border border-accent/25 text-start space-y-3 shadow-sm">
                <div className="space-y-1">
                  <p className="font-bold text-slate-800 text-sm">{t("success_track_title")}</p>
                  <p className="text-sm text-slate-600 leading-relaxed">{t("success_track_desc")}</p>
                </div>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={offerUrl}
                    dir="ltr"
                    onFocus={(e) => e.target.select()}
                    className="h-11 rounded-xl bg-slate-50 border-slate-200 text-xs font-mono text-slate-600 text-left"
                    aria-label={t("success_track_title")}
                  />
                  <Button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(offerUrl)
                        setOfferUrlCopied(true)
                        setTimeout(() => setOfferUrlCopied(false), 2500)
                      } catch {
                        toast({ title: t("error_title"), variant: "destructive" })
                      }
                    }}
                    className={cn("h-11 px-4 rounded-xl shrink-0 font-bold", offerUrlCopied && "bg-success hover:bg-success/90")}
                  >
                    {offerUrlCopied ? t("success_track_copied") : t("success_track_copy")}
                  </Button>
                </div>
                <a href={offerUrl} className="inline-block">
                  <Button variant="outline" size="sm" className="rounded-lg font-bold">
                    {t("success_track_open")}
                  </Button>
                </a>
              </div>
            )}
            <div className="p-5 bg-gradient-to-br from-primary/5 to-accent/5 rounded-2xl border border-primary/10 text-start space-y-2">
              <p className="font-bold text-slate-800 text-sm">{t("success_register_title")}</p>
              <p className="text-sm text-slate-600 leading-relaxed">{t("success_register_desc")}</p>
              <Link href="/register" className="inline-block pt-1">
                <Button size="sm" className="rounded-lg bg-cta hover:bg-cta/90 font-bold">
                  {t("register_cta_long")}
                </Button>
              </Link>
            </div>
          </div>
        )}

        {/* ===== RFQ + offer form ===== */}
        {!isLoading && !errorCode && !isSubmitted && rfq && lookup && (
          <>
            {/* Link validity banner */}
            <div className="flex flex-wrap items-center gap-2 p-3.5 rounded-2xl border border-accent/25 bg-accent/5">
              <div className="h-8 w-8 rounded-xl bg-accent/15 flex items-center justify-center shrink-0">
                <LinkIcon size={15} className="text-accent" />
              </div>
              <p className="text-sm font-bold text-slate-700 flex-1 min-w-[200px]">
                {lookup.contractorName
                  ? t("invited_by", { name: lookup.contractorName })
                  : t("invited_generic")}
              </p>
              <Badge className="bg-white text-slate-600 border-slate-200 gap-1.5 font-bold" suppressHydrationWarning>
                <Clock size={11} className="text-accent" />
                {t("link_valid_until", { date: new Date(lookup.linkExpiresAt).toLocaleDateString(locale) })}
              </Badge>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
              {/* ============ RFQ DETAILS ============ */}
              <section className="lg:col-span-3 bg-white rounded-2xl border border-slate-200/70 shadow-xl shadow-primary/5 overflow-hidden">
                {/* Hero header — mirrors the supplier portal details dialog */}
                <div className="relative px-5 pt-5 pb-5 border-b bg-gradient-to-bl from-primary/8 via-primary/3 to-white overflow-hidden">
                  <div className="absolute -top-8 -end-8 w-32 h-32 bg-primary/5 rounded-full blur-2xl pointer-events-none" />
                  <div className="relative flex items-start gap-2.5">
                    <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Tag size={16} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        {lookup.canSubmit ? (
                          <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 text-[10px] font-black px-2 py-0.5 rounded-full border border-emerald-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            {t("rfq_status_open")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 text-[10px] font-black px-2 py-0.5 rounded-full border border-slate-200">
                            {t("rfq_status_closed")}
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 font-mono bg-white/70 px-2 py-0.5 rounded-md border border-slate-200">
                          #{rfq.id.substring(0, 8).toUpperCase()}
                        </span>
                        {rfq.requiresWarranty && (
                          <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-full border border-amber-200">
                            <ShieldCheck size={10} />
                            {t("warranty_badge")}
                          </span>
                        )}
                      </div>
                      <h1 className="text-lg sm:text-xl font-black text-slate-800 leading-tight">{rfq.title}</h1>
                      <div className="flex flex-wrap items-center gap-2 mt-2.5">
                        {rfq.category && (
                          <Badge variant="secondary" className="bg-primary/10 text-primary border-none font-bold text-xs">
                            {displayCategory(rfq.category, locale)}
                          </Badge>
                        )}
                        {rfq.subCategory && (
                          <Badge variant="outline" className="text-slate-600 border-slate-200 bg-white/70 font-medium text-xs">
                            {displaySubcategory(rfq.subCategory, locale)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-5 py-5 space-y-4">
                  {/* Stats: location + deadline */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1.5 p-3.5 rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/5 to-transparent">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        <MapPin size={11} className="text-primary" />
                        <span>{t("city_label")}</span>
                      </div>
                      <p className="text-sm font-bold text-slate-800 leading-tight">
                        {rfq.city && rfq.district
                          ? `${displayCity(rfq.city, locale)} - ${displayCity(rfq.district, locale)}`
                          : rfq.city
                            ? displayCity(rfq.city, locale)
                            : t("not_specified")}
                      </p>
                      {rfq.locationCoords && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${rfq.locationCoords.lat},${rfq.locationCoords.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-primary underline hover:text-primary/70 transition-colors font-medium w-fit mt-0.5"
                        >
                          {t("view_on_map")}
                        </a>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 p-3.5 rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50/60 to-transparent">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700 uppercase tracking-wider">
                        <Calendar size={11} className="text-amber-600" />
                        <span>{t("deadline_label")}</span>
                      </div>
                      <p className="text-sm font-bold text-slate-800 leading-tight" suppressHydrationWarning>
                        {rfq.deadline ? new Date(rfq.deadline).toLocaleDateString(locale) : t("not_specified")}
                      </p>
                      {rfq.deadline && (
                        <span className="text-[11px] text-amber-700 font-bold mt-0.5" suppressHydrationWarning>
                          {getRemainingTime(rfq.deadline)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Products */}
                  {rfq.products.length > 0 ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <h2 className="font-bold text-slate-700 flex items-center gap-2 text-sm">
                          <Package size={15} className="text-primary" />
                          {t("products_title")}
                        </h2>
                        <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20 font-bold">
                          {rfq.products.length}
                        </Badge>
                      </div>
                      <div className="grid gap-2">
                        {rfq.products.map((prod, idx) => (
                          <div key={idx} className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-primary/30 hover:shadow-md transition-all">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                <span className="bg-primary text-white text-[10px] font-black w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                                  {idx + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="font-bold text-sm text-slate-800">{prod.name}</p>
                                  {prod.subCategory && (
                                    <div className="mt-1">
                                      <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded">
                                        {displaySubcategory(prod.subCategory, locale)}
                                      </span>
                                    </div>
                                  )}
                                  {prod.description && (
                                    <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{prod.description}</p>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-0.5 bg-primary/5 px-3 py-2 rounded-lg shrink-0 min-w-[80px]">
                                <span className="font-black text-primary text-base leading-none" dir="ltr">
                                  {prod.quantity}
                                </span>
                                <span className="text-[10px] text-slate-500 font-medium">{prod.unitOfMeasure}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    rfq.quantity != null && (
                      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-600 bg-slate-50 w-fit px-3 py-1.5 rounded-md">
                        <Package size={14} className="text-primary" />
                        {t("quantity_label", { quantity: String(rfq.quantity), unit: rfq.unitOfMeasure || "" })}
                      </div>
                    )
                  )}

                  {/* Notes */}
                  {rfq.notes && (
                    <div className="p-4 bg-gradient-to-br from-amber-50/60 to-white rounded-xl border border-amber-100 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <MessageCircle size={14} className="text-amber-700" />
                        <h2 className="font-bold text-amber-800 text-sm">{t("notes_title")}</h2>
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{rfq.notes}</p>
                    </div>
                  )}

                  {/* PDF attachment */}
                  {rfq.pdfUrl && (
                    <div className="flex items-center gap-3 p-4 bg-blue-50/60 rounded-xl border border-blue-100 shadow-sm">
                      <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                        <File size={20} className="text-blue-600" />
                      </div>
                      <span className="flex-1 text-sm font-bold text-slate-700">{t("pdf_attached")}</span>
                      <a href={rfq.pdfUrl} target="_blank" rel="noopener noreferrer" download>
                        <Button variant="outline" size="sm" className="gap-1 bg-white border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all">
                          <Download size={14} />
                          {t("download")}
                        </Button>
                      </a>
                    </div>
                  )}
                </div>
              </section>

              {/* ============ OFFER FORM ============ */}
              <section className="lg:col-span-2 lg:sticky lg:top-24 bg-white rounded-2xl border border-slate-200/70 shadow-xl shadow-primary/5 overflow-hidden">
                <div className="px-5 pt-5 pb-4 border-b bg-gradient-to-bl from-success/5 to-white">
                  <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                    {t("form_title")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">{t("form_desc")}</p>
                </div>

                {!lookup.canSubmit ? (
                  <div className="p-8 text-center space-y-4">
                    <div className="w-14 h-14 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mx-auto">
                      <AlertCircle size={26} />
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {lookup.deadlinePassed ? t("closed_deadline_desc") : t("closed_desc")}
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit(onSubmit)} className="px-5 py-5 space-y-4" noValidate>
                    {/* Company + contact */}
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="companyName" className="text-sm font-semibold flex items-center gap-1.5">
                          <Building2 size={13} className="text-primary" />
                          {t("company_name")} <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="companyName"
                          {...register("companyName")}
                          placeholder={t("company_name_placeholder")}
                          className={cn("h-11 rounded-xl border-2 border-input focus:border-primary", errors.companyName && "border-destructive")}
                        />
                        {errors.companyName && <p className="text-xs text-destructive">{t("field_required")}</p>}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="contactName" className="text-sm font-semibold flex items-center gap-1.5">
                          <User size={13} className="text-primary" />
                          {t("contact_name")} <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="contactName"
                          {...register("contactName")}
                          placeholder={t("contact_name_placeholder")}
                          className={cn("h-11 rounded-xl border-2 border-input focus:border-primary", errors.contactName && "border-destructive")}
                        />
                        {errors.contactName && <p className="text-xs text-destructive">{t("field_required")}</p>}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="email" className="text-sm font-semibold flex items-center gap-1.5">
                            <Mail size={13} className="text-primary" />
                            {t("email")} <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="email"
                            type="email"
                            {...register("email")}
                            placeholder="you@company.com"
                            dir="ltr"
                            className={cn("h-11 rounded-xl border-2 border-input focus:border-primary text-left", errors.email && "border-destructive")}
                          />
                          {errors.email && <p className="text-xs text-destructive">{t("invalid_email")}</p>}
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="phone" className="text-sm font-semibold flex items-center gap-1.5">
                            <Phone size={13} className="text-primary" />
                            {t("phone")} <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="phone"
                            type="tel"
                            {...register("phone")}
                            placeholder="05xxxxxxxx"
                            dir="ltr"
                            className={cn("h-11 rounded-xl border-2 border-input focus:border-primary text-left", errors.phone && "border-destructive")}
                          />
                          {errors.phone && <p className="text-xs text-destructive">{t("invalid_phone")}</p>}
                        </div>
                      </div>
                    </div>

                    {/* Price + execution — mirrors the portal offer dialog hero stats */}
                    <div className="grid grid-cols-1 gap-3 p-4 rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/5 via-primary/3 to-transparent">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                          <Banknote size={12} className="text-primary" />
                          <span>{t("price_label")}</span>
                          <span className="text-red-500 normal-case">*</span>
                        </div>
                        <div className="relative">
                          <input
                            type="number"
                            id="price"
                            {...register("price")}
                            className={cn(
                              "w-full h-12 px-4 ps-4 pe-12 rounded-xl border-2 border-input bg-white text-xl font-black text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
                              errors.price && "border-destructive"
                            )}
                            placeholder="0"
                            min="0"
                            step="any"
                            aria-label={t("price_label")}
                          />
                          <span className="absolute end-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">{t("sar")}</span>
                        </div>
                        {errors.price && <p className="text-xs text-destructive">{t("invalid_price")}</p>}
                      </div>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                          <CalendarClock size={12} className="text-primary" />
                          <span>{t("execution_duration")}</span>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            {...register("executionDuration")}
                            placeholder={t("duration_placeholder")}
                            min="0"
                            className="h-11 text-lg font-black rounded-xl border-2 border-input focus:border-primary transition-colors bg-white"
                            aria-label={t("execution_duration")}
                          />
                          <Select value={executionDurationUnit} onValueChange={setExecutionDurationUnit}>
                            <SelectTrigger className="w-28 h-11 text-sm font-bold rounded-xl border-2 border-input bg-white" aria-label={t("execution_duration")}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="أيام">{t("days")}</SelectItem>
                              <SelectItem value="أسابيع">{t("weeks")}</SelectItem>
                              <SelectItem value="أشهر">{t("months")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    {/* Delivery */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="deliveryLocation" className="text-sm font-semibold">{t("delivery_location")}</Label>
                        <Input
                          id="deliveryLocation"
                          {...register("deliveryLocation")}
                          placeholder={t("delivery_location_placeholder")}
                          className="h-11 rounded-xl border-2 border-input focus:border-primary"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="deliveryDate" className="text-sm font-semibold">{t("delivery_date")}</Label>
                        <Input
                          id="deliveryDate"
                          type="date"
                          {...register("deliveryDate")}
                          className="h-11 rounded-xl border-2 border-input focus:border-primary"
                        />
                      </div>
                    </div>

                    {/* PDF upload */}
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">{t("upload_pdf")}</Label>
                      {pdfFile ? (
                        <div className="flex items-center gap-3 p-3.5 bg-blue-50/50 border border-blue-200/50 rounded-xl">
                          <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                            <File size={17} className="text-blue-600" />
                          </div>
                          <span className="flex-1 text-sm font-semibold text-blue-800 truncate" dir="ltr">{pdfFile.name}</span>
                          <Button type="button" variant="ghost" size="sm" onClick={removePdf} className="text-red-500 rounded-lg shrink-0" aria-label={t("remove")}>
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      ) : (
                        <div className="relative">
                          <input
                            ref={pdfInputRef}
                            type="file"
                            accept=".pdf"
                            onChange={handlePdfSelect}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            aria-label={t("upload_pdf")}
                          />
                          <div className="flex items-center justify-center gap-3 h-20 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 text-slate-500 hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group">
                            <div className="h-9 w-9 rounded-lg bg-slate-100 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                              <Upload size={16} className="text-slate-400 group-hover:text-primary transition-colors" />
                            </div>
                            <span className="text-sm font-semibold text-slate-700">{t("click_to_upload_pdf")}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Website */}
                    <div className="space-y-1.5">
                      <Label htmlFor="website" className="text-sm font-semibold text-slate-700">{t("website_label")}</Label>
                      <div className="relative">
                        <Globe className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                          id="website"
                          {...register("website")}
                          placeholder="https://..."
                          dir="ltr"
                          className="h-11 ps-10 rounded-xl border-2 border-input focus:border-primary transition-colors text-left"
                        />
                      </div>
                    </div>

                    {/* Message */}
                    <div className="space-y-1.5">
                      <Label htmlFor="message" className="text-sm font-semibold text-slate-700">{t("message_label")}</Label>
                      <Textarea
                        id="message"
                        {...register("message")}
                        placeholder={t("message_placeholder")}
                        rows={3}
                        className="rounded-xl border-2 border-input focus:border-primary resize-none"
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full h-12 bg-gradient-to-l from-success to-emerald-600 hover:from-success/90 hover:to-emerald-600/90 gap-2 rounded-xl shadow-lg shadow-success/25 hover:shadow-xl hover:shadow-success/30 transition-all font-black text-white active:scale-[0.98]"
                    >
                      {isSubmitting ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                      )}
                      {isSubmitting ? t("submitting") : t("submit_btn")}
                    </Button>
                    <p className="text-[11px] text-muted-foreground text-center leading-relaxed">{t("terms_note")}</p>
                  </form>
                )}
              </section>
            </div>
          </>
        )}
      </main>

      {/* ===== Footer ===== */}
      <footer className="border-t border-slate-200/70 bg-white/60 mt-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-start">
          <p className="text-xs text-muted-foreground">{t("footer_powered")}</p>
          <Link href="/" className="text-xs font-bold text-cta hover:underline" dir="ltr">
            mdmaktech.sa
          </Link>
        </div>
      </footer>
    </div>
  )
}
