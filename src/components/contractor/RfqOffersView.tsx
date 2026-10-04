"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useRouter } from "@/i18n/routing"
import { useTranslations, useLocale } from 'next-intl'
import { cn } from "@/lib/utils"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ReviewDialog } from "@/components/ReviewDialog"
import { Star } from "lucide-react"
import { displayCategory, displaySubcategory, displayCity } from "@/lib/constants"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToastAction } from "@/components/ui/toast"
import { useProcActor } from "@/hooks/useProcActor"
import { resolvePolicies } from "@/lib/procurement/policies"
import { offerRates, pricedProducts } from "@/lib/procurement/offer-pricing"
import { lastPaid } from "@/lib/procurement/prices"
import { useProcurementPrices } from "@/hooks/useProcurementPrices"
import { PROCUREMENT_SETTINGS, PURCHASE_ORDERS, type AwardReasonCode, type ProcurementPolicies, type PurchaseOrder, type ReceiptFact, type SupplierFacts } from "@/lib/procurement/types"
import { poBlocks, poStatus, supplierScore } from "@/lib/procurement/po"
import { awardDisclosed } from "@/lib/procurement/supplier"
import { createPurchaseOrderFromAward, type AwardOfferLike, type RfqLike } from "@/lib/procurement/writes"
import { procLinks } from "@/lib/procurement/events"
import { displayPoNumber } from "@/lib/procurement/format"
import { legacyLinesOf, recordReceipt } from "@/lib/procurement/receipt-writes"
import {
  awardSupplierOrgId,
  competingOffers,
  offersSealed,
  supplierFactsFromProfile,
  type OfferAwardReason,
} from "@/lib/procurement/award"
import { awardMode, bestOfferIds, offerTotal, pickOffer, ratesByOffer, type OrderableOffer, type Picks } from "@/lib/procurement/rfq-award"
import { rfqNotes } from "@/lib/procurement/rfq-notes"
import { answerRecipients, canAskReductionRound, canCancelRfq, invitedRows, priceTrail, unansweredCount, type InquiryLike } from "@/lib/procurement/rfq-detail"
import { actsOnRfq, awardsOnRfq, closesRfqEarly, ownerReadsRfqs, rfqMine, runsRfqs } from "@/lib/procurement/rfq-access"
import { daysToDeadline, rfqNeedSources, rfqPageTab, rfqStage, type NeedLinkedRfq } from "@/lib/procurement/rfq-view"
import { unlinkNeedsFromRfq } from "@/lib/procurement/needs-writes"
import { guestLinkUrl } from "@/components/procurement/rfq/guestLinkUrl"
import { useRfqRunner } from "@/hooks/useRfqRunner"
import { useSearchParams } from "next/navigation"
import { RfqNumber, RfqStagePill } from "@/components/procurement/RfqCard"
import { RfqGuestLinkPanel } from "@/components/procurement/rfq/RfqGuestLinkPanel"
import { RfqRegisterGuestDialog, type GuestToRegister } from "@/components/procurement/rfq/RfqRegisterGuestDialog"
import { ShareRfqLinkDialog } from "@/components/contractor/ShareRfqLinkDialog"
import { RfqExtendDialog, type ExtendTarget } from "@/components/procurement/RfqExtendDialog"
import { printRfqWithLink, rfqPrintModel } from "@/components/procurement/RfqPrint"
import { useSupplierRecipientOptions } from "@/components/contractor/SupplierRecipientsPicker"
import { displayDocNumber } from "@/lib/procurement/format"
import { leadDaysOf } from "@/components/procurement/rfq/RfqComparison"
import { releaseBoqDrawsForRfq } from "@/lib/boq-draws"
import { logRfqDocument } from "@/lib/procurement/rfq-writes"
import { RfqManualOfferDialog } from "@/components/procurement/rfq/RfqManualOfferDialog"
import { answerQuery } from "@/lib/procurement/rfq-writes"
import type { RfqWriteActor } from "@/lib/procurement/rfq-access"
import { RfqComparison } from "@/components/procurement/rfq/RfqComparison"
import { RfqAwardDialog, type AwardDone } from "@/components/procurement/rfq/RfqAwardDialog"
import { CancelRfqDialog, CloseNowDialog, ExcludeOfferDialog, ReductionRoundDialog } from "@/components/procurement/rfq/RfqActionDialogs"
import { RfqDetailsPanel, RfqDraftPanel, RfqInvitedList } from "@/components/procurement/rfq/RfqDetailsPanel"
import type { RfqOfferView, RfqView } from "@/components/procurement/rfq/rfqOfferView"
import { Callout } from "@/components/module-ui/Callout"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { OfferTermsChips } from "@/components/procurement/OfferTermsChips"
import { GuestOfferProof } from "@/components/procurement/guest/GuestOfferProof"
import { useSupplierRecords } from "@/hooks/useSupplierRecords"
import { profileOfFacts, sourcingBlockOf } from "@/lib/procurement/rfq-extras"


