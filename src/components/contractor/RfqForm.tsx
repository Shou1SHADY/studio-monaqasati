"use client"

import { DEFAULT_RFQ_PRICING, asksForOffers, effectivePricing, firstDeadline, showsPricingChoice, step3Refusals } from "@/lib/procurement/rfq-form"
import { useState, useRef, useEffect, useMemo } from "react"
import { useRouter } from "@/i18n/routing"
import { useSearchParams } from "next/navigation"
import { useTranslations, useLocale } from 'next-intl'
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  FileText,
  MapPin,
  Paperclip,
  Zap,
  Loader2,
  Trash2,
  Upload,
  File,
  Save,
  Send,
  AlertCircle,
  Banknote,
  Globe,
  ListOrdered,
  Lock,
  Handshake,
} from "lucide-react"
import { draftRfqDescription } from "@/ai/flows/draft-rfq-description-flow"
import { useToast } from "@/hooks/use-toast"
import { linkNeed } from "@/lib/procurement/needs-writes"
import { parseNeedSource } from "@/lib/procurement/needs"
import { useFirestore, useUser, useStorage, useMemoFirebase, useCollection, useDoc } from "@/firebase"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { useProcActor } from "@/hooks/useProcActor"
import { resolvePolicies } from "@/lib/procurement/policies"
import { PROCUREMENT_SETTINGS, type ProcurementPolicies } from "@/lib/procurement/types"
import { createPurchaseOrderFromAward } from "@/lib/procurement/writes"
import { toAmount, type PricingMode } from "@/lib/procurement/offer-pricing"
import { incompleteProducts, productComplete } from "@/lib/rfq-products"
import { displayPoNumber } from "@/lib/procurement/format"
import { collection, doc, getDoc, updateDoc, query, where, arrayUnion, addDoc } from "firebase/firestore"
import { upsertCatalogItems } from "@/lib/catalog-utils"
import { notifyFavoriteSuppliersOfPublish } from "@/lib/notify-favorites"
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"
import { CITIES_BY_COUNTRY, COUNTRIES, CITIES_DISTRICTS, displayCity, displayDistrict, displayCountry } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { REQUIRE_COMPLETE_PROFILE } from "@/lib/app-env"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { ProductRowEditor, type ProductRow, makeEmptyProductRow } from "@/components/shared/ProductRowEditor"
import { SupplierRecipientsPicker, useSupplierRecipientOptions } from "@/components/contractor/SupplierRecipientsPicker"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { useProcurementPrices } from "@/hooks/useProcurementPrices"
import { useOpenNeeds } from "@/hooks/useOpenNeeds"
import { lastPaid } from "@/lib/procurement/prices"
import { addDays, supplierScore } from "@/lib/procurement/po"
import type { Need } from "@/lib/procurement/needs"
import { useSupplierDirectory } from "@/hooks/useSupplierDirectory"
import { CATEGORIES_DATA, displayCategory } from "@/lib/constants"
import { earliestNeedBy, invitableRecipients, publicReach, sourcingBlockOf, suggestRfqTitle } from "@/lib/procurement/rfq-extras"
import type { SourcingBlock } from "@/lib/procurement/supplier-file"

interface ValidationError {
  field: string
  message: string
}

function RequiredStar() {
  return <span className="text-destructive me-1">*</span>
}

/**
 * Shared RFQ creation/edit form. When `projectId` is provided, the RFQ is linked to that
 * project (the "Tender" case — project-scoped, synced into the project's `rfqIds`). When
 * omitted, the RFQ is standalone (a quick, non-project price request) — `projectId` is
 * written as `null` and no project sync happens. UI copy is identical either way.
 */
