"use client"

// «طلب عروض أسعار جديد» (Procurement 1.5 — PUR-02, PUR-03): rows, not cards; the same
// three steps as the incoming request's panel — المواد · النشر · المراجعة — and «انشر»
// only on the review. ONE RFQ as written, every category on it; per-line pricing never
// changes by itself; after publishing, the number and the guest link in one panel.
// The draft saves itself (no «حفظ كمسودة») and spends no RFQ number until published.
//
// Kept from the form it replaces: the default unit, the suggested title, the AI-free
// attachments/notes, the internal budget the supplier never sees, payment terms,
// «يُحمَّل على مشروع» as the group's place, the warranty flag (row menu), private
// recipients with their facts, the direct award with its order, the needs' back-links.

import { displayNeedRef } from "@/lib/procurement/format"
import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { addDoc, arrayUnion, collection, doc, getDoc, getDocs, limit, query, setDoc, updateDoc, where } from "firebase/firestore"
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage"
import { ArrowLeft, ArrowRight, ClipboardPaste, Inbox, Loader2, Send } from "lucide-react"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useStorage, useUser } from "@/firebase"
import { useRouter } from "@/i18n/routing"
import { useToast } from "@/hooks/use-toast"
import { useModules } from "@/hooks/useCompanyModules"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { useOpenNeeds } from "@/hooks/useOpenNeeds"
import { useSupplierDirectory } from "@/hooks/useSupplierDirectory"
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { WizardSteps } from "@/components/module-ui/WizardSteps"
import { Callout } from "@/components/module-ui/Callout"
import { useSupplierRecipientOptions } from "@/components/contractor/SupplierRecipientsPicker"
import { InviteSupplierDialog } from "@/components/procurement/InviteSupplierDialog"
import { termRowsOf } from "@/components/procurement/rfq/RfqTermsPicker"
import { guestLinkUrl } from "@/components/procurement/rfq/guestLinkUrl"
import { displayCity } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { reachBySub, extendPool, invitableRecipients, sourcingBlockOf } from "@/lib/procurement/rfq-extras"
import { type InvitationDoc } from "@/components/procurement/SupplierInvitations"
import { needLastOrderDay } from "@/lib/procurement/need-desk"
import { supplierInvitationsQuery } from "@/lib/procurement/invite-query"
import { profileVatMark, type SourcingBlock } from "@/lib/procurement/supplier-file"
import { createRfqWithNumber, updateRfqNumbered } from "@/lib/procurement/rfq-writes"
import { createPurchaseOrderFromAward } from "@/lib/procurement/writes"
import { linkNeed } from "@/lib/procurement/needs-writes"
import { rfqTermsToStore, termsRefusal } from "@/lib/procurement/terms-freeze"
import { supplierScore } from "@/lib/procurement/po"
import { displayDocNumber, displayPoNumber, fmtDayLong } from "@/lib/procurement/format"
import { PROCUREMENT_SETTINGS } from "@/lib/procurement/types"
import { deliverySites, siteLine, storedSites, projectSiteId } from "@/lib/procurement/delivery-sites"
import { notifyFavoriteSuppliersOfPublish } from "@/lib/notify-favorites"
import { upsertCatalogItems } from "@/lib/catalog-utils"
import { label } from "@/lib/materials/tree"
import { toAmount } from "@/lib/procurement/offer-pricing"
import {
  addRequests,
  blankLine,
  groupsFromRfq,
  rfqEditRefusal,
  rfqIdentityOf,
  groupsMeta,
  incomingFromNeed,
  lineComplete,
  lineStarted,
  linesFromPaste,
  materialsProblems,
  newGroup,
  numberedLines,
  parsePaste,
  partialRequestKeys,
  requestKeysIn,
  reviewFacts,
  rfqLinesDoc,
  rfqPlace,
  suggestTitle,
  type EditorGroup,
} from "@/lib/procurement/rfq-editor"
import { EditorMaterials } from "./EditorMaterials"
import { EditorPublish, type PublishValues } from "./EditorPublish"
import { EditorReview, type ReviewModel } from "./EditorReview"
import { RfqPublishedPanel } from "./RfqPublishedPanel"
import { parseNeedSource, type Need } from "@/lib/procurement/needs"

type Rec = Record<string, unknown>
type Step = 1 | 2 | 3

const todayDay = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const plusDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)

