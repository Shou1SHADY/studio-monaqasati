"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { collection, doc, getDoc, query, where } from "firebase/firestore"
import {
  AlertTriangle, ArrowRight, BadgeCheck, Building2, Contact, Eye, FileSignature, Loader2, Lock, PencilLine, Plus, Save, Wallet,
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
import { CRM_QUOTATIONS, type CrmQuotation, type QuotationBranding } from "@/lib/crm"
import { WORK_ORDERS, type WorkOrder } from "@/lib/manufacturing"
import {
  DEFAULT_QUOTATION_VAT_PERCENT,
  EMPTY_QUOTATION_BRANDING,
  sheetCustomerFromContact,
  type QuotationSheetData,
} from "@/lib/quotation-document"
import { SALES_QUOTE_REQUESTS, linkQuoteRequestDraft, type QuoteRequest } from "@/lib/sales-transfers"
import { VALIDITY_CHOICES, issueBlocks, issueQuotation, quoteEditable, type IssueBlock } from "@/lib/sales-quotes"
import { displayDocNumber } from "@/lib/sales-numbering"
import { RequiredMark } from "@/components/crm/CrmFormDialog"
import { DATE_INPUT_CLASS } from "@/components/crm/CrmOpportunityDialog"
import {
  QuotationItemsEditor,
  QuotationPhaseControl,
  QuotationScheduleEditor,
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
  const { can, isOrgOwner } = usePermissions()
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

  // "Price it" from the CRM request inbox: `?request=` seeds the client and the
  // lines. `?draft=` reopens a draft (or an issued quote, texts only) — a
  // request with a draft is continued here, never priced twice (RQ-04).
  const searchParams = useSearchParams()
  const requestId = searchParams.get("request")
  const draftId = searchParams.get("draft")
  const [request, setRequest] = useState<QuoteRequest | null>(null)
  const [draft, setDraft] = useState<CrmQuotation | null>(null)
  const [requestLoading, setRequestLoading] = useState(!!requestId || !!draftId)
  useEffect(() => {
    if (!firestore || (!requestId && !draftId)) return
    let cancelled = false
    ;(async () => {
      try {
        if (draftId) {
          const snap = await getDoc(doc(firestore, CRM_QUOTATIONS, draftId))
          if (!cancelled && snap.exists()) setDraft({ id: snap.id, ...(snap.data() as Omit<CrmQuotation, "id">) })
        } else if (requestId) {
          const snap = await getDoc(doc(firestore, SALES_QUOTE_REQUESTS, requestId))
          if (!cancelled && snap.exists()) {
            const loaded = { id: snap.id, ...(snap.data() as Omit<QuoteRequest, "id">) }
            // The request already has its draft: continue that one.
            if (loaded.status === "new" && loaded.draftQuotationId) {
              router.replace(`${base}/quotations/new?draft=${loaded.draftQuotationId}`)
              return
            }
            setRequest(loaded)
          }
        }
      } catch (err) {
        console.error("Composer seed load failed:", err)
      } finally {
        if (!cancelled) setRequestLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [firestore, requestId, draftId, router, base])

  // A request that is no longer open seeds nothing: it was answered already.
  const openRequest = request && request.status === "new" ? request : null
  const requestDefaults = useMemo(
    () =>
      openRequest
        ? {
            contactId: openRequest.contactId,
            requestId: openRequest.id,
            opportunityId: openRequest.opportunityId ?? null,
            items: openRequest.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, unitPrice: 0 })),
          }
        : undefined,
    [openRequest]
  )

  const form = useQuotationForm({
    open: !requestLoading,
    orgId,
    contacts: draft ? undefined : contactOptions,
    quotation: draft ?? undefined,
    finishedOrders,
    defaults: requestDefaults,
  })
  const { isSaving } = form

  // The document's own fields. The number is drawn on the FIRST save — a
  // composer closed without saving consumes none (QC-15).
  const quotationNumber = draft?.quotationNumber ?? ""
  const [vatPercent, setVatPercent] = useState(String(DEFAULT_QUOTATION_VAT_PERCENT))
  const [terms, setTerms] = useState("")
  const [leadTime, setLeadTime] = useState("")
  const [branding, setBranding] = useState<QuotationBranding>(EMPTY_QUOTATION_BRANDING)
  const [logoUploading, setLogoUploading] = useState(false)
  const [pane, setPane] = useState<Pane>("form")
  const [leaving, setLeaving] = useState(false)

  const documentSeeded = useRef(false)
  useEffect(() => {
    if (documentSeeded.current || requestLoading) return
    documentSeeded.current = true
    setTerms(draft ? draft.terms ?? "" : t("sales_qb_terms_default"))
    setLeadTime(draft?.leadTime ?? "")
    if (draft?.vatPercent != null) setVatPercent(String(draft.vatPercent))
  }, [t, draft, requestLoading])

  // Identity is READ from Settings & Governance, never typed here (QC-02); a
  // saved quotation keeps the letterhead it was written under.
  const brandingSeeded = useRef(false)
  useEffect(() => {
    if (brandingSeeded.current || brandingLoading || requestLoading) return
    brandingSeeded.current = true
    setBranding((current) => (draft?.branding ? draft.branding : { ...brandingDefaults, logoUrl: current.logoUrl ?? brandingDefaults.logoUrl }))
  }, [brandingLoading, brandingDefaults, draft, requestLoading])

  const today = new Date().toISOString().slice(0, 10)
  const editable = draft ? quoteEditable(draft, today) : "all"
  const contact = contacts.find((c) => c.id === form.effectiveContactId) ?? null
  // Lines appear on the sheet as soon as they have a name, before a quantity.
  const previewItems = form.itemRows
    .filter((r) => r.name.trim())
    .map((r) => ({ name: r.name.trim(), quantity: Number(r.quantity) || 0, unit: r.unit.trim(), unitPrice: Number(r.unitPrice) || 0 }))
  const sheetData: QuotationSheetData = {
    quotationNumber,
    date: form.date || null,
    validUntil: null,
    validityDays: Number(form.validityDays) > 0 ? Number(form.validityDays) : null,
    isDraft: !draft || draft.status === "draft",
    leadTime,
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

  // What blocks Issue, live as you type — the write runs the same function (T4).
  const blocks: IssueBlock[] = issueBlocks(
    {
      contactId: form.effectiveContactId,
      items: form.parsedItems,
      installments: form.parsedInstallments,
      validityDays: Number(form.validityDays),
    },
    form.issueContext
  )
  const blockText = (b: IssueBlock): string => {
    switch (b.kind) {
      case "below_cost":
        return t("sales_below_cost_blocked", { name: b.name })
      case "over_cap":
        return t("sales_discount_cap_blocked", { name: b.name, discount: b.discountPercent, cap: b.capPercent })
      case "advance_required":
        return t("sales_q_block_advance", { items: b.names.join(" · ") })
      default:
        return t(`sales_q_block_${b.kind}`)
    }
  }

  const busy = isSaving || leaving
  const formDisabled = busy || !canManage || editable === "none"
  const figuresDisabled = formDisabled || editable !== "all"

  const handleSave = async (issue: boolean) => {
    if (busy || !canManage || !user) return
    const fail = (title: string) => {
      setPane("form")
      toast({ title, variant: "destructive" })
    }
    if (!form.effectiveContactId) return fail(t("sales_pick_contact_required"))
    if (logoUploading) return fail(t("sales_qb_logo_wait"))
    const vat = Number(vatPercent)
    if (vatPercent.trim() === "" || !Number.isFinite(vat) || vat < 0 || vat > 100) return fail(t("sales_qb_vat_error"))
    if (issue && blocks.length) return fail(blockText(blocks[0]))

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
      quiet: issue,
      extra: { terms: terms.trim() || null, leadTime: leadTime.trim() || null, vatPercent: vat, branding: trimmed },
    })
    if (!id) return
    const actor = { id: user.uid, name: user.displayName || user.email || "" }
    setLeaving(true)
    try {
      // The request keeps its place in the inbox as "finish the draft" until
      // the draft is issued — issuing is what answers it.
      if (openRequest && !draft) {
        const snap = await getDoc(doc(firestore, CRM_QUOTATIONS, id))
        await linkQuoteRequestDraft(firestore, { requestId: openRequest.id, quotationId: id, quotationNumber: (snap.data()?.quotationNumber as string) || "" })
      }
      if (issue) {
        const issued = await issueQuotation(firestore, { quotationId: id, context: form.issueContext, actor })
        toast({ title: t("sales_q_issued_toast", { number: displayDocNumber(issued.quotationNumber, locale) }) })
      }
    } catch (err) {
      console.error(err)
      const code = err instanceof Error ? err.message : ""
      toast({ title: code.startsWith("blocked:") ? t("sales_q_issue_blocked") : t("crm_save_error"), variant: "destructive" })
    }
    router.push(`${base}/quotations/${id}`)
  }

  if (isLoading || brandingLoading || requestLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={32} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  const identityRows: Array<{ label: string; value: string; ltr?: boolean }> = [
    { label: t("sales_qb_company_name"), value: branding.companyName },
    { label: t("sales_qb_cr_number"), value: branding.crNumber, ltr: true },
    { label: t("sales_qb_vat_number"), value: branding.vatNumber, ltr: true },
    { label: t("sales_qb_address"), value: branding.address },
    { label: t("sales_qb_phone"), value: branding.phone, ltr: true },
    { label: t("sales_qb_email"), value: branding.email, ltr: true },
    { label: t("sales_qb_website"), value: branding.website, ltr: true },
  ]

  return (
    <SalesShell
      portal={portal}
      title={t("sales_qb_title")}
      description={t("sales_qb_desc")}
      action={
        <>
          <QuotationPrintButton sheet={<QuotationPdfSheet data={sheetData} />} documentTitle={documentTitle} disabled={busy} />
          <Button variant={editable === "all" ? "outline" : "default"} className="gap-2" onClick={() => void handleSave(false)} disabled={formDisabled}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
            {editable === "all" ? t("sales_q_save_draft") : t("sales_qb_save")}
          </Button>
          {editable === "all" && (
            <Button className="gap-2" onClick={() => void handleSave(true)} disabled={formDisabled || blocks.length > 0} aria-describedby={blocks.length ? "qb-issue-blocks" : undefined}>
              <BadgeCheck size={16} aria-hidden="true" />
              {t("sales_q_issue_btn")}
            </Button>
          )}
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

      {openRequest && (
        <p className="rounded-lg border border-cta/30 bg-cta/5 px-3 py-2 text-xs font-semibold text-cta" dir="auto">
          {t("sales_rq_banner", { number: displayDocNumber(openRequest.requestNumber, locale), contact: openRequest.contactName || "—" })}
        </p>
      )}
      {request && !openRequest && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs font-semibold text-warning" dir="auto">
          {t("sales_rq_already_answered", { number: displayDocNumber(request.requestNumber, locale) })}
        </p>
      )}
      {editable === "texts" && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs font-semibold text-warning">
          <Lock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t("sales_q_issued_lock")}
        </p>
      )}
      {editable === "none" && (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive">
          <Lock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t("sales_q_locked")}
        </p>
      )}

      {/* Why Issue is off — every reason, as you type (T4). */}
      {editable === "all" && blocks.length > 0 && (
        <div id="qb-issue-blocks" className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5" role="status">
          <p className="flex items-center gap-2 text-xs font-black text-warning">
            <AlertTriangle size={13} aria-hidden="true" />
            {t("sales_q_blocks_title")}
          </p>
          <ul className="list-disc space-y-1 ps-5 text-xs text-slate-700">
            {blocks.map((b, i) => (
              <li key={`${b.kind}-${i}`}>{blockText(b)}</li>
            ))}
          </ul>
          {blocks.some((b) => b.kind === "advance_required") && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={form.addAdvance} disabled={formDisabled}>
              <Plus size={13} aria-hidden="true" />
              {t("sales_q_add_advance")}
            </Button>
          )}
        </div>
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
            <fieldset disabled={figuresDisabled} className="p-5 space-y-4 min-w-0">
              <div className="space-y-1.5">
                <Label htmlFor="qb-customer">{t("sales_pick_contact")} <RequiredMark /></Label>
                {draft ? (
                  <p id="qb-customer" className="rounded-lg border bg-muted/30 px-3 py-2 text-sm font-semibold" dir="auto">{form.effectiveContactName || "—"}</p>
                ) : sortedContacts.length > 0 ? (
                  <Select value={form.selectedContactId || undefined} onValueChange={form.setSelectedContactId} disabled={figuresDisabled || !!openRequest}>
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
                    disabled={figuresDisabled}
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
            <fieldset disabled={figuresDisabled} className="p-5 space-y-4 min-w-0">
              <QuotationItemsEditor form={form} />
              <QuotationScheduleEditor form={form} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="qb-amount">{t("sales_qb_amount_net")} <RequiredMark /></Label>
                  <Input
                    id="qb-amount" type="number" min="0" step="any" inputMode="decimal" dir="ltr"
                    value={form.hasItems ? String(form.itemsTotal) : form.amount}
                    onChange={(e) => form.setAmount(e.target.value)}
                    disabled={figuresDisabled || form.hasItems}
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
                    disabled={figuresDisabled}
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
                    disabled={figuresDisabled}
                    className={DATE_INPUT_CLASS}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qb-validity">{t("sales_q_validity_days")} <RequiredMark /></Label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {VALIDITY_CHOICES.map((d) => (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={Number(form.validityDays) === d}
                        onClick={() => form.setValidityDays(String(d))}
                        disabled={figuresDisabled}
                        className={cn(
                          "h-10 rounded-lg border px-3 text-xs font-bold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                          Number(form.validityDays) === d ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        )}
                      >
                        {d}
                      </button>
                    ))}
                    <Input
                      id="qb-validity" type="number" min="1" step="1" inputMode="numeric" dir="ltr" className="h-10 w-20"
                      value={form.validityDays}
                      onChange={(e) => form.setValidityDays(e.target.value)}
                      disabled={figuresDisabled}
                      aria-describedby="qb-validity-hint"
                    />
                  </div>
                  <p id="qb-validity-hint" className="text-[11px] text-muted-foreground">{t("sales_q_validity_hint")}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qb-lead-time">{t("sales_qb_lead_time")}</Label>
                <Input id="qb-lead-time" dir="auto" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} disabled={formDisabled} aria-describedby="qb-lead-time-hint" />
                <div className="flex flex-wrap gap-1.5">
                  {[7, 21, 30].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setLeadTime(t("sales_q_lead_days", { days: d }))}
                      disabled={formDisabled}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {t("sales_q_lead_days", { days: d })}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setLeadTime(t("sales_q_lead_schedule"))}
                    disabled={formDisabled}
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {t("sales_q_lead_schedule")}
                  </button>
                </div>
                <p id="qb-lead-time-hint" className="text-[11px] text-muted-foreground">{t("sales_q_lead_hint")}</p>
              </div>
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
              {/* The logo is the owner's to set, once (QC-02). */}
              {isOrgOwner && !draft ? (
                <QuotationLogoField
                  orgId={orgId}
                  value={branding.logoUrl}
                  onChange={(url) => setBranding((b) => ({ ...b, logoUrl: url }))}
                  onUploadingChange={setLogoUploading}
                  disabled={formDisabled}
                />
              ) : null}
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Lock size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
                {t("sales_q_identity_read_only")}
              </p>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                {identityRows.map((r) => (
                  <div key={r.label}>
                    <dt className="text-[11px] text-muted-foreground">{r.label}</dt>
                    <dd className="font-semibold text-foreground" dir={r.ltr ? "ltr" : "auto"}>{r.value || "—"}</dd>
                  </div>
                ))}
              </dl>
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