export function RfqForm({ projectId }: { projectId?: string }) {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const [step, setStep] = useState(1)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get("edit")
  const isEditing = !!editId
  const catalogParam = searchParams.get("catalog")
  // ?items=[{"name","quantity","unit"}] — free items handed over by another
  // screen (Manufacturing's purchase requests, from the RFQs list).
  const itemsParam = searchParams.get("items")
  const itemsApplied = useRef<string | null>(null)
  // ?source= — the need this RFQ answers (a work order's shortfall, a project's
  // request, a stock gap). The RFQ carries it, and the need is told which RFQ it became.
  const sourceParam = searchParams.get("source")
  const purchaseSource = useMemo(() => parseNeedSource(sourceParam), [sourceParam])
  // Several needs combined on the desk arrive as `sources=a|b|c` (P-30): every one is linked.
  const sourcesParam = searchParams.get("sources")
  const extraSources = useMemo(
    () => (sourcesParam ? sourcesParam.split("|").filter((x) => x && x !== sourceParam).map((x) => parseNeedSource(x)).filter((x): x is NonNullable<typeof x> => x !== null) : []),
    [sourcesParam, sourceParam]
  )
  const tShared = useTranslations("Portal.Shared")
  const [editRfqData, setEditRfqData] = useState<any>(null)
  const [isLoadingEdit, setIsLoadingEdit] = useState(isEditing)
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const storage = useStorage()
  const { profile, isLoading: isProfileLoading } = useResolvedProfile(isUserLoading ? null : user?.uid)

  const [visibilityMode, setVisibilityMode] = useState<"public" | "private" | "direct">("public")
  // How we ask to be quoted (PRD SS4, prototype FORMS.rfq): per line is the
  // default — the only way a multi-line RFQ can be split across suppliers and
  // an order carries a unit price; one total is the buyer's explicit choice.
  const [pricingMode, setPricingMode] = useState<PricingMode>(DEFAULT_RFQ_PRICING)
  // Which suppliers a private RFQ goes to. null means "not narrowed" — every
  // connected supplier, which is what private meant before this picker existed
  // and stays the default so an untouched form behaves exactly as it used to.
  const [privateRecipients, setPrivateRecipients] = useState<string[] | null>(null)
  // Direct award: one supplier, an agreed price, no offer round at all — the
  // RFQ is born Awarded with an accepted offer.
  const [directSupplierOrgId, setDirectSupplierOrgId] = useState("")
  // PRD 3.0: a direct award yields a purchase order awaiting approval — who
  // prepares it and the org's policies (routing, competition threshold).
  const { actor: procActor, orgId: procOrgId, orgName: procOrgName } = useProcActor(projectId)
  const policiesRef = useMemoFirebase(() => (firestore && procOrgId ? doc(firestore, PROCUREMENT_SETTINGS, procOrgId) : null), [firestore, procOrgId])
  const { data: policiesDoc } = useDoc(policiesRef)
  const policies = useMemo<ProcurementPolicies>(() => resolvePolicies(policiesDoc as Partial<ProcurementPolicies> | null), [policiesDoc])

  const connectedLinksQuery = useMemoFirebase(() => {
    if (!user || !firestore || !profile) return null
    return query(
      collection(firestore, "contractorSupplierLinks"),
      where("contractorOrgId", "==", (profile as any).organizationId || user.uid),
      where("status", "==", "active")
    )
  }, [firestore, user, profile])
  const { data: connectedLinks } = useCollection(connectedLinksQuery)

  // Who a private RFQ can be addressed to — connected suppliers plus any
  // favourite that never got a link record. See the hook for why both.
  const favoriteSupplierIds: string[] = (profile as any)?.favoriteSuppliers || []
  const supplierOptions = useSupplierRecipientOptions(
    connectedLinks as any[],
    favoriteSupplierIds,
    t("suppliers_registered_supplier")
  )
  const allRecipientIds = supplierOptions.map((o) => o.orgId)


  // ── All useState/useRef hooks MUST be declared before any early returns ──

  const [formData, setFormData] = useState({
    title: "",
    country: "SA",
    city: "",
    district: "",
    deadline: "",
    estimatedBudget: "",
    notes: "",
    pdfUrl: null as string | null,
    pdfStoragePath: null as string | null
  })

  const [products, setProducts] = useState<ProductRow[]>([makeEmptyProductRow("1")])

  // A rate needs something to multiply by, so per-line pricing is only on offer
  // while every material carries a quantity. Derived from what is typed right
  // now: emptying a quantity takes the choice away again, and the effect below
  // puts the RFQ back to a total rather than storing a mode nobody can honour.
  const canPriceLines = products.some((p) => p.category || p.quantity.trim()) && products.every((p) => toAmount(p.quantity) > 0)
  // Derived, never forced into the state: a quantity typed later brings the
  // buyer's choice back instead of leaving the RFQ on a total nobody picked.
  const storedPricing = effectivePricing(pricingMode, products.length, canPriceLines, visibilityMode)

  const [isUploadingPdf, setIsUploadingPdf] = useState(false)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  // Several PDFs (R-37); `pdfUrl` stays the first one for every older reader.
  const [attachments, setAttachments] = useState<Array<{ name: string; url: string; path: string }>>([])

  // «من الاحتياج المفتوح» (R-19): lines picked from the open needs keep their
  // need-by date and their source, per product row.
  const tp = useTranslations("Portal.Procurement")
  const procWorld = useProcurementWorld()
  const [todayDay] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
  const { history: priceHistory } = useProcurementPrices(procWorld.orgId || null)
  const openNeeds = useOpenNeeds(procWorld, !isEditing)
  const [pickedNeeds, setPickedNeeds] = useState<Record<string, Need>>({})
  // Direct award (R-17): the agreed unit price of every line, and why one
  // supplier when the total passes the no-competition cap.
  const [directLinePrices, setDirectLinePrices] = useState<Record<string, string>>({})
  const [directReason, setDirectReason] = useState<"" | "sole" | "match" | "urgent">("")
  // Who may be invited privately or awarded directly (`supplierSourcingBlock`):
  // our record over the platform profile; an unread profile is not held against him.
  const { suppliers: platformSuppliers } = useSupplierDirectory(procWorld.orgId, favoriteSupplierIds, procWorld.offers)
  const sourcingOf = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const byId = new Map(platformSuppliers.flatMap((s) => [s.orgId, ...s.memberIds].map((id) => [id, s] as const)))
    const records = new Map(procWorld.supplierRecords.map((r) => [r.supplierOrgId, r]))
    return (id: string): SourcingBlock | null => {
      const s = byId.get(id)
      return s ? sourcingBlockOf(s.record || records.get(id), { vat: s.profileVat, crExpiry: s.profileCrExpiry }, today) : sourcingBlockOf(records.get(id), undefined, today)
    }
  }, [platformSuppliers, procWorld.supplierRecords])

  /** Who the RFQ actually reaches — the explicit picks, or everyone connected
   * while the contractor has not narrowed it down; never one who may not be invited. */
  const selectedRecipients: string[] = invitableRecipients(allRecipientIds, privateRecipients, sourcingOf)

  // The private list's facts (R-37): on-time from our orders, an expired CR, and why one may not be invited.
  const supplierFacts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const bySupplier = new Map<string, typeof procWorld.orders>()
    for (const o of procWorld.orders) bySupplier.set(o.supplierOrgId, [...(bySupplier.get(o.supplierOrgId) || []), o])
    const out = new Map<string, { onTime: number | null; crExpired: boolean; block: SourcingBlock | null }>()
    const ids = new Set([...bySupplier.keys(), ...procWorld.supplierFacts.keys(), ...allRecipientIds])
    const now = new Date()
    ids.forEach((id) => {
      const cr = procWorld.supplierFacts.get(id)?.crExpiry
      const block = sourcingOf(id)
      out.set(id, { onTime: supplierScore(bySupplier.get(id) || [], procWorld.deliveries, now).onTimePercent, crExpired: block === "cr_expired" || Boolean(cr && cr < today), block })
    })
    return out
    // allRecipientIds is rebuilt every render; its ids are the dependency.
  }, [procWorld.orders, procWorld.deliveries, procWorld.supplierFacts, sourcingOf, allRecipientIds.join(",")])

  // Per-line project («يُحمَّل على مشروع»): the org's projects; a project's own form locks it.
  const formOrgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""
  const orgProjectsQuery = useMemoFirebase(() => (firestore && formOrgId ? query(collection(firestore, "projects"), where("organizationId", "==", formOrgId)) : null), [firestore, formOrgId])
  const { data: orgProjects } = useCollection(orgProjectsQuery)
  const projectChoices = useMemo(
    () => ((orgProjects || []) as Array<{ id: string; name?: string }>).map((p) => ({ value: p.id, label: p.name || p.id })).sort((a, b) => a.label.localeCompare(b.label, locale === "ar" ? "ar" : "en")),
    [orgProjects, locale]
  )
  const projectLabelOf = (id: string | null | undefined): string | null => (id ? projectChoices.find((p) => p.value === id)?.label || null : null)

  // The title follows the lines until the buyer types his own («يُقترح من المنتجات ويمكنك تعديله»).
  const tr = useTranslations("Portal.Procurement.rfqextras")
  const [titleEdited, setTitleEdited] = useState(false)
  const rowName = (p: ProductRow) => ((p.subCategory === "أخرى" ? p.otherSubCategory : p.subCategory) || p.description || p.category || "").trim()
  const suggestedTitle = suggestRfqTitle(
    products.map((p) => ({ name: rowName(p), project: projectLabelOf(projectId || p.projectId || null) })),
    { and: tr("form.title_and"), more: (count) => tr("form.title_more", { count }) }
  )
  useEffect(() => {
    if (isEditing || titleEdited || !suggestedTitle) return
    setFormData((prev) => (prev.title === suggestedTitle ? prev : { ...prev, title: suggestedTitle }))
  }, [suggestedTitle, titleEdited, isEditing])

  useEffect(() => {
    if (!editId || !firestore || !user) return
    // Wait for the profile to finish loading before validating ownership/context below.
    if (isUserLoading || isProfileLoading) return
    const loadEditData = async () => {
      try {
        const snap = await getDoc(doc(firestore, "rfqs", editId))
        if (snap.exists()) {
          const data = snap.data()

          // Ownership check: an RFQ is semi-public for `read` (suppliers browse it), but its
          // full contents (title/products/notes/PDF) must only ever populate this form for the
          // owning organization — otherwise ?edit=<any rfq id> would leak another org's data.
          const callerOrgId = (profile as any)?.organizationId || user.uid
          if (data.organizationId !== callerOrgId) {
            toast({ title: t("newrfq_toast_update_failed"), variant: "destructive" })
            router.replace("/contractor/rfqs")
            return
          }

          // Context check: this form instance must match the RFQ's actual project association
          // (project-scoped vs standalone) — otherwise saving would silently reassign it.
          const dataProjectId = data.projectId || null
          const expectedProjectId = projectId || null
          if (dataProjectId !== expectedProjectId) {
            router.replace(
              dataProjectId
                ? `/contractor/projects/${dataProjectId}/tenders/new?edit=${editId}`
                : `/contractor/rfqs/new?edit=${editId}`
            )
            return
          }

          setEditRfqData(data)
          setTitleEdited(true)
          setFormData({
            title: data.title || "",
            country: data.country || "SA",
            city: data.city || "",
            district: data.district || "",
            deadline: data.deadline || "",
            estimatedBudget: data.estimatedBudget
              ? Number(data.estimatedBudget).toLocaleString("de-DE")
              : "",
            notes: data.notes || "",
            pdfUrl: data.pdfUrl || null,
            pdfStoragePath: data.pdfStoragePath || null
          })
          setAttachments(
            Array.isArray(data.attachments) && data.attachments.length
              ? data.attachments
              : data.pdfUrl
                ? [{ name: "PDF", url: data.pdfUrl, path: data.pdfStoragePath || "" }]
                : []
          )
          setVisibilityMode(data.visibility === "private" ? "private" : "public")
          setPricingMode(data.pricingMode === "line" ? "line" : "total")
          // An empty list on an existing RFQ means it predates this picker, so
          // leave it null — "everyone connected", the rule it was saved under.
          setPrivateRecipients(Array.isArray(data.allowedSupplierOrgIds) && data.allowedSupplierOrgIds.length > 0 ? data.allowedSupplierOrgIds : null)
          if (data.products?.length) {
            setProducts(data.products.map((p: any, idx: number) => ({
              id: (idx + 1).toString(),
              quantity: String(p.quantity || ""),
              unit: p.unitOfMeasure || p.unit || "",
              description: p.description || "",
              category: p.category || "",
              subCategory: p.subCategory || "",
              requiresWarranty: !!p.requiresWarranty,
              needBy: typeof p.needBy === "string" ? p.needBy.slice(0, 10) : "",
              projectId: typeof p.projectId === "string" ? p.projectId : "",
            })))
          }
        }
      } catch (err) {
        console.error("Failed to load RFQ for editing:", err)
      } finally {
        setIsLoadingEdit(false)
      }
    }
    loadEditData()
  }, [editId, firestore, user, isUserLoading, isProfileLoading])

  // Pre-populate products from catalog selection (?catalog=id1,id2,...)
  useEffect(() => {
    if (!catalogParam || !firestore || isEditing) return
    const ids = catalogParam.split(",").filter(Boolean)
    if (ids.length === 0) return

    Promise.all(ids.map(id => getDoc(doc(firestore, "contractorCatalog", id))))
      .then(snaps => {
        type CatalogSnap = { id: string; lastQuantity?: number; unit?: string; category?: string; subCategory?: string }
        const valid: CatalogSnap[] = snaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() } as CatalogSnap))
        if (valid.length === 0) return
        setProducts(valid.map((item, idx) => ({
          id: (idx + 1).toString(),
          quantity: String(item.lastQuantity || ""),
          unit: String(item.unit || ""),
          description: "",
          category: String(item.category || ""),
          subCategory: String(item.subCategory || ""),
        })))
        toast({
          title: t("catalog_prefilled_toast"),
          description: t("catalog_prefilled_toast_desc", { count: valid.length }),
        })
      })
      .catch(console.error)
  }, [catalogParam, firestore])

  // Pre-populate free items (?items=<JSON array of {name, quantity, unit}>).
  // The category is still the buyer's pick; the name lands in the description
  // and as the "other" sub-category text. Malformed input is ignored.
  useEffect(() => {
    if (!itemsParam || isEditing || itemsApplied.current === itemsParam) return
    itemsApplied.current = itemsParam
    let parsed: unknown
    try {
      parsed = JSON.parse(itemsParam)
    } catch {
      return
    }
    if (!Array.isArray(parsed)) return
    const items = parsed
      .map((x) => {
        const o = (x && typeof x === "object" ? x : {}) as { name?: unknown; quantity?: unknown; unit?: unknown }
        const name = typeof o.name === "string" ? o.name.trim().slice(0, 200) : ""
        const quantity = typeof o.quantity === "number" && Number.isFinite(o.quantity) && o.quantity > 0 ? o.quantity : null
        const unit = typeof o.unit === "string" ? o.unit.trim().slice(0, 40) : ""
        return { name, quantity, unit }
      })
      .filter((x) => x.name)
      .slice(0, 50)
    if (items.length === 0) return
    const stamp = Date.now()
    setProducts((prev) => {
      const kept = prev.filter((p) => p.quantity.trim() || p.unit.trim() || p.description.trim() || p.category)
      return [
        ...kept,
        ...items.map((it, idx) => ({
          ...makeEmptyProductRow(`items-${stamp}-${idx}`),
          quantity: it.quantity != null ? String(it.quantity) : "",
          unit: it.unit,
          description: it.name,
          otherSubCategory: it.name,
        })),
      ]
    })
    toast({ title: tShared("mfy_rfq_items_prefilled", { count: items.length }) })
  }, [itemsParam, isEditing])

  if (isLoadingEdit) {
    return (
      <PortalLayout>
        <div className="flex justify-center items-center h-[60vh]">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      </PortalLayout>
    )
  }

  if (isUserLoading || isProfileLoading) {
    return (
      <PortalLayout>
        <div className="flex justify-center items-center h-[60vh]">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      </PortalLayout>
    )
  }

  if (REQUIRE_COMPLETE_PROFILE && profile && !profile.profileCompleted) {
    return (
      <PortalLayout>
        <div className="max-w-md mx-auto py-12 text-center space-y-6 bg-white rounded-[2rem] p-8 border border-slate-100 shadow-xl mt-12" dir={locale === "ar" ? "rtl" : "ltr"}>
          <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-amber-200">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-2xl font-black text-slate-800 font-headline">{t("newrfq_profile_incomplete")}</h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            {t("newrfq_profile_incomplete_desc")}
          </p>
          <div className="pt-4">
            <Button
              onClick={() => router.push("/contractor/profile")}
              className="w-full h-12 bg-primary hover:bg-secondary text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-xl"
            >
              {t("newrfq_go_to_profile")}
            </Button>
          </div>
        </div>
      </PortalLayout>
    )
  }

  if (profile && !profile.isVerified) {
    return (
      <PortalLayout>
        <div className="max-w-md mx-auto py-12 text-center space-y-6 bg-white rounded-[2rem] p-8 border border-slate-100 shadow-xl mt-12" dir={locale === "ar" ? "rtl" : "ltr"}>
          <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-amber-200">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-2xl font-black text-slate-800 font-headline">{t("newrfq_verification_required")}</h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            {t("newrfq_verification_required_desc")}
          </p>
          <div className="pt-4">
            <Button
              onClick={() => router.push("/contractor/profile")}
              className="w-full h-12 bg-primary hover:bg-secondary text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-xl"
            >
              {t("newrfq_go_to_profile_verify")}
            </Button>
          </div>
        </div>
      </PortalLayout>
    )
  }

  // Only NEXT_PUBLIC_-prefixed vars are inlined into the client bundle by Next.js — a plain
  // GEMINI_API_KEY/GOOGLE_API_KEY set on the server is invisible here and would never enable this.
  const isAiEnabled = !!process.env.NEXT_PUBLIC_GEMINI_API_KEY

  const syncFirstPdf = (list: Array<{ name: string; url: string; path: string }>) =>
    setFormData((prev) => ({ ...prev, pdfUrl: list[0]?.url ?? null, pdfStoragePath: list[0]?.path ?? null }))

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    if (files.some((f) => f.type !== "application/pdf")) {
      toast({ title: t("newrfq_upload_error"), variant: "destructive" })
      return
    }
    setIsUploadingPdf(true)
    try {
      if (!storage) throw new Error("Storage not initialized")
      const added: Array<{ name: string; url: string; path: string }> = []
      for (const file of files) {
        const storagePath = `rfqs/pdfs/${Date.now()}-${file.name}`
        const fileRef = ref(storage, storagePath)
        await uploadBytes(fileRef, file)
        added.push({ name: file.name, url: await getDownloadURL(fileRef), path: storagePath })
      }
      setAttachments((prev) => {
        const next = [...prev, ...added]
        syncFirstPdf(next)
        return next
      })
      toast({ title: t("newrfq_upload_success"), description: t("newrfq_upload_success_desc") })
    } catch (error) {
      console.error("PDF upload failed:", error)
      toast({ title: t("newrfq_incomplete_data"), description: t("newrfq_upload_failed"), variant: "destructive" })
    } finally {
      setIsUploadingPdf(false)
      if (pdfInputRef.current) pdfInputRef.current.value = ""
    }
  }

  const removePdf = async (path: string) => {
    if (path && storage) {
      try {
        await deleteObject(ref(storage, path))
      } catch (error) {
        console.warn("Could not delete PDF from storage:", error)
      }
    }
    setAttachments((prev) => {
      const next = prev.filter((a) => a.path !== path)
      syncFirstPdf(next)
      return next
    })
  }

  // ── Open needs, direct prices, the deadline's warning ──
  const productName = (p: ProductRow) => ((p.subCategory === "أخرى" ? p.otherSubCategory : p.subCategory) || p.category || p.description || "").trim()
  const pickNeed = (n: Need) => {
    const stamp = Date.now()
    const rows = n.lines.map((l, idx) => ({ ...makeEmptyProductRow(`need-${stamp}-${idx}`), quantity: String(l.quantity), unit: l.unit, description: l.name, otherSubCategory: l.name, needBy: n.needBy?.slice(0, 10) || "", projectId: n.projectId || "" }))
    setProducts((prev) => [...prev.filter((p) => p.quantity.trim() || p.unit.trim() || p.description.trim() || p.category), ...rows])
    setPickedNeeds((prev) => ({ ...prev, ...Object.fromEntries(rows.map((r) => [r.id, n])) }))
  }
  const liveNeeds = Object.entries(pickedNeeds).filter(([rowId]) => products.some((p) => p.id === rowId))
  const pickedKeys = new Set(liveNeeds.map(([, n]) => n.key))
  const needChoices = openNeeds.filter((n) => !pickedKeys.has(n.key) && (!purchaseSource || JSON.stringify(n.source) !== JSON.stringify(purchaseSource))).slice(0, 8)
  const needByOf = (rowId: string) => products.find((p) => p.id === rowId)?.needBy || pickedNeeds[rowId]?.needBy || null
  const earliestNeed = earliestNeedBy([...liveNeeds.map(([, n]) => ({ needBy: n.needBy })), ...products.filter(productComplete)])
  const lineProjectOf = (p: ProductRow): string | null => projectId || p.projectId || null
  const latestDeadline = earliestNeed ? addDays(earliestNeed, -policies.awardCycleDays) : null
  const directTotal = products.filter(productComplete).reduce((sum, p) => sum + toAmount(p.quantity) * (Number(directLinePrices[p.id]) || 0), 0)
  const directOverCap = directTotal > policies.directPurchaseCap

  const clearError = (field: string) => {
    setValidationErrors(prev => prev.filter(e => e.field !== field))
  }

  const titleToSave = formData.title.trim() || suggestedTitle

  const validateStep1 = (draft = false): ValidationError[] => {
    const errors: ValidationError[] = []

    if (!formData.title.trim() && !(draft && suggestedTitle)) {
      errors.push({ field: "title", message: t("newrfq_val_title_required") })
    }

    if (!products.some(productComplete)) {
      errors.push({ field: "products", message: t("newrfq_val_product_required") })
    } else if (incompleteProducts(products).length) {
      errors.push({ field: "products", message: t("newrfq_val_product_incomplete") })
    }

    return errors
  }

  // Step 2 (notes + attachments) is entirely optional, so it has no validator —
  // `nextStep` waves it through.
  const validateStep3 = (): ValidationError[] => {
    const errors: ValidationError[] = []

    // A direct award has no offer round: no deadline is asked (prototype FORMS.rfq).
    for (const refusal of step3Refusals({ city: formData.city, deadline: formData.deadline, audience: visibilityMode, today: todayDay })) {
      if (refusal === "city") errors.push({ field: "city", message: t("newrfq_val_city_required") })
      if (refusal === "deadline") errors.push({ field: "deadline", message: t("newrfq_val_deadline_required") })
      if (refusal === "deadline_past") errors.push({ field: "deadline", message: tp("rfqx.form.deadline_after_today") })
    }

    // A private RFQ addressed to nobody is invisible to every supplier —
    // publishing it would look like success and then produce silence.
    if (visibilityMode === "private" && supplierOptions.length > 0 && selectedRecipients.length === 0) {
      errors.push({ field: "rfq-recipients", message: t("newrfq_val_recipients_required") })
    }

    return errors
  }

  const showErrors = (errors: ValidationError[]) => {
    setValidationErrors(errors)
    if (errors.length > 0) {
      const firstError = errors[0]
      const fieldElement = document.getElementById(firstError.field)
      if (fieldElement) {
        fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }

      toast({
        title: t("newrfq_incomplete_data"),
        description: errors[0].message,
        variant: "destructive"
      })
    }
  }

  const nextStep = () => {
    const errors = step === 1 ? validateStep1() : []

    if (errors.length > 0) {
      showErrors(errors)
      return
    }

    setValidationErrors([])
    setStep(s => s + 1)
  }

  const prevStep = () => {
    setStep(s => s - 1)
    setValidationErrors([])
  }

  const handleAiDraft = async () => {
    clearError("title")
    const firstProduct = products[0]
    if (!formData.title || !firstProduct?.category) {
      toast({
        title: t("newrfq_incomplete_data"),
        description: t("newrfq_ai_not_available_desc"),
        variant: "destructive"
      })
      return
    }

    setIsGenerating(true)
    try {
      const result = await draftRfqDescription({
        keywords: formData.title,
        category: firstProduct.category,
        quantity: Number(firstProduct.quantity) || 1,
        unit: firstProduct.unit || "عدد",
        notes: formData.notes
      })

      setTitleEdited(true)
      setFormData(prev => ({
        ...prev,
        title: result.title,
        notes: result.description
      }))

      toast({
        title: t("newrfq_ai_enhanced"),
        description: t("newrfq_ai_enhanced_desc"),
      })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('API key') || errorMessage.includes('GEMINI_API_KEY') || errorMessage.includes('GOOGLE_API_KEY')) {
        toast({
          title: t("newrfq_ai_not_available"),
          description: t("newrfq_ai_not_available_desc"),
          variant: "destructive"
        })
      } else {
        toast({
          title: t("newrfq_incomplete_data"),
          description: t("newrfq_ai_draft_failed"),
          variant: "destructive"
        })
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSubmit = async (status: "Draft" | "New" = "New") => {
    if (!firestore || !user) return

    // Full validation — a draft needs only its lines (prototype `draftOk`): it reaches no supplier yet.
    const draft = status === "Draft"
    const step1Errors = validateStep1(draft)
    const step3Errors = draft ? [] : validateStep3()
    const allErrors = [...step1Errors, ...step3Errors]

    if (allErrors.length > 0) {
      // If we are at step 1 but there are errors in step 2 (shouldn't happen often)
      // or if we are at step 2 and there are errors in step 1.
      showErrors(allErrors)
      return
    }

    const validProducts = products.filter(productComplete)

    if (visibilityMode === "direct" && !isEditing) {
      if (status === "Draft") {
        toast({ title: t("newrfq_direct_no_draft"), variant: "destructive" })
        return
      }
      if (!directSupplierOrgId || validProducts.some((p) => !(Number(directLinePrices[p.id]) > 0))) {
        toast({ title: t("newrfq_direct_missing"), description: tp("rfqpo.form.direct_prices_required"), variant: "destructive" })
        return
      }
      if (directOverCap && !directReason) {
        toast({ title: tp("rfqpo.form.direct_reason_required"), variant: "destructive" })
        return
      }
      const block = sourcingOf(directSupplierOrgId)
      if (block) {
        toast({ title: tr("form.direct_blocked", { reason: tr(`sourcing.${block}`) }), variant: "destructive" })
        return
      }
      if (new Set(validProducts.map(p => p.category)).size > 1) {
        // Multi-category submissions split into several RFQs — one agreed price
        // can't be divided across them, so a direct award stays single-category.
        toast({ title: t("newrfq_direct_multi_category"), variant: "destructive" })
        return
      }
    }

    setIsSubmitting(true)

    const redirectTarget = projectId ? `/contractor/projects/${projectId}?tab=rfqs` : "/contractor/rfqs"

    if (isEditing && editId) {
      // Edit mode: update the single existing RFQ. projectId is intentionally NOT included here —
      // it's immutable after creation (reassigning between projects/standalone is not supported).
      const rfqData: any = {
        title: titleToSave,
        category: validProducts[0]?.category || editRfqData?.category || "",
        subCategory: validProducts.every(p => p.subCategory === validProducts[0].subCategory)
          ? (validProducts[0].subCategory === "أخرى" ? validProducts[0].otherSubCategory : validProducts[0].subCategory)
          : "متعدد",
        products: validProducts.map(p => ({
          // No standalone "product name" field — the category/subcategory pick is the name,
          // matching how the app already treats them as the canonical (Arabic) product label elsewhere.
          name: (p.subCategory === "أخرى" ? p.otherSubCategory : p.subCategory) || p.category,
          quantity: Number(p.quantity),
          unitOfMeasure: p.unit,
          description: p.description,
          category: p.category,
          subCategory: p.subCategory === "أخرى" ? p.otherSubCategory : p.subCategory,
          requiresWarranty: !!p.requiresWarranty,
          ...(needByOf(p.id) ? { needBy: needByOf(p.id) } : {}),
          ...(lineProjectOf(p) ? { projectId: lineProjectOf(p), projectName: projectLabelOf(lineProjectOf(p)) } : {}),
        })),
        deadline: formData.deadline,
        estimatedBudget: formData.estimatedBudget
          ? Number(formData.estimatedBudget.replace(/\./g, ""))
          : null,
        country: formData.country,
        city: formData.city,
        district: formData.district,
        notes: formData.notes,
        pdfUrl: formData.pdfUrl,
        pdfStoragePath: formData.pdfStoragePath,
        attachments,
        status: status,
        pricingMode: storedPricing,
        visibility: visibilityMode,
        allowedSupplierOrgIds: visibilityMode === "private" ? [...selectedRecipients] : [],
        orderedFromMdmakDirect: false,
        requiresWarranty: validProducts.some(p => p.requiresWarranty),
        updatedAt: new Date().toISOString()
      }

      try {
        await updateDoc(doc(firestore, "rfqs", editId), rfqData)
        if (status === "New") void notifyFavoriteSuppliersOfPublish(user, [editId])
        toast({
          title: t("newrfq_toast_updated"),
          description: t("newrfq_toast_updated_desc"),
        })
        router.push(redirectTarget)
      } catch {
        toast({
          title: t("newrfq_toast_update_failed"),
          variant: "destructive"
        })
      }
      setIsSubmitting(false)
      return
    }

    // Create mode: group products by category and create separate RFQs (project-scoped or standalone)
    const rfqsRef = collection(firestore, "rfqs")

    // Group products by their main category
    const groupedProducts = validProducts.reduce((acc, product) => {
      const cat = product.category
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(product)
      return acc
    }, {} as Record<string, typeof validProducts>)

    const categories = Object.keys(groupedProducts)
    const createdRfqIds: string[] = []
    let creationFailed = false

    for (const cat of categories) {
      const catProducts = groupedProducts[cat]
      const rfqTitle = categories.length > 1 ? `${titleToSave} - ${cat}` : titleToSave

      const rfqData = {
        contractorId: user.uid,
        organizationId: profile?.organizationId || user.uid, // Fallback to UID if orgId not present
        projectId: projectId || null,
        title: rfqTitle,
        category: cat,
        // If there's only one product or all products share the same subcategory, use it. Otherwise, leave empty.
        subCategory: catProducts.every(p => p.subCategory === catProducts[0].subCategory)
          ? (catProducts[0].subCategory === "أخرى" ? catProducts[0].otherSubCategory : catProducts[0].subCategory)
          : "متعدد",
        products: catProducts.map(p => ({
          // No standalone "product name" field — the category/subcategory pick is the name,
          // matching how the app already treats them as the canonical (Arabic) product label elsewhere.
          name: (p.subCategory === "أخرى" ? p.otherSubCategory : p.subCategory) || p.category,
          quantity: Number(p.quantity),
          unitOfMeasure: p.unit,
          description: p.description,
          category: p.category,
          subCategory: p.subCategory === "أخرى" ? p.otherSubCategory : p.subCategory,
          requiresWarranty: !!p.requiresWarranty,
          ...(needByOf(p.id) ? { needBy: needByOf(p.id) } : {}),
          ...(lineProjectOf(p) ? { projectId: lineProjectOf(p), projectName: projectLabelOf(lineProjectOf(p)) } : {}),
        })),
        ...(catProducts.some((p) => needByOf(p.id)) ? { needBy: catProducts.map((p) => needByOf(p.id)).filter((d): d is string => Boolean(d)).sort()[0] } : {}),
        ...(catProducts.some((p) => pickedNeeds[p.id]) ? { needSources: Array.from(new Map(catProducts.filter((p) => pickedNeeds[p.id]).map((p) => [pickedNeeds[p.id].key, pickedNeeds[p.id].source])).values()) } : {}),
        attachments,
        deadline: asksForOffers(visibilityMode) ? formData.deadline : null,
        estimatedBudget: asksForOffers(visibilityMode) && formData.estimatedBudget
          ? Number(formData.estimatedBudget.replace(/\./g, ""))
          : null,
        country: formData.country,
        city: formData.city,
        district: formData.district,
        notes: formData.notes,
        pdfUrl: formData.pdfUrl,
        pdfStoragePath: formData.pdfStoragePath,
        status: visibilityMode === "direct" ? "Awarded" : status,
        pricingMode: storedPricing,
        visibility: visibilityMode === "direct" ? "private" : visibilityMode,
        allowedSupplierOrgIds:
          visibilityMode === "direct" ? [directSupplierOrgId]
          : visibilityMode === "private" ? [...selectedRecipients]
          : [],
        ...(visibilityMode === "direct" ? { directAward: true, awardedAt: new Date().toISOString() } : {}),
        orderedFromMdmakDirect: false,
        requiresWarranty: catProducts.some(p => p.requiresWarranty),
        createdByUserId: user.uid,
        createdByUserName: profile?.name || user.email || "عضو الفريق",
        createdAt: new Date().toISOString()
      }

      // Keep the project's rfqIds list in sync so the projects list card's tender count stays accurate.
      // Awaited (not fire-and-forget) so a failed write is caught before we tell the user it worked.
      // Skipped entirely for standalone RFQs (no project to sync into).
      try {
        const catNeeds = Array.from(new Map(catProducts.filter((p) => pickedNeeds[p.id]).map((p) => [pickedNeeds[p.id].key, pickedNeeds[p.id]])).values())
        const source = purchaseSource ?? (catNeeds.length === 1 ? catNeeds[0].source : null)
        const ref = await addDoc(rfqsRef, source ? { ...rfqData, purchaseSource: source } : rfqData)
        createdRfqIds.push(ref.id)
        // Each picked need is told which RFQ it became (its own home records it).
        for (const n of catNeeds) {
          try {
            await linkNeed(firestore, n.source, { rfqId: ref.id, rfqNumber: null }, (profile as { name?: string } | null)?.name || user?.email || "")
          } catch (linkErr) {
            console.error("need ↔ RFQ link failed:", linkErr)
          }
        }
        if (purchaseSource && createdRfqIds.length === 1) {
          try {
            await linkNeed(firestore, purchaseSource, { rfqId: ref.id, rfqNumber: (rfqData as { rfqNumber?: string }).rfqNumber ?? null }, (profile as { name?: string } | null)?.name || user?.email || "")
          } catch (linkErr) {
            // The RFQ exists; only the back-reference failed — Purchasing can still see both.
            console.error("purchase request ↔ RFQ link failed:", linkErr)
          }
          for (const extra of extraSources) {
            try {
              await linkNeed(firestore, extra, { rfqId: ref.id, rfqNumber: (rfqData as { rfqNumber?: string }).rfqNumber ?? null }, (profile as { name?: string } | null)?.name || user?.email || "")
            } catch (linkErr) {
              console.error("combined need ↔ RFQ link failed:", linkErr)
            }
          }
        }
        if (projectId) {
          await updateDoc(doc(firestore, "projects", projectId), { rfqIds: arrayUnion(ref.id) })
        }
      } catch (err) {
        console.error(err)
        creationFailed = true
        break
      }
    }

    if (creationFailed) {
      toast({
        title: t("newrfq_toast_create_failed"),
        description: createdRfqIds.length > 0
          ? t("newrfq_toast_create_partial_desc", { count: createdRfqIds.length, total: categories.length })
          : t("newrfq_toast_create_failed_desc"),
        variant: "destructive",
      })
      setIsSubmitting(false)
      return
    }

    if (status === "Draft") {
      toast({
        title: t("newrfq_toast_saved"),
        description: t("newrfq_toast_saved_desc"),
      })
      setFormData({
        title: "",
        country: "SA",
        city: "",
        district: "",
        deadline: "",
        estimatedBudget: "",
        notes: "",
        pdfUrl: null,
        pdfStoragePath: null
      })
      setAttachments([])
      setPickedNeeds({})
      setTitleEdited(false)
      setProducts([{ id: "1", quantity: "", unit: "", description: "", category: "", subCategory: "" }])
      setStep(1)
      setIsSubmitting(false)
    } else if (visibilityMode === "direct") {
      // Born awarded: the accepted offer, the chat, and the supplier's
      // notification are created here — the same end-state the accept flow in
      // RfqOffersView produces, minus the offer round.
      const rfqId = createdRfqIds[0]
      const rfqTitle = titleToSave
      let directOffer: { id: string; price: string; supplierId: string; organizationId: string; supplierName: string } | null = null
      try {
        const supplierOption = supplierOptions.find((o) => o.orgId === directSupplierOrgId)
        const supplierName = supplierOption?.name || ""
        // The picked id is an ORG id; the notification inbox needs a USER id —
        // a primary org's id IS its owner's uid, a secondary org names its owner.
        let supplierUserId = directSupplierOrgId
        const supplierUserSnap = await getDoc(doc(firestore, "users", directSupplierOrgId))
        if (!supplierUserSnap.exists()) {
          const orgSnap = await getDoc(doc(firestore, "organizations", directSupplierOrgId))
          supplierUserId = (orgSnap.data()?.ownerUserId as string) || directSupplierOrgId
        }
        const contractorOrgId = (profile as Record<string, string>)?.organizationId || user.uid
        const price = String(Math.round(directTotal * 100) / 100)

        const offerRef = await addDoc(collection(firestore, "offers"), {
          directAward: true,
          supplierId: supplierUserId,
          organizationId: directSupplierOrgId,
          supplierName,
          companyName: supplierName,
          submittedByUserId: user.uid,
          submittedByUserName: profile?.name || user.email || "",
          rfqId,
          rfqTitle,
          projectId: projectId || null,
          contractorId: user.uid,
          contractorOrgId,
          price,
          lines: validProducts.map((p, idx) => ({ rfqProductIndex: idx, unitPrice: Number(directLinePrices[p.id]) })),
          deliveryLocation: formData.city,
          deliveryBatches: [{ location: formData.city, deliveryDate: formData.deadline, price, quantity: "" }],
          status: "مقبول",
          // Internal until Finance approves its purchase order and it is
          // sent: no chat and no notice now (22 Sep review, `awardDisclosed`).
          awaitingOrderApproval: true,
          decidedByUserId: user.uid,
          decidedByUserName: profile?.name || user.email || "",
          decidedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        })
        directOffer = { id: offerRef.id, price, supplierId: supplierUserId, organizationId: directSupplierOrgId, supplierName }
      } catch (err) {
        console.error("Direct award post-create failed:", err)
        toast({ title: t("newrfq_direct_partial_error"), variant: "destructive" })
        setIsSubmitting(false)
        return
      }

      // PRD 3.0: the purchase order over the direct award, born awaiting
      // approval (basis `direct` — the writes read it off `rfq.directAward`).
      // The award above stands whatever happens here; a missing order is
      // raised later from the accepted offer's card.
      let orderNumber: string | null = null
      if (directOffer) {
        try {
          const contractorOrgId = (profile as Record<string, string>)?.organizationId || user.uid
          const created = await createPurchaseOrderFromAward(
            firestore,
            procActor,
            {
              rfq: {
                id: rfqId,
                title: rfqTitle,
                organizationId: contractorOrgId,
                contractorId: user.uid,
                projectId: projectId || null,
                category: categories[0] || null,
                city: formData.city,
                directAward: true,
                products: groupedProducts[categories[0]]?.map((p) => ({ name: (p.subCategory === "أخرى" ? p.otherSubCategory : p.subCategory) || p.category, quantity: Number(p.quantity), unitOfMeasure: p.unit })) || null,
                purchaseSource: purchaseSource ?? null,
              },
              offer: { ...directOffer, directAward: true, companyName: directOffer.supplierName, deliveryLocation: formData.city, status: "مقبول", lines: validProducts.map((p, idx) => ({ rfqProductIndex: idx, unitPrice: Number(directLinePrices[p.id]) })) },
              offers: [{ ...directOffer, status: "مقبول" }],
              awardReason: directReason ? { code: "other", text: tp(`rfqpo.form.direct_reason_${directReason}`) } : null,
              policies,
            },
            { copy: tShared, locale: locale === "en" ? "en" : "ar", orgName: procOrgName || null }
          )
          orderNumber = created.docNumber
        } catch (err) {
          console.error("purchase order not created after direct award:", (err as { code?: string })?.code || err)
        }
      }

      toast({
        title: t("newrfq_direct_success"),
        description: orderNumber ? t("newrfq_direct_success_order", { number: displayPoNumber(orderNumber, locale) }) : t("newrfq_direct_success_no_order"),
      })
      router.push(redirectTarget)
    } else {
      // Update recurring-items catalog — fire and forget, doesn't block the success flow
      const orgId = (profile as Record<string, string>)?.organizationId || user.uid
      upsertCatalogItems(firestore, user.uid, orgId, validProducts).catch(console.error)
      void notifyFavoriteSuppliersOfPublish(user, createdRfqIds)

      toast({
        title: t("newrfq_toast_published"),
        description: t("newrfq_toast_published_desc"),
      })
      router.push(redirectTarget)
    }
  }

  const hasError = (field: string) => validationErrors.some(e => e.field === field)

  return (
    <PortalLayout>
      <div className="max-w-4xl mx-auto py-8 text-start">
        <div className="mb-8">
          <h1 className="text-3xl font-black text-foreground font-headline">{isEditing ? t("newrfq_edit_title") : t("newrfq_page_title")}</h1>
          <p className="text-muted-foreground mt-2">{isEditing ? t("newrfq_edit_desc") : t("newrfq_page_desc")}</p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 mb-8">
          {[
            { step: 1, label: t("newrfq_step_request_details"), icon: FileText },
            { step: 2, label: t("newrfq_step_notes_files"), icon: Paperclip },
            { step: 3, label: t("newrfq_step_location_date"), icon: MapPin },
          ].map(({ step: s, label, icon: Icon }, idx) => (
            <div key={s} className="flex items-center">
              <button
                onClick={() => step >= s && setStep(s)}
                disabled={step < s}
                aria-current={step === s ? "step" : undefined}
                className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  step === s
                    ? "bg-primary text-white shadow-lg shadow-primary/25 cursor-pointer"
                    : step > s
                      ? "bg-success/10 text-success border border-success/20 cursor-pointer hover:bg-success/20"
                      : "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                }`}
              >
                {step > s ? <CheckCircle2 size={20} /> : <Icon size={20} />}
                <span className="font-bold text-xs sm:text-sm">{label}</span>
              </button>
              {idx < 2 && (
                locale === 'ar' ? <ChevronLeft size={20} className="mx-1 sm:mx-2 text-slate-300" /> : <ChevronRight size={20} className="mx-1 sm:mx-2 text-slate-300" />
              )}
            </div>
          ))}
        </div>

        {validationErrors.length > 0 && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-start gap-3">
            <AlertCircle className="text-destructive shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <p className="font-bold text-destructive text-sm">{t("newrfq_errors_title")}</p>
              <ul className="mt-2 space-y-1 text-sm text-destructive/80">
                {validationErrors.map((error, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                    {error.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <Card className="shadow-xl border-0 overflow-hidden">
          <CardContent className="p-0">
            {step === 1 && (
              <div className="p-8 space-y-8">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-bold text-slate-700">
                      {t("newrfq_tender_title")}<RequiredStar />
                    </Label>
                    {isAiEnabled && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAiDraft}
                        disabled={isGenerating}
                        className={`text-xs h-8 gap-2 border border-amber-400 bg-amber-50 text-amber-700 rounded-lg transition-all duration-200 ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:bg-amber-500 hover:text-white hover:border-amber-500 cursor-pointer'}`}
                      >
                        <Zap size={14} className={isGenerating ? "animate-pulse" : ""} />
                        {t("newrfq_ai_enhance")}
                      </Button>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="title"
                      placeholder={t("newrfq_tender_title_placeholder")}
                      value={formData.title}
                      onChange={e => {
                        setFormData({ ...formData, title: e.target.value })
                        setTitleEdited(e.target.value.trim() !== "")
                        clearError("title")
                      }}
                      className={`h-12 text-lg border-slate-200 focus:border-primary focus:ring-primary/20 rounded-xl ${hasError("title") ? 'border-destructive ring-1 ring-destructive' : ''}`}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{tr("form.title_help")}</p>
                </div>

                <div className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

                <div>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <FileText size={20} className="text-primary" />
                      </div>
                      <div>
                        <Label className="text-lg font-bold text-slate-800">
                          {t("newrfq_requested_products")}<RequiredStar />
                        </Label>
                        <p className="text-xs text-slate-500 mt-0.5">{t("newrfq_products_help")}</p>
                      </div>
                    </div>
                  </div>
                  {hasError("products") && (
                    <div className="mb-4 p-3 bg-destructive/5 border border-destructive/20 rounded-lg text-sm text-destructive flex items-center gap-2">
                      <AlertCircle size={16} />
                      {validationErrors.find(e => e.field === "products")?.message}
                    </div>
                  )}
                  <ProductRowEditor
                    rows={products}
                    onChange={setProducts}
                    locale={locale}
                    t={t}
                    onFieldTouched={(id, field) => clearError(`product_${id}_${field}`)}
                    lineExtras={{
                      projects: projectChoices,
                      lockedProjectLabel: projectId ? projectLabelOf(projectId) || tr("form.this_project") : null,
                      minNeedBy: todayDay,
                      copy: { needBy: tr("form.need_by"), project: tr("form.line_project"), general: tr("form.general_stock"), search: tr("form.search_project"), none: t("newrfq_no_results") },
                    }}
                  />
                  {liveNeeds.length > 0 && (
                    <ul className="mt-3 space-y-1 rounded-xl border bg-muted/30 p-3 text-xs">
                      {liveNeeds.map(([rowId, n]) => (
                        <li key={rowId} className="text-muted-foreground" dir="auto">
                          <span className="font-semibold text-foreground">{products.find((p) => p.id === rowId)?.description}</span> · {n.refLabel}
                          {n.context ? ` · ${n.context}` : ""}
                          {n.needBy ? ` · ${tp("rfqpo.form.needed_by", { date: n.needBy })}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  {!isEditing && needChoices.length > 0 && (
                    <div className="mt-5 space-y-2">
                      <p className="text-sm font-bold text-foreground">{tp("rfqpo.form.from_needs")}</p>
                      <div className="flex flex-wrap gap-2">
                        {needChoices.map((n) => (
                          <button
                            key={n.key}
                            type="button"
                            onClick={() => pickNeed(n)}
                            className="rounded-full border border-dashed border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            ＋ {n.lines.map((l) => `${l.name} ${l.quantity.toLocaleString("en-US")} ${l.unit}`).join("، ")}
                            {n.needBy ? ` · ${tp("rfqpo.form.needed_by", { date: n.needBy })}` : ""}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">{tp("rfqpo.form.from_needs_hint")}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Notes and attachments — optional, and previously the tail of step 1,
                where they stretched the first screen past the point anyone scrolled.
                On their own step the required work (title + products) fits without
                scrolling and this stays skippable. */}
            {step === 2 && (
              <div className="p-8 space-y-8">
                <div className="space-y-4 p-6 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  <Label className="text-base font-bold text-slate-700">{t("newrfq_additional_notes")}</Label>
                  <Textarea
                    rows={3}
                    placeholder={t("newrfq_notes_placeholder")}
                    value={formData.notes}
                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                    className="rounded-xl border-slate-200 bg-white"
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-blue-50 flex items-center justify-center">
                      <FileText size={18} className="text-blue-600" />
                    </div>
                    <Label className="text-base font-bold text-slate-700">{t("newrfq_pdf_files")}</Label>
                  </div>
                  {attachments.map((a) => (
                    <div key={a.path || a.url} className="flex items-center gap-4 rounded-2xl border border-cta/20 bg-cta/5 p-4">
                      <File size={20} className="shrink-0 text-cta" aria-hidden="true" />
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground hover:underline" dir="auto">
                        {a.name}
                      </a>
                      <Button variant="ghost" size="sm" onClick={() => removePdf(a.path)} className="rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={tp("rfqpo.form.remove_file")}>
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  ))}
                  <div className="relative">
                    <input
                      ref={pdfInputRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      multiple
                      onChange={handlePdfUpload}
                      disabled={isUploadingPdf}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                      aria-label={t("newrfq_click_upload_pdf")}
                    />
                    <div className="group flex h-28 cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-muted/30 text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5">
                      {isUploadingPdf ? (
                        <Loader2 size={24} className="animate-spin text-primary" />
                      ) : (
                        <>
                          <Upload size={20} className="text-muted-foreground transition-colors group-hover:text-primary" />
                          <div className="text-start">
                            <span className="block text-sm font-semibold text-foreground">{t("newrfq_click_upload_pdf")}</span>
                            <span className="text-xs text-muted-foreground">{tp("rfqpo.form.pdf_many")}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="p-8 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">
                      {t("newrfq_country_label")}<RequiredStar />
                    </Label>
                    <SearchableSelect
                      value={formData.country}
                      onChange={v => {
                        setFormData({ ...formData, country: v, city: "", district: "" })
                        clearError("city")
                      }}
                      options={COUNTRIES.map(c => ({ value: c.value, label: displayCountry(c.value, locale) }))}
                      placeholder={t("newrfq_select_country")}
                      searchPlaceholder={t("newrfq_search_country")}
                      noResultsText={t("newrfq_no_results")}
                    />
                  </div>
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">
                      {t("newrfq_city_label")}<RequiredStar />
                    </Label>
                    <SearchableSelect
                      value={formData.city}
                      onChange={v => {
                        setFormData({ ...formData, city: v, district: "" })
                        clearError("city")
                      }}
                      options={(CITIES_BY_COUNTRY[formData.country] || []).map(city => ({ value: city, label: displayCity(city, locale) }))}
                      placeholder={t("newrfq_select_city")}
                      searchPlaceholder={t("newrfq_search_city")}
                      noResultsText={t("newrfq_no_results")}
                      error={hasError("city")}
                    />
                  </div>
                  {formData.city && CITIES_DISTRICTS[formData.city] && (
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold text-slate-700">
                        {t("newrfq_district_label")}
                      </Label>
                      <SearchableSelect
                        value={formData.district}
                        onChange={v => {
                          setFormData({ ...formData, district: v })
                          clearError("district")
                        }}
                        options={CITIES_DISTRICTS[formData.city].map(dist => ({ value: dist, label: displayDistrict(dist, locale) }))}
                        placeholder={t("newrfq_select_district")}
                        searchPlaceholder={t("newrfq_search_district")}
                        noResultsText={t("newrfq_no_results")}
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-4 p-6 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-amber-50 flex items-center justify-center">
                      <MapPin size={18} className="text-amber-600" />
                    </div>
                    <div>
                      <Label className="text-base font-bold text-slate-700">{t("newrfq_supply_info")}</Label>
                      <p className="text-xs text-slate-500 mt-0.5">{t("newrfq_supply_info_help")}</p>
                    </div>
                  </div>
                  <div className="p-4 bg-amber-50/50 rounded-xl border border-amber-200/50">
                    <p className="text-sm text-amber-800 flex items-center gap-2">
                      <AlertCircle size={16} className="shrink-0" />
                      <span>{t("newrfq_supply_info_note")}</span>
                    </p>
                  </div>
                </div>

                {asksForOffers(visibilityMode) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">
                      {t("newrfq_deadline_label")}<RequiredStar />
                    </Label>
                    <input
                      type="date"
                      id="deadline"
                      value={formData.deadline}
                      onChange={e => {
                        setFormData({ ...formData, deadline: e.target.value })
                        clearError("deadline")
                      }}
                      className={`flex h-12 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm cursor-pointer ${hasError("deadline") ? 'border-destructive ring-1 ring-destructive' : ''}`}
                      dir="ltr"
                      min={firstDeadline(todayDay)}
                    />
                    {formData.deadline && (
                      <p className="text-xs text-muted-foreground">
                        {t("newrfq_deadline_display", { date: new Date(formData.deadline).toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) })}
                      </p>
                    )}
                    {formData.deadline && latestDeadline && formData.deadline > latestDeadline ? (
                      <p className="text-xs font-semibold text-destructive">{tp("rfqpo.form.deadline_misses", { date: latestDeadline })}</p>
                    ) : policies.sealOffersUntilDeadline ? (
                      <p className="text-xs text-muted-foreground">{tp("rfqpo.form.sealed_until")}</p>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700">
                      {t("newrfq_estimated_budget")}
                    </Label>
                    <Input
                      inputMode="numeric"
                      placeholder={t("newrfq_estimated_budget_placeholder")}
                      value={formData.estimatedBudget}
                      onChange={e => {
                        const digits = e.target.value.replace(/\D/g, "")
                        const formatted = digits ? Number(digits).toLocaleString("de-DE") : ""
                        setFormData({ ...formData, estimatedBudget: formatted })
                      }}
                      className="h-12 rounded-xl border-slate-200"
                      dir="ltr"
                    />
                    <p className="text-xs text-muted-foreground">{tp("rfqpo.form.budget_hint")}</p>
                  </div>
                </div>
                )}

                {/* Visibility mode */}
                {/* How to be quoted (PRD SS4): one figure, or a rate per material.
                    Per line is what gives an order real unit prices — and so a price
                    history, a drift report and an estimate to route the next need on.
                    Offered only when every material has a quantity to multiply by. */}
                {showsPricingChoice(products.length, visibilityMode) && (
                <div className="p-5 rounded-2xl border bg-muted/40 border-border">
                  <p className="text-sm font-bold text-foreground mb-3">{t("newrfq_pricing_label")}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {([
                      { mode: "total" as const, icon: Banknote, label: t("newrfq_pricing_total") },
                      { mode: "line" as const, icon: ListOrdered, label: t("newrfq_pricing_line") },
                    ]).map(({ mode, icon: Icon, label }) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={mode === "line" && !canPriceLines}
                        onClick={() => setPricingMode(mode)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-bold transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
                          storedPricing === mode
                            ? "bg-primary text-white border-primary shadow-sm"
                            : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                        )}
                      >
                        <Icon size={16} className="shrink-0" />
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                    {storedPricing === "line" ? t("newrfq_pricing_line_desc") : t("newrfq_pricing_total_desc")}
                  </p>
                  {!canPriceLines && (
                    <p className="text-xs text-amber-700 mt-2 flex items-center gap-1.5 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200 w-fit">
                      <AlertCircle size={11} className="shrink-0" />
                      {t("newrfq_pricing_needs_quantities")}
                    </p>
                  )}
                </div>
                )}

                <div className={cn(
                  "p-5 rounded-2xl border transition-all duration-200",
                  visibilityMode !== "public" ? "bg-primary/5 border-primary/20" : "bg-muted/40 border-border"
                )}>
                  <p className="text-sm font-bold text-foreground mb-3">{t("newrfq_visibility_label")}</p>

                  <div className={cn("grid grid-cols-1 gap-2", isEditing ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
                    {([
                      { mode: "public" as const, icon: Globe, label: t("newrfq_visibility_public") },
                      { mode: "private" as const, icon: Lock, label: t("newrfq_visibility_private") },
                      // A direct award can only be BORN — turning an existing open
                      // tender into one would orphan submitted offers.
                      ...(isEditing ? [] : [{ mode: "direct" as const, icon: Handshake, label: t("newrfq_visibility_direct") }]),
                    ]).map(({ mode, icon: Icon, label }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setVisibilityMode(mode)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-bold transition-all cursor-pointer",
                          visibilityMode === mode
                            ? "bg-primary text-white border-primary shadow-sm"
                            : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                        )}
                      >
                        <Icon size={16} className="shrink-0" />
                        {label}
                      </button>
                    ))}
                  </div>

                  <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                    {visibilityMode === "direct"
                      ? t("newrfq_visibility_direct_desc")
                      : visibilityMode === "private"
                        ? t("newrfq_visibility_private_desc")
                        : t("newrfq_visibility_public_desc")}
                  </p>
                  {visibilityMode === "public" && (
                    <p className="mt-2 text-xs text-cta">
                      {tr("form.public_reach", {
                        count: publicReach(platformSuppliers, products.map((p) => p.category), CATEGORIES_DATA).length,
                        cats: Array.from(new Set(products.map((p) => p.category).filter(Boolean))).map((c) => displayCategory(c, locale)).join(locale === "ar" ? "، " : ", ") || "—",
                      })}
                    </p>
                  )}

                  {visibilityMode !== "public" && supplierOptions.length === 0 && (
                    <p className="text-xs text-amber-700 mt-2 flex items-center gap-1.5 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200 w-fit">
                      <AlertCircle size={11} className="shrink-0" />
                      {t("newrfq_visibility_no_suppliers")}
                    </p>
                  )}

                  {visibilityMode === "direct" && supplierOptions.length > 0 && (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>{t("newrfq_direct_supplier_label")} *</Label>
                        <SearchableSelect
                          value={directSupplierOrgId}
                          onChange={setDirectSupplierOrgId}
                          options={supplierOptions.map((o) => {
                            const block = sourcingOf(o.orgId)
                            return { value: o.orgId, label: `${o.name}${o.isFavorite ? " ★" : ""}${block ? ` — ${tr(`sourcing.${block}`)}` : ""}` }
                          })}
                          placeholder={t("newrfq_direct_supplier_label")}
                          searchPlaceholder={t("newrfq_direct_supplier_label")}
                          noResultsText={t("newrfq_visibility_no_suppliers")}
                          size="md"
                        />
                        {directSupplierOrgId && sourcingOf(directSupplierOrgId) && (
                          <p className="text-xs font-semibold text-destructive">{tr(`sourcing.${sourcingOf(directSupplierOrgId)}`)}</p>
                        )}
                      </div>
                    </div>
                  )}
                  {visibilityMode === "direct" && supplierOptions.length > 0 && (
                    <div className="mt-4 space-y-3">
                      <div className="overflow-hidden rounded-xl border bg-card">
                        <p className="border-b bg-muted/40 px-3 py-2 text-xs font-bold">{tp("rfqpo.form.direct_unit_price")}</p>
                        {products.filter(productComplete).map((p) => {
                          const last = lastPaid(priceHistory, productName(p), p.unit)
                          return (
                            <div key={p.id} className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0">
                              <div className="min-w-0 text-sm">
                                <p className="truncate font-semibold" dir="auto">
                                  {productName(p)}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  <span dir="ltr">{toAmount(p.quantity).toLocaleString("en-US")}</span> {p.unit}
                                  {last ? ` · ${tp("rfqpo.form.last_price", { price: last.price.toLocaleString("en-US") })}` : ""}
                                </p>
                              </div>
                              <Input
                                inputMode="decimal"
                                dir="ltr"
                                aria-label={`${tp("rfqpo.form.direct_unit_price")} — ${productName(p)}`}
                                className="h-9 w-28 shrink-0 rounded-lg tabular-nums"
                                value={directLinePrices[p.id] || ""}
                                onChange={(e) => setDirectLinePrices((prev) => ({ ...prev, [p.id]: e.target.value.replace(/[^\d.]/g, "") }))}
                              />
                            </div>
                          )
                        })}
                        <div className="flex items-center justify-between bg-muted/30 px-3 py-2 text-sm font-bold">
                          <span>{tp("rfqpo.form.total")}</span>
                          <span dir="ltr" className="tabular-nums">
                            {directTotal.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                      {directOverCap && (
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-warning">{tp("rfqpo.form.direct_over_cap", { cap: policies.directPurchaseCap.toLocaleString("en-US") })}</p>
                          <div className="flex flex-wrap gap-2" role="radiogroup">
                            {(["sole", "match", "urgent"] as const).map((r) => (
                              <button
                                key={r}
                                type="button"
                                role="radio"
                                aria-checked={directReason === r}
                                onClick={() => setDirectReason(r)}
                                className={cn(
                                  "rounded-full border px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                  directReason === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                                )}
                              >
                                {tp(`rfqpo.form.direct_reason_${r}`)}
                              </button>
                            ))}
                          </div>
                          <p className="text-[11px] text-muted-foreground">{tp("rfqpo.form.direct_reason_hint")}</p>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Addressing a private RFQ. Defaults to every connected
                      supplier, so the contractor who does not care keeps the
                      old one-click behaviour, while the one who does can send
                      to a couple of trusted names instead of the whole list. */}
                  {visibilityMode === "private" && (
                    <SupplierRecipientsPicker
                      className="mt-4"
                      options={supplierOptions}
                      selected={selectedRecipients}
                      onChange={setPrivateRecipients}
                      facts={supplierFacts}
                    />
                  )}
                  {visibilityMode === "private" && <p className="mt-2 text-xs text-muted-foreground">{tp("rfqpo.form.guest_link_after")}</p>}
                </div>

                <ul className="space-y-1 rounded-xl bg-muted/50 p-4 text-xs text-muted-foreground">
                  {(visibilityMode === "direct" ? ["direct_1", "direct_2"] : ["publish_1", "publish_2", "publish_3"]).map((k) => (
                    <li key={k}>• {tp(`rfqpo.form.effect_${k}`, { count: visibilityMode === "private" ? selectedRecipients.length : visibilityMode === "public" ? publicReach(platformSuppliers, products.map((p) => p.category), CATEGORIES_DATA).length : 0 })}</li>
                  ))}
                </ul>
              </div>
            )}

          </CardContent>

          <div className="flex items-center justify-between border-t bg-slate-50/50 p-6">
            <Button
              variant="outline"
              onClick={prevStep}
              disabled={step === 1 || isSubmitting}
              className={`gap-2 px-6 rounded-xl bg-white hover:bg-slate-100 hover:text-slate-700 border border-slate-300 text-slate-700 ${step === 1 || isSubmitting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              {locale === 'ar' ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              {t("newrfq_prev")}
            </Button>

            {step < 3 ? (
              <div className="flex gap-3 flex-wrap justify-end">
                {visibilityMode !== "direct" && products.some(productComplete) && (!isEditing || editRfqData?.status === "Draft") && (
                  <Button
                    onClick={() => handleSubmit("Draft")}
                    disabled={isSubmitting}
                    variant="outline"
                    className="gap-2 px-6 rounded-xl"
                  >
                    {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                    {t("newrfq_save_draft")}
                  </Button>
                )}
                <Button onClick={nextStep} className="gap-2 px-8 rounded-xl cursor-pointer shadow-lg shadow-primary/25">
                  {t("newrfq_next")}
                  {locale === 'ar' ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
                </Button>
              </div>
            ) : (
              <div className="flex gap-3 flex-wrap">
                <Button
                  onClick={() => handleSubmit("Draft")}
                  disabled={isSubmitting}
                  variant="outline"
                  className={`gap-2 px-8 rounded-xl ${isSubmitting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                >
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                  {t("newrfq_save_draft")}
                </Button>
                <Button
                  onClick={() => handleSubmit("New")}
                  disabled={isSubmitting}
                  className={`bg-success hover:bg-success/90 gap-2 px-10 rounded-xl shadow-lg shadow-success/25 ${isSubmitting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                >
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                  {visibilityMode === "direct" ? tp("rfqx.form.submit_direct") : t("newrfq_publish_now")}
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </PortalLayout>
  )
}
