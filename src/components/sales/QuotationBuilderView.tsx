"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { collection, doc, getDoc, query, where } from "firebase/firestore"
import {
  ArrowRight, Building2, Contact, Eye, FileSignature, Loader2, Lock, PencilLine, Save, Wallet,
} from "lucide-react"
import { Link, useRouter } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { useQuotationForm } from "@/hooks/useQuotationForm"
import { useQuotationBrandingDefaults } from "@/hooks/useQuotationBranding"
import { cn } from "@/lib/utils"
import { generateQuotationNumber, type QuotationBranding } from "@/lib/crm"
import { WORK_ORDERS, type WorkOrder } from "@/lib/manufacturing"
import {
  DEFAULT_QUOTATION_VALIDITY_DAYS,
  DEFAULT_QUOTATION_VAT_PERCENT,
  EMPTY_QUOTATION_BRANDING,
  addDaysToIsoDate,
  sheetCustomerFromContact,
  validityDaysBetween,
  type QuotationSheetData,
} from "@/lib/quotation-document"
import { SALES_QUOTE_REQUESTS, markQuoteRequestQuoted, type QuoteRequest } from "@/lib/sales-transfers"
import { RequiredMark } from "@/components/crm/CrmFormDialog"
import { DATE_INPUT_CLASS } from "@/components/crm/CrmOpportunityDialog"
import {
  QuotationItemsEditor,
  QuotationPhaseControl,
  QuotationScheduleEditor,
  QuotationStatusField,
} from "@/components/crm/QuotationFormFields"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { SalesShell, SalesSection, salesBasePath } from "./SalesShell"
import { QuotationPdfSheet } from "./QuotationPdfSheet"
import { QuotationPrintButton } from "./QuotationPrintButton"
import { QuotationLogoField } from "./QuotationLogoField"

type Pane = "form" | "preview"

/** The A4 sheet scaled down to whatever width its column has. The sheet keeps
 * its true 210mm layout; only the rendering is scaled, so the preview is the
 * print, just smaller. */