export function RfqEditor({
  projectId,
  requestKeys,
  variant = "page",
  startStep = 2,
  onClose,
}: {
  projectId?: string
  /** The incoming request(s) the panel opens on (PUR-01 «انشره»). */
  requestKeys?: string[]
  /** `panel`: the incoming request's own panel — step 1 is the request as asked, no draft, «جهّزه» opens the editor. */
  variant?: "page" | "panel"
  /** The panel opens on the publishing step («انشره») or on the request itself (a press on its row). */
  startStep?: 1 | 2
  onClose?: () => void
}) {
  const panel = variant === "panel"
  const t = useTranslations("Portal.ProcEditor")
  const tShared = useTranslations("Portal.Shared")
  const tr = useTranslations("Portal.Procurement.rfqextras")
  const tp = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const router = useRouter()
  const params = useSearchParams()
  const { toast } = useToast()
  const firestore = useFirestore()
  const storage = useStorage()
  const { user, isUserLoading } = useUser()
  const { profile } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const { on } = useModules()
  const pmOn = on("project-management")
  const world = useProcurementWorld()
  const orgId = world.orgId || (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""
  const { index } = useMaterialTree()
  const fmtDay = (d: string) => fmtDayLong(d, locale)
  const editId = params.get("edit")

  // ── The company's facts ──────────────────────────────────────────────────
  const settingsRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, PROCUREMENT_SETTINGS, orgId) : null), [firestore, orgId])
  const { data: settingsDoc } = useDoc(settingsRef)
  const projectsQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: projects } = useCollection(projectsQ)
  const warehousesQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: warehouses } = useCollection(warehousesQ)
  const sites = useMemo(
    () =>
      deliverySites({
        stored: storedSites((settingsDoc as Rec | null)?.deliverySites),
        warehouses: (warehouses || []) as Rec[] as Array<{ id: string; name?: string }>,
        projects: (projects || []) as Rec[] as Array<{ id: string; name?: string }>,
        pmOn,
      }),
    [settingsDoc, warehouses, projects, pmOn],
  )
  const projectName = (id: string) => ((projects || []) as Array<{ id: string; name?: string }>).find((p) => p.id === id)?.name || null

  const linksQ = useMemoFirebase(
    () => (firestore && orgId ? query(collection(firestore, "contractorSupplierLinks"), where("contractorOrgId", "==", orgId), where("status", "==", "active")) : null),
    [firestore, orgId],
  )
  const { data: links } = useCollection(linksQ)
  const favoriteIds: string[] = ((profile as Rec | null)?.favoriteSuppliers as string[] | undefined) || []
  const recipientOptions = useSupplierRecipientOptions(links as Rec[] as Array<{ supplierOrgId?: string; supplierName?: string }>, favoriteIds, tShared("supplier_fallback_name"))
  const { suppliers: platform } = useSupplierDirectory(world.orgId, favoriteIds, world.offers)
  const sourcingOf = useMemo(() => {
    const today = todayDay()
    const byId = new Map(platform.flatMap((s) => [s.orgId, ...s.memberIds].map((id) => [id, s] as const)))
    const records = new Map(world.supplierRecords.map((r) => [r.supplierOrgId, r]))
    return (id: string): SourcingBlock | null => {
      const s = byId.get(id)
      return s ? sourcingBlockOf(s.record || records.get(id), { vat: profileVatMark(s), crExpiry: s.profileCrExpiry }, today) : sourcingBlockOf(records.get(id), undefined, today)
    }
  }, [platform, world.supplierRecords])
  const recipientFacts = useMemo(() => {
    const out = new Map<string, { onTime: number | null; crExpired: boolean; block: SourcingBlock | null; unverified: boolean }>()
    const now = new Date()
    for (const o of recipientOptions) {
      const block = sourcingOf(o.orgId)
      out.set(o.orgId, {
        onTime: supplierScore(
          world.orders.filter((x) => x.supplierOrgId === o.orgId),
          world.deliveries,
          now,
        ).onTimePercent,
        crExpired: block === "cr_expired",
        block: block === "unverified" ? null : block,
        unverified: block === "unverified",
      })
    }
    return out
  }, [recipientOptions, sourcingOf, world.orders, world.deliveries])

  const openNeeds = useOpenNeeds(world, true)
  const invitationsQ = useMemoFirebase(() => (firestore && orgId && !isUserLoading ? supplierInvitationsQuery(firestore, orgId) : null), [firestore, orgId, isUserLoading])
  const { data: invitationDocs } = useCollection<Omit<InvitationDoc, "id">>(invitationsQ)
  const invitations = useMemo(() => ((invitationDocs || []) as InvitationDoc[]).filter((i) => i.type === "supplier_invite"), [invitationDocs])
  const lastOrderOf = useMemo(() => (n: Need) => needLastOrderDay(n, { orders: world.orders, policies: world.policies }), [world.orders, world.policies])

  // ── The editor's state ───────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1)
  const [groups, setGroups] = useState<EditorGroup[]>(() => [newGroup()])
  const [values, setValues] = useState<PublishValues>(() => ({
    audience: "public",
    deadline: "",
    pricing: "line",
    title: "",
    terms: termRowsOf(null),
    termsSet: false,
    notes: "",
    budget: "",
    attachments: [],
    recipients: null,
    directSupplierOrgId: "",
    directPrices: {},
    directReason: "",
  }))
  const [titleEdited, setTitleEdited] = useState(false)
  const [showProblems, setShowProblems] = useState(false)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [editingLive, setEditingLive] = useState(false)
  // An RFQ opened to edit keeps its project and its author (never the editor's, never null).
  const identity = useRef<ReturnType<typeof rfqIdentityOf> | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState("")
  const [pickOpen, setPickOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [done, setDone] = useState<{ id: string; number: string; guestUrl: string | null; reached: number; closesOn: string | null; direct: boolean; po: string | null } | null>(null)
  const [loaded, setLoaded] = useState(!editId)

  // The place of a project's own form is fixed.
  useEffect(() => {
    if (!projectId || editId) return
    setGroups((gs) => (gs.some((g) => g.projectId === projectId) ? gs : [newGroup({ projectId, siteId: projectSiteId(projectId), label: projectName(projectId) || "" })]))
  }, [projectId, editId])
  // A project group learns its city once the sites are read.
  useEffect(() => {
    setGroups((gs) =>
      gs.map((g) => {
        if (g.city || !g.siteId) return g
        const s = sites.find((x) => x.id === g.siteId)
        return s && (s.city || s.name !== g.label) ? { ...g, city: s.city || g.city, district: s.district || g.district, label: g.label || s.name } : g
      }),
    )
  }, [sites])

  // The deadline: today + the settings' window (PUR-01 p.3 «اليوم + 3 أيام، من الإعدادات»).
  useEffect(() => {
    setValues((v) => (v.deadline ? v : { ...v, deadline: plusDays(todayDay(), Math.max(1, world.policies.rfqWindowDays || 3)) }))
  }, [world.policies.rfqWindowDays])

  // ── Opened on a draft or an RFQ to edit ──────────────────────────────────
  useEffect(() => {
    if (!editId || !firestore || !orgId || loaded) return
    void (async () => {
      const snap = await getDoc(doc(firestore, "rfqs", editId))
      const data = snap.data() as Rec | undefined
      if (!data || data.organizationId !== orgId) {
        toast({ title: t("err_not_yours"), variant: "destructive" })
        router.replace("/contractor/rfqs")
        return
      }
      const offers = data.status === "New" ? (await getDocs(query(collection(firestore, "offers"), where("rfqId", "==", editId), limit(1))).catch(() => null))?.size ?? 1 : 0
      const refusal = rfqEditRefusal(data as { status?: string; offersCount?: number }, offers)
      if (refusal) {
        toast({ title: t(refusal === "has_offers" ? "err_edit_has_offers" : "err_edit_closed"), variant: "destructive" })
        router.replace(`/contractor/rfqs/${editId}/offers`)
        return
      }
      identity.current = rfqIdentityOf(data)
      setGroups(groupsFromRfq(data))
      setTitleEdited(true)
      setValues((v) => ({
        ...v,
        audience: data.visibility === "private" ? "private" : "public",
        deadline: typeof data.deadline === "string" ? data.deadline : v.deadline,
        pricing: data.pricingMode === "total" ? "total" : "line",
        title: String(data.title || ""),
        terms: termRowsOf(data.paymentTermsList as never),
        termsSet: Array.isArray(data.paymentTermsList) && data.paymentTermsList.length > 0,
        notes: String(data.notes || ""),
        budget: data.estimatedBudget ? String(data.estimatedBudget) : "",
        attachments: Array.isArray(data.attachments) ? (data.attachments as PublishValues["attachments"]) : [],
        recipients: Array.isArray(data.allowedSupplierOrgIds) && data.allowedSupplierOrgIds.length ? (data.allowedSupplierOrgIds as string[]) : null,
      }))
      if (data.status === "Draft") setDraftId(editId)
      else setEditingLive(true)
      setLoaded(true)
    })()
  }, [editId, firestore, orgId, loaded, router, t, toast])

  // ── Filled from the incoming requests (?requests= from «جهّزه», ?sources= from the desk) ──
  const prefilled = useRef(false)
  useEffect(() => {
    if (prefilled.current || editId) return
    const keys = requestKeys?.length ? requestKeys : (params.get("requests") || "").split("|").filter(Boolean)
    const sources = [params.get("source"), ...(params.get("sources") || "").split("|")].filter(Boolean) as string[]
    if (!keys.length && !sources.length) return
    if (!openNeeds.length) return
    const hits = openNeeds.filter((n) => keys.includes(n.key) || sources.some((s) => JSON.stringify(n.source) === JSON.stringify(parseNeedSource(s))))
    if (!hits.length) return
    prefilled.current = true
    const next = addRequests([newGroup()], hits.map((n) => incomingFromNeed(n, sites, lastOrderOf(n))))
    setGroups((gs) => (panel ? next : addRequests(gs, hits.map((n) => incomingFromNeed(n, sites, lastOrderOf(n))))))
    // «انشره» opens on the publishing step — unless a material still lacks its sub-category, or the place its city:
    // then on the request, the lacking row coloured from the start (PUR-01 p.4). A press on the row opens the request itself.
    if (panel) {
      const lacking = materialsProblems(next).length > 0
      setShowProblems(lacking)
      if (!lacking) setStep(startStep)
    }
  }, [openNeeds, params, sites, editId, requestKeys, panel, startStep, lastOrderOf])
  // ?items=[{name, quantity, unit}] (the workshop's shortfalls, the catalogue)
  useEffect(() => {
    const raw = params.get("items")
    if (!raw || editId || prefilled.current) return
    try {
      const items = (JSON.parse(raw) as Array<{ name?: string; quantity?: number; unit?: string }>).filter((x) => x && x.name).slice(0, 50)
      if (!items.length) return
      prefilled.current = true
      setGroups((gs) => {
        const first = gs[0] || newGroup()
        const lines = items.map((it) => ({
          ...blankLine(),
          name: String(it.name).slice(0, 200),
          quantity: it.quantity ? String(it.quantity) : "",
          unit: String(it.unit || "").slice(0, 40),
          unitFromSource: !!it.unit,
        }))
        return [{ ...first, lines: [...first.lines.filter(lineStarted), ...lines] }, ...gs.slice(1)]
      })
    } catch {
      /* malformed: ignored */
    }
  }, [params, editId])

  // ?catalog=id1,id2 (the contractor's catalogue of recurring items): its words, unit and last quantity.
  useEffect(() => {
    const raw = params.get("catalog")
    if (!raw || editId || prefilled.current || !firestore) return
    prefilled.current = true
    void Promise.all(
      raw
        .split(",")
        .filter(Boolean)
        .slice(0, 50)
        .map((id) => getDoc(doc(firestore, "contractorCatalog", id))),
    )
      .then((snaps) => {
        const lines = snaps
          .filter((s) => s.exists())
          .map((s) => s.data() as { name?: string; unit?: string; lastQuantity?: number })
          .map((it) => ({ ...blankLine(), name: String(it.name || ""), quantity: it.lastQuantity ? String(it.lastQuantity) : "", unit: String(it.unit || ""), unitFromSource: !!it.unit }))
          .filter((l) => l.name)
        if (lines.length) setGroups((gs) => [{ ...gs[0], lines: [...gs[0].lines.filter(lineStarted), ...lines] }, ...gs.slice(1)])
      })
      .catch(() => undefined)
  }, [params, editId, firestore])

  // The BOQ item of each row of an incoming request, read once for the panel's first step (PUR-01 p.3).
  const [boq, setBoq] = useState<Record<string, string>>({})
  const boqWanted = useMemo(() => (panel ? Array.from(new Set(groups.flatMap((g) => (g.projectId ? g.lines.flatMap((l) => (l.boqItemId ? [`${g.projectId}/${l.boqItemId}`] : [])) : [])))) : []), [groups, panel])
  useEffect(() => {
    const todo = boqWanted.filter((k) => !(k in boq))
    if (!firestore || !todo.length) return
    void Promise.all(
      todo.map(async (k) => {
        const [pid, iid] = k.split("/")
        const snap = await getDoc(doc(firestore, "projects", pid, "boqItems", iid)).catch(() => null)
        const d = snap?.data() as { itemNo?: string | number | null; code?: string | null; description?: string | null; descriptionAr?: string | null } | undefined
        return [k, [String(d?.itemNo ?? d?.code ?? "").trim(), String(d?.description ?? d?.descriptionAr ?? "").trim()].filter(Boolean).join(" · ")] as const
      }),
    ).then((entries) => setBoq((prev) => ({ ...prev, ...Object.fromEntries(entries) })))
  }, [boqWanted, boq, firestore])

  // ── Derived ──────────────────────────────────────────────────────────────
  const problems = materialsProblems(groups)
  const complete = numberedLines(groups).filter((r) => lineComplete(r.line))
  const suggested = suggestTitle(groups, { and: tr("form.title_and"), more: (count) => tr("form.title_more", { count }) })
  const title = (titleEdited ? values.title : suggested) || suggested
  useEffect(() => {
    if (!titleEdited && suggested !== values.title) setValues((v) => ({ ...v, title: suggested }))
  }, [suggested, titleEdited, values.title])

  const linesDoc = useMemo(() => rfqLinesDoc(groups, locale, projectName), [groups, locale, projects])
  const reach = useMemo(() => reachBySub(platform, linesDoc.subCategoryIds), [platform, linesDoc.subCategoryIds])
  const favouriteReached = reach.distinct.find((s) => favoriteIds.includes(s.orgId))?.name || null
  // An unverified supplier — one who joined through our invitation — may be picked in «خاص» (PUR-05), with his tag;
  // he is never ticked for us, and an expired CR still blocks him.
  const privateBlockOf = (id: string): SourcingBlock | null => {
    const block = sourcingOf(id)
    return block === "unverified" ? null : block
  }
  const selectedRecipients = invitableRecipients(
    recipientOptions.map((o) => o.orgId),
    values.recipients,
    values.recipients === null ? sourcingOf : privateBlockOf,
  )
  const directPool = extendPool(
    recipientOptions.map((o) => ({ orgId: o.orgId, name: o.name, isFavorite: o.isFavorite })),
    platform,
    linesDoc.categories,
    [],
    {},
    linesDoc.subCategoryIds,
  )
  const directLines = complete.map((r) => ({ key: r.line.key, name: r.line.name, quantity: toAmount(r.line.quantity), unit: r.line.unit }))
  const directTotal = directLines.reduce((s, l) => s + l.quantity * (Number(values.directPrices[l.key]) || 0), 0)
  const directOverCap = directTotal > world.policies.directPurchaseCap
  const firstDeadline = todayDay()
  const facts = reviewFacts(groups, index)
  const place = rfqPlace(groups)
  const newRequests = openNeeds.filter((n) => !requestKeysIn(groups).has(n.key))

  const publishProblems = (): string[] => {
    const out: string[] = []
    if (values.audience !== "direct" && (!values.deadline || values.deadline < firstDeadline)) out.push("deadline")
    if (values.audience === "private" && !selectedRecipients.length) out.push("recipients")
    if (values.audience === "direct") {
      if (!values.directSupplierOrgId) out.push("direct_supplier")
      if (directLines.some((l) => !(Number(values.directPrices[l.key]) > 0))) out.push("direct_prices")
      if (directOverCap && !values.directReason) out.push("direct_reason")
      if (values.directSupplierOrgId && sourcingOf(values.directSupplierOrgId)) out.push("direct_blocked")
    }
    if (termsRefusal(values.terms)) out.push("terms")
    return out
  }

  // A draft opened to be published (?step=review) lands on the review; an unfinished one shows what lacks.
  const reviewOpened = useRef(false)
  useEffect(() => {
    if (reviewOpened.current || !editId || !loaded || params.get("step") !== "review") return
    reviewOpened.current = true
    if (problems.length) {
      setShowProblems(true)
      setStep(1)
    } else if (publishProblems().length) {
      setShowProblems(true)
      setStep(2)
    } else setStep(3)
  })

  // ── The document ─────────────────────────────────────────────────────────
  const rfqDoc = (status: "Draft" | "New" | "Awarded"): Rec => {
    const d = rfqLinesDoc(groups, locale, projectName, { draft: status === "Draft", perLine: status === "Draft" ? undefined : partialRequestKeys(groups) })
    const needSources = Array.from(
      new Map(d.products.filter((p) => "needSource" in p && p.needSource).map((p) => [JSON.stringify((p as { needSource: unknown }).needSource), (p as { needSource: unknown }).needSource])).values(),
    )
    const needBy = d.products
      .map((p) => (p as { needBy?: string }).needBy)
      .filter((x): x is string => !!x)
      .sort()[0]
    const direct = values.audience === "direct"
    const kept = identity.current
    return {
      contractorId: kept?.contractorId || user?.uid || "",
      organizationId: orgId,
      projectId: projectId || kept?.projectId || null,
      projectIds: Array.from(new Set(d.products.map((p) => (p as { projectId?: string }).projectId).filter(Boolean))),
      title: title || t("untitled"),
      ...d,
      editorGroups: groupsMeta(groups),
      materialTree: true,
      ...(needBy ? { needBy } : {}),
      ...(needSources.length ? { needSources } : {}),
      ...(needSources.length === 1 ? { purchaseSource: needSources[0] } : {}),
      country: "SA",
      city: place.city,
      district: place.district,
      multiPlace: place.multi,
      cities: place.cities,
      deadline: direct ? null : values.deadline,
      estimatedBudget: !direct && values.budget ? toAmount(values.budget) : null,
      notes: values.notes,
      attachments: values.attachments,
      pdfUrl: values.attachments[0]?.url || null,
      pdfStoragePath: values.attachments[0]?.path || null,
      status,
      pricingMode: direct ? "line" : complete.length > 1 ? values.pricing : "line",
      visibility: direct ? "private" : values.audience,
      allowedSupplierOrgIds: direct ? [values.directSupplierOrgId] : values.audience === "private" ? selectedRecipients : [],
      ...(direct ? { directAward: true, awardedAt: new Date().toISOString() } : {}),
      orderedFromMdmakDirect: false,
      requiresWarranty: d.products.some((p) => p.requiresWarranty),
      paymentTermsList: rfqTermsToStore(values.terms, values.termsSet),
      createdByUserId: kept?.createdByUserId || user?.uid || "",
      createdByUserName: kept?.createdByUserName || (profile as { name?: string } | null)?.name || user?.email || "",
      updatedAt: new Date().toISOString(),
    }
  }

  // ── The draft saves itself ───────────────────────────────────────────────
  const dirty = useRef(false)
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    dirty.current = true
  }, [groups, values])
  useEffect(() => {
    if (!firestore || !user || !orgId || panel || editingLive || done || !loaded || values.audience === "direct") return
    if (!numberedLines(groups).length || !dirty.current) return
    const timer = window.setTimeout(async () => {
      try {
        const data = rfqDoc("Draft")
        if (draftId) await updateDoc(doc(firestore, "rfqs", draftId), data as Record<string, never>)
        else {
          const r = doc(collection(firestore, "rfqs"))
          await setDoc(r, { ...data, createdAt: new Date().toISOString() })
          setDraftId(r.id)
        }
        dirty.current = false
        setSavedAt(Date.now())
      } catch (err) {
        console.warn("draft not saved:", (err as { code?: string })?.code || err)
      }
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [groups, values, firestore, user, orgId, draftId, editingLive, done, loaded])

  // ── Attachments ──────────────────────────────────────────────────────────
  const upload = async (files: File[]) => {
    if (!storage || !files.length) return
    if (files.some((f) => f.type !== "application/pdf")) {
      toast({ title: t("err_pdf_only"), variant: "destructive" })
      return
    }
    setUploading(true)
    try {
      const added: PublishValues["attachments"] = []
      for (const f of files) {
        const path = `rfqs/pdfs/${Date.now()}-${f.name}`
        const r = ref(storage, path)
        await uploadBytes(r, f)
        added.push({ name: f.name, url: await getDownloadURL(r), path })
      }
      setValues((v) => ({ ...v, attachments: [...v.attachments, ...added] }))
    } catch {
      toast({ title: t("err_upload"), variant: "destructive" })
    } finally {
      setUploading(false)
    }
  }
  const removeAttachment = async (path: string) => {
    if (storage && path) await deleteObject(ref(storage, path)).catch(() => undefined)
    setValues((v) => ({ ...v, attachments: v.attachments.filter((a) => a.path !== path) }))
  }

  // ── Steps ────────────────────────────────────────────────────────────────
  const next = () => {
    if (step === 1) {
      if (problems.length) {
        setShowProblems(true)
        const first = problems[0]
        toast({ title: t("err_step1"), description: t(`err_${first.code}`, { no: first.no ?? "" }), variant: "destructive" })
        return
      }
      setShowProblems(false)
      setStep(2)
    } else if (step === 2) {
      const p = publishProblems()
      if (p.length) {
        setShowProblems(true)
        toast({ title: t("err_step2"), description: t(`err_${p[0]}`), variant: "destructive" })
        return
      }
      setShowProblems(false)
      setStep(3)
    }
  }

  const reviewModel: ReviewModel = {
    lines: facts.lines,
    subs: facts.subs,
    groups: facts.groups,
    audience: values.audience,
    reach: reach.distinct.length,
    favourite: favouriteReached,
    perSub: reach.perSub.map((s) => ({ name: index?.byId.get(s.subId) ? label(index.byId.get(s.subId)!, locale) : s.subId, count: s.count })),
    privateCount: selectedRecipients.length,
    directName: directPool.find((p) => p.orgId === values.directSupplierOrgId)?.name || null,
    deadline: values.audience === "direct" ? null : values.deadline,
    daysToDeadline: values.deadline ? daysBetween(todayDay(), values.deadline) : null,
    pricing: values.pricing,
    terms: values.termsSet ? values.terms.map((r) => t("terms_row", { pct: r.pct, days: r.days })).join(" + ") : t("terms_offer"),
    delivery: place.multi
      ? t("delivery_each", { city: place.city ? displayCity(place.city, locale) : "—" })
      : groups
          .filter((g) => g.lines.some(lineComplete))
          .map((g) => `${g.label || t("group_unnamed")} · ${siteLine(g, (c) => displayCity(c, locale))}`)
          .join(" ؛ "),
    noSpec: facts.noSpec,
    outside: facts.outside,
    unitDiffers: facts.unitDiffers,
  }

  // ── Publish («انشر», from the review only) ───────────────────────────────
  const publish = async () => {
    if (!firestore || !user || publishing) return
    if (problems.length || publishProblems().length) return
    setPublishing(true)
    const direct = values.audience === "direct"
    const status = direct ? "Awarded" : "New"
    const data = rfqDoc(status)
    try {
      let id: string
      let number: string
      if (editingLive && editId) {
        number = (await updateRfqNumbered(firestore, editId, data)) || ""
        id = editId
      } else if (draftId) {
        number = (await updateRfqNumbered(firestore, draftId, { ...data, publishedAt: new Date().toISOString() })) || ""
        id = draftId
      } else {
        const r = await createRfqWithNumber(firestore, { ...data, organizationId: orgId, createdAt: new Date().toISOString() })
        id = r.id
        number = r.rfqNumber
      }
      // Each request a row came from is told which RFQ it became (it reads the state back, PUR-01 p.5).
      const byName = (profile as { name?: string } | null)?.name || user.email || ""
      for (const src of (data.needSources as Need["source"][] | undefined) || []) {
        await linkNeed(firestore, src, { rfqId: id, rfqNumber: number }, byName).catch((err) => console.error("need ↔ RFQ link failed:", err))
      }
      if (projectId) await updateDoc(doc(firestore, "projects", projectId), { rfqIds: arrayUnion(id) }).catch(() => undefined)
      // Materials typed outside the list reach the platform team (PUR-04).
      const outside = complete.filter((r) => r.line.material?.outside).map((r) => ({ name: r.line.name, subId: r.line.material!.subId }))
      if (outside.length)
        void user
          .getIdToken()
          .then((tok) => fetch("/api/materials/suggest", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, body: JSON.stringify({ items: outside }) }))
          .catch(() => undefined)

      let po: string | null = null
      if (direct) po = await directAward(id, number, data)
      else {
        void notifyFavoriteSuppliersOfPublish(user, [id])
        upsertCatalogItems(
          firestore,
          user.uid,
          orgId,
          complete.map((r) => ({
            category: r.line.material?.path[0]?.ar || r.line.legacy?.category || "",
            subCategory: (r.line.material?.path[1] || r.line.material?.path[0])?.ar || r.line.legacy?.subCategory || "",
            otherSubCategory: r.line.name,
            quantity: r.line.quantity,
            unit: r.line.unit,
            subCategoryId: r.line.material?.subId,
          })),
        ).catch(() => undefined)
      }
      const guestUrl = direct ? null : await guestLinkUrl(user, { id, status: "New" }).catch(() => null)
      setDone({ id, number, guestUrl, reached: values.audience === "private" ? selectedRecipients.length : reach.distinct.length, closesOn: direct ? null : fmtDay(values.deadline), direct, po })
    } catch (err) {
      console.error("publish failed:", err)
      toast({ title: t("err_publish"), variant: "destructive" })
    } finally {
      setPublishing(false)
    }
  }

  /** The direct award: the accepted offer and its purchase order, born awaiting approval (as before). */
  const directAward = async (rfqId: string, number: string, data: Rec): Promise<string | null> => {
    if (!firestore || !user) return null
    const supplierOrg = values.directSupplierOrgId
    const supplierName = directPool.find((p) => p.orgId === supplierOrg)?.name || ""
    let supplierUserId = supplierOrg
    const us = await getDoc(doc(firestore, "users", supplierOrg))
    if (!us.exists()) supplierUserId = ((await getDoc(doc(firestore, "organizations", supplierOrg))).data()?.ownerUserId as string) || supplierOrg
    const price = String(Math.round(directTotal * 100) / 100)
    const offerLines = directLines.map((l, idx) => ({ rfqProductIndex: idx, unitPrice: Number(values.directPrices[l.key]) }))
    const offerRef = await addDoc(collection(firestore, "offers"), {
      directAward: true,
      supplierId: supplierUserId,
      organizationId: supplierOrg,
      supplierName,
      companyName: supplierName,
      submittedByUserId: user.uid,
      submittedByUserName: (profile as { name?: string } | null)?.name || user.email || "",
      rfqId,
      rfqTitle: data.title,
      projectId: projectId || null,
      contractorId: user.uid,
      contractorOrgId: orgId,
      price,
      lines: offerLines,
      deliveryLocation: place.city,
      deliveryDistrict: place.district || null,
      deliveryBatches: [{ location: place.city, deliveryDate: (data.needBy as string) || "", price, quantity: "" }],
      status: "مقبول",
      awaitingOrderApproval: true,
      decidedByUserId: user.uid,
      decidedByUserName: (profile as { name?: string } | null)?.name || user.email || "",
      decidedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })
    try {
      const created = await createPurchaseOrderFromAward(
        firestore,
        world.actor,
        {
          rfq: {
            id: rfqId,
            title: String(data.title),
            organizationId: orgId,
            contractorId: user.uid,
            projectId: projectId || null,
            category: (data.category as string) || null,
            city: place.city,
            directAward: true,
            products: (data.products as Array<{ name: string; quantity: number; unitOfMeasure: string }>).map((p) => ({ name: p.name, quantity: p.quantity, unitOfMeasure: p.unitOfMeasure })),
            purchaseSource: (data.purchaseSource as never) ?? null,
            paymentTermsList: rfqTermsToStore(values.terms, values.termsSet),
          },
          offer: {
            id: offerRef.id,
            price,
            supplierId: supplierUserId,
            organizationId: supplierOrg,
            supplierName,
            directAward: true,
            companyName: supplierName,
            deliveryLocation: place.city,
            deliveryDistrict: place.district || null,
            status: "مقبول",
            lines: offerLines,
          },
          offers: [{ id: offerRef.id, price, supplierId: supplierUserId, organizationId: supplierOrg, supplierName, status: "مقبول" }],
          awardReason: values.directReason ? { code: "other", text: tp(`rfqpo.form.direct_reason_${values.directReason}`) } : null,
          policies: world.policies,
        },
        { copy: tShared, locale: locale === "en" ? "en" : "ar", orgName: world.orgName || null },
      )
      return created.docNumber
    } catch (err) {
      console.error("purchase order not created after direct award:", (err as { code?: string })?.code || err)
      void number
      return null
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="py-6">
        {done.direct && (
          <Callout tone="info" className="mx-auto mb-4 max-w-xl">
            {done.po ? t("done_direct_po", { number: displayPoNumber(done.po, locale) }) : t("done_direct_no_po")}
          </Callout>
        )}
        <RfqPublishedPanel
          number={displayDocNumber(done.number, locale)}
          reached={done.reached}
          closesOn={done.closesOn}
          guestUrl={done.guestUrl}
          title={title}
          openHref={`/contractor/rfqs/${done.id}`}
          direct={done.direct}
          onNew={() => (panel && onClose ? onClose() : router.replace("/contractor/rfqs/new"))}
        />
      </div>
    )
  }

  const steps = [panel ? t("step_request") : t("step_materials"), t("step_publish"), t("step_review")]
  const prepareHref = `/contractor/rfqs/new?requests=${encodeURIComponent(groups.flatMap((g) => g.lines.map((l) => l.source?.key)).filter((k, i, a): k is string => !!k && a.indexOf(k) === i).join("|"))}`
  const firstGroup = groups.find((g) => g.lines.some(lineStarted))
  return (
    <div className={cn("space-y-5", panel ? "pb-4" : "pb-24")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[14rem] flex-1">
          {panel ? (
            <>
              <h2 className="text-xl font-black text-foreground">{firstGroup?.requestRefs.map((r) => displayNeedRef(r, locale)).join(" · ") || t("title_new")}</h2>
              <p className="mt-1 text-sm text-muted-foreground" dir="auto">
                {t("panel_sub", { place: firstGroup?.label || "—", count: facts.lines || numberedLines(groups).length })}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-black text-foreground">
                {editingLive ? t("title_edit") : t("title_new")}{" "}
                {!editingLive && <span className="align-middle text-xs font-semibold text-muted-foreground">{savedAt ? t("draft_saved") : t("draft")}</span>}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground" dir="auto">
                {title || t("title_hint_empty")}
              </p>
            </>
          )}
        </div>
        {step === 1 && !panel && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="gap-2" disabled={!newRequests.length} onClick={() => setPickOpen(true)}>
              <Inbox size={15} /> {t("from_incoming", { count: newRequests.length })}
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste size={15} /> {t("paste")}
            </Button>
          </div>
        )}
      </div>

      <WizardSteps steps={steps} current={step - 1} ariaLabel={t("steps_label")} />

      {!loaded ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-module" />
        </div>
      ) : step === 1 ? (
        <>
          <EditorMaterials groups={groups} onChange={setGroups} index={index} sites={sites} problems={problems} showProblems={showProblems} lockedProjectId={projectId} fixed={panel} boq={boq} pmOn={pmOn} />
          {panel && <p className="text-xs text-muted-foreground">{t("panel_part_hint")}</p>}
        </>
      ) : step === 2 ? (
        <EditorPublish
          values={values}
          onChange={(patch) => {
            if (patch.title !== undefined) setTitleEdited(true)
            setValues((v) => ({ ...v, ...patch }))
          }}
          lines={directLines}
          publicReachCount={reach.distinct.length}
          favouriteName={favouriteReached}
          recipientOptions={recipientOptions}
          recipientFacts={recipientFacts}
          selectedRecipients={selectedRecipients}
          directPool={directPool}
          directOverCap={directOverCap}
          firstDeadline={firstDeadline}
          deadlineHint={t("deadline_hint", { days: world.policies.rfqWindowDays })}
          onInvite={() => setInviteOpen(true)}
          onUpload={(f) => void upload(f)}
          uploading={uploading}
          onRemoveAttachment={(p) => void removeAttachment(p)}
          showProblems={showProblems}
        />
      ) : (
        <EditorReview model={reviewModel} fmtDay={fmtDay} />
      )}

      {/* The footer: what the RFQ is so far, and the step's one action (fixed on a phone). */}
      <div className={cn(panel ? "sticky bottom-0 rounded-xl border bg-card px-4 py-3 max-md:pe-20" : "fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 py-3 backdrop-blur max-md:pe-20 md:static md:z-auto md:rounded-xl md:border md:bg-card")}>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t("footer_sum", { lines: facts.lines, groups: facts.groups, subs: facts.subs, reach: reach.distinct.length })}</p>
          {step > 1 && (
            <Button type="button" variant="outline" onClick={() => setStep((s) => (s - 1) as Step)} className="gap-1.5">
              {locale === "ar" ? <ArrowRight size={15} /> : <ArrowLeft size={15} />} {t("back")}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => (panel && onClose ? onClose() : router.push(projectId && pmOn ? `/contractor/projects/${projectId}?tab=rfqs` : "/contractor/rfqs"))}>
            {t("cancel")}
          </Button>
          {panel && step === 1 && (
            <Button type="button" variant="outline" onClick={() => router.push(prepareHref)}>
              {t("prepare")}
            </Button>
          )}
          {step < 3 ? (
            <Button type="button" onClick={next} className="gap-1.5">
              {step === 1 ? t("next_publish") : t("next_review")} {locale === "ar" ? <ArrowLeft size={15} /> : <ArrowRight size={15} />}
            </Button>
          ) : (
            <Button type="button" onClick={() => void publish()} disabled={publishing} className="gap-1.5">
              {publishing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {values.audience === "direct" ? t("award_now") : editingLive ? t("save_changes") : t("publish")}
            </Button>
          )}
        </div>
      </div>

      <InviteSupplierDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        orgName={world.orgName}
        invitations={invitations}
        platform={platform.map((s) => ({ orgId: s.orgId, name: s.name, phone: s.phone, email: s.email }))}
        onAddExisting={() => router.push("/contractor/suppliers?segment=platform")}
      />

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("paste_title")}</DialogTitle>
            <DialogDescription>{t("paste_desc")}</DialogDescription>
          </DialogHeader>
          <Textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={8} dir="auto" aria-label={t("paste_title")} placeholder={t("paste_placeholder")} />
          <DialogFooter>
            <Button
              type="button"
              disabled={!parsePaste(pasteText).length}
              onClick={() => {
                const lines = linesFromPaste(parsePaste(pasteText), index)
                setGroups((gs) => {
                  const last = gs[gs.length - 1]
                  return [...gs.slice(0, -1), { ...last, lines: [...last.lines.filter(lineStarted), ...lines] }]
                })
                setPasteText("")
                setPasteOpen(false)
              }}
            >
              {t("paste_add", { count: parsePaste(pasteText).length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("pick_incoming")}</DialogTitle>
            <DialogDescription>{t("pick_incoming_desc")}</DialogDescription>
          </DialogHeader>
          <ul className="divide-y rounded-lg border">
            {newRequests.map((n) => (
              <li key={n.key}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-muted">
                  <Checkbox checked={picked.includes(n.key)} onCheckedChange={(v) => setPicked((cur) => (v ? [...cur, n.key] : cur.filter((k) => k !== n.key)))} className="mt-0.5" />
                  <span className="min-w-0 space-y-0.5">
                    <b className="block text-sm">
                      {displayNeedRef(n.refLabel, locale)} · {n.projectName || n.context}
                    </b>
                    <span className="block truncate text-xs text-muted-foreground">{n.lines.filter((l) => !l.link).map((l) => `${l.name} ${l.quantity.toLocaleString("en-US")} ${l.unit}`).join(" · ")}</span>
                    {n.needBy && <span className="block text-xs text-muted-foreground">{t("need_by_short", { date: fmtDay(n.needBy.slice(0, 10)) })}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              type="button"
              disabled={!picked.length}
              onClick={() => {
                const reqs = openNeeds.filter((n) => picked.includes(n.key)).map((n) => incomingFromNeed(n, sites, lastOrderOf(n)))
                setGroups((gs) => addRequests(gs, reqs))
                setPicked([])
                setPickOpen(false)
              }}
            >
              {t("add_requests", { count: picked.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <span className={cn("sr-only")} aria-live="polite">
        {savedAt ? t("draft_saved") : ""}
      </span>
    </div>
  )
}