import {
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  TrendingUp,
  Calendar,
  MessageSquare,
  MapPin,
  Tag,
  Truck,
  Package,
  Phone,
  Box,
  File,
  Send,
  Globe,
  Download,
  Briefcase,
  ChevronLeft,
  FileCheck,
  Handshake,
  ShieldCheck,
  AlertTriangle,
  Link2,
  Lock,
} from "lucide-react"
import { useCollection, useDoc, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { collection, query, where, orderBy, doc, updateDoc, setDoc, getDoc, addDoc, deleteDoc, arrayRemove, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Link } from "@/i18n/routing"
import { logFinanceAudit } from "@/lib/finance-audit"
import { receiveDelivery } from "@/lib/warehouse-transfer"
import { onGoodsReceived } from "@/lib/accounting/hooks"
import { markPurchaseArrived, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { orderRef } from "@/lib/manufacturing-view"
import { emitMfgEvent, mfgLinks } from "@/lib/mfg-events"
import { useActiveCompanyName } from "@/hooks/useActiveCompanyName"
import { GuestNotifyDialog, type GuestNotifyTarget } from "@/components/contractor/GuestNotifyDialog"
import {
  eventForDecision,
  eventForSampleAction,
  guestEventForOffer,
} from "@/utils/guest-offer-workflow"

function asDayText(v: unknown): string | null {
  if (!v) return null
  if (typeof v === "string") return v
  const ts = v as { toDate?: () => Date }
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : null
}

function fmtDate(val: any, locale: string) {
  if (!val) return '-'
  const d = new Date(val)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

// Shared RFQ-offers view — used both by the project-scoped route (tenders/[tenderId]/offers)
// and the flat standalone route (rfqs/[id]/offers). rfqId is passed as a prop rather than
// read from route params so this component is agnostic to which route rendered it.
export function RfqOffersView({ rfqId }: { rfqId: string }) {
  const t = useTranslations("Portal.Contractor")
  // Manufacturing events carry Portal.Shared keys (mfn_*) for their pushed text.
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const router = useRouter()
  const { toast } = useToast()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const activeCompanyName = useActiveCompanyName(profile, user?.uid)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [openingChat, setOpeningChat] = useState<string | null>(null)
  const [sampleRequestOffer, setSampleRequestOffer] = useState<any | null>(null)
  const [raisingOrderId, setRaisingOrderId] = useState<string | null>(null)
  const [reviewOffer, setReviewOffer] = useState<any | null>(null)
  // The comparison's picks (rfqProductIndex → offer) — the award is made from them.
  const [picks, setPicks] = useState<Picks>({})
  // The card's «الاستفسارات (n)» lands on the queries (`?tab=inquiries`).
  const searchParams = useSearchParams()
  const tabParam = searchParams.get("tab")
  const [tab, setTab] = useState<string>(() => rfqPageTab(tabParam))
  useEffect(() => {
    if (tabParam) setTab(rfqPageTab(tabParam))
  }, [tabParam])
  const [shareOpen, setShareOpen] = useState(false)
  const [extendTarget, setExtendTarget] = useState<ExtendTarget | null>(null)
  const [registerGuest, setRegisterGuest] = useState<GuestToRegister | null>(null)
  const [draftDeleteOpen, setDraftDeleteOpen] = useState(false)
  const [deletingDraft, setDeletingDraft] = useState(false)
  const [awardOpen, setAwardOpen] = useState(false)
  const [excludeTarget, setExcludeTarget] = useState<{ id: string; name: string; total: number | null; raw: any } | null>(null)
  const [closeNowOpen, setCloseNowOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [roundOpen, setRoundOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [confirmDeliveryDoc, setConfirmDeliveryDoc] = useState<any | null>(null)
  const [receiverName, setReceiverName] = useState("")
  const [isConfirmingDelivery, setIsConfirmingDelivery] = useState(false)
  // Guest offers have no in-app inbox — every workflow step has to be pushed
  // out to the supplier on the channel the RFQ was originally shared on.
  const [guestNotify, setGuestNotify] = useState<GuestNotifyTarget | null>(null)

  const queueGuestNotify = (
    offer: any,
    event: ReturnType<typeof eventForDecision>,
    extras?: { note?: string | null; targetPrice?: string | null }
  ) => {
    if (!offer?.isGuestOffer || !event) return
    setGuestNotify({
      offerId: offer.id,
      supplierName: offer.companyName || offer.supplierName || t("offers_registered_supplier"),
      rfqTitle: offer.rfqTitle || (rfq as { title?: string } | null)?.title || "",
      event,
      note: extras?.note || null,
      targetPrice: extras?.targetPrice || null,
    })
  }

  const openChat = async (offer: any) => {
    if (!firestore || !user) return
    // Guest offers (submitted via a share link) have no platform account to
    // chat with — reach the supplier on the channel the RFQ was shared on,
    // falling back to a plain mail draft when there's nothing to announce.
    if (offer.isGuestOffer) {
      const event = guestEventForOffer(offer)
      if (event) {
        queueGuestNotify(offer, event, { note: offer.reductionNote, targetPrice: offer.targetPrice ? String(offer.targetPrice) : null })
      } else if (offer.guestContact?.email) {
        window.open(`mailto:${offer.guestContact.email}`, "_blank")
      }
      return
    }
    setOpeningChat(offer.id)
    try {
      // Create chat doc if it doesn't exist (fallback for offers accepted before this fix)
      const chatRef = doc(firestore, "chats", offer.id)
      const snap = await getDoc(chatRef)
      if (!snap.exists()) {
        await setDoc(chatRef, {
          offerId: offer.id,
          rfqId: rfqId,
          rfqTitle: offer.rfqTitle || offer.title || "",
          contractorId: user.uid,
          contractorOrgId: profile?.organizationId || user.uid,
          supplierId: offer.supplierId,
          supplierOrgId: offer.organizationId || offer.supplierId,
          createdAt: new Date().toISOString()
        })
      }
      router.push(`/contractor/chat/${offer.id}`)
    } catch (err: any) {
      console.error("❌ openChat failed:", err?.code, err?.message)
      toast({ title: t("offers_toast_error"), description: t("offers_toast_error_desc", { message: err?.code || "" }), variant: "destructive" })
      setOpeningChat(null)
    }
  }

  const offersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "offers"),
      where("rfqId", "==", rfqId),
      orderBy("createdAt", "desc")
    )
  }, [firestore, user, isUserLoading, rfqId])

  const rfqDocRef = useMemoFirebase(() => {
    if (!firestore || !rfqId) return null
    return doc(firestore, "rfqs", rfqId)
  }, [firestore, rfqId])

  const { data: rfq, isLoading: isRfqLoading } = useDoc(rfqDocRef)
  // Project-scoped permission check (falls back to the default group for standalone RFQs)
  const { can } = usePermissions((rfq as { projectId?: string } | null)?.projectId || undefined)
  const canConfirmDelivery = can("deliveries.confirm")

  const { data: offers, isLoading: isOffersLoading } = useCollection(offersQuery)
  const isLoading = isOffersLoading || isRfqLoading

  // The purchase order laid over the award (PRD 3.0): who prepares it, the
  // org's policies, and the facts about the supplier an approval will check.
  const tRfqd = useTranslations("Portal.Procurement.rfqd")
  const { actor: procActor, orgId: procOrgId, orgName: procOrgName } = useProcActor((rfq as { projectId?: string } | null)?.projectId || undefined)
  // One gate for running this RFQ (rfq-access.ts): the manager runs every RFQ,
  // a buyer his own, the owner only while the org has no procurement staff.
  // An Admin decides on RFQs Mdmak posted as a contractor (no team to grant him).
  const { runner } = useRfqRunner((rfq as { projectId?: string } | null)?.projectId || undefined)
  const isPlatformAdmin = profile?.role === "Admin"
  const rfqAuthor = (rfq || {}) as { createdByUserId?: string | null; contractorId?: string | null }
  const acts = isPlatformAdmin || actsOnRfq(rfqAuthor, runner)
  const canDecide = isPlatformAdmin || awardsOnRfq(rfqAuthor, runner)
  const closes = closesRfqEarly(rfqAuthor, runner)
  const ownerReads = ownerReadsRfqs(runner)
  const notMine = !isPlatformAdmin && runsRfqs(runner) && !rfqMine(rfqAuthor, runner)
  const writeActor: RfqWriteActor = { ...runner, canPrepare: runner.canPrepare || isPlatformAdmin }
  const policiesRef = useMemoFirebase(() => (firestore && procOrgId ? doc(firestore, PROCUREMENT_SETTINGS, procOrgId) : null), [firestore, procOrgId])
  const { data: policiesDoc } = useDoc(policiesRef)
  const policies = useMemo<ProcurementPolicies>(() => resolvePolicies(policiesDoc as Partial<ProcurementPolicies> | null), [policiesDoc])
  // The suppliers the picks would award — what each order's approval will check.
  const [supplierFacts, setSupplierFacts] = useState<Record<string, SupplierFacts>>({})
  // Every live offer's supplier: the award checks them, and so does «أفضل سعر»
  // and the card's «لا يصدر له أمر قبل استكمال سجلّه».
  const pickedSupplierIds = useMemo(() => {
    const ids = new Set<string>()
    for (const o of (offers || []) as any[]) {
      if (o.status === "مرفوض") continue
      const id = awardSupplierOrgId(o)
      if (id) ids.add(id)
    }
    return [...ids].sort().join(",")
  }, [offers])
  useEffect(() => {
    if (!firestore || !pickedSupplierIds) return
    const missing = pickedSupplierIds.split(",").filter((id) => !supplierFacts[id])
    if (!missing.length) return
    let cancelled = false
    ;(async () => {
      const found: Record<string, SupplierFacts> = {}
      for (const id of missing) {
        try {
          let snap = await getDoc(doc(firestore, "users", id))
          if (!snap.exists()) snap = await getDoc(doc(firestore, "organizations", id))
          found[id] = supplierFactsFromProfile(id, snap.exists() ? (snap.data() as Parameters<typeof supplierFactsFromProfile>[1]) : null)
        } catch (err) {
          console.warn("supplier facts not read:", (err as { code?: string })?.code || err)
          found[id] = supplierFactsFromProfile(id, null)
        }
      }
      if (!cancelled) setSupplierFacts((prev) => ({ ...prev, ...found }))
    })()
    return () => {
      cancelled = true
    }
  }, [firestore, pickedSupplierIds, supplierFacts])
  const { history: priceHistory } = useProcurementPrices(procOrgId)
  const supplierRecords = useSupplierRecords(procOrgId)
  const tProc = useTranslations("Portal.Procurement")
  const tx = useTranslations("Portal.Procurement.rfqx")
  const linksQuery = useMemoFirebase(() => (firestore && procOrgId ? query(collection(firestore, "contractorSupplierLinks"), where("contractorOrgId", "==", procOrgId), where("status", "==", "active")) : null), [firestore, procOrgId])
  const { data: supplierLinks } = useCollection(linksQuery)
  const supplierOptions = useSupplierRecipientOptions((supplierLinks || []) as any[], ((profile as { favoriteSuppliers?: string[] } | null)?.favoriteSuppliers) || [], t("suppliers_registered_supplier"))

  // The org's orders and receipts: this RFQ's orders (details tab) and each
  // supplier's on-time record (the comparison's notes).
  const orgOrdersQuery = useMemoFirebase(() => (firestore && procOrgId ? query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", procOrgId)) : null), [firestore, procOrgId])
  const { data: orgOrdersData } = useCollection(orgOrdersQuery)
  const orgOrders = useMemo(() => ((orgOrdersData || []) as PurchaseOrder[]).map((o) => ({ ...o, lines: o.lines || [], log: o.log || [] })), [orgOrdersData])
  const orgDeliveriesQuery = useMemoFirebase(() => (firestore && procOrgId ? query(collection(firestore, "deliveries"), where("contractorOrgId", "==", procOrgId)) : null), [firestore, procOrgId])
  const { data: orgDeliveriesData } = useCollection(orgDeliveriesQuery)
  const orgReceipts = useMemo(
    () =>
      ((orgDeliveriesData || []) as Array<ReceiptFact & { deliveryDate?: unknown; confirmedAt?: unknown }>).map((d) => ({
        ...d,
        deliveryDate: asDayText(d.deliveryDate),
        confirmedAt: asDayText(d.confirmedAt),
      })) as ReceiptFact[],
    [orgDeliveriesData]
  )
  const rfqOrders = useMemo(() => orgOrders.filter((o) => o.rfqId === rfqId), [orgOrders, rfqId])

  // Budget-overrun check: project budget + committed spend across every accepted/completed
  // offer in the project (not just this RFQ), so the award is weighed against
  // the whole project's commitments, not just its own RFQ.
  const projectId = (rfq as { projectId?: string } | null)?.projectId
  const projectDocRef = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return doc(firestore, "projects", projectId)
  }, [firestore, projectId])
  const { data: project } = useDoc(projectDocRef)

  const projectOffersQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return query(collection(firestore, "offers"), where("projectId", "==", projectId))
  }, [firestore, projectId])
  const { data: projectOffers } = useCollection(projectOffersQuery)

  const awardBudget = (() => {
    const budgetVal = (project as { budget?: number } | null)?.budget
    if (budgetVal == null) return null
    const committed = (projectOffers || [])
      .filter((o: any) => o.rfqId !== rfqId && (o.status === "مقبول" || o.status === "تم التسليم"))
      .reduce((sum: number, o: any) => sum + (Number(o.awardedTotal) || parseFloat(o.price) || 0), 0)
    return { budget: budgetVal, committed }
  })()

  // Supplier queries — the tab's badge counts the unanswered ones.
  const inquiriesQuery = useMemoFirebase(() => (firestore && rfqId ? query(collection(firestore, "rfqs", rfqId, "inquiries"), orderBy("createdAt", "desc")) : null), [firestore, rfqId])
  const { data: inquiries, isLoading: inquiriesLoading } = useCollection(inquiriesQuery)
  const unanswered = unansweredCount((inquiries || []) as InquiryLike[])

  // Delivery notices for this RFQ's offers
  const deliveriesQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || !rfqId) return null
    return query(collection(firestore, "deliveries"), where("rfqId", "==", rfqId))
  }, [firestore, user, isUserLoading, rfqId])
  const { data: deliveries } = useCollection(deliveriesQuery)
  const deliveryByOfferId: Record<string, any> = {}
  ;(deliveries || []).forEach((d: any) => { deliveryByOfferId[d.offerId] = d })

  // Guarantee submissions for this RFQ's offers (submitted by suppliers at delivery time)
  const guaranteesQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || !rfqId) return null
    return query(collection(firestore, "guarantees"), where("rfqId", "==", rfqId), where("hasGuarantee", "==", true))
  }, [firestore, user, isUserLoading, rfqId])
  const { data: guarantees } = useCollection(guaranteesQuery)
  const guaranteesByOfferId: Record<string, any[]> = {}
  ;(guarantees || []).forEach((g: any) => {
    if (!guaranteesByOfferId[g.offerId]) guaranteesByOfferId[g.offerId] = []
    guaranteesByOfferId[g.offerId].push(g)
  })

  const handleConfirmDelivery = async () => {
    if (!firestore || !user || !confirmDeliveryDoc || !receiverName.trim()) return
    // PRD 3.0: a legacy delivery (no order) that names its items is confirmed
    // through the receipts write — same effects (stock, books, Manufacturing,
    // the supplier's `delivery_confirmed`), plus a GR number. A notice with
    // no items (registered suppliers' notices carry none — impl-b §8.2) would
    // be refused there as "nothing counted", so it keeps today's path below.
    const offerOfConfirm = (offers || []).find((o: any) => o.id === confirmDeliveryDoc.offerId) as { poId?: string } | undefined
    if (confirmDeliveryDoc.poId || offerOfConfirm?.poId) {
      // The award has an order: the receipt is counted at the gate, never "confirmed whole" here.
      setConfirmDeliveryDoc(null)
      router.push(procLinks.receipt(confirmDeliveryDoc.id))
      return
    }
    if (legacyLinesOf(confirmDeliveryDoc).length > 0) {
      setIsConfirmingDelivery(true)
      try {
        const offerOfDelivery = (offers || []).find((o: any) => o.id === confirmDeliveryDoc.offerId) as { price?: string | number; totalBatchesPrice?: number } | undefined
        const legacyNet = Math.max(0, Number(offerOfDelivery?.totalBatchesPrice ?? offerOfDelivery?.price) || 0)
        const result = await recordReceipt(
          firestore,
          procActor,
          {
            delivery: confirmDeliveryDoc,
            po: null,
            receiverName: receiverName.trim(),
            policies,
            purchaseSource: (rfq as { purchaseSource?: { kind: string; workOrderId?: string; purchaseRequestId?: string } } | null)?.purchaseSource ?? null,
            legacyNet: legacyNet > 0 ? legacyNet : null,
            projectName: (project as { name?: string } | null)?.name || null,
          },
          { copy: tShared, locale: locale === "en" ? "en" : "ar", centralWarehouseCopy: { name: t("wh_central_name"), location: t("wh_central_location"), description: t("wh_central_desc") } }
        )
        toast(
          result.stockLanded
            ? { title: t("delivery_confirm_success"), description: t("delivery_receipt_link") }
            : { title: t("delivery_confirm_success"), description: t("delivery_stock_not_landed"), variant: "destructive" }
        )
        setConfirmDeliveryDoc(null)
        setReceiverName("")
      } catch (err) {
        console.error("receipt not recorded:", (err as { code?: string })?.code || err)
        toast({ title: t("offers_toast_error"), variant: "destructive" })
      } finally {
        setIsConfirmingDelivery(false)
      }
      return
    }
    setIsConfirmingDelivery(true)
    try {
      await updateDoc(doc(firestore, "deliveries", confirmDeliveryDoc.id), {
        status: "confirmed",
        receivedByName: receiverName.trim(),
        confirmedAt: serverTimestamp(),
        confirmedByUserId: user.uid
      })

      // Goods receipt: confirming delivery is the moment stock actually enters a
      // warehouse — the project's warehouse if this delivery is tied to one project,
      // otherwise the org's central warehouse (created here if it doesn't exist yet,
      // same deterministic id as useCentralWarehouse). Kept isolated from the delivery
      // confirmation above, which already committed and must not be rolled back by this.
      let stockLanded = true
      const orgId = confirmDeliveryDoc.contractorOrgId as string | undefined
      // What the delivery is worth: the awarded offer's price — quoted EXCLUDING
      // VAT (the offer form says so). One offer, one delivery.
      const offerOfDelivery = (offers || []).find((o: any) => o.id === confirmDeliveryDoc.offerId) as { price?: string | number; totalBatchesPrice?: number } | undefined
      const deliveryNet = Math.max(0, Number(offerOfDelivery?.totalBatchesPrice ?? offerOfDelivery?.price) || 0)
      try {
        const rawItems = ((confirmDeliveryDoc.items || []) as { name?: string; quantity?: number; unitOfMeasure?: string; unit?: string }[])
          .map((it) => ({ name: it.name || "", unit: it.unitOfMeasure || it.unit || "", quantity: Number(it.quantity) || 0 }))
          .filter((it) => it.name && it.unit && it.quantity > 0)
        // A unit cost only when it is exact: one line, one price. Splitting one
        // total across lines in different units would invent prices.
        const deliveryItems = rawItems.map((it) => ({ ...it, unitCost: rawItems.length === 1 && deliveryNet > 0 ? Math.round((deliveryNet / it.quantity) * 100) / 100 : null }))

        if (orgId && deliveryItems.length > 0) {
          let targetWarehouseId: string | null = null
          if (confirmDeliveryDoc.projectId) {
            const projectSnap = await getDoc(doc(firestore, "projects", confirmDeliveryDoc.projectId))
            targetWarehouseId = (projectSnap.data() as { warehouseId?: string } | undefined)?.warehouseId || null
          }
          if (!targetWarehouseId) {
            const centralRef = doc(firestore, "warehouses", `central_${orgId}`)
            const centralSnap = await getDoc(centralRef)
            if (!centralSnap.exists()) {
              await setDoc(centralRef, {
                name: t("wh_central_name"),
                location: t("wh_central_location"),
                description: t("wh_central_desc"),
                organizationId: orgId,
                isCentral: true,
                projectId: null,
                projectName: null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              })
            }
            targetWarehouseId = `central_${orgId}`
          }
          await receiveDelivery({ firestore, warehouseId: targetWarehouseId, items: deliveryItems, organizationId: orgId })
        }
      } catch (receiptErr) {
        stockLanded = false
        console.error("Goods receipt into warehouse failed:", receiptErr)
      }

      const actorName = profile?.name || user.email || ""
      if (orgId && stockLanded) {
        // The books: the company now holds the goods and owes the supplier.
        onGoodsReceived(
          firestore,
          { organizationId: orgId, userId: user.uid, userName: actorName },
          {
            deliveryId: confirmDeliveryDoc.id,
            net: deliveryNet,
            supplierId: confirmDeliveryDoc.supplierOrgId && confirmDeliveryDoc.supplierOrgId !== "guest" ? confirmDeliveryDoc.supplierOrgId : null,
            supplierName: confirmDeliveryDoc.supplierName || null,
            rfqTitle: confirmDeliveryDoc.rfqTitle || null,
            projectId: confirmDeliveryDoc.projectId || null,
            projectName: (project as { name?: string } | null)?.name || null,
          }
        )
      }

      // This RFQ answered one of Manufacturing's purchase requests: the goods
      // are in stock now, so the request is "arrived" and the workshop hears it
      // — instead of the request staying "RFQ started" for ever.
      const purchaseSource = (rfq as { purchaseSource?: { kind?: string; workOrderId?: string; purchaseRequestId?: string } } | null)?.purchaseSource
      if (orgId && stockLanded && purchaseSource?.kind === "mfg_purchase" && purchaseSource.workOrderId && purchaseSource.purchaseRequestId) {
        try {
          await markPurchaseArrived(firestore, { orderId: purchaseSource.workOrderId, purchaseRequestId: purchaseSource.purchaseRequestId, actor: { id: user.uid, name: actorName } })
          const woSnap = await getDoc(doc(firestore, "workOrders", purchaseSource.workOrderId))
          const wo = woSnap.exists() ? ({ ...(woSnap.data() as WorkOrderV2), id: woSnap.id }) : null
          const pr = wo?.purchaseRequests?.find((p) => p.id === purchaseSource.purchaseRequestId)
          if (wo && pr) {
            await emitMfgEvent(firestore, {
              kind: "purchase_arrived",
              copy: tShared,
              organizationId: orgId,
              actor: { id: user.uid, name: actorName },
              to: [{ permission: "manufacturing.manage" }, { users: [pr.byId] }],
              params: { ref: orderRef(wo), qty: String(pr.quantity), unit: pr.unit, item: pr.itemName, block: "" },
              workOrderId: wo.id,
              link: mfgLinks.order(wo.id),
            })
          }
        } catch (linkErr) {
          // Stock has landed either way; the request can still be closed from the inbox.
          console.warn("purchase request not closed:", linkErr)
        }
      }

      // Guest deliveries have no user doc to notify — the guest sees the
      // confirmation on their offer page, and hears from us again when the
      // supply is marked complete.
      if (confirmDeliveryDoc.supplierId && !confirmDeliveryDoc.isGuestDelivery && confirmDeliveryDoc.supplierId !== "guest") {
        await addDoc(collection(firestore, "users", confirmDeliveryDoc.supplierId, "notifications"), {
          userId: confirmDeliveryDoc.supplierId,
          organizationId: confirmDeliveryDoc.supplierOrgId || confirmDeliveryDoc.supplierId,
          type: "delivery_confirmed",
          i18n: { title: "pn_delivery_confirmed_title", message: "pn_delivery_confirmed", params: { rfq: confirmDeliveryDoc.rfqTitle || "" } },
          title: "✅ تم تأكيد الاستلام",
          message: `أكد المقاول استلام الشحنة لطلب عروض الأسعار: ${confirmDeliveryDoc.rfqTitle || ""}`,
          offerId: confirmDeliveryDoc.offerId,
          rfqId: confirmDeliveryDoc.rfqId,
          createdAt: new Date().toISOString(),
          read: false
        })
      }

      toast(
        stockLanded
          ? { title: t("delivery_confirm_success"), description: t("delivery_receipt_link") }
          : { title: t("delivery_confirm_success"), description: t("delivery_stock_not_landed"), variant: "destructive" }
      )
      setConfirmDeliveryDoc(null)
      setReceiverName("")
    } catch {
      toast({ title: t("offers_toast_error"), variant: "destructive" })
    } finally {
      setIsConfirmingDelivery(false)
    }
  }

  // The award's second half (PRD 3.0 §5.1-5): a purchase order laid over the
  // accepted offer, born awaiting approval. Idempotent — an offer that already
  // names its order gets it back — so the same call serves the accept flow
  // and the "raise its order" button on an award whose order never got made.
  const raisePurchaseOrder = async (offer: any, reason: OfferAwardReason | { code: AwardReasonCode; text?: string | null } | null | undefined) => {
    if (!firestore || !rfq) throw new Error("rfq_missing")
    const rfqLike: RfqLike = {
      id: rfqId,
      title: (rfq as { title?: string }).title || offer.rfqTitle || "",
      organizationId: (rfq as { organizationId?: string }).organizationId || null,
      contractorId: (rfq as { contractorId?: string }).contractorId || null,
      projectId: (rfq as { projectId?: string }).projectId || null,
      projectName: (project as { name?: string } | null)?.name || null,
      category: (rfq as { category?: string }).category || null,
      city: (rfq as { city?: string }).city || null,
      directAward: Boolean((rfq as { directAward?: boolean }).directAward),
      products: (rfq as { products?: RfqLike["products"] }).products || null,
      purchaseSource: (rfq as { purchaseSource?: RfqLike["purchaseSource"] }).purchaseSource || null,
    }
    // An Admin deciding on an Mdmak-posted RFQ may award here without a team
    // permission; the order's rules ask for membership, so his attempt is
    // refused cleanly and the award still stands.
    const actor = { ...procActor, canPrepare: procActor.canPrepare || isPlatformAdmin }
    return createPurchaseOrderFromAward(
      firestore,
      actor,
      {
        rfq: rfqLike,
        offer: offer as AwardOfferLike,
        offers: competingOffers(((offers || []) as AwardOfferLike[]).map((o) => (o.id === offer.id ? (offer as AwardOfferLike) : o))),
        awardReason: reason ? { code: reason.code, text: reason.text ?? null } : null,
        policies,
      },
      { copy: tShared, locale: locale === "en" ? "en" : "ar", orgName: procOrgName || activeCompanyName || null }
    )
  }

  const toastOrderRaised = (result: { id: string; docNumber: string }) => {
    toast({
      title: t("offers_toast_accepted_title"),
      description: t("offers_award_order_created", { number: displayPoNumber(result.docNumber, locale) }),
      action: (
        <ToastAction altText={t("offers_award_open_order")} onClick={() => router.push(procLinks.order(result.id))}>
          {t("offers_award_open_order")}
        </ToastAction>
      ),
    })
  }

  const handleRaiseOrder = async (offer: any) => {
    if (!firestore || !user) return
    setRaisingOrderId(offer.id)
    try {
      const result = await raisePurchaseOrder(offer, offer.awardReason || null)
      toastOrderRaised(result)
    } catch (err) {
      console.error("purchase order not raised:", (err as { code?: string })?.code || err)
      toast({ title: t("offers_toast_error"), description: t("offers_award_order_failed"), variant: "destructive" })
    } finally {
      setRaisingOrderId(null)
    }
  }

  // The supplier hears a rejection or a reduction request at once — never an
  // award, which reaches him when its purchase order is approved and sent.
  const notifyDecision = async (offer: any, decision: "مرفوض" | "مطلوب تخفيض", note?: string, requestedPrice?: string, skipGuest = false) => {
    if (!firestore) return
    if (offer?.supplierId && !offer.isGuestOffer) {
      try {
        let notifType = "offer_rejected"
        let notifTitle = t("offers_notif_rejected_title")
        let notifMessage = t("offers_notif_rejected_msg", { title: offer.rfqTitle || "" })
        if (decision === "مطلوب تخفيض") {
          notifType = "price_reduction"
          notifTitle = t("offers_notif_reduction_title")
          let baseMsg = t("offers_notif_reduction_msg", { title: offer.rfqTitle || "" })
          if (requestedPrice) baseMsg += `
${t("offers_notif_reduction_target_price", { price: requestedPrice, currency: t("offers_currency_sar") })}`
          if (note) baseMsg += `
${t("offers_notif_reduction_note", { note })}`
          notifMessage = baseMsg
        }
        const i18nKey = notifType === "price_reduction" ? "pn_price_reduction" : "pn_offer_rejected"
        await addDoc(collection(firestore, "users", offer.supplierId, "notifications"), {
          userId: offer.supplierId,
          organizationId: offer.organizationId || offer.supplierId,
          type: notifType,
          i18n: {
            title: `${i18nKey}_title`,
            message: i18nKey,
            params: { rfq: offer.rfqTitle || "", price: requestedPrice || "", note: note || "" },
          },
          title: notifTitle,
          message: notifMessage,
          offerId: offer.id,
          rfqId: rfqId,
          rfqTitle: offer.rfqTitle || "",
          createdAt: new Date().toISOString(),
          read: false
        })
      } catch (notifErr) {
        console.warn("⚠️ Failed to write supplier notification (non-critical):", notifErr)
      }
    }
    // Guests get the same news by WhatsApp/email instead of an inbox.
    if (!skipGuest) queueGuestNotify(offer, eventForDecision(decision, Boolean(offer?.isGuestOffer)), { note, targetPrice: requestedPrice })
  }

  const onExcluded = (offerId: string) => {
    const offer = offers?.find((o: any) => o.id === offerId)
    setExcludeTarget(null)
    setPicks((prev) => Object.fromEntries(Object.entries(prev).filter(([, id]) => id !== offerId)))
    if (offer) void notifyDecision(offer, "مرفوض")
    toast({ title: t("offers_toast_rejected_title"), description: t("offers_toast_rejected_desc") })
  }

  // The award was made from the picks: one order per supplier, awaiting
  // approval. A budget overrun the buyer accepted is logged for Finance.
  const onAwarded = (done: AwardDone) => {
    setAwardOpen(false)
    setPicks({})
    if (done.budgetReason && firestore && user && projectId && awardBudget) {
      logFinanceAudit(firestore, projectId, {
        action: "budget_exception_override",
        actorId: user.uid,
        actorName: profile?.name || user.email || "عضو الإدارة",
        targetType: "offer",
        targetId: done.orders.map((o) => o.offerId).join(","),
        amount: done.total,
        reason: done.budgetReason,
        meta: {
          rfqTitle: rfq?.title || "",
          budget: awardBudget.budget,
          committedBefore: awardBudget.committed,
          projectedTotal: awardBudget.committed + done.total,
          overageAmount: awardBudget.committed + done.total - awardBudget.budget,
        },
      })
    }
    const first = done.orders[0]
    toast({
      title: t("offers_toast_accepted_title"),
      description: tRfqd("award.done", { count: done.orders.length, numbers: done.orders.map((o) => displayPoNumber(o.docNumber, locale)).join(" · ") }),
      action: first ? (
        <ToastAction altText={t("offers_award_open_order")} onClick={() => router.push(procLinks.order(first.id))}>
          {t("offers_award_open_order")}
        </ToastAction>
      ) : undefined,
    })
  }

  const handleSampleAction = async (offerId: string, action: "مطلوبة" | "تم الاستلام") => {
    if (!firestore || !user) return;
    setProcessingId(offerId);
    try {
       await updateDoc(doc(firestore, "offers", offerId), {
         sampleStatus: action,
         sampleUpdatedAt: new Date().toISOString()
       });

      const offerSnap = await getDoc(doc(firestore, "offers", offerId));
      const offerData = offerSnap.data();
      // Guests have no user doc — they're reached through GuestNotifyDialog below.
      const canNotifyInApp = Boolean(offerData?.supplierId) && !offerData?.isGuestOffer
      if (action === "مطلوبة") {
        if (canNotifyInApp && offerData?.supplierId) {
          await addDoc(collection(firestore, "users", offerData.supplierId, "notifications"), {
            userId: offerData.supplierId,
            organizationId: offerData.organizationId || offerData.supplierId,
            type: "sample_requested",
            i18n: { title: "pn_sample_requested_title", message: "pn_sample_requested", params: { rfq: offerData.rfqTitle || "" } },
            title: "طلب عينة جديد",
            message: `قام المقاول بطلب عينة لطلب عروض الأسعار: ${offerData.rfqTitle || ""}`,
            offerId: offerId,
            rfqId: rfqId,
            createdAt: new Date().toISOString(),
            read: false
          });
        }
      } else if (action === "تم الاستلام") {
        if (canNotifyInApp && offerData?.supplierId) {
          await addDoc(collection(firestore, "users", offerData.supplierId, "notifications"), {
            userId: offerData.supplierId,
            organizationId: offerData.organizationId || offerData.supplierId,
            type: "sample_received",
            i18n: { title: "pn_sample_received_title", message: "pn_sample_received", params: { rfq: offerData.rfqTitle || "" } },
            title: "✅ تم استلام العينة",
            message: `قام المقاول بتأكيد استلام العينة لطلب عروض الأسعار: ${offerData.rfqTitle || ""}`,
            offerId: offerId,
            rfqId: rfqId,
            createdAt: new Date().toISOString(),
            read: false
          });
        }
      }

      queueGuestNotify(
        { ...offerData, id: offerId },
        eventForSampleAction(action, Boolean(offerData?.isGuestOffer))
      );

      toast({
        title: action === "مطلوبة" ? t("offers_toast_sample_req") : t("offers_toast_sample_rcv"),
        description: action === "مطلوبة" ? t("offers_toast_sample_req_desc") : t("offers_toast_sample_rcv_desc")
      });
    } catch (error: any) {
      console.error("❌ handleSampleAction failed:", error);
      toast({ title: t("offers_toast_error"), description: `${t("offers_toast_sample_error")} ${error?.message || ""}`, variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  }

  const handleMarkAsCompleted = async (offerId: string) => {
    if (!firestore || !user) return
    setProcessingId(offerId)
    try {
      await updateDoc(doc(firestore, "offers", offerId), {
        status: "تم التسليم",
        completedAt: new Date().toISOString()
      })
      await updateDoc(doc(firestore, "rfqs", rfqId), {
        status: "Awarded",
        completedAt: new Date().toISOString()
      })

      // Notify the supplier that the supply has been confirmed as complete
      // (guests get the same news by WhatsApp/email — see queueGuestNotify below)
      const offerSnap = await getDoc(doc(firestore, "offers", offerId))
      const offerData = offerSnap.data()
      if (offerData?.supplierId && !offerData?.isGuestOffer) {
        await addDoc(collection(firestore, "users", offerData.supplierId, "notifications"), {
          userId: offerData.supplierId,
          organizationId: offerData.organizationId || offerData.supplierId,
          type: "supply_completed",
          i18n: { title: "pn_supply_completed_title", message: "pn_supply_completed", params: { rfq: offerData.rfqTitle || "" } },
          title: "🎉 تم تأكيد اكتمال التوريد",
          message: `قام المقاول بتأكيد اكتمال التوريد لطلب عروض الأسعار: ${offerData.rfqTitle || ""}`,
          offerId: offerId,
          rfqId: rfqId,
          createdAt: new Date().toISOString(),
          read: false
        })
      }

      if (offerData?.isGuestOffer) {
        queueGuestNotify({ ...offerData, id: offerId }, "supply_completed")
      }

      toast({
        title: t("offers_toast_completed_title"),
        description: t("offers_toast_completed_desc")
      })
    } catch (error: any) {
      toast({
        title: t("offers_toast_error"),
        description: t("offers_toast_error_desc", { message: error.message }),
        variant: "destructive"
      })
    } finally {
      setProcessingId(null)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "مقبول": return <Badge className="bg-success/10 text-success border-success/20">{t("offers_status_accepted")}</Badge>
      case "تم التسليم": return <Badge className="bg-blue-50 text-blue-600 border-blue-100">{t("offers_status_completed")}</Badge>
      case "مرفوض": return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-none">{t("offers_status_rejected")}</Badge>
      case "مطلوب تخفيض": return <Badge className="bg-amber-100 text-amber-700 border-none">{t("offers_status_reduction")}</Badge>
      default: return <Badge className="bg-amber-50 text-amber-600 border-amber-100">{t("offers_status_review")}</Badge>
    }
  }

  // «أفضل سعر» (R-16, `bestOfferIds`): the lowest total among live offers that
  // price EVERY line, when two or more compete and that supplier can be given
  // an order — a partial offer's smaller total is not a better price.
  // Prices stay the suppliers' own until the deadline when the org asked for a
  // sealed round (§5.1-4) — or until a manager closes it early. The cards still
  // show who quoted, when, with what attachment; the figure is behind a lock.
  const sealed = offersSealed(rfq as { deadline?: string | null; status?: string | null; closedEarly?: { at?: string } | null } | null, policies, new Date())
  // An expediter sees dates and quantities, never an amount (R-03).
  const seesPrices = procActor.seesPrices || profile?.role === "Admin"
  const showPrices = seesPrices && !sealed
  const rfqView = (rfq ? { ...(rfq as object), id: rfqId } : null) as RfqView | null
  const offerViews = (offers || []) as unknown as RfqOfferView[]
  const liveOffers = competingOffers(offerViews)
  const rfqOpen = (rfq as { status?: string } | null)?.status === "New"
  const canPick = canDecide && rfqOpen && !sealed
  // «يصدر له أمر»: a registered supplier needs a VAT number and a verified
  // record (unknown facts are not held against him); a guest is judged at the award.
  const canOrder = (o: OrderableOffer) => {
    if (o.isGuestOffer) return true
    const id = awardSupplierOrgId(o as RfqOfferView)
    const f = id ? supplierFacts[id] : null
    return !f || (f.hasVatNumber !== false && f.verified !== false)
  }
  const bestIds = sealed || !rfqOpen ? new Set<string>() : bestOfferIds(rfqView, offerViews as OrderableOffer[], canOrder)
  const guestOffers = offerViews.filter((o) => o.isGuestOffer).length
  const daysLeft = rfqView ? daysToDeadline(rfqView, new Date()) : null
  const deadlinePassed = daysLeft !== null && daysLeft < 0
  const stage = rfqView ? rfqStage(rfqView, new Date(), sealed) : null
  const extendable = acts && rfqOpen && !rfqView?.directAward && (!deadlinePassed || offerViews.length === 0 || !policies.sealOffersUntilDeadline)
  const printDoc = async () => {
    if (!rfqView) return
    const p = (profile || {}) as { companyName?: string; name?: string; taxNumber?: string; crNumber?: string }
    const number = rfqView.rfqNumber ? displayDocNumber(rfqView.rfqNumber, locale) : `#${rfqId.slice(0, 6)}`
    const model = rfqPrintModel(rfqView as unknown as Parameters<typeof rfqPrintModel>[0], { name: p.companyName || procOrgName || p.name || "", vat: p.taxNumber || null, cr: p.crNumber || null }, number, displayCity(rfqView.city || "", locale), policies)
    // The document a supplier off the platform receives carries the link he quotes through.
    const link = acts ? guestLinkUrl(user, { id: rfqId, status: rfqView.status, directAward: rfqView.directAward }) : Promise.resolve(null)
    if (!(await printRfqWithLink(model, locale, (k, params) => tProc(`rfqpo.print.${k}`, params), link))) {
      toast({ title: tProc("rfqpo.popup_blocked"), variant: "destructive" })
      return
    }
    if (firestore && acts) void logRfqDocument(firestore, writeActor, rfqId).catch((err) => console.warn("print not logged:", (err as { code?: string })?.code || err))
  }
  const editHref = projectId ? `/contractor/projects/${projectId}/tenders/new?edit=${rfqId}` : `/contractor/rfqs/new?edit=${rfqId}`
  const deleteDraft = async () => {
    if (!firestore || !rfq || (rfq as { status?: string }).status !== "Draft") return
    setDeletingDraft(true)
    try {
      if (projectId) {
        await releaseBoqDrawsForRfq(firestore, projectId, rfqId)
        await updateDoc(doc(firestore, "projects", projectId), { rfqIds: arrayRemove(rfqId) })
      }
      // Its needs go back to the desk before it goes (R-19).
      const stuck = await unlinkNeedsFromRfq(firestore, rfqId, rfqNeedSources(rfq as NeedLinkedRfq))
      await deleteDoc(doc(firestore, "rfqs", rfqId))
      toast({ title: t("rfq_delete_success"), description: stuck > 0 ? tProc("p2c.rfq.needs_not_released", { count: stuck }) : undefined })
      router.push("/contractor/rfqs")
    } catch (err) {
      console.error("draft not deleted:", (err as { code?: string })?.code || err)
      toast({ title: t("rfq_delete_failed"), variant: "destructive" })
    } finally {
      setDeletingDraft(false)
      setDraftDeleteOpen(false)
    }
  }
  const productCount = pricedProducts(rfqView).length
  const ratesMap = rfqView ? ratesByOffer(rfqView, liveOffers) : new Map<string, Map<number, number>>()
  const notes = useMemo(() => {
    if (!rfqView || sealed || !seesPrices) return []
    const byOrg = new Map<string, PurchaseOrder[]>()
    for (const o of orgOrders) byOrg.set(o.supplierOrgId, [...(byOrg.get(o.supplierOrgId) || []), o])
    return rfqNotes(rfqView, offerViews, {
      lastPaidOf: (name, unit) => lastPaid(priceHistory, name, unit),
      onTimeOf: (o) => {
        const id = awardSupplierOrgId(o)
        return id ? supplierScore(byOrg.get(id) || [], orgReceipts, new Date()).onTimePercent : null
      },
      policies,
      now: new Date(),
      value: rfqView.estimatedBudget ?? null,
    })
  }, [rfq, offers, sealed, seesPrices, orgOrders, orgReceipts, priceHistory, policies])
  const sourcingFor = (o: RfqOfferView) => {
    const id = awardSupplierOrgId(o)
    return id ? sourcingBlockOf(supplierRecords.get(id), profileOfFacts(supplierFacts[id]), new Date().toISOString().slice(0, 10)) : null
  }
  const blocksFor = (o: RfqOfferView) => {
    const id = awardSupplierOrgId(o)
    if (!id) return []
    const shadow = { id: "", basis: "rfq", isGuestSupplier: false, supplierOrgId: id, supplierName: "", lines: [], totalExVat: 0, status: "awaiting_approval", createdAt: new Date().toISOString() } as unknown as PurchaseOrder
    return poBlocks(shadow, { supplier: supplierFacts[id] || null, otherOrders: [], policies, now: new Date() })
  }
  const acceptOffer = (offer: any) => {
    if (!rfqView) return
    setPicks((prev) => pickOffer(rfqView, liveOffers, offer.id, prev))
    setAwardOpen(true)
  }

  // Offers contain competitor pricing/notes — never render them to a caller outside the
  // RFQ's own org, even though the `offers` collection's read rule only scopes by rfqId.
  const callerOrgId = (profile as any)?.organizationId || user?.uid
  if (!isLoading && rfq && callerOrgId && rfq.organizationId !== callerOrgId) {
    return (
      <PortalLayout>
        <div className="flex flex-col items-center justify-center gap-4 p-20 text-center">
          <h2 className="text-xl font-bold text-slate-800">{t("offers_access_denied_title")}</h2>
          <p className="text-muted-foreground max-w-md">{t("offers_access_denied_desc")}</p>
          <Button onClick={() => router.push("/contractor/rfqs")}>{t("offers_back_to_tenders")}</Button>
        </div>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout>
      <div className="space-y-6 text-start">

        {/* ── Unified Hero Banner ── */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 text-white shadow-2xl shadow-primary/20">
          <div className="absolute top-0 start-0 -mt-20 -ms-20 h-64 w-64 rounded-full bg-accent/20 blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 end-0 -mb-20 -me-20 h-64 w-64 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

          <div className="relative z-10 space-y-5">
            {/* Back */}
            <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1.5 text-white/60 hover:text-white hover:bg-white/10 -ms-2 h-8 rounded-xl px-3">
              <ArrowRight size={14} className="rotate-180 rtl:rotate-0 shrink-0" />
              <span className="text-sm">{t("offers_back_to_tenders")}</span>
            </Button>

            {/* Title + stat chips */}
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
              <div className="space-y-1.5 flex-1">
                <h1 className={cn("text-3xl font-black text-white", locale !== 'ar' && "tracking-tight")}>
                  {t("offers_page_title")}
                </h1>
                {rfq && (
                  <p className={cn("text-white/75 text-lg font-semibold", locale === 'ar' ? "leading-[1.6]" : "leading-snug")}>
                    {rfq.title}
                  </p>
                )}
                <p className="text-white/50 text-sm">{t("offers_page_desc")}</p>
              </div>

              {!isLoading && (
                <div className="flex flex-wrap items-start gap-3 shrink-0">
                  <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl px-5 py-3 text-center min-w-[84px]">
                    <p className="text-[10px] font-bold text-white/50 mb-1">{t("offers_total")}</p>
                    <p className="text-3xl font-black text-white leading-none">{offers?.length || 0}</p>
                    {guestOffers > 0 && <p className="mt-1 text-[10px] font-semibold text-violet-200">{tx("header.guests", { count: guestOffers })}</p>}
                  </div>
                  <div className="bg-success/20 backdrop-blur-sm border border-success/20 rounded-2xl px-5 py-3 text-center min-w-[84px]">
                    <p className="text-[10px] font-bold text-success/70 mb-1">{t("offers_accepted_count")}</p>
                    <p className="text-3xl font-black text-success leading-none">{offers?.filter((o: any) => o.status === "مقبول").length || 0}</p>
                  </div>
                  <div className="bg-amber-500/20 backdrop-blur-sm border border-amber-500/20 rounded-2xl px-5 py-3 text-center min-w-[84px]">
                    <p className="text-[10px] font-bold text-amber-300/70 mb-1">{t("offers_under_review_count")}</p>
                    <p className="text-3xl font-black text-amber-300 leading-none">{offers?.filter((o: any) => o.status === "قيد المراجعة").length || 0}</p>
                  </div>
                </div>
              )}
            </div>

            {/* RFQ metadata strip */}
            {rfq && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-4 border-t border-white/10 text-sm text-white/60">
                <Badge className="bg-white/10 text-white/80 border-white/10 font-medium rounded-lg hover:bg-white/20">
                  {displayCategory(rfq.category, locale)}
                </Badge>
                {rfq.subCategory && (
                  <span className="text-white/40 text-xs">{displaySubcategory(rfq.subCategory, locale)}</span>
                )}
                <div className="flex items-center gap-1.5">
                  <MapPin size={13} className="shrink-0" />
                  <span>{displayCity(rfq.city, locale)}{rfq.district ? ` · ${displayCity(rfq.district, locale)}` : ''}</span>
                </div>
                {stage && (
                  <span className="rounded-full bg-white px-0.5 py-0.5">
                    <RfqStagePill stage={stage} sealed={sealed} />
                  </span>
                )}
                {rfq.directAward ? (
                  <span className="text-xs">{tProc("rfqpo.list.direct_no_deadline")}</span>
                ) : rfq.deadline ? (
                  <div className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium", deadlinePassed ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-200")} suppressHydrationWarning>
                    <Calendar size={12} className="shrink-0" />
                    {t("offers_deadline_label", { date: fmtDate(rfq.deadline, locale) })}
                    {rfqOpen && daysLeft !== null && <span>· {deadlinePassed ? t("rfqv_passed") : tProc("rfqpo.list.left", { days: daysLeft })}</span>}
                  </div>
                ) : null}
                {rfq.products && rfq.products.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Package size={13} className="shrink-0" />
                    <span>{rfq.products.length} {t("offers_products_word")}</span>
                  </div>
                )}
                {rfq.pdfUrl && (
                  <a href={rfq.pdfUrl} target="_blank" rel="noopener noreferrer" download
                    className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white/80 rounded-lg px-3 py-1 text-xs transition-colors">
                    <File size={12} className="shrink-0" />
                    {t("offers_download_pdf")}
                  </a>
                )}
                {rfq.notes && (
                  <div className="flex items-center gap-1.5 bg-blue-500/15 text-blue-200 rounded-lg px-2.5 py-1 text-xs">
                    <Tag size={11} className="shrink-0" />
                    {t("offers_has_notes")}
                  </div>
                )}
                {rfq.requiresWarranty && (
                  <div className="flex items-center gap-1.5 bg-amber-500/20 text-amber-200 rounded-lg px-2.5 py-1 text-xs font-medium">
                    <ShieldCheck size={12} className="shrink-0" />
                    {t("offers_warranty_required_badge")}
                  </div>
                )}
                {rfq.createdByUserName && <span className="text-xs">{t("rfqv_by")} <b className="text-white/80">{rfq.createdByUserName}</b></span>}
                <span className="ms-auto">
                  <RfqNumber rfq={{ id: rfqId, rfqNumber: (rfq as { rfqNumber?: string | null }).rfqNumber ?? null }} />
                </span>
              </div>
            )}
          </div>
        </div>

        {ownerReads && <Callout tone="info">{tx("owner_reads")}</Callout>}
        {notMine && <Callout tone="info">{tx("not_mine", { name: (rfq as { createdByUserName?: string } | null)?.createdByUserName || "—" })}</Callout>}

        {rfqView && (rfq as { status?: string } | null)?.status === "Draft" ? (
          <RfqDraftPanel rfq={rfqView} projectName={(project as { name?: string } | null)?.name || null} editHref={editHref} canAct={acts} deleting={deletingDraft} onDelete={() => setDraftDeleteOpen(true)} />
        ) : (
        /* ── Tabs ── */
        <Tabs value={tab} onValueChange={setTab} className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg text-slate-800">{t("offers_title")}</h3>
            <TabsList className="bg-slate-100/50 border border-slate-200">
              <TabsTrigger value="list" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                {t("offers_tab_list")}
                {(offers || []).length > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold tabular-nums text-muted-foreground">{(offers || []).length}</span>}
              </TabsTrigger>
              <TabsTrigger value="compare" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">{t("offers_tab_compare")}</TabsTrigger>
              <TabsTrigger value="inquiries" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                {t("offers_tab_inquiries")}
                {(inquiries || []).length > 0 && (
                  <span
                    className={cn("rounded-full px-1.5 text-[10px] font-bold tabular-nums", unanswered ? "bg-warning text-white" : "bg-muted text-muted-foreground")}
                    title={unanswered ? tRfqd("qa.unanswered_title", { count: unanswered }) : undefined}
                  >
                    {unanswered || (inquiries || []).length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="details" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">{tRfqd("tab_details")}</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="list" className="space-y-4 m-0 mt-6">
            {isLoading ? (
              <div className="p-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <Loader2 className="animate-spin" size={40} />
                <p>{t("offers_loading")}</p>
              </div>
            ) : !offers || offers.length === 0 ? (
              <Card className="border-dashed border-2 border-slate-200 shadow-none">
                <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
                  <TrendingUp size={48} className="opacity-20" />
                  <p className="font-bold text-lg">{t("offers_no_data")}</p>
                  <p className="text-sm">{rfqOpen && deadlinePassed ? tx("offers.expired_empty") : t("offers_no_data_desc")}</p>
                </CardContent>
              </Card>
            ) : (
              <>
              {sealed && <Callout tone="info">{tRfqd("list.sealed_banner", { date: fmtDate(rfq?.deadline, locale) })}</Callout>}
              {offers.map((offer: any) => {
                const isBestOffer = bestIds.has(offer.id);
                const lead = leadDaysOf(offer)
                const orderable = canOrder(offer)
                const isMdmak = !!offer.isFromMdmak;
                const quotedLines = ratesMap.get(offer.id)?.size ?? 0
                const partial = awardMode(rfqView) === "lines" && productCount > 1 && quotedLines > 0 && quotedLines < productCount
                const awardedLines: number[] | null = Array.isArray(offer.awardedLines) ? offer.awardedLines : null

                return (
                  <Card key={offer.id} className={cn(
                    "shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden relative",
                    offer.status === "مقبول" ? "border-success/30" :
                    offer.status === "مرفوض" ? "border-slate-200 opacity-65" :
                    isMdmak ? "border-accent/40 bg-accent/[0.015]" :
                    offer.isGuestOffer ? "border-violet/30" :
                    isBestOffer ? "border-amber-300/70 shadow-amber-50" : "border-slate-100"
                  )} style={{
                    borderInlineStart: `3px solid ${
                      offer.status === "مقبول" ? "hsl(155 80% 35%)" :
                      offer.status === "مرفوض" ? "hsl(215 16% 75%)" :
                      isMdmak ? "hsl(186 79% 46%)" :
                      offer.isGuestOffer ? "hsl(var(--violet))" :
                      isBestOffer ? "hsl(35 92% 50%)" : "hsl(214 32% 88%)"
                    }`
                  }}>
                    {isMdmak && (
                      <div className="absolute top-0 end-0 z-10 flex items-center gap-1 bg-accent text-primary text-[10px] font-black px-3 py-1 rounded-bl-xl rounded-tr-sm shadow-sm whitespace-nowrap">
                        <Handshake size={11} /> مدماك تيك
                      </div>
                    )}
                    {!isMdmak && isBestOffer && offer.status === "قيد المراجعة" && (
                      <div className="absolute top-1 start-3 z-10 flex items-center gap-1 bg-amber-400 text-amber-950 text-[10px] font-black px-2.5 py-1 rounded-full shadow-sm whitespace-nowrap">
                        <TrendingUp size={11} /> {t("offers_best_price")}
                      </div>
                    )}
                    <CardContent className="p-0">
                      <div className="flex flex-col md:flex-row">
                        {/* Offer Details */}
                        <div className="p-6 flex-1 space-y-4">
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={cn(
                                "h-11 w-11 rounded-xl flex items-center justify-center text-white font-black text-lg shrink-0 shadow-sm select-none",
                                offer.status === "مقبول" ? "bg-success" :
                                offer.status === "مرفوض" ? "bg-slate-400" :
                                isBestOffer ? "bg-amber-500" : "bg-primary/80"
                              )}>
                                {((offer.companyName || offer.supplierName) || "؟").trim().charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                {offer.supplierId && !isMdmak && !offer.isGuestOffer ? (
                                  <Link
                                    href={`/contractor/supplier/profile/${offer.organizationId || offer.supplierId}`}
                                    className="font-bold text-sm text-slate-800 hover:text-primary transition-colors inline-flex items-center gap-1 group"
                                  >
                                    <span className="truncate">{offer.companyName || offer.supplierName || t("offers_registered_supplier")}</span>
                                    <ChevronLeft size={12} className="opacity-0 -mx-1 group-hover:opacity-100 group-hover:mx-0 transition-all rtl:rotate-0 ltr:rotate-180 shrink-0" />
                                  </Link>
                                ) : (
                                  <p className={cn("font-bold text-sm", isMdmak ? "text-accent" : "text-slate-800")}>
                                    {offer.companyName || offer.supplierName || t("offers_registered_supplier")}
                                  </p>
                                )}
                                {offer.isGuestOffer && (
                                  <span className="inline-flex items-center gap-1 bg-accent/10 text-accent text-[10px] font-black px-2 py-0.5 rounded-full border border-accent/20 mt-1">
                                    <Link2 size={9} />
                                    {t("offers_guest_badge")}
                                  </span>
                                )}
                                {rfqOpen && !sealed && offer.status !== "مرفوض" && (offer.isGuestOffer || !orderable) && (
                                  <p className="text-[11px] text-amber-700 mt-0.5 flex items-center gap-1">
                                    <AlertTriangle size={10} className="shrink-0" />
                                    {offer.isGuestOffer ? tx("card.guest_register_first") : tx("card.record_incomplete")}
                                  </p>
                                )}
                                {offer.status === "مرفوض" && offer.exclusion?.code && (
                                  <p className="text-[11px] text-slate-500 mt-0.5" dir="auto">
                                    {t("offers_exclusion_stored", { reason: t(`offers_exclusion_${offer.exclusion.code}`) })}
                                    {offer.exclusion.note ? ` — ${offer.exclusion.note}` : ""}
                                  </p>
                                )}
                                {offer.submittedByUserName && (
                                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                                    {t("offers_submitted_by", { name: offer.submittedByUserName })}
                                  </p>
                                )}
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  {offer.isManualOffer ? (
                                    <StatusPill tone="mute" className="text-[10px]">{tRfqd("list.recorded_by", { name: offer.recordedByName || "—" })}</StatusPill>
                                  ) : offer.directAward ? (
                                    <StatusPill tone="ok" className="text-[10px]">{tx("card.origin_direct")}</StatusPill>
                                  ) : !offer.isGuestOffer && !isMdmak ? (
                                    <StatusPill tone="mute" className="text-[10px]">{tx("card.origin_platform")}</StatusPill>
                                  ) : null}
                                  {offer.recordedEarly && <StatusPill tone="warn" className="text-[10px]">{tx("cmp.before_close")}</StatusPill>}
                                  {lead != null && <StatusPill tone="mute" className="text-[10px]">{tRfqd("cmp.lead_days", { days: lead })}</StatusPill>}
                                  {offer.sampleStatus === "مطلوبة" && <StatusPill tone="info" className="text-[10px]">{tx("card.sample_requested")}</StatusPill>}
                                  {offer.offerPdfUrl ? (
                                    <StatusPill tone="ok" className="text-[10px]">{tRfqd("list.official_quote")}</StatusPill>
                                  ) : (
                                    <StatusPill tone="warn" className="text-[10px]">{tRfqd("list.no_official_quote")}</StatusPill>
                                  )}
                                  {partial && showPrices && <StatusPill tone="warn" className="text-[10px]">{tRfqd("list.partial", { count: quotedLines, of: productCount })}</StatusPill>}
                                  <OfferTermsChips offer={offer} now={new Date()} />
                                  {offer.status === "مقبول" && awardedLines && productCount > 0 && awardedLines.length < productCount && (
                                    <StatusPill tone="ok" className="text-[10px]">{tRfqd("list.awarded_lines", { count: awardedLines.length, of: productCount })}</StatusPill>
                                  )}
                                </div>
                                {offer.isGuestOffer && offer.guestContact ? (
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                                    {offer.guestContact.email && (
                                      <a href={`mailto:${offer.guestContact.email}`} className="text-xs text-blue-600 hover:underline" dir="ltr">
                                        {offer.guestContact.email}
                                      </a>
                                    )}
                                    {offer.guestContact.phone && (
                                      <a href={`tel:${offer.guestContact.phone}`} className="text-xs text-blue-600 hover:underline" dir="ltr">
                                        {offer.guestContact.phone}
                                      </a>
                                    )}
                                    <GuestOfferProof offer={offer} />
                                    {offer.guestContact.vatNumber ? (
                                      <span className="text-xs text-muted-foreground" dir="ltr">{tx("card.vat", { vat: offer.guestContact.vatNumber })}</span>
                                    ) : (
                                      <span className="text-xs font-semibold text-warning">{tx("card.no_vat")}</span>
                                    )}
                                    {offer.guestInvite?.at && <span className="text-xs text-muted-foreground">{tx("card.invited", { date: fmtDate(offer.guestInvite.at, locale) })}</span>}
                                    {acts && rfqOpen && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setRegisterGuest({
                                            offerId: offer.id,
                                            name: offer.companyName || offer.supplierName || offer.guestContact?.name || "",
                                            phone: offer.guestContact?.phone || null,
                                            email: offer.guestContact?.email || null,
                                            vatNumber: offer.guestContact?.vatNumber || null,
                                          })
                                        }
                                        className="inline-flex items-center gap-1 rounded text-xs font-bold text-module hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                      >
                                        {tx("card.register")}
                                      </button>
                                    )}
                                    {guestEventForOffer(offer) ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          queueGuestNotify(offer, guestEventForOffer(offer), {
                                            note: offer.reductionNote,
                                            targetPrice: offer.targetPrice ? String(offer.targetPrice) : null,
                                          })
                                        }
                                        className="inline-flex items-center gap-1 text-xs font-bold text-accent hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
                                      >
                                        <Send size={10} />
                                        {t("guest_notify_resend")}
                                      </button>
                                    ) : acts && offer.guestContact.phone ? (
                                      // Nothing to announce yet: «أبلغ المورد» opens the sender's own WhatsApp chat with him.
                                      <a
                                        href={waChatLink(offer.guestContact.phone)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 rounded text-xs font-bold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                      >
                                        <Phone size={10} aria-hidden="true" />
                                        {t("guest_notify_resend")}
                                      </a>
                                    ) : null}
                                  </div>
                                ) : (
                                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                    <p className="text-xs text-muted-foreground font-mono">{offer.supplierId?.substring(0, 10)}...</p>
                                    <GuestOfferProof offer={{ guestContact: null, guestPapers: offer.supplierPapers }} />
                                  </div>
                                )}
                                {offer.supplierWebsite && (
                                  <a
                                    href={offer.supplierWebsite.startsWith('http') ? offer.supplierWebsite : `https://${offer.supplierWebsite}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1"
                                  >
                                    <Globe size={10} />
                                    {t("offers_visit_website")}
                                  </a>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {offer.supplierId && !isMdmak && !offer.isGuestOffer && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  asChild
                                  className="h-8 px-3 rounded-lg text-xs font-bold text-primary hover:text-primary hover:bg-primary/10 gap-1"
                                >
                                  <Link href={`/contractor/supplier/profile/${offer.organizationId || offer.supplierId}`}>
                                    <Briefcase size={12} />
                                    {t("offers_view_supplier_profile")}
                                  </Link>
                                </Button>
                              )}
                              {getStatusBadge(offer.status || "قيد المراجعة")}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-3 text-sm mt-1">
                            <div className={cn(
                              "flex items-baseline gap-2 px-4 py-2.5 rounded-2xl border",
                              isBestOffer ? "bg-amber-50 border-amber-200/60" : "bg-primary/5 border-primary/10"
                            )}>
                              <span className="text-xs text-muted-foreground me-0.5">{t("offers_proposed_price")}:</span>
                              {sealed ? (
                                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Lock size={13} aria-hidden="true" />
                                  {tRfqd("list.sealed_until", { date: fmtDate(rfq?.deadline, locale) })}
                                </span>
                              ) : showPrices ? (
                                <>
                                  <span className={cn("font-black text-2xl tabular-nums", isBestOffer ? "text-amber-600" : "text-primary")}>
                                    {offer.price}
                                  </span>
                                  <span className="text-sm font-medium text-muted-foreground">{t("offers_currency_sar")}</span>
                                </>
                              ) : (
                                <span className="font-black text-lg text-muted-foreground">—</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground" suppressHydrationWarning>
                              <Calendar size={14} />
                              <span suppressHydrationWarning>{fmtDate(offer.createdAt, locale)}</span>
                            </div>
                            {offer.deliveryFrequency && (
                              <div className="flex items-center gap-2 sm:col-span-2">
                                <Calendar size={14} className="text-muted-foreground" />
                                <span className="text-slate-600">{t("offers_delivery_frequency")}</span>
                                <span className="font-medium">{offer.deliveryFrequency}</span>
                              </div>
                            )}
                          </div>

                          {showPrices && priceTrail(offer).length > 0 && (
                            <p className="text-xs font-semibold text-success" dir="auto">
                              {tRfqd("list.reduced_from", { prices: priceTrail(offer).map((n) => n.toLocaleString("en-US")).join(" ← ") })}
                            </p>
                          )}
                          {offer.status === "مطلوب تخفيض" && (
                            <p className="text-xs font-semibold text-warning">{tRfqd("list.reduction_awaiting")}</p>
                          )}

                          {/* Guest suppliers have no chat thread — their note
                              travels with the offer itself */}
                          {offer.isGuestOffer && (offer.guestReplyNote || offer.guestMessage) && (
                            <div className="mt-3 p-3 rounded-xl border border-accent/20 bg-accent/5">
                              <p className="text-[11px] font-bold text-accent uppercase tracking-wider mb-1">
                                {t("offers_guest_note")}
                              </p>
                              <p className="text-sm text-slate-700 leading-relaxed" dir="auto">
                                {offer.guestReplyNote || offer.guestMessage}
                              </p>
                            </div>
                          )}
                          {!offer.isGuestOffer && offer.supplierNote && (
                            <div className="mt-3 rounded-xl border bg-muted/40 p-3">
                              <p className="mb-1 text-[11px] font-bold text-muted-foreground">{tProc("p2c.offer.supplier_note")}</p>
                              <p className="text-sm leading-relaxed text-foreground/80" dir="auto">
                                «{offer.supplierNote}»
                              </p>
                            </div>
                          )}

                          {/* The rates the RFQ asked for, before the decision — until now they
                              first appeared on the approved order. offerRates sets aside rates
                              that no longer add up to the offer (a total revised on its own). */}
                          {(() => {
                            const rates = offerRates(rfq as Parameters<typeof offerRates>[0], offer).filter((r) => r.quoted)
                            if (!rates.length || !showPrices) return null
                            return (
                              <div className="mt-3 pt-3 border-t border-slate-200">
                                <p className="text-xs font-bold text-slate-600 mb-2">{t("offers_line_prices")}</p>
                                <div className="rounded border border-slate-100 bg-white divide-y text-sm">
                                  {rates.map((r) => (
                                    <div key={r.rfqProductIndex} className="flex items-center justify-between gap-2 p-2">
                                      <span className="min-w-0 truncate font-medium" dir="auto">{r.name}</span>
                                      <span className="shrink-0 tabular-nums text-slate-600" dir="ltr">
                                        {tShared("offer_line_qty", { qty: r.quantity, unit: r.unit })} × {r.unitPrice.toLocaleString("en-US")}
                                        <span className="ms-2 font-bold text-success">{(Math.round(r.quantity * r.unitPrice * 100) / 100).toLocaleString("en-US")} {t("offers_currency_sar")}</span>
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })()}

                          {/* A schedule only when there is one: a single-shipment offer carries
                              one synthetic batch whose "quantity" summed tons and sheets. */}
                          {offer.deliveryBatches && (offer.deliveryBatches.length > 1 || (rfq as { shipmentMode?: string } | null)?.shipmentMode === "multiple") && (
                            <div className="mt-3 pt-3 border-t border-slate-200">
                              <p className="text-xs font-bold text-slate-600 mb-2">{t("offers_batches")}</p>
                              <div className="space-y-2">
                                {offer.deliveryBatches.map((batch: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between bg-white p-2 rounded border border-slate-100 text-sm">
                                    <div className="flex items-center gap-2">
                                      <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-bold">
                                        {t("offers_batch_no", { number: idx + 1 })}
                                      </span>
                                      <span className="text-slate-600">{batch.quantity}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Calendar size={12} className="text-muted-foreground" />
                                      <span className="text-slate-600">{batch.deliveryDate}</span>
                                      {showPrices && <span className="font-bold text-success">{batch.price} {t("offers_currency_sar")}</span>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              {offer.totalBatchesPrice && showPrices && (
                                <div className="mt-2 flex justify-end">
                                  <span className="text-xs text-muted-foreground">
                                    {t("offers_total_batches_price")} <span className="font-bold text-success">{offer.totalBatchesPrice} {t("offers_currency_sar")}</span>
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          {offer.offerPdfUrl && (
                            <div className="mt-4 p-3 bg-blue-50/50 rounded-xl border border-blue-100 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <File size={18} className="text-blue-600" />
                                <span className="text-sm font-bold text-slate-700">{t("offers_attached_file")}</span>
                              </div>
                              <Button variant="outline" size="sm" asChild className="h-8 rounded-lg bg-white border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white transition-all">
                                <a href={offer.offerPdfUrl} target="_blank" rel="noopener noreferrer">
                                  <Download size={12} className="me-1" aria-hidden="true" />
                                  {t("offers_view_file")}
                                </a>
                              </Button>
                            </div>
                          )}
                          {rfq?.requiresWarranty && (
                            (guaranteesByOfferId[offer.id] || []).length > 0 ? (
                              <div className="mt-3 space-y-2">
                                {(guaranteesByOfferId[offer.id] || []).map((g: any) => (
                                  <div key={g.id} className="p-3 bg-amber-50/60 rounded-xl border border-amber-100 flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <ShieldCheck size={18} className="text-amber-600 shrink-0" />
                                      <div className="min-w-0">
                                        <span className="text-sm font-bold text-slate-700 block truncate">{g.itemName || g.itemNameEn}</span>
                                        <span className="text-xs text-muted-foreground">
                                          {g.status === "accepted" ? t("offers_guarantee_accepted") : g.status === "rejected" ? t("offers_guarantee_rejected") : t("offers_guarantee_pending")}
                                        </span>
                                      </div>
                                    </div>
                                    {g.fileUrl && (
                                      <Button variant="outline" size="sm" asChild className="h-8 rounded-lg bg-white border-amber-200 text-amber-700 hover:bg-amber-600 hover:text-white transition-all shrink-0">
                                        <a href={g.fileUrl} target="_blank" rel="noopener noreferrer">
                                          <Download size={12} className="me-1" aria-hidden="true" />
                                          {t("offers_view_warranty_file")}
                                        </a>
                                      </Button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex items-center gap-2">
                                <ShieldCheck size={18} className="text-slate-400" />
                                <span className="text-sm text-muted-foreground">{t("offers_warranty_missing")}</span>
                              </div>
                            )
                          )}
                        </div>

                        {/* Action Buttons - Pending */}
                        {offer.status === "قيد المراجعة" && acts && (
                          <div className="bg-slate-50/60 p-5 grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-col items-center justify-center gap-2.5 md:border-s border-t md:border-t-0 min-w-[190px] border-slate-100">
                            {!sealed && rfqOpen && (
                            <>
                            {canDecide && (
                            <Button variant="success"
                              onClick={() => acceptOffer(offer)}
                              disabled={processingId === offer.id}
                              className="w-full gap-2 rounded-full transition-all hover:shadow-lg hover:shadow-success/20"
                              size="sm"
                            >
                              {processingId === offer.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                              {t("offers_accept")}
                            </Button>
                            )}
                            <Button
                              onClick={() => setExcludeTarget({ id: offer.id, name: offer.companyName || offer.supplierName || t("offers_registered_supplier"), total: offerTotal(offer), raw: offer })}
                              disabled={processingId === offer.id}
                              variant="ghost"
                              className="w-full gap-2 rounded-full text-red-600 hover:text-red-700 hover:bg-red-50 transition-all"
                              size="sm"
                            >
                              <XCircle size={14} />
                              {tRfqd("exclude.button")}
                            </Button>
                            </>
                            )}
                            {(!offer.sampleStatus || offer.sampleStatus === "تم الاستلام") && (
                              <Button
                                onClick={() => offer.sampleStatus ? handleSampleAction(offer.id, "مطلوبة") : setSampleRequestOffer(offer)}
                                disabled={processingId === offer.id}
                                variant="outline"
                                className="w-full gap-2 rounded-full border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 hover:border-blue-500 hover:text-blue-800 transition-all font-medium mt-1"
                                size="sm"
                              >
                                <Box size={14} />
                                {offer.sampleStatus ? t("offers_request_another_sample") : t("offers_request_sample")}
                              </Button>
                            )}
                            {offer.sampleStatus === "تم الإرسال" && (
                              <div className="w-full space-y-2">
                                <Button
                                  onClick={() => handleSampleAction(offer.id, "تم الاستلام")}
                                  disabled={processingId === offer.id}
                                  variant="outline"
                                  className="w-full gap-2 rounded-full border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-500 hover:text-emerald-800 transition-all font-medium mt-1"
                                  size="sm"
                                >
                                  <CheckCircle2 size={14} />
                                  {t("offers_confirm_receipt")}
                                </Button>
                                <Button variant="primary"
                                  onClick={() => openChat(offer)}
                                  disabled={openingChat === offer.id}
                                  className="w-full gap-2 rounded-full transition-all"
                                  size="sm"
                                >
                                  <MessageSquare size={14} />
                                  {t("offers_chat_sample")}
                                </Button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Action Buttons - Accepted */}
                        {offer.status === "مقبول" && (
                          <div className="bg-success/5 p-5 grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-col items-center justify-center gap-2.5 md:border-s border-t md:border-t-0 min-w-[190px] border-success/15">
                            {/* The purchase order over this award (PRD 3.0) — or, for an
                                award whose order never got made, the way to raise it. */}
                            {offer.poId ? (
                              <PoStatusPill poId={offer.poId} poNumber={offer.poNumber} />
                            ) : canDecide ? (
                              <Button
                                onClick={() => handleRaiseOrder(offer)}
                                disabled={raisingOrderId === offer.id}
                                variant="outline"
                                className="w-full gap-2 rounded-full border-module/40 text-module bg-module/10 hover:bg-module/20 text-xs font-bold"
                                size="sm"
                              >
                                {raisingOrderId === offer.id ? <Loader2 size={14} className="animate-spin" /> : <FileCheck size={14} />}
                                {t("offers_award_raise_order")}
                              </Button>
                            ) : null}
                            {deliveryByOfferId[offer.id] && deliveryByOfferId[offer.id].status === "pending_confirmation" && (
                              <div className="w-full p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs space-y-1.5 mb-1">
                                <p className="font-bold text-amber-800 flex items-center gap-1.5">
                                  <Truck size={12} />
                                  {t("delivery_notice_banner")}
                                </p>
                                <p className="text-amber-700">{t("delivery_notice_driver")}: {deliveryByOfferId[offer.id].deliveryPersonName}</p>
                                <p className="text-amber-700" suppressHydrationWarning>
                                  {t("delivery_notice_date")}: {fmtDate(deliveryByOfferId[offer.id].deliveryDate, locale)}
                                </p>
                              </div>
                            )}
                            {deliveryByOfferId[offer.id] && deliveryByOfferId[offer.id].status === "pending_confirmation" && canConfirmDelivery && (
                              deliveryByOfferId[offer.id].poId || offer.poId ? (
                                // A delivery against an order is counted at the gate, line by line.
                                <Button variant="success" asChild className="w-full gap-2 rounded-full transition-all text-xs" size="sm">
                                  <Link href={procLinks.receipt(deliveryByOfferId[offer.id].id)}>
                                    <CheckCircle2 size={14} />
                                    {t("delivery_confirm_btn")}
                                  </Link>
                                </Button>
                              ) : (
                                <Button variant="success"
                                  onClick={() => setConfirmDeliveryDoc(deliveryByOfferId[offer.id])}
                                  className="w-full gap-2 rounded-full transition-all text-xs"
                                  size="sm"
                                >
                                  <CheckCircle2 size={14} />
                                  {t("delivery_confirm_btn")}
                                </Button>
                              )
                            )}
                            {deliveryByOfferId[offer.id] && deliveryByOfferId[offer.id].status === "confirmed" && (
                              <>
                                <Badge className="w-full justify-center bg-success/10 text-success border-success/20 gap-1.5 py-1.5">
                                  <CheckCircle2 size={12} />
                                  {t("delivery_confirmed_badge")}
                                </Badge>
                                <Link href={`/contractor/receipts/${deliveryByOfferId[offer.id].id}`} className="w-full">
                                  <Button variant="outline" className="w-full gap-2 rounded-full text-xs" size="sm">
                                    <FileCheck size={14} />
                                    {t("delivery_view_receipt")}
                                  </Button>
                                </Link>
                              </>
                            )}
                            {/* Contact follows disclosure: while the award is internal (Finance
                                has not approved, or the order is not sent) the supplier has been
                                told nothing — a chat or WhatsApp now would tell him. */}
                            <AwardDisclosure offer={offer}>
                              {(disclosed, withdrawn) =>
                                disclosed ? (
                                  <>
                                    <Button variant="primary"
                                      onClick={() => openChat(offer)}
                                      disabled={openingChat === offer.id}
                                      className="w-full gap-2 rounded-full transition-all hover:shadow-lg text-xs"
                                      size="sm"
                                    >
                                      {openingChat === offer.id ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                                      {t("offers_open_chat")}
                                    </Button>
                                    <SupplierWhatsAppButton supplierId={offer.supplierId} guestPhone={offer.isGuestOffer ? offer.guestContact?.phone : undefined} />
                                    {/* With an order, completion is the order's (receipts, close); the
                                        old button would set a second, parallel "delivered". */}
                                    {!offer.poId && (
                                      <Button
                                        onClick={() => handleMarkAsCompleted(offer.id)}
                                        disabled={processingId === offer.id}
                                        className="w-full bg-blue-600 hover:bg-blue-700 gap-2 rounded-full transition-all text-xs"
                                        size="sm"
                                      >
                                        {processingId === offer.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                        {t("offers_confirm_completion")}
                                      </Button>
                                    )}
                                  </>
                                ) : (
                                  <p className="w-full text-[11px] leading-relaxed text-slate-600">{t(withdrawn ? "offers_award_withdrawn" : "offers_award_internal")}</p>
                                )
                              }
                            </AwardDisclosure>
                          </div>
                        )}

                        {/* Action Buttons - Completed */}
                        {offer.status === "تم التسليم" && (
                          <div className="bg-blue-50/30 p-5 grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-col items-center justify-center gap-2.5 md:border-s border-t md:border-t-0 min-w-[190px] border-blue-100">
                            <Button variant="primary"
                              onClick={() => openChat(offer)}
                              disabled={openingChat === offer.id}
                              className="w-full gap-2 rounded-full transition-all hover:shadow-lg text-xs"
                              size="sm"
                            >
                              {openingChat === offer.id ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                              {t("offers_open_chat")}
                            </Button>
                            <SupplierWhatsAppButton supplierId={offer.supplierId} guestPhone={offer.isGuestOffer ? offer.guestContact?.phone : undefined} />
                            {offer.contractorRated ? (
                              <Button
                                disabled
                                className="w-full bg-slate-100 text-slate-400 gap-2 rounded-full border-none text-xs"
                                size="sm"
                              >
                                <Star size={14} className="fill-slate-300 text-slate-300" />
                                {t("offers_supplier_rated")}
                              </Button>
                            ) : (
                              <Button
                                onClick={() => setReviewOffer(offer)}
                                className="w-full bg-amber-500 hover:bg-amber-600 gap-2 rounded-full transition-all hover:shadow-lg hover:shadow-amber-500/20 text-xs"
                                size="sm"
                              >
                                <Star size={14} className="fill-white" />
                                {t("offers_rate_supplier")}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
              </>
            )}
            {rfqView && rfqOpen && !rfqView.directAward && !deadlinePassed && (
              <RfqGuestLinkPanel rfqId={rfqId} canShare={acts} onShare={() => setShareOpen(true)} />
            )}
            {rfqView && !isLoading && (
              <RfqInvitedList rfq={rfqView} offers={offerViews} guestOffers={guestOffers} favoriteIds={(profile as { favoriteSuppliers?: string[] } | null)?.favoriteSuppliers || []} />
            )}
          </TabsContent>

          <TabsContent value="compare" className="m-0 mt-6">
            {rfqView && (
              <RfqComparison
                rfq={rfqView}
                offers={offerViews}
                picks={picks}
                onPicksChange={setPicks}
                canPick={canPick}
                showPrices={seesPrices}
                sealed={sealed}
                sealedUntil={fmtDate(rfq?.deadline, locale)}
                notes={notes}
                onAward={() => setAwardOpen(true)}
                canCloseEarly={closes && rfqOpen}
                onCloseEarly={() => setCloseNowOpen(true)}
                round={canAskReductionRound(rfqView, liveOffers.length, sealed) ? (acts ? "can" : "none") : rfqView.reductionRound ? "done" : "none"}
                onAskRound={() => setRoundOpen(true)}
                projectName={(project as { name?: string } | null)?.name || null}
              />
            )}
          </TabsContent>

          <TabsContent value="inquiries" className="m-0 mt-6">
            <InquiriesSection
              rfqId={rfqId}
              rfqTitle={rfq?.title || ""}
              inquiries={(inquiries || []) as InquiryDoc[]}
              isLoading={inquiriesLoading}
              canAnswer={acts}
              actor={writeActor}
              recipientsFor={(inq) => answerRecipients(rfq || {}, offerViews, inq, user?.uid || "")}
            />
          </TabsContent>

          <TabsContent value="details" className="m-0 mt-6">
            {rfqView && (
              <RfqDetailsPanel
                rfq={rfqView}
                orders={rfqOrders}
                showPrices={seesPrices}
                canCancel={acts && canCancelRfq(rfqView)}
                onCancel={() => setCancelOpen(true)}
                onRecordOffer={acts && rfqOpen ? () => setManualOpen(true) : null}
                onExtend={
                  extendable
                    ? () =>
                        setExtendTarget({
                          id: rfqId,
                          title: rfqView.title || "",
                          passed: deadlinePassed,
                          invited: [...(rfqView.allowedSupplierOrgIds || []), ...(rfqView.invitedSupplierOrgIds || [])],
                          categories: [rfqView.category, ...((rfqView.products || []) as Array<{ category?: string | null }>).map((p) => p.category)].filter((c): c is string => Boolean(c)),
                        })
                    : null
                }
                extendLabel={deadlinePassed && offerViews.length === 0 ? tProc("rfqpo.list.republish") : t("rfqv_edit_open")}
                onPrint={() => void printDoc()}
                projectName={(project as { name?: string } | null)?.name || null}
              />
            )}
          </TabsContent>
        </Tabs>
        )}
      </div>

      {rfqView && (
        <RfqAwardDialog
          open={awardOpen}
          onOpenChange={setAwardOpen}
          rfq={rfqView}
          projectName={(project as { name?: string } | null)?.name || null}
          offers={offerViews}
          picks={picks}
          actor={writeActor}
          policies={policies}
          orgName={procOrgName || activeCompanyName || null}
          blocksFor={blocksFor}
          budget={awardBudget}
          onDone={onAwarded}
          sourcingFor={sourcingFor}
        />
      )}
      <ExcludeOfferDialog
        open={!!excludeTarget}
        onOpenChange={(o) => !o && setExcludeTarget(null)}
        rfqId={rfqId}
        offer={excludeTarget}
        actor={writeActor}
        showPrice={showPrices}
        onDone={onExcluded}
      />
      <CloseNowDialog
        open={closeNowOpen}
        onOpenChange={setCloseNowOpen}
        rfqId={rfqId}
        actor={writeActor}
        offered={offerViews.length}
        invited={((rfq as { allowedSupplierOrgIds?: string[] } | null)?.allowedSupplierOrgIds || []).length}
        onDone={() => {
          setCloseNowOpen(false)
          setTab("compare")
          toast({ title: tRfqd("close.done") })
        }}
      />
      {rfqView && (
        <ReductionRoundDialog
          open={roundOpen}
          onOpenChange={setRoundOpen}
          rfqId={rfqId}
          rfqTitle={rfqView.title || ""}
          products={pricedProducts(rfqView)}
          lastPriceOf={(p) => lastPaid(priceHistory, p.name, p.unit)?.price ?? null}
          offerIds={liveOffers.filter((o) => o.status !== "مقبول").map((o) => o.id)}
          actor={writeActor}
          onDone={(reached, message) => {
            setRoundOpen(false)
            for (const id of reached) {
              const o = offers?.find((x: any) => x.id === id)
              if (o) void notifyDecision(o, "مطلوب تخفيض", message, undefined, true)
            }
            toast({ title: tRfqd("round.done", { count: reached.length }) })
          }}
        />
      )}
      {rfqView && (
        <RfqManualOfferDialog
          open={manualOpen}
          onOpenChange={setManualOpen}
          rfq={rfqView}
          pendingInvitees={invitedRows(rfqView, offerViews).filter((r) => !r.offered).map((r) => r.orgId)}
          sealed={sealed}
          actor={writeActor}
          onDone={() => {
            setManualOpen(false)
            toast({ title: tRfqd("manual.done") })
          }}
        />
      )}
      <CancelRfqDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        rfqId={rfqId}
        actor={writeActor}
        onDone={() => {
          setCancelOpen(false)
          toast({ title: tRfqd("cancel.done") })
        }}
      />

      <Dialog open={!!sampleRequestOffer} onOpenChange={(open) => !open && setSampleRequestOffer(null)}>
        <DialogContent className="sm:max-w-md" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t("offers_sample_dialog_title")}</DialogTitle>
            <DialogDescription className="text-start mt-2 text-slate-600">
              {t("offers_sample_dialog_desc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-row justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={async () => {
                if (sampleRequestOffer) {
                  await handleSampleAction(sampleRequestOffer.id, "مطلوبة");
                  setSampleRequestOffer(null);
                }
              }}
              disabled={!!processingId}
            >
              {t("offers_send_notification")}
            </Button>
            <Button variant="primary"
              
              onClick={async () => {
                if (sampleRequestOffer) {
                  await handleSampleAction(sampleRequestOffer.id, "مطلوبة");
                  openChat(sampleRequestOffer);
                  setSampleRequestOffer(null);
                }
              }}
              disabled={!!processingId || !!openingChat}>
              {t("offers_send_and_chat")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Delivery Dialog */}
      <Dialog open={!!confirmDeliveryDoc} onOpenChange={(open) => { if (!open) { setConfirmDeliveryDoc(null); setReceiverName("") } }}>
        <DialogContent className="sm:max-w-md" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader className="text-start sm:text-start">
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-success" />
              {t("delivery_confirm_title")}
            </DialogTitle>
            <DialogDescription>{t("delivery_confirm_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {confirmDeliveryDoc && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                <p className="text-slate-600">{t("delivery_notice_driver")}: <span className="font-bold">{confirmDeliveryDoc.deliveryPersonName}</span></p>
                <p className="text-slate-600" suppressHydrationWarning>{t("delivery_notice_date")}: <span className="font-bold">{fmtDate(confirmDeliveryDoc.deliveryDate, locale)}</span></p>
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("delivery_receiver_label")} <span className="text-destructive">*</span></Label>
              <Input
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                placeholder={t("delivery_receiver_placeholder")}
                disabled={isConfirmingDelivery}
              />
            </div>
          </div>
          <DialogFooter className={cn("flex flex-row gap-2 mt-2", locale === 'ar' ? "flex-row-reverse justify-start" : "justify-end")}>
            <Button variant="outline" onClick={() => setConfirmDeliveryDoc(null)} disabled={isConfirmingDelivery}>{t("cancel")}</Button>
            <Button variant="success"
              onClick={handleConfirmDelivery}
              disabled={isConfirmingDelivery || !receiverName.trim()}
              className="gap-2"
            >
              {isConfirmingDelivery ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
              {t("delivery_confirm_submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      {reviewOffer && (
        <ReviewDialog
          open={!!reviewOffer}
          onOpenChange={(open) => !open && setReviewOffer(null)}
          offerId={reviewOffer.id}
          rfqId={rfqId}
          reviewerId={user?.uid || ""}
          reviewerName={activeCompanyName || ""}
          reviewerRole="Contractor"
          revieweeId={reviewOffer.organizationId || reviewOffer.supplierId}
          revieweeName={reviewOffer.supplierName || "المورد"}
          revieweeRole="Supplier"
          onSubmitSuccess={() => setReviewOffer(null)}
        />
      )}

      {/* Guest supplier notification — pushes the workflow step out to a
          share-link supplier on WhatsApp or email */}
      <GuestNotifyDialog target={guestNotify} onClose={() => setGuestNotify(null)} />
      <ShareRfqLinkDialog rfq={shareOpen && rfq ? { id: rfqId, title: (rfq as { title?: string }).title } : null} isOpen={shareOpen} onClose={() => setShareOpen(false)} onPrint={() => void printDoc()} />
      <RfqExtendDialog target={extendTarget} actor={writeActor} options={supplierOptions} orgId={procOrgId} onOpenChange={(o) => !o && setExtendTarget(null)} />
      <RfqRegisterGuestDialog guest={registerGuest} rfqId={rfqId} rfqTitle={(rfq as { title?: string } | null)?.title || ""} orgName={procOrgName || activeCompanyName || ""} actor={writeActor} onOpenChange={(o) => !o && setRegisterGuest(null)} />
      <Dialog open={draftDeleteOpen} onOpenChange={(o) => !deletingDraft && setDraftDeleteOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="text-start">
            <DialogTitle>{t("rfq_delete_confirm_title")}</DialogTitle>
            <DialogDescription>{t("rfq_delete_confirm_desc", { title: (rfq as { title?: string } | null)?.title || "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setDraftDeleteOpen(false)} disabled={deletingDraft}>
              {t("cancel")}
            </Button>
            <Button onClick={deleteDraft} disabled={deletingDraft} className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deletingDraft && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {t("rfq_delete_tender")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  )
}

type InquiryDoc = InquiryLike & {
  id: string
  question?: string
  supplierName?: string
  submittedByUserName?: string
  createdAt?: string
  repliedAt?: string
  repliedByUserName?: string
  sentToAll?: boolean
}

// Supplier queries (R-15): an answer is published on the query and reaches
// every invitee — no supplier gets an informational edge.
function InquiriesSection({
  rfqId,
  rfqTitle,
  inquiries,
  isLoading,
  canAnswer,
  actor,
  recipientsFor,
}: {
  rfqId: string
  rfqTitle: string
  inquiries: InquiryDoc[]
  isLoading: boolean
  canAnswer: boolean
  actor: RfqWriteActor
  recipientsFor: (inquiry: InquiryDoc) => string[]
}) {
  const t = useTranslations("Portal.Contractor")
  const tRfqd = useTranslations("Portal.Procurement.rfqd")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const [replyText, setReplyText] = useState<{ [key: string]: string }>({})
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [showReply, setShowReply] = useState<string | null>(null)
  const { toast } = useToast()
  const firestore = useFirestore()
  const unanswered = unansweredCount(inquiries)

  const handleReply = async (inquiry: InquiryDoc) => {
    const text = replyText[inquiry.id]?.trim()
    if (!firestore || !text) return
    setReplyingTo(inquiry.id)
    try {
      const told = await answerQuery(firestore, actor, { rfqId, rfqTitle, inquiryId: inquiry.id, answer: text, recipients: recipientsFor(inquiry) }, { copy: tShared })
      toast({ title: t("offers_inq_sent_title"), description: tRfqd("qa.sent_to_all", { count: told }) })
      setReplyText((prev) => ({ ...prev, [inquiry.id]: "" }))
      setShowReply(null)
    } catch {
      toast({ title: t("offers_toast_error"), description: t("offers_inq_failed"), variant: "destructive" })
    } finally {
      setReplyingTo(null)
    }
  }

  if (isLoading) {
    return (
      <Card className="border-none shadow-sm">
        <CardContent className="p-12 flex justify-center">
          <Loader2 className="animate-spin text-primary" size={32} />
        </CardContent>
      </Card>
    )
  }

  if (!inquiries.length) {
    return (
      <Card className="border-dashed border-2 border-slate-200 shadow-none">
        <CardContent className="p-16 flex flex-col items-center text-center text-muted-foreground gap-3">
          <MessageSquare size={48} className="opacity-20" />
          <p className="font-bold text-lg">{t("offers_inq_no_data")}</p>
          <p className="text-sm">{tRfqd("qa.empty")}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="border-b bg-slate-50/50">
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <MessageSquare size={20} className="text-primary" />
          {t("offers_inquiries_title", { count: inquiries.length })}
          {unanswered > 0 && <span className="text-sm font-bold text-destructive">· {tRfqd("qa.unanswered", { count: unanswered })}</span>}
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">{tRfqd("qa.to_all_note")}</p>
      </CardHeader>
      <CardContent className="p-6">
        <div className="space-y-4">
          {inquiries.map((inq) => (
            <div key={inq.id} className="p-4 bg-white rounded-xl border border-slate-200 hover:border-primary/30 transition-colors">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <MessageSquare size={18} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-bold text-sm text-slate-700">
                      {inq.supplierName || t("offers_registered_supplier")}
                      {inq.submittedByUserName && <span className="text-[11px] font-normal text-slate-500 ms-2">({inq.submittedByUserName})</span>}
                    </span>
                    <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                      {fmtDate(inq.createdAt, locale)}
                    </span>
                  </div>
                  <p className="text-slate-600 text-sm leading-relaxed" dir="auto">{inq.question}</p>

                  {inq.reply ? (
                    <div className="mt-3 p-3 bg-success/5 rounded-lg border border-success/20">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <CheckCircle2 size={14} className="text-success" />
                        <span className="text-xs font-bold text-success">{t("offers_inq_reply_label")}</span>
                        {inq.repliedByUserName && <span className="text-[11px] text-success/80">({inq.repliedByUserName})</span>}
                        <span className="text-xs text-success/70" suppressHydrationWarning>
                          {fmtDate(inq.repliedAt, locale)}
                        </span>
                        {inq.sentToAll && <span className="text-[11px] text-success/80">· {tRfqd("qa.reached_all")}</span>}
                      </div>
                      <p className="text-sm text-slate-700" dir="auto">{inq.reply}</p>
                    </div>
                  ) : canAnswer ? (
                    <div className="mt-3">
                      {showReply === inq.id ? (
                        <div className="space-y-2">
                          <Textarea
                            value={replyText[inq.id] || ""}
                            onChange={(e) => setReplyText((prev) => ({ ...prev, [inq.id]: e.target.value }))}
                            placeholder={t("offers_inq_reply_placeholder")}
                            aria-label={tRfqd("qa.answer")}
                            rows={3}
                            className="text-sm"
                          />
                          <p className="text-[11px] text-muted-foreground">{tRfqd("qa.to_all_note")}</p>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleReply(inq)} disabled={!replyText[inq.id]?.trim() || replyingTo === inq.id} className="gap-2">
                              {replyingTo === inq.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                              {tRfqd("qa.publish")}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => { setShowReply(null); setReplyText((prev) => ({ ...prev, [inq.id]: "" })) }}>
                              {t("offers_inq_cancel")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => setShowReply(inq.id)} className="gap-2 mt-2">
                          <MessageSquare size={14} />
                          {tRfqd("qa.answer")}
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/** Whether the supplier has been told of this award, read live off its order —
 * the same rule every supplier screen uses (`awardDisclosed`). */
function AwardDisclosure({ offer, children }: { offer: { poId?: string | null; status?: string | null; awaitingOrderApproval?: boolean | null }; children: (disclosed: boolean, withdrawn: boolean) => ReactNode }) {
  const firestore = useFirestore()
  const ref = useMemoFirebase(() => (firestore && offer.poId ? doc(firestore, PURCHASE_ORDERS, offer.poId) : null), [firestore, offer.poId])
  const { data: po } = useDoc(ref)
  const orders = new Map<string, PurchaseOrder>()
  if (offer.poId && po) orders.set(offer.poId, { ...(po as PurchaseOrder), id: offer.poId })
  return <>{children(awardDisclosed(offer, orders), (po as PurchaseOrder | null)?.status === "cancelled")}</>
}

/** The order laid over an accepted offer: its number and its derived state,
 * read live off the order itself, linking to the orders desk. */
function PoStatusPill({ poId, poNumber }: { poId: string; poNumber?: string | null }) {
  const firestore = useFirestore()
  const locale = useLocale()
  const t = useTranslations("Portal.Contractor")
  const tProc = useTranslations("Portal.Procurement")
  const ref = useMemoFirebase(() => (firestore ? doc(firestore, PURCHASE_ORDERS, poId) : null), [firestore, poId])
  const { data: po } = useDoc(ref)
  const status = po ? poStatus({ ...(po as PurchaseOrder), lines: (po as PurchaseOrder).lines || [], log: (po as PurchaseOrder).log || [] }) : null
  const number = displayPoNumber((po as PurchaseOrder | null)?.docNumber || poNumber, locale)
  return (
    <Link
      href={procLinks.order(poId)}
      className="w-full rounded-xl border border-module/30 bg-module/10 px-3 py-2 text-xs hover:bg-module/20 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 block"
      aria-label={t("offers_award_open_order")}
    >
      <span className="font-bold text-module flex items-center gap-1.5">
        <FileCheck size={12} className="shrink-0" />
        <bdi>{number || t("offers_award_order_word")}</bdi>
      </span>
      {status && <span className="block text-[11px] text-slate-600 mt-0.5">{tProc(`status.${status}`)}</span>}
    </Link>
  )
}

const waChatLink = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, "")
  return `https://wa.me/${cleaned.startsWith("0") ? "966" + cleaned.slice(1) : cleaned}`
}

function SupplierWhatsAppButton({ supplierId, guestPhone }: { supplierId: string; guestPhone?: string | null }) {
  const firestore = useFirestore()
  const t = useTranslations("Portal.Contractor")
  // Guest offers carry their phone inline — there is no users/{id} doc to read.
  const docRef = useMemoFirebase(() => {
    if (!firestore || !supplierId || guestPhone || supplierId === "guest") return null
    return doc(firestore, "users", supplierId)
  }, [firestore, supplierId, guestPhone])
  const { data: supplier } = useDoc(docRef)

  const phone = guestPhone || supplier?.phone || supplier?.mobile || supplier?.whatsapp
  if (!phone) return null

  const cleaned = phone.replace(/\D/g, "")
  const waNumber = cleaned.startsWith("0") ? "966" + cleaned.slice(1) : cleaned

  return (
    <a
      href={`https://wa.me/${waNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      className="w-full flex items-center justify-center gap-2 h-8 rounded-full bg-[#25D366] hover:bg-[#20ba5a] text-white text-xs font-bold transition-colors"
    >
      <Phone size={13} />
      {t("offers_supplier_whatsapp")}
    </a>
  )
}