function ScaledA4({ children, isRtl }: { children: ReactNode; isRtl: boolean }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ scale: 1, height: 0 })

  useEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return
    const measure = () => {
      const natural = inner.offsetWidth || 1
      const scale = Math.min(1, outer.clientWidth / natural)
      const height = Math.ceil(inner.offsetHeight * scale)
      setBox((prev) => (prev.scale === scale && prev.height === height ? prev : { scale, height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={outerRef} className="relative w-full overflow-hidden" style={{ height: box.height || undefined }}>
      <div
        ref={innerRef}
        className={cn("absolute top-0 w-max shadow-lg ring-1 ring-border", isRtl ? "right-0 origin-top-right" : "left-0 origin-top-left")}
        style={{ transform: `scale(${box.scale})` }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * New quotation, as a document: the creation form on one side and the branded
 * A4 quotation it produces on the other, updating as you type. Saving goes
 * through the same hook as the quick dialog (so acceptance, Finance's deposit
 * notice, the work order and the sales order behave identically) and adds the
 * document itself — validity, terms, VAT rate and the letterhead snapshot.
 */
export function QuotationBuilderView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const router = useRouter()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { user } = useUser()
  const { can } = usePermissions()
  const canManage = can("sales.manage")
  const base = salesBasePath(portal)

  const { orgId, contacts, isLoading } = useCrmData()
  const { branding: brandingDefaults, isLoading: brandingLoading } = useQuotationBrandingDefaults()

  const ordersQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: ordersData } = useCollection(ordersQuery)
  const finishedOrders = useMemo(
    () => ((ordersData || []) as WorkOrder[]).filter((o) => o.status === "done").sort((a, b) => (b.orderNumber || 0) - (a.orderNumber || 0)),
    [ordersData]
  )
  const contactOptions = useMemo(() => contacts.map((c) => ({ id: c.id, name: c.name })), [contacts])
  const sortedContacts = useMemo(() => [...contactOptions].sort((a, b) => a.name.localeCompare(b.name)), [contactOptions])

  // "Price it" from the CRM request inbox: `?request=` seeds the client and
  // the lines, and the first save takes the request out of the inbox.
  const searchParams = useSearchParams()
  const requestId = searchParams.get("request")
  const [request, setRequest] = useState<QuoteRequest | null>(null)
  const [requestLoading, setRequestLoading] = useState(!!requestId)
  useEffect(() => {
    if (!firestore || !requestId) return
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDoc(doc(firestore, SALES_QUOTE_REQUESTS, requestId))
        if (!cancelled && snap.exists()) setRequest({ id: snap.id, ...(snap.data() as Omit<QuoteRequest, "id">) })
      } catch (err) {
        console.error("Quote request load failed:", err)
      } finally {
        if (!cancelled) setRequestLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [firestore, requestId])

  const requestDefaults = useMemo(
    () =>
      request
        ? {
            contactId: request.contactId,
            items: request.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, unitPrice: 0 })),
          }
        : undefined,
    [request]
  )

  const form = useQuotationForm({
    open: !requestId || !requestLoading,
    orgId,
    contacts: contactOptions,
    finishedOrders,
    defaults: requestDefaults,
  })
  const { isSaving } = form

  // The document's own fields.
  const [quotationNumber, setQuotationNumber] = useState("")
  const [validUntil, setValidUntil] = useState("")
  const [vatPercent, setVatPercent] = useState(String(DEFAULT_QUOTATION_VAT_PERCENT))
  const [terms, setTerms] = useState("")
  const [branding, setBranding] = useState<QuotationBranding>(EMPTY_QUOTATION_BRANDING)
  const [logoUploading, setLogoUploading] = useState(false)
  const [pane, setPane] = useState<Pane>("form")
  const [leaving, setLeaving] = useState(false)

  // Numbered up front so the preview (and a PDF printed before saving) carries
  // the number the quotation will be saved under.
  const documentSeeded = useRef(false)
  useEffect(() => {
    if (documentSeeded.current) return
    documentSeeded.current = true
    setQuotationNumber(generateQuotationNumber())
    setTerms(t("sales_qb_terms_default"))
  }, [t])

  const validitySeeded = useRef(false)
  useEffect(() => {
    if (validitySeeded.current || !form.date) return
    validitySeeded.current = true
    setValidUntil(addDaysToIsoDate(form.date, DEFAULT_QUOTATION_VALIDITY_DAYS))
  }, [form.date])

  const brandingSeeded = useRef(false)
  useEffect(() => {
    if (brandingSeeded.current || brandingLoading) return
    brandingSeeded.current = true
    setBranding((current) => ({ ...brandingDefaults, logoUrl: current.logoUrl ?? brandingDefaults.logoUrl }))
  }, [brandingLoading, brandingDefaults])

  const setBrandingField = (key: Exclude<keyof QuotationBranding, "logoUrl">, value: string) =>
    setBranding((b) => ({ ...b, [key]: value }))

  const contact = contacts.find((c) => c.id === form.selectedContactId) ?? null
  // Lines appear on the sheet as soon as they have a name, before a quantity.
  const previewItems = form.itemRows
    .filter((r) => r.name.trim())
    .map((r) => ({ name: r.name.trim(), quantity: Number(r.quantity) || 0, unit: r.unit.trim(), unitPrice: Number(r.unitPrice) || 0 }))
  const sheetData: QuotationSheetData = {
    quotationNumber,
    date: form.date || null,
    validUntil: validUntil || null,
    customer: sheetCustomerFromContact(contact, form.effectiveContactName),
    items: previewItems.length > 0 ? previewItems : null,
    amount: form.effectiveAmount,
    vatPercent,
    installments: form.parsedInstallments,
    terms,
    notes: form.notes,
    branding,
  }
  const documentTitle = [t("sales_qb_sheet_title"), quotationNumber, form.effectiveContactName].filter(Boolean).join(" - ")

  const busy = isSaving || leaving
  const formDisabled = busy || !canManage

  const handleSave = async () => {
    if (busy || !canManage) return
    const fail = (title: string) => {
      setPane("form")
      toast({ title, variant: "destructive" })
    }
    if (!form.selectedContactId) return fail(t("sales_pick_contact_required"))
    if (logoUploading) return fail(t("sales_qb_logo_wait"))
    const vat = Number(vatPercent)
    if (vatPercent.trim() === "" || !Number.isFinite(vat) || vat < 0 || vat > 100) return fail(t("sales_qb_vat_error"))
    if (validUntil && form.date && validUntil < form.date) return fail(t("sales_qb_valid_until_error"))

    const trimmed: QuotationBranding = {
      logoUrl: branding.logoUrl && !branding.logoUrl.startsWith("blob:") ? branding.logoUrl : null,
      companyName: branding.companyName.trim(),
      crNumber: branding.crNumber.trim(),
      vatNumber: branding.vatNumber.trim(),
      address: branding.address.trim(),
      phone: branding.phone.trim(),
      email: branding.email.trim(),
      website: branding.website.trim(),
    }
    const id = await form.save({
      quotationNumber,
      vatPercent: vat,
      extra: {
        validUntil: validUntil || null,
        validityDays: validityDaysBetween(form.date, validUntil),
        terms: terms.trim() || null,
        vatPercent: vat,
        branding: trimmed,
      },
    })
    if (!id) return
    if (request && request.status === "new" && user) {
      try {
        await markQuoteRequestQuoted(firestore, {
          requestId: request.id,
          quotationId: id,
          quotationNumber,
          actor: { id: user.uid, name: user.email || "" },
        })
      } catch (err) {
        console.error("Quote request stamp failed:", err)
      }
    }
    setLeaving(true)
    router.push(`${base}/quotations/${id}`)
  }

  if (isLoading || brandingLoading || requestLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={32} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  const brandingFields: Array<{ key: Exclude<keyof QuotationBranding, "logoUrl">; label: string; ltr?: boolean; wide?: boolean; type?: string }> = [
    { key: "companyName", label: t("sales_qb_company_name"), wide: true },
    { key: "crNumber", label: t("sales_qb_cr_number"), ltr: true },
    { key: "vatNumber", label: t("sales_qb_vat_number"), ltr: true },
    { key: "phone", label: t("sales_qb_phone"), ltr: true, type: "tel" },
    { key: "email", label: t("sales_qb_email"), ltr: true, type: "email" },
    { key: "website", label: t("sales_qb_website"), ltr: true },
    { key: "address", label: t("sales_qb_address"), wide: true },
  ]

  return (
    <SalesShell
      portal={portal}
      title={t("sales_qb_title")}
      description={t("sales_qb_desc")}
      action={
        <>
          <QuotationPrintButton sheet={<QuotationPdfSheet data={sheetData} />} documentTitle={documentTitle} disabled={busy} />
          <Button className="gap-2" onClick={() => void handleSave()} disabled={busy || !canManage}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
            {t("sales_qb_save")}
          </Button>
        </>
      }
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          href={`${base}/quotations`}
          className="text-xs font-semibold text-muted-foreground hover:text-primary flex items-center gap-1 w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          <ArrowRight size={12} className={cn(!isRtl && "rotate-180")} aria-hidden="true" />
          {t("sales_detail_back")}
        </Link>
        {!canManage && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Lock size={12} aria-hidden="true" />
            {t("sales_no_permission")}
          </p>
        )}
      </div>

      {request && (
        <p className="rounded-lg border border-cta/30 bg-cta/5 px-3 py-2 text-xs font-semibold text-cta" dir="auto">
          {t("sales_rq_banner", { number: request.requestNumber, contact: request.contactName || "—" })}
        </p>
      )}

      {/* Below lg the two sides take turns. */}
      <div role="group" aria-label={t("sales_qb_view_switch")} className="lg:hidden grid grid-cols-2 gap-1 rounded-lg border bg-muted/30 p-1">
        {(["form", "preview"] as Pane[]).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={pane === p}
            onClick={() => setPane(p)}
            className={cn(
              "h-11 rounded-md text-sm font-bold flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              pane === p ? "bg-primary text-white shadow-sm" : "text-slate-600 hover:bg-white"
            )}
          >
            {p === "form" ? <PencilLine size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
            {p === "form" ? t("sales_qb_tab_form") : t("sales_qb_tab_preview")}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        {/* ── Form side ─────────────────────────────────────────────── */}
        <div className={cn("space-y-4 min-w-0", pane !== "form" && "hidden lg:block")}>
          <SalesSection title={t("sales_qb_section_customer")} icon={Contact}>
            <fieldset disabled={formDisabled} className="p-5 space-y-4 min-w-0">
              <div className="space-y-1.5">
                <Label htmlFor="qb-customer">{t("sales_pick_contact")} <RequiredMark /></Label>
                {sortedContacts.length > 0 ? (
                  <Select value={form.selectedContactId || undefined} onValueChange={form.setSelectedContactId} disabled={formDisabled}>
                    <SelectTrigger id="qb-customer"><SelectValue placeholder={t("sales_pick_contact_placeholder")} /></SelectTrigger>
                    <SelectContent>
                      {sortedContacts.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground border border-dashed rounded-lg p-3">{t("sales_no_contacts")}</p>
                )}
              </div>
              <QuotationPhaseControl form={form} />
              {form.phase === "post_manufacturing" && (
                <div className="space-y-1.5">
                  <Label htmlFor="qb-order">{t("sales_pick_work_order")}</Label>
                  <Select
                    value={form.linkedOrderId || "__none__"}
                    onValueChange={(v) => form.pickFinishedOrder(v === "__none__" ? "" : v)}
                    disabled={formDisabled}
                  >
                    <SelectTrigger id="qb-order"><SelectValue placeholder={t("sales_pick_work_order_placeholder")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t("sales_pick_work_order_none")}</SelectItem>
                      {finishedOrders.map((o) => (
                        <SelectItem key={o.id} value={o.id}>#{o.orderNumber} {o.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </fieldset>
          </SalesSection>

          <SalesSection title={t("sales_qb_section_pricing")} icon={Wallet}>
            <fieldset disabled={formDisabled} className="p-5 space-y-4 min-w-0">
              <QuotationItemsEditor form={form} />
              <QuotationScheduleEditor form={form} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="qb-amount">{t("sales_qb_amount_net")} <RequiredMark /></Label>
                  <Input
                    id="qb-amount" type="number" min="0" step="any" inputMode="decimal" dir="ltr"
                    value={form.hasItems ? String(form.itemsTotal) : form.amount}
                    onChange={(e) => form.setAmount(e.target.value)}
                    disabled={formDisabled || form.hasItems}
                    aria-describedby="qb-amount-hint"
                  />
                  <p id="qb-amount-hint" className="text-[11px] text-muted-foreground">
                    {form.hasItems ? t("sales_qb_amount_from_items") : t("sales_qb_amount_lump_hint")}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qb-vat">{t("sales_qb_vat_percent")}</Label>
                  <Input
                    id="qb-vat" type="number" min="0" max="100" step="any" inputMode="decimal" dir="ltr"
                    value={vatPercent}
                    onChange={(e) => setVatPercent(e.target.value)}
                    disabled={formDisabled}
                    aria-describedby="qb-vat-hint"
                  />
                  <p id="qb-vat-hint" className="text-[11px] text-muted-foreground">{t("sales_qb_vat_hint")}</p>
                </div>
              </div>
            </fieldset>
          </SalesSection>

          <SalesSection title={t("sales_qb_section_document")} icon={FileSignature}>
            <fieldset disabled={formDisabled} className="p-5 space-y-4 min-w-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="qb-date">{t("crm_quote_date")}</Label>
                  <input
                    id="qb-date" type="date" dir="ltr" value={form.date}
                    onChange={(e) => form.setDate(e.target.value)}
                    disabled={formDisabled}
                    className={DATE_INPUT_CLASS}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qb-valid-until">{t("sales_qb_valid_until")}</Label>
                  <input
                    id="qb-valid-until" type="date" dir="ltr" value={validUntil} min={form.date || undefined}
                    onChange={(e) => setValidUntil(e.target.value)}
                    disabled={formDisabled}
                    className={DATE_INPUT_CLASS}
                  />
                </div>
              </div>
              <QuotationStatusField form={form} id="qb-status" />
              <div className="space-y-1.5">
                <Label htmlFor="qb-terms">{t("sales_qb_terms")}</Label>
                <Textarea id="qb-terms" rows={6} value={terms} onChange={(e) => setTerms(e.target.value)} disabled={formDisabled} dir="auto" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qb-notes">{t("crm_notes")}</Label>
                <Textarea id="qb-notes" rows={3} value={form.notes} onChange={(e) => form.setNotes(e.target.value)} disabled={formDisabled} dir="auto" />
              </div>
            </fieldset>
          </SalesSection>

          <SalesSection title={t("sales_qb_section_branding")} icon={Building2}>
            <div className="p-5 space-y-4">
              <QuotationLogoField
                orgId={orgId}
                value={branding.logoUrl}
                onChange={(url) => setBranding((b) => ({ ...b, logoUrl: url }))}
                onUploadingChange={setLogoUploading}
                disabled={formDisabled}
              />
              <p className="text-[11px] text-muted-foreground">{t("sales_qb_branding_hint")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {brandingFields.map((f) => (
                  <div key={f.key} className={cn("space-y-1.5", f.wide && "sm:col-span-2")}>
                    <Label htmlFor={`qb-brand-${f.key}`}>{f.label}</Label>
                    <Input
                      id={`qb-brand-${f.key}`}
                      type={f.type ?? "text"}
                      dir={f.ltr ? "ltr" : "auto"}
                      value={branding[f.key]}
                      onChange={(e) => setBrandingField(f.key, e.target.value)}
                      disabled={formDisabled}
                    />
                  </div>
                ))}
              </div>
            </div>
          </SalesSection>
        </div>

        {/* ── Preview side ──────────────────────────────────────────── */}
        <div
          className={cn(
            "min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto rounded-xl border bg-muted/40 p-3 sm:p-4",
            pane !== "preview" && "hidden lg:block"
          )}
        >
          <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Eye size={13} className="text-cta" aria-hidden="true" />
              {t("sales_qb_preview_title")}
            </p>
            <p className="text-[11px] text-muted-foreground">{t("sales_qb_pdf_hint")}</p>
          </div>
          <ScaledA4 isRtl={isRtl}>
            <QuotationPdfSheet data={sheetData} />
          </ScaledA4>
        </div>
      </div>
    </SalesShell>
  )
}
