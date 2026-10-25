"use client"

// The purchase order's drawer (PRD 3.0 §5.1, §6.1–6.2). One grammar for every
// state: header → next step (the computed facts and only the buttons this
// person may press; when the step is somebody else's it says who and shows
// no button) → the money trail → line progress → deliveries → award facts →
// documents → the document trail → log. The second layer (po-extras.ts) adds
// what came back from Finance, the advance, the revision, the line's context,
// the schedule and warranty, Projects' budget and sample gates, and who may act
// here: the owner reads (and approves); a buyer acts on his own orders only.
// Every button re-runs the domain predicate before it shows,
// and the write re-runs it again inside its transaction; a refusal comes back
// as a `ProcWriteError` code and is shown as the sentence for that code.

import { getAuth } from "firebase/auth"
import { deliveryStep, waitingSinceDays, type StepNotice } from "@/lib/procurement/next-step"
import { FORWARD_HREF } from "@/lib/procurement/today"
import { RecordNoticeDialog } from "@/components/procurement/RecordNoticeDialog"
import { ForwardReceiptDialog } from "@/components/procurement/ForwardReceiptDialog"
import { ReceiverPreviewDialog } from "@/components/procurement/ReceiverPreviewDialog"
import { LineSpec } from "@/components/procurement/LineSpec"
import { openWhatsAppWithLink } from "@/components/procurement/chats/ConversationPanel"
import { EscalateError, escalateNoticeCall } from "@/lib/procurement/notice-escalate-client"
import { needsEscalation } from "@/lib/procurement/escalation"
import { printGoodsReceipt, supplierIdentityOf } from "@/lib/procurement/receipt-print"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"
import { changeAskOpen, type PoWithChat } from "@/lib/procurement/po-messages"
import { sendPoMessage } from "@/lib/procurement/po-message-client"
import { usePrintProfile } from "@/hooks/usePrintProfile"
import { printedNumber } from "@/lib/company-print-profile"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, FileText, Info, Printer, Star } from "lucide-react"
import { collection, doc, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { usePermissions } from "@/hooks/usePermissions"
import { useSupplierIdentity } from "@/hooks/useSupplierIdentity"
import { useToast } from "@/hooks/use-toast"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import type { ProcurementWorld } from "@/hooks/useProcurementWorld"
import { Link } from "@/i18n/routing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { can as resolveCan, type TeamGroup } from "@/lib/permissions"
import { DocumentThread } from "@/components/documents/DocumentThread"
import { useModules } from "@/hooks/useCompanyModules"
import { procLinks } from "@/lib/procurement/events"
import { displayDocNumber, displayNoticeNumber, displayPoNumber, displayReceiptNumber, noticeNumberFor } from "@/lib/procurement/format"
import { approvalRefusal, canCancelRemainder, canRecordAcceptance, canSend, canUpdateDate, isLumpSum, isSelfApproval, lineToArrive, poBlocks, poStatus, poWarnings, receiptDay, receiptsOf, reminderCooldownUntil, round2, todayOf, dayOf } from "@/lib/procurement/po"
import { PRICE_AGREEMENTS, agreementState, type PriceAgreement } from "@/lib/procurement/prices"
import { AGREEMENT_HREF } from "@/lib/procurement/today"
import type { PoLine, PoLogEntry, PoSendChannel, PurchaseOrder, RejectDecision } from "@/lib/procurement/types"
import {
  advanceState,
  approverNames,
  asX,
  awaitsPmBudget,
  budgetOverrun,
  chosenOfferValidity,
  closedByPayment,
  lineInTransit,
  lineRejectReasons,
  manualOfferBy,
  overrunTotal,
  pmBudgetAsk,
  pmCancelOf,
  pmCancelOpen,
  poActs,
  poTerms,
  registeredOfferCount,
  samplePending,
  selfIssueRefusal,
  type AwardOfferFact,
  type PoFinanceHold,
  type PoLineX,
  type PoTerms,
} from "@/lib/procurement/po-extras"
import { cancelRemainderWithFee, answerHoldPrice, decideHold, holdInvoice, referBudgetToProjects, releaseHold, remindApprovers, remindFinanceAboutAdvance, type PoLogAction } from "@/lib/procurement/po-extra-writes"
import { operatingPolicies } from "@/lib/procurement/policies"
import {
  ProcWriteError,
  closeReceivedPurchaseOrder,
  ratePurchaseOrder,
  recordSupplierAcceptance,
  releaseDiscounted,
  remindSupplier,
  resubmitPurchaseOrder,
  type RatingInput,
  type RejectTermsLine,
  type WriteOpts,
} from "@/lib/procurement/writes"
import { CancelOrderDialog, DateDialog, ReasonDialog, RejectDecisionDialog } from "./PoActionDialogs"
import {
  CancelWithFeeDialog,
  DecideHoldDialog,
  DocTrailSection,
  FinanceBannerCallout,
  FinanceTrailSection,
  HoldInvoiceDialog,
  OrderDeliveriesSections,
  ScheduleSection,
  SupplierDateDialog,
  WarrantyCallout,
  XCallout,
  useBoqGateItems,
} from "./PoExtraSections"
import { HonestDateText, LineBar, Money, PoStatusPill, PoTags, WhoTag, useDateText, useStepSentence } from "./PoBits"
import {
  actorCanDecideLines,
  actorCanExpedite,
  actorCanResubmit,
  actorCanReturn,
  buildPoPrintModel,
  buildStatementModel,
  canCancelOrder,
  canCloseShort,
  canPrintOrder,
  canRateNow,
  figure,
  lineActions,
  lineParts,
  moneyFigure,
  moneyTrail,
  quantityText,
  type PrintCompany,
} from "./PoModel"
import { printPurchaseOrder, printReceiptStatement } from "./PoPrint"
import { PoRateDialog } from "./PoRateDialog"
import { PoSendDialog } from "./PoSendDialog"
import { FinancelessPaymentSection } from "./FinancelessPaymentSection"
import { PoSupplierSection } from "./PoSupplierSection"
import { acceptSupplierWarranty } from "@/lib/procurement/supplier-acts-writes"
import { reopenAwardAfterDecline, reopenAwardRefusal } from "@/lib/procurement/rfq-writes"
import { PoReceiverLine } from "./PoReceiverLine"
import { PoBnplRow, PoChatBody } from "./PoV2Sections"
import { PoRouteError, poAct, type PoActResult } from "@/lib/procurement/po-client"
import { lineUnitName, pendingVersion, pieceView, poNextStep, poSiteOf, poVer, type PoStateCtx } from "@/lib/procurement/po-state"
import { noticeNumberOf } from "@/lib/procurement/receipt-desk"
import { bareOrderNo } from "@/lib/po-link"

type Tone = "red" | "amber" | "blue" | "green"

function Callout({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  const Icon = tone === "green" ? CheckCircle2 : tone === "blue" ? Info : AlertTriangle
  return (
    <div
      className={cn(
        "flex gap-2 rounded-lg border px-3 py-2 text-sm leading-relaxed",
        tone === "red" && "border-destructive/30 bg-destructive/5 text-destructive",
        tone === "amber" && "border-warning/30 bg-warning/5 text-warning",
        tone === "blue" && "border-cta/30 bg-cta/5 text-cta",
        tone === "green" && "border-success/30 bg-success/5 text-success",
        className
      )}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-foreground/90">{children}</div>
    </div>
  )
}

/** A block of the order's drawer. The next step, the lines and the notices stay open; the rest is FOLDED
 * until asked for (PUR-07 — the drawer had a dozen sections open at once). No letter-spacing: Arabic. */
function Section({ title, badge, action, children, folded }: { title: string; badge?: ReactNode; action?: ReactNode; children: ReactNode; folded?: boolean }) {
  const head = (
    <>
      <h3 className="flex items-center gap-2 text-xs font-black text-muted-foreground">
        {title}
        {badge}
      </h3>
      {action}
    </>
  )
  if (folded) {
    return (
      <details className="group rounded-xl border bg-card">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          {head}
          <ChevronDown size={14} className="text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-3 border-t px-3 py-3">{children}</div>
      </details>
    )
  }
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">{head}</header>
      <div className="space-y-3 px-3 py-3">{children}</div>
    </section>
  )
}

/** The money and supplier boxes folded, handed to components that take a `Section` (PUR-07). */
const FoldedSection = (p: { title: string; children: ReactNode }) => <Section {...p} folded />

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <div className="min-w-0">
        <p>{label}</p>
        {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0 font-bold">{children}</div>
    </div>
  )
}

type DialogState =
  | null
  | { kind: "return" }
  | { kind: "send" }
  | { kind: "accept" }
  | { kind: "date" }
  | { kind: "cancel_line"; line: PoLine }
  | { kind: "reject"; line: PoLine; decision?: RejectDecision }
  | { kind: "close_short" }
  | { kind: "cancel_order" }
  | { kind: "rate" }
  | { kind: "decide_hold"; hold: PoFinanceHold }
  | { kind: "hold_invoice" }

export function PoDrawer({ po, world, open, onOpenChange, now }: { po: PurchaseOrder | null; world: ProcurementWorld; open: boolean; onOpenChange: (open: boolean) => void; now: Date }) {
  const t = useTranslations("Portal.ProcOrders")
  const tProc = useTranslations("Portal.Procurement")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale() as "ar" | "en"
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const fmt = useDateText()
  const stepText = useStepSentence()
  const tThread = useTranslations("Portal.Thread")
  const modules = useModules()
  const remindUntil = po ? reminderCooldownUntil(po, now) : null
  const { actor, policies } = world
  const stepsBack = operatingPolicies(policies).ownerStepsBack
  const { profile } = useResolvedProfile(actor.uid || null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // «أعد الترسية» asks once before it reopens the award.
  const [reawardAsk, setReawardAsk] = useState(false)
  // PUR-06/07: a guest supplier's notice recorded on his behalf.
  const [noticeOpen, setNoticeOpen] = useState(false)
  // «ذكّر المعتمِد» is a notice only (nothing is logged on an order awaiting approval): once per order, per session.
  const [approverReminded, setApproverReminded] = useState<string | null>(null)
  // «علّمها مدفوعة» in the next step opens the payment section's own form.
  const [advanceAsk, setAdvanceAsk] = useState(0)
  // PO-06: «حوّل للمستلم» / «أعد التحويل» open the forward form here, without leaving the order. PO-05: «كما يراه المستلم».
  const [forwardId, setForwardId] = useState<string | null>(null)
  const [receiverViewId, setReceiverViewId] = useState<string | null>(null)
  const tContractor = useTranslations("Portal.Contractor")
  const tReceiptPrint = useTranslations("Portal.ProcReceipts.print")
  // «ردّ في المحادثة» (PO-13) brings the conversation's box into view.
  const chatRef = useRef<HTMLDivElement | null>(null)
  /** «صعّد» (PO-07, TDY-05): an uncounted delivery past the policy window goes to the project manager — or the owner. */
  const escalateOf = async (deliveryId: string) => {
    setBusy("escalate")
    try {
      const r = await escalateNoticeCall(deliveryId)
      toast({ title: t("next2.escalated", { name: r.toName || "", hasName: r.toName ? 1 : 0 }) })
    } catch (error) {
      toast({ title: t("next2.escalate_failed"), description: error instanceof EscalateError ? error.code : undefined, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }
  const remindReceiverOf = async (deliveryId: string, name: string) => {
    const u = getAuth().currentUser
    if (!u) return
    setBusy("remind_receiver")
    try {
      const res = await fetch("/api/receipt-links/remind", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify({ deliveryId }) })
      const body = (await res.json().catch(() => null)) as { code?: string } | null
      toast(res.ok ? { title: t("next2.receiver_reminded", { name }) } : { title: t(body?.code === "TOO_SOON" ? "next2.remind_too_soon" : "next2.remind_failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }
  const perms = usePermissions()
  // Finance's acts; the owner acts as Finance here only on an order he may act on (not one a buyer prepared).
  const isFinance = perms.isOrgOwner ? !(po && poActs(po, actor, stepsBack).ownerReadOnly) : perms.can("invoices.manage") || perms.can("accounting.post")
  // «أوقف صرف فاتورة» is a Procurement decision (PUR-07): the owner and the order's approvers hold; Finance too.
  const canHoldInvoice = isFinance || (Boolean(po) && !poActs(po as PurchaseOrder, actor, stepsBack).ownerReadOnly && (actor.isOwner || actor.canApprove))
  // The resolved policy — the self-issue write re-reads it inside its transaction.
  const selfLimit = operatingPolicies(policies).buyerSelfIssueLimit
  const boqItems = useBoqGateItems(po ? asX(po) : null)
  // The receipt statement's facts: the supplier's identity and where each receipt landed.
  const statementSupplier = useSupplierIdentity(open && po ? po.supplierOrgId : null, po ? world.supplierRecords.find((r) => r.supplierOrgId === po.supplierOrgId)?.vatNumber : null)
  const warehousesQ = useMemoFirebase(() => (firestore && open && world.orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", world.orgId)) : null), [firestore, open, world.orgId])
  const { data: warehousesData } = useCollection<{ name?: string; projectId?: string | null }>(warehousesQ)

  // Who an order awaiting approval is routed to, by name (prototype `apprWho`).
  const { orgMembers } = useOrgMembers(po?.status === "awaiting_approval" ? world.orgId || null : null)
  const approvers = useMemo(
    () =>
      po && po.status === "awaiting_approval"
        ? approverNames(
            po,
            orgMembers.map((m) => ({
              id: m.id,
              name: (m.name as string) || (m.email as string) || "",
              isOwner: m.id === world.orgId || m.organizationRole === "owner",
              canApprove: resolveCan("po.approve", { organizationRole: (m.organizationRole as string | null | undefined) ?? null, defaultGroupId: (m.defaultGroupId as string | undefined) || null, groups: perms.groups as TeamGroup[] }),
            }))
          )
        : [],
    [po, orgMembers, world.orgId, perms.groups]
  )

  // The agreement the order was placed on — a link, and «مؤرشف» once it has ended.
  const agreementRef = useMemoFirebase(() => (firestore && po?.agreementId ? doc(firestore, PRICE_AGREEMENTS, po.agreementId) : null), [firestore, po?.agreementId])
  const { data: agreement, isLoading: agreementLoading } = useDoc<PriceAgreement>(agreementRef)
  const agreementArchived = Boolean(po?.agreementId) && !agreementLoading && (!agreement || agreementState(agreement, todayOf(now)) === "expired")

  // Where each receipt landed decides which module recorded it.
  const warehouses = useMemo(() => (warehousesData || []).map((w) => ({ id: w.id, projectId: w.projectId ?? null })), [warehousesData])

  const receipts = useMemo(() => (po ? receiptsOf(po, world.deliveries) : []), [po, world.deliveries])
  const deliveries = useMemo(
    () => (po ? world.deliveries.filter((d) => d.poId === po.id).sort((a, b) => (receiptDay(b) || "").localeCompare(receiptDay(a) || "")) : []),
    [po, world.deliveries]
  )
  const blocks = useMemo(
    () => (po && po.status === "awaiting_approval" ? poBlocks(po, { supplier: world.supplierFacts.get(po.supplierOrgId) ?? null, otherOrders: world.orders, policies, now }) : []),
    [po, world.supplierFacts, world.orders, policies, now]
  )
  const warnings = useMemo(() => (po && po.status === "awaiting_approval" ? poWarnings(po, { supplier: world.supplierFacts.get(po.supplierOrgId) ?? null }) : []), [po, world.supplierFacts])

  // The writes stamp their own clock: the page's `now` is a render-time value.
  const opts: WriteOpts = { copy: tShared, locale, orgName: world.orgName }

  /** Runs a write; a refusal is shown as the sentence for its code. Resolves whether it succeeded. */
  const run = async (key: string, fn: () => Promise<unknown>, successKey?: string | ((result: unknown) => string)): Promise<boolean> => {
    if (!firestore) return false
    setBusy(key)
    try {
      const result = await fn()
      if (successKey) toast({ title: t(typeof successKey === "function" ? successKey(result) : successKey) })
      return true
    } catch (err) {
      if (err instanceof ProcWriteError) toast({ title: tProc(`err_${err.code}`, err.params), variant: "destructive" })
      else if (err instanceof PoRouteError) toast({ title: tProc(`err_${err.reason}` as "err_wrong_state", err.params), variant: "destructive" })
      else {
        console.error(err)
        toast({ title: t("toast.failed"), variant: "destructive" })
      }
      return false
    } finally {
      setBusy(null)
    }
  }

  const print = usePrintProfile()
  const company: PrintCompany = useMemo(() => {
    const p = (profile || {}) as { companyName?: string; name?: string; crNumber?: string; taxNumber?: string; city?: string; location?: string; phone?: string; phoneNumber?: string; email?: string }
    return { name: p.companyName || world.orgName || p.name || "", cr: printedNumber(p.crNumber, print.crNumber), vat: printedNumber(p.taxNumber, print.taxNumber), address: p.location || p.city || null, phone: p.phone || p.phoneNumber || null, email: p.email || null }
  }, [profile, world.orgName, print.crNumber, print.taxNumber])

  const tPrint = (key: string, params?: Record<string, string | number>) => t(`print.${key}`, params)

  // Today's «أرسِله للمورد» lands here with `act=send`: the send form opens once.
  const searchParams = useSearchParams()
  const sendAsked = useRef<string | null>(null)
  const wantsSend = open && po?.status === "approved" && searchParams?.get("act") === "send" && Boolean(firestore) && actorCanExpedite(actor) && poActs(po, actor, stepsBack).acts && canSend(po)
  useEffect(() => {
    if (!wantsSend || !po || sendAsked.current === po.id) return
    sendAsked.current = po.id
    setDialog({ kind: "send" })
  }, [wantsSend, po])

  if (!po) return null
  const px = asX(po)
  const lumpOrder = isLumpSum(po)
  const status = poStatus(po)
  const paidClosed = closedByPayment(asX(po))
  const acts = poActs(po, actor, stepsBack)
  const revision = poVer(po)
  // Projects switched off for this company: no budget referral and no sample gate — nobody there could clear them.
  const pmOn = modules.on("project-management")
  const financeOn = modules.on("payments")
  const stateCtx: PoStateCtx = { notices: world.deliveries as StepNotice[], financeOn, acceptanceDays: policies.supplierAcceptanceDays, now }
  const ps = poNextStep(po, stateCtx)
  const pendingV = pendingVersion(po)
  const overrun = pmOn && po.status === "awaiting_approval" ? budgetOverrun(po, boqItems, world.orders) : []
  const pmWait = pmOn && awaitsPmBudget(px)
  const pmAsk = pmOn && pmBudgetAsk(px, overrun)
  const samples = pmOn && po.status === "awaiting_approval" ? samplePending(po, boqItems) : []
  const selfIssue = selfIssueRefusal(po, actor, selfLimit, blocks.length + samples.length + (pmWait ? 1 : 0)) === null && !actor.canApprove && !actor.isOwner
  const advance = advanceState(px, financeOn)
  const rfqDoc = world.rfqs.find((r) => r.id === po.rfqId) as { requiresWarranty?: boolean } | undefined
  const offerDoc = world.offers.find((o) => o.id === po.offerId) as { deliveryBatches?: Array<{ quantity?: string | number; deliveryDate?: string }> } | undefined
  const schedule =
    px.deliverySchedule && px.deliverySchedule.length
      ? px.deliverySchedule
      : (offerDoc?.deliveryBatches || []).length > 1
        ? (offerDoc?.deliveryBatches || []).map((b) => ({ quantity: Number(b.quantity) || 0, date: String(b.deliveryDate || "").slice(0, 10) })).filter((b) => b.date)
        : []
  const warranty = Boolean(px.requiresWarranty ?? rfqDoc?.requiresWarranty)
  const sourceKey = po.purchaseSource?.kind === "mfg_purchase" ? "mfg" : po.purchaseSource?.kind === "project_request" ? "project" : po.purchaseSource?.kind === "stock_gap" ? "stock" : null

  const number = displayPoNumber(po.docNumber, locale)
  const money = moneyTrail(po)
  const f = firestore
  const offerFacts = world.offers as AwardOfferFact[]
  const manualBy = manualOfferBy(po, offerFacts)
  const offerValidity = chosenOfferValidity(po, offerFacts)
  const rfqKnown = Boolean(po.rfqId && world.rfqs.some((r) => r.id === po.rfqId))
  const termsText = (x: PoTerms): string | null =>
    !x ? null : x.kind === "advance" ? tProc("rfqpo.po.terms_adv", { pct: x.percent, days: x.days }) : x.kind === "credit" ? tProc("rfqpo.po.terms_credit", { days: x.days }) : x.text
  const terms = termsText(poTerms(px))
  const site = poSiteOf(po)
  const siteLine = site ? [site.name, site.district].filter(Boolean).join(" — ") : null
  const guestContact = (world.offers.find((o) => o.id === po.offerId) as { guestContact?: { name?: string | null; phone?: string | null } } | undefined)?.guestContact
  const supplierPhone = ((world.supplierRecords.find((r) => r.supplierOrgId === po.supplierOrgId) as { contactPhone?: string | null } | undefined)?.contactPhone || guestContact?.phone || null) as string | null
  const rfqNo = (rfqDoc as { rfqNumber?: string } | undefined)?.rfqNumber
  const rfqLabel = rfqNo ? displayDocNumber(rfqNo, locale) : po.rfqTitle || "—"
  // An off-platform supplier reads the order on its link, and hears from us on WhatsApp (MSG-05).
  const offPlatform = Boolean(po.isGuestSupplier) || !po.supplierUserId
  // The supplier asked for a change from the link or his portal and nobody answered yet (PO-13).
  const changeAsk = po.status !== "cancelled" && po.status !== "closed" ? changeAskOpen(po as PoWithChat) : null
  const canExpedite = actorCanExpedite(actor) && acts.acts
  const deliveryOf = (id: string | null) => (id ? (world.deliveries.find((d) => d.id === id) as DeskDelivery | undefined) : undefined)
  /** Where a delivery lands and what the place is called — the forward form offers that place's receivers first. */
  const placeOf = (d: DeskDelivery): { id: string | null; name: string } => {
    const whs = warehousesData || []
    const id = d.landedWarehouseId || (d as { warehouseId?: string | null }).warehouseId || (po.projectId ? whs.find((w) => w.projectId === po.projectId)?.id : null) || (world.orgId ? `central_${world.orgId}` : null)
    return { id: id || null, name: (id ? whs.find((w) => w.id === id)?.name : null) || tContractor("wh_central_name") }
  }
  const noticeRawOf = (d: DeskDelivery): string | null => noticeNumberOf(d, world.deliveries as DeskDelivery[], po) || noticeNumberFor(po.docNumber, Number(d.seq) > 0 ? Number(d.seq) : null)
  const noticeNoOf = (d: DeskDelivery): string | null => {
    const n = noticeRawOf(d)
    return n ? displayNoticeNumber(n, locale) : null
  }
  /** «ذكّر المورد». A registered supplier hears in his portal; one outside the platform gets the same reminder on WhatsApp from this
   * device, with a fresh order link, and it is posted in the order's conversation (PO-09) — the cooldown is the write's. */
  const remindNow = (kind: "accept" | "delivery" | "rest") => {
    if (!f) return
    if (!offPlatform) {
      void run("remind", () => remindSupplier(f, actor, po.id, opts), kind === "rest" ? "toast.reminded_rest" : "toast.reminded_portal")
      return
    }
    const opened = window.open("", "_blank")
    void run(
      "remind",
      async () => {
        try {
          await remindSupplier(f, actor, po.id, opts)
          const text = t(kind === "accept" ? "next2.wa_remind_accept" : kind === "rest" ? "next2.wa_remind_rest" : "next2.wa_remind_delivery", { company: world.orgName || company.name || "", number: bareOrderNo(po.docNumber) })
          await sendPoMessage({ poId: po.id, text, channel: "whatsapp", locale })
          await openWhatsAppWithLink(po.id, supplierPhone, text, opened)
        } catch (err) {
          opened?.close()
          throw err
        }
      },
      "toast.reminded_whatsapp"
    )
  }
  /** One receipt's «PDF» (PO-10), as the Goods received desk prints it. */
  const printReceiptOf = (id: string) => {
    const d = deliveryOf(id)
    if (!d) return
    const placeId = d.landedWarehouseId || (d as { warehouseId?: string | null }).warehouseId || null
    const vat = world.supplierRecords.find((r) => r.supplierOrgId === po.supplierOrgId)?.vatNumber
    const ok = printGoodsReceipt({
      delivery: d,
      po,
      company,
      supplier: statementSupplier ?? supplierIdentityOf(null, vat),
      noticeNumber: noticeNoOf(d),
      placeName: (placeId ? (warehousesData || []).find((w) => w.id === placeId)?.name : null) || po.projectName || null,
      projectName: po.projectName || null,
      displayNumber: d.docNumber ? displayReceiptNumber(d.docNumber, locale) : `DEL-${d.id.slice(0, 8).toUpperCase()}`,
      displayPoNumber: displayPoNumber(po.docNumber, locale),
      withPrices: actor.seesPrices,
      locale,
      t: (k, p) => tReceiptPrint(k as "title", p),
      tp: (k, p) => tProc(k as "doc.GR", p),
      now,
    })
    if (!ok) toast({ title: t("toast.popup_blocked"), variant: "destructive" })
  }
  const scrollToChat = () => {
    const box = chatRef.current
    if (!box) return
    box.scrollIntoView({ behavior: "smooth", block: "start" })
    box.querySelector("textarea")?.focus()
  }

  const printOrder = () => {
    const extras = { revision, paymentTerms: terms, tolerancePercent: policies.overReceiptTolerancePercent }
    if (!printPurchaseOrder(buildPoPrintModel(po, company, actor.seesPrices), number, locale, tPrint, now, extras)) toast({ title: t("toast.popup_blocked"), variant: "destructive" })
  }
  const printStatement = () => {
    const placeName = (id: string | null | undefined) => (id ? (warehousesData || []).find((w) => w.id === id)?.name || null : null)
    if (!printReceiptStatement(buildStatementModel(po, world.deliveries, company, now, { supplier: statementSupplier, placeName }), number, (n) => displayReceiptNumber(n, locale), locale, tPrint)) toast({ title: t("toast.popup_blocked"), variant: "destructive" })
  }

  const ratedBlock = (r: NonNullable<PurchaseOrder["rating"]>): ReactNode => (
    <div className="rounded-lg border px-3 py-2 text-sm">
      <p className="font-bold">{t("next.rated_title", { conformity: r.conformity, cooperation: r.cooperation })}</p>
      <p className="text-xs text-muted-foreground">
        {r.byName} · {fmt(r.at)} · {r.publishAnonymously ? t("next.rated_published") : t("next.rated_internal")}
      </p>
      {r.note && <p className="mt-1 text-xs">{r.note}</p>}
    </div>
  )

  // How long the order has waited on its current hands (PUR-07): with the approver since it was prepared (or last resubmitted), with the supplier since it was sent.
  const approvalSince = [...(po.log || [])].reverse().find((e) => e.action === "resubmitted")?.at || po.createdAt
  const waitingApprovalDays = waitingSinceDays(approvalSince, now)
  const waitingAcceptanceDays = waitingSinceDays(po.sentAt, now)
  const advanceDays = waitingSinceDays(po.approvedAt, now)
  const closesReceived = !financeOn && (actor.isOwner || actor.canApprove) && acts.acts

  // ── Next step ──────────────────────────────────────────────────────────
  const nextStep = (): ReactNode => {
    const expediter = actorCanExpedite(actor) && acts.acts
    const cancelLink = f && acts.acts && canCancelOrder(po, actor) && (
      <Button variant="link" size="sm" className="h-auto p-0 text-destructive" onClick={() => setDialog({ kind: "cancel_order" })}>
        {t("next.cancel_order")}
      </Button>
    )
    // Finance closes a received order by paying it; one that got there before the write did reads closed too.
    switch (paidClosed ? "closed" : status) {
      case "awaiting_approval": {
        if (po.returnedReason) {
          return (
            <>
              <Callout tone="red">
                <b>{t("next.returned_title")}</b> — {po.returnedReason}
              </Callout>
              {f && actorCanResubmit(po, actor) ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={busy != null} onClick={() => run("resubmit", () => resubmitPurchaseOrder(f, actor, po.id, null, opts), "toast.resubmitted")}>
                    {t("next.resubmit")}
                  </Button>
                  {cancelLink}
                </div>
              ) : (
                <Callout tone="blue">{t("next.awaiting_resubmission", { by: po.preparedByName })}</Callout>
              )}
            </>
          )
        }
        const refusal = approvalRefusal(po, actor, policies)
        const flags: ReactNode[] = []
        if (po.basis === "retroactive") flags.push(<Callout key="retro" tone="amber">{t("next.flag_retroactive")}</Callout>)
        if (po.shortCompetition) flags.push(<Callout key="short" tone="amber">{t("next.flag_short_competition", { count: po.offersCount })}</Callout>)
        if (po.lowestOfferTotal != null && po.totalExVat > po.lowestOfferTotal)
          flags.push(
            <Callout key="lowest" tone="blue">
              {t("next.flag_non_lowest", { reason: po.awardReasonCode ? tProc(`awardReason.${po.awardReasonCode}`) : "—" })}
              {po.awardReasonText ? ` — ${po.awardReasonText}` : ""}
            </Callout>
          )
        if (manualBy) flags.push(<Callout key="manual" tone="amber">{tProc("rfqpo.po.manual_offer_by", { name: manualBy })}</Callout>)
        else if (po.noOfficialQuote && po.basis !== "retroactive" && !po.agreementId) flags.push(<Callout key="quote" tone="amber">{t("next.flag_no_official_quote")}</Callout>)
        if (po.basis === "rfq" && po.rfqId)
          flags.push(
            <Callout key="offers" tone="blue">
              {tProc("rfqpo.po.offers_registered", { count: registeredOfferCount(po, offerFacts) })}
              {offerValidity ? ` · ${tProc("rfqpo.po.offer_valid_until", { date: fmt(offerValidity) })}` : ""}
            </Callout>
          )
        if (po.agreementId) flags.push(<Callout key="agreement" tone="blue">{t("next.flag_agreement", { number: displayDocNumber(po.agreementNo || "", locale) })}</Callout>)
        else if (po.basis === "direct" && !po.rfqId) flags.push(<Callout key="direct" tone="amber">{t("next.flag_direct", { reason: po.awardReasonText || "—" })}</Callout>)
        if (pmWait)
          return (
            <>
              <XCallout tone="amber">
                {tProc(actor.seesPrices ? "rfqpo.po.pmw_money" : "rfqpo.po.pmw", { over: (overrun.length ? overrunTotal(overrun) : Math.round(Number(px.pmBudget?.over) || 0)).toLocaleString("en-US") })}
                {px.pmBudget?.state === "renegotiate" && ` — ${tProc("enforce.pm_renegotiate", { by: px.pmBudget.byName || "—", note: px.pmBudget.note || "—" })}`}
              </XCallout>
              {cancelLink}
            </>
          )
        if (pmAsk)
          flags.push(
            <div key="pm-ask" className="space-y-2">
              <XCallout tone="amber">{tProc(actor.seesPrices ? "enforce.pm_over_money" : "enforce.pm_over", { over: overrunTotal(overrun).toLocaleString("en-US") })}</XCallout>
              {f && (actor.canApprove || actor.isOwner || (actor.canPrepare && acts.acts)) && (
                <Button size="sm" variant="outline" disabled={busy != null} onClick={() => run("refer", () => referBudgetToProjects(f, actor, po.id, { items: boqItems, otherOrders: world.orders }, opts), "toast.saved")}>
                  {tProc("enforce.pm_refer")}
                </Button>
              )}
            </div>
          )
        else if (px.pmBudget?.state === "accepted")
          flags.push(
            <Callout key="pm-ok" tone="green">
              {tProc("enforce.pm_accepted", { by: px.pmBudget.byName || "—" })}
            </Callout>
          )
        return (
          <>
            {blocks.map((b) => (
              <Callout key={b.code} tone="red">
                {tProc(`blocks.${b.code}`, b.params)}
              </Callout>
            ))}
            {warnings.map((w) => (
              <Callout key={w.code} tone="amber">
                {tProc(`warnings.${w.code}`, w.params)}
              </Callout>
            ))}
            {samples.map((i) => (
              <Callout key={`sample-${i.id}`} tone="red">
                {tProc("rfqpo.po.sample_pending", { item: i.description || i.name || i.id })}
              </Callout>
            ))}
            {flags}
            {f && selfIssue && (
              <div className="space-y-2">
                <Callout tone="blue">{tProc("rfqpo.po.self_issue_hint", { limit: selfLimit.toLocaleString("en-US") })}</Callout>
                <Button disabled={busy != null} onClick={() => run("self", () => poAct("self-issue", { poId: po.id }, locale), (out) => ((out as PoActResult | undefined)?.status === "sent" ? "toast.approved_sent" : financeOn ? "toast.approved" : "toast.approved_nofin"))}>
                  {tProc("rfqpo.po.self_issue")}
                </Button>
              </div>
            )}
            {!refusal && f ? (
              <>
                {isSelfApproval(po, actor) && <Callout tone="amber">{tProc("selfApproval")}</Callout>}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={busy != null || blocks.length > 0 || samples.length > 0}
                    title={blocks.length || samples.length ? t("next.approve_blocked") : undefined}
                    onClick={() =>
                      run(
                        "approve",
                        () => poAct("approve", { poId: po.id }, locale),
                        // Sent on the portal at approval (policy sendOnApproval) — or waiting to be sent.
                        (out) => ((out as PoActResult | undefined)?.status === "sent" ? "toast.approved_sent" : financeOn ? "toast.approved" : "toast.approved_nofin")
                      )
                    }
                  >
                    {t("next.approve")}
                  </Button>
                  <Button variant="outline" disabled={busy != null} onClick={() => setDialog({ kind: "return" })}>
                    {t("next.return")}
                  </Button>
                  {cancelLink}
                </div>
              </>
            ) : (
              <>
                <Callout tone="blue">
                  {t("next.awaiting_approver", { approver: approvers.length ? approvers.join(tProc("rfqpo.po.approver_or")) : tProc(`approver.${po.approverKind}`), days: waitingApprovalDays })}
                  {refusal && actor.canApprove && refusal.code !== "not_awaiting" ? ` — ${tProc(`refusal.${refusal.code}`, refusal.params)}` : ""}
                </Callout>
                {f && (actor.isOwner || actor.canPrepare || actor.canApprove) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy != null || approverReminded === po.id}
                    onClick={() =>
                      void run(
                        "remind_approver",
                        async () => {
                          await remindApprovers(f, actor, po.id, opts)
                          setApproverReminded(po.id)
                        },
                        "toast.approver_reminded"
                      )
                    }
                  >
                    {t(approverReminded === po.id ? "next.approver_reminded" : "next.remind_approver")}
                  </Button>
                )}
                {f && actorCanReturn(actor) && refusal?.code === "own_order" && (
                  <Button variant="outline" size="sm" disabled={busy != null} onClick={() => setDialog({ kind: "return" })}>
                    {t("next.return")}
                  </Button>
                )}
                {cancelLink}
              </>
            )}
          </>
        )
      }
      case "approved":
        return (
          <>
            <Callout tone="green">
              {t(financeOn ? "next.approved_body" : "next.approved_body_nofin", { by: po.approvedByName || "—", date: fmt(po.approvedAt), supplier: po.supplierName })}
            </Callout>
            <div className="flex flex-wrap items-center gap-2">
              {f && expediter && canSend(po) && (
                <Button disabled={busy != null} onClick={() => setDialog({ kind: "send" })}>
                  {t("next.send")}
                </Button>
              )}
              {f && expediter && canSend(po) && (
                <Button variant="outline" disabled={busy != null} onClick={() => run("outside", () => poAct("send", { poId: po.id, channel: "outside" }, locale), "toast.sent_offline")}>
                  {tProc("rfqpo.po.sent_outside")}
                </Button>
              )}
              {cancelLink}
            </div>
          </>
        )
      case "sent":
        if (ps.state.k === "dec")
          return (
            <>
              <Callout tone="red">
                <b>{t("next.declined_title")}</b> — {stepText(ps)}
              </Callout>
              <p className="text-xs text-muted-foreground">{t("next.dec_detail", { date: fmt(po.supplierDecline?.at) })}</p>
              {f && acts.acts && canCancelOrder(po, actor) && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={busy != null} onClick={() => setDialog({ kind: "cancel_order" })}>
                    {t("next.reaward_or_return")}
                  </Button>
                </div>
              )}
            </>
          )
        {
          // PO-08: inside the acceptance window the order simply waits (blue); past it (`nacc`) it is amber, says since when and by
          // which policy, and «ذكّر المورد» leads — recording the acceptance stays for a supplier who said yes on the phone.
          const nacc = ps.state.k === "nacc"
          const sentLine = t("next.sent_body", { channel: po.sentChannel ? tProc(`channel.${po.sentChannel}`) : "—", date: fmt(po.sentAt) })
          return (
            <>
              {nacc ? (
                <Callout tone="amber">
                  <b>{t("next.sent_since", { days: waitingAcceptanceDays })}</b>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{t("next.nacc_sub", { window: policies.supplierAcceptanceDays })}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{sentLine}</span>
                </Callout>
              ) : (
                <Callout tone="blue">
                  <b>{t("next.sent_waiting")}</b> {sentLine}
                </Callout>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {f && expediter && canRecordAcceptance(po) && (
                  <Button variant={nacc ? "outline" : "default"} disabled={busy != null} onClick={() => setDialog({ kind: "accept" })}>
                    {t("next.record_acceptance")}
                  </Button>
                )}
                {f && expediter && (
                  <>
                    <Button variant={nacc ? "default" : "outline"} disabled={busy != null || remindUntil != null} onClick={() => remindNow("accept")}>
                      {t("next.remind")}
                    </Button>
                    {remindUntil && <span className="text-[11px] text-muted-foreground">{t("next.remind_after", { time: remindUntil.toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) })}</span>}
                  </>
                )}
                {nacc && f && acts.acts && canCancelOrder(po, actor) ? (
                  <Button variant="outline" className="text-destructive" disabled={busy != null} onClick={() => setDialog({ kind: "cancel_order" })}>
                    {t("next.cancel_order")}
                  </Button>
                ) : (
                  cancelLink
                )}
              </div>
            </>
          )
        }
      case "in_delivery":
      case "part_received": {
        // PUR-07: the step from the facts — who we wait on and since when; the supplier is never blamed
        // for a notice he sent in time that waits for our count.
        const step = deliveryStep(po, world.deliveries as StepNotice[], now)
        const remindSupplierBtn = (label: string, rest = false) =>
          f &&
          expediter && (
            <>
              <Button variant="outline" disabled={busy != null || remindUntil != null} onClick={() => remindNow(rest ? "rest" : "delivery")}>
                {label}
              </Button>
              {remindUntil && <span className="text-[11px] text-muted-foreground">{t("next.remind_after", { time: remindUntil.toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) })}</span>}
            </>
          )
        const dateBtn = f && expediter && canUpdateDate(po) && (
          <Button variant="outline" disabled={busy != null} onClick={() => setDialog({ kind: "date" })}>
            {t("next.update_date")}
          </Button>
        )
        const closeShortBtn = f && acts.acts && canCloseShort(po, actor) && (
          <Button variant="ghost" disabled={busy != null} onClick={() => setDialog({ kind: "close_short" })}>
            {t("next.close_short")}
          </Button>
        )
        let body: ReactNode = null
        let buttons: ReactNode = null
        switch (step?.kind) {
          case "notice_to_forward":
            body = (
              <Callout tone="amber">
                {t("next2.to_forward")}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{t("next2.to_forward_sub", { date: step.noticeDay ? fmt(step.noticeDay) : "—", place: po.deliveryLocation ? ` · ${po.deliveryLocation}` : "" })}</span>
              </Callout>
            )
            // PO-06: the forward form opens here; the desk stays one link away.
            buttons = expediter && (
              <>
                <Button disabled={busy != null} onClick={() => setForwardId(step.deliveryId)}>
                  {t("next2.forward")}
                </Button>
                <Button asChild variant="ghost">
                  <Link href={FORWARD_HREF(step.deliveryId)}>{t("next2.open_desk")}</Link>
                </Button>
              </>
            )
            break
          case "in_transit":
            body = (
              <Callout tone="blue">
                {t("next2.in_transit", { date: step.day ? fmt(step.day) : "—", name: step.receiver || "—" })}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{step.auto ? t("next2.in_transit_auto") : t("next2.in_transit_fwd", { date: step.forwardedDay ? fmt(step.forwardedDay) : "—" })}</span>
              </Callout>
            )
            break
          case "receiver_late": {
            // PO-07: past the policy window «صعّد» leads and the reminder steps back; escalated once, it says to whom.
            const notice = deliveryOf(step.deliveryId)
            const escalation = notice?.escalation ?? null
            const canEscalate = Boolean(notice) && needsEscalation(notice as DeskDelivery, now, policies.escalateAfterDays)
            body = (
              <>
                <Callout tone="amber">
                  <b>{t("next2.receiver_late", { name: step.receiver || "—", days: step.days })}</b>{" "}
                  {t("next2.receiver_late_sub", { noticed: step.noticeDay ? fmt(step.noticeDay) : "—", forwarded: step.forwardedDay ? fmt(step.forwardedDay) : "—", how: step.byLink ? t("next2.by_link") : t("next2.in_app") })}
                </Callout>
                {escalation && <p className="text-xs text-muted-foreground">{t("next2.escalated_note", { date: fmt(escalation.at), name: escalation.toName || "", hasName: escalation.toName ? 1 : 0 })}</p>}
              </>
            )
            buttons = expediter && (
              <>
                {canEscalate && (
                  <Button disabled={busy != null} onClick={() => void escalateOf(step.deliveryId)}>
                    {t("next2.escalate")}
                  </Button>
                )}
                <Button variant={canEscalate ? "outline" : "default"} disabled={busy != null} onClick={() => void remindReceiverOf(step.deliveryId, step.receiver)}>
                  {t("next2.remind_receiver")}
                </Button>
                <Button variant="outline" disabled={busy != null} onClick={() => setForwardId(step.deliveryId)}>
                  {t("next2.reforward")}
                </Button>
              </>
            )
            break
          }
          case "counted":
            body = <Callout tone="green">{t("next2.counted", { name: step.receiver || "—" })}</Callout>
            buttons = (
              <Button asChild>
                <Link href={`/contractor/goods-received?tab=incoming&delivery=${step.deliveryId}`}>{t("next2.book_receipt")}</Link>
              </Button>
            )
            break
          case "part_received":
            body = (
              <Callout tone="blue">
                {step.byLines ? t("next2.part_lines", { done: step.linesDone, total: step.linesTotal }) : t("next2.part", { received: step.received.toLocaleString("en-US"), ordered: step.ordered.toLocaleString("en-US"), left: step.left.toLocaleString("en-US"), unit: step.unit })}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{t("next2.part_sub")}</span>
              </Callout>
            )
            buttons = (
              <>
                {remindSupplierBtn(t("next2.remind_rest"), true)}
                {closeShortBtn}
              </>
            )
            break
          case "rejected": {
            body = (
              <Callout tone="red">
                {t("next2.rejected", { qty: step.qty.toLocaleString("en-US"), unit: step.unit })}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{t("next2.rejected_sub")}</span>
              </Callout>
            )
            const rejectedLine = po.lines.find((l) => l.id === step.lineId)
            // The three answers of the form, one press away (PUR-07): replace · discount · send it back (reduce the order).
            buttons =
              f && rejectedLine && acts.acts && actorCanDecideLines(actor) ? (
                <>
                  {(["replace", "discount", "reduce"] as const).map((d) => (
                    <Button key={d} variant={d === "replace" ? "default" : "outline"} disabled={busy != null} onClick={() => setDialog({ kind: "reject", line: rejectedLine, decision: d })}>
                      {t(`next2.ask_${d}`)}
                    </Button>
                  ))}
                </>
              ) : null
            break
          }
          case "guest_due":
            body = (
              <Callout tone="amber">
                {t("next2.guest_due")}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {t("next2.guest_due_sub", { date: fmt(step.day), contact: [guestContact?.name, supplierPhone].filter(Boolean).length ? ` · ${[guestContact?.name, supplierPhone].filter(Boolean).join(" ")}` : "" })}
                </span>
              </Callout>
            )
            buttons = (
              <>
                {f && expediter && (
                  <Button disabled={busy != null} onClick={() => setNoticeOpen(true)}>
                    {t("next2.record_notice")}
                  </Button>
                )}
                {supplierPhone && (
                  <Button asChild variant="outline">
                    <a href={`tel:${supplierPhone.replace(/\s/g, "")}`}>{t("next2.call")}</a>
                  </Button>
                )}
                {dateBtn}
              </>
            )
            break
          case "supplier_late":
            body = <Callout tone="red">{t("next2.supplier_late", { days: step.days })}</Callout>
            buttons = (
              <>
                {remindSupplierBtn(t("next.remind"))}
                {dateBtn}
              </>
            )
            break
          case "supplier_due":
            body = <Callout tone="blue">{t("next2.supplier_due", { date: fmt(step.day) })}</Callout>
            break
          default:
            body = <Callout tone="amber">{t("next.no_date_body")}</Callout>
            buttons = dateBtn
        }
        return (
          <>
            {advance === "owner" && (
              <>
                <Callout tone="amber">{t("step.adv_owner", { percent: Number(px.advancePercent) || 0 })}</Callout>
                {f && actor.isOwner ? (
                  <Button size="sm" disabled={busy != null} onClick={() => void run("advance_ok", () => poAct("advance-approve", { poId: po.id }, locale), "toast.advance_approved")}>
                    {t("next.approve_advance")}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("next.advance_owner_wait")}</p>
                )}
              </>
            )}
            {advance === "requested" && (
              <>
                <Callout tone="amber">{financeOn ? tProc("rfqpo.po.advance_unpaid_fin", { pct: Number(px.advancePercent) || 0, days: advanceDays }) : tProc("rfqpo.po.advance_unpaid", { pct: Number(px.advancePercent) || 0 })}</Callout>
                {f && expediter && financeOn && (
                  <Button variant="outline" size="sm" disabled={busy != null} onClick={() => void run("remind_finance", () => remindFinanceAboutAdvance(f, actor, po.id, opts), "toast.finance_reminded")}>
                    {tProc("rfqpo.po.remind_finance")}
                  </Button>
                )}
                {actor.seesPrices && !financeOn && (actor.isOwner || actor.canApprove) && (
                  <Button variant="outline" size="sm" disabled={busy != null} onClick={() => setAdvanceAsk((n) => n + 1)}>
                    {t("pay.mark_advance_short")}
                  </Button>
                )}
              </>
            )}
            {body}
            <div className="flex flex-wrap items-center gap-2">
              {buttons}
              {step?.kind !== "part_received" && step?.kind !== "guest_due" && step?.kind !== "supplier_late" && step?.kind !== "notice_to_forward" && step?.kind !== "receiver_late" && dateBtn}
              {step?.kind !== "part_received" && closeShortBtn}
              {cancelLink}
            </div>
          </>
        )
      }
      case "received":
        return (
          <>
            <Callout tone="green">{t(financeOn ? "next.received_body" : "next.received_body_nofin")}</Callout>
            {po.rating && ratedBlock(po.rating)}
            <div className="flex flex-wrap items-center gap-2">
              {f && closesReceived && (
                <Button disabled={busy != null} onClick={() => void run("close_received", () => closeReceivedPurchaseOrder(f, actor, po.id, opts), "toast.closed")}>
                  {t("next.close")}
                </Button>
              )}
              {f && acts.acts && canRateNow(po, world.deliveries, actor) && (
                <Button variant="outline" className="gap-2" disabled={busy != null} onClick={() => setDialog({ kind: "rate" })}>
                  <Star size={15} aria-hidden="true" />
                  {t("next.rate")}
                </Button>
              )}
            </div>
          </>
        )
      case "closed":
        return (
          <>
            <Callout tone={po.closedShort ? "amber" : "green"}>
              {paidClosed ? t("next.closed_paid_body") : po.closedShort ? t("next.closed_short_body", { reason: po.closeReason || "—" }) : t("next.closed_body")}
              {po.closedAt ? ` · ${fmt(po.closedAt)}` : ""}
            </Callout>
            {po.rating ? (
              ratedBlock(po.rating)
            ) : (
              f &&
              acts.acts &&
              canRateNow(po, world.deliveries, actor) && (
                <Button variant="outline" className="gap-2" disabled={busy != null} onClick={() => setDialog({ kind: "rate" })}>
                  <Star size={15} aria-hidden="true" />
                  {t("next.rate")}
                </Button>
              )
            )}
          </>
        )
      case "cancelled": {
        // The supplier declined the order (DEC): its RFQ still reads «awarded», so the buyer reopens the award here.
        const rfq = po.rfqId ? world.rfqs.find((r) => r.id === po.rfqId) : undefined
        const canReaward = Boolean(f && po.supplierDecline && rfq && reopenAwardRefusal(po, rfq, actor) === null)
        return (
          <>
            <Callout tone="amber">
              {po.supplierDecline ? <b>{t("next.declined_title")}</b> : null}
              {po.supplierDecline ? " — " : null}
              {t("next.cancelled_body", { reason: po.cancelledReason || "—" })}
            </Callout>
            {canReaward && f && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t("next.reaward_body")}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {reawardAsk ? (
                    <Button
                      disabled={busy != null}
                      onClick={() =>
                        void run("reaward", () => reopenAwardAfterDecline(po.id), "toast.reaward_done").then(() => setReawardAsk(false))
                      }
                    >
                      {t("next.reaward_confirm")}
                    </Button>
                  ) : (
                    <Button variant="outline" disabled={busy != null} onClick={() => setReawardAsk(true)}>
                      {t("next.reaward")}
                    </Button>
                  )}
                </div>
              </div>
            )}
            {po.supplierDecline && rfq?.status === "New" && po.rfqId && (
              <Link href={`/contractor/rfqs/${po.rfqId}/offers`} className="text-xs font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("next.reaward_open_rfq")}
              </Link>
            )}
          </>
        )
      }
      default:
        return null
    }
  }

  // ── Log ────────────────────────────────────────────────────────────────
  const logSentence = (e: PoLogEntry): string => {
    const p = e.params || {}
    const action = e.action as PoLogAction
    const params: Record<string, string | number> = {
      by: e.byName || "—",
      note: e.note || "",
      date: p.date ? fmt(String(p.date)) : "",
      number: p.number ? displayReceiptNumber(String(p.number), locale) : "",
      channel: p.channel ? tProc(`channel.${String(p.channel) as PoSendChannel}`) : "",
      decision: !p.decision
        ? ""
        : action === "hold_decided"
          ? tProc(`rfqpo.po.hold.decision.${String(p.decision)}`)
          : action === "budget_decided"
            ? tProc(`enforce.budget.${String(p.decision)}`)
            : tProc(`rejectDecision.${String(p.decision) as RejectDecision}`),
      over: p.over != null ? Number(p.over).toLocaleString("en-US") : "",
      invoice: p.invoice ? String(p.invoice) : "",
      line: p.line ? String(p.line) : "",
      qty: p.qty != null ? figure(Number(p.qty)) : "",
      // The free supplier's acts: the transfer he answered, the warranty's item, his stars, the receipts an invoice covers.
      ref: p.ref ? String(p.ref) : "",
      item: p.item ? String(p.item) : "",
      stars: p.stars != null ? Number(p.stars) : "",
      receipts: p.receipts ? String(p.receipts) : "",
      ver: p.ver != null ? Number(p.ver) : "",
    }
    let s = tProc(`log.${e.action}`, params)
    if (e.action === "approved" && p.selfApproved) s += ` · ${tProc("selfApproval")}`
    if (e.action === "approved" && p.selfIssued) s += ` · ${tProc("rfqpo.po.trail.self_issued")}`
    if (e.action === "sent" && p.outside) s += ` · ${tProc("rfqpo.po.trail.outside")}`
    if (e.action === "remainder_cancelled" && p.fee) s += ` · ${tProc("rfqpo.po.fee_logged", { fee: Number(p.fee).toLocaleString("en-US") })}`
    if (e.action === "closed" && p.short) s += ` · ${tProc("status.closed_short")}`
    if (e.action === "closed" && p.byPayment) s = tProc("rfqpo.po.log_closed_paid", params)
    if (e.action === "date_updated" && e.note) s += ` — ${e.note}`
    return s
  }
  const log = [...(po.log || [])].reverse()
  const CHAT_ACTIONS = new Set(["sent", "supplier_accepted", "delivery_reported", "received", "date_updated", "closed", "cancelled", "supplier_declined", "version_accepted"])
  const chatEvents = (po.log || []).filter((e) => CHAT_ACTIONS.has(e.action)).map((e) => ({ at: e.at, text: logSentence(e) }))

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side={isRtl ? "left" : "right"} dir={isRtl ? "rtl" : "ltr"} className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
          <SheetHeader className="space-y-2 border-b px-4 py-4 text-start sm:px-6">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-module/10 text-module">
                <FileText size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <SheetTitle className="flex flex-wrap items-center gap-2 text-lg font-black leading-relaxed text-primary">
                  <span dir="ltr" className="tabular-nums">
                    {number}
                  </span>
                  <WhoTag who={ps.state.who} />
                  <PoStatusPill po={po} now={now} notices={world.deliveries} />
                  <Badge variant="outline" className="text-[11px] font-normal">
                    {tProc(`basis.${po.basis}`)}
                  </Badge>
                </SheetTitle>
                <SheetDescription className="text-sm text-foreground">
                  {po.supplierOrgId ? (
                    <Link href={`/contractor/suppliers?supplier=${encodeURIComponent(po.supplierOrgId)}`} className="font-bold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
                      {po.supplierName}
                    </Link>
                  ) : (
                    <span className="font-bold">{po.supplierName}</span>
                  )}
                  {po.rfqTitle ? ` · ${po.rfqTitle}` : ""}
                  {po.projectName ? ` · ${po.projectName}` : ""}
                </SheetDescription>
                <p className="text-xs text-muted-foreground" dir="auto">
                  {[siteLine, terms, po.isGuestSupplier ? t("head.off_platform") : null].filter(Boolean).join(" · ")}
                </p>
                <PoTags po={po} policies={policies} className="pt-1" />
                <p className="text-xs text-muted-foreground">{t("head.prepared", { by: po.preparedByName, date: fmt(po.createdAt) })}</p>
              </div>
            </div>
          </SheetHeader>

          <div className="space-y-4 px-4 py-4 sm:px-6">
            {financeOn && <FinanceBannerCallout po={px} seesPrices={actor.seesPrices} />}
            <Section title={t("sec.next_step")}>
              {acts.ownerReadOnly && status !== "awaiting_approval" && status !== "closed" && !paidClosed && status !== "cancelled" && <Callout tone="blue">{tProc("rfqpo.po.owner_reads", { by: po.preparedByName })}</Callout>}
              {acts.notMine && <Callout tone="blue">{tProc("rfqpo.po.not_mine", { by: po.preparedByName })}</Callout>}
              {pendingV && <Callout tone="amber">{t("version.pending", { n: pendingV.n })}</Callout>}
              {changeAsk && (
                // PO-13: the supplier's change request is the first thing to answer — in the conversation, by a new date, or by cancelling.
                <>
                  <Callout tone="amber">
                    <b dir="auto">{t("next.change_asked", { text: changeAsk.text })}</b>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{t("next.change_asked_sub", { date: fmt(changeAsk.at) })}</span>
                  </Callout>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button disabled={busy != null} onClick={scrollToChat}>
                      {t("next.reply_in_chat")}
                    </Button>
                    {f && canExpedite && canUpdateDate(po) && (
                      <Button variant="outline" disabled={busy != null} onClick={() => setDialog({ kind: "date" })}>
                        {t("next.update_date")}
                      </Button>
                    )}
                    {f && acts.acts && canCancelOrder(po, actor) && (
                      <Button variant="outline" className="text-destructive" disabled={busy != null} onClick={() => setDialog({ kind: "cancel_order" })}>
                        {t("next.cancel_order")}
                      </Button>
                    )}
                  </div>
                </>
              )}
              {nextStep()}
            </Section>

            {po.sentAt && po.status !== "cancelled" && (
              <div ref={chatRef} className="scroll-mt-4">
                <Section title={t("chat.title")}>
                  <PoChatBody registered={!po.isGuestSupplier && Boolean(po.supplierUserId)} events={chatEvents} phone={supplierPhone} po={po} receipts={world.deliveries} />
                </Section>
              </div>
            )}

            <Section title={t("sec.lines", { count: po.lines.length })} badge={actor.seesPrices ? <span className="font-normal text-foreground/80">{t("sec.lines_total", { total: moneyFigure(money.commitment) })}</span> : undefined}>
              {po.lines.map((l) => {
                const transit = lineInTransit(po, l, world.deliveries)
                const la = acts.acts ? lineActions(po, l, actor, now, { notices: world.deliveries, inTransit: transit }) : { cancelRemainder: false, decideReject: false }
                const parts = lineParts(l)
                const lx = l as PoLineX
                const pv = pieceView(l, locale)
                return (
                  <div key={l.id} className="space-y-2 border-b pb-3 last:border-b-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-bold" dir="auto">
                          {l.name}
                        </p>
                        {/* PO-01: the spec and the tree path the RFQ named — 12 mm is not 16 mm. */}
                        <LineSpec spec={l.spec} path={l.path} />
                      </div>
                      <p className="shrink-0 text-end text-sm tabular-nums">
                        {quantityText(parts.ordered, lineUnitName(l, locale))}
                        {actor.seesPrices && l.unitPrice != null && !lumpOrder && (
                          <span className="ms-1 text-xs text-muted-foreground">
                            × <Money value={l.unitPrice} />
                          </span>
                        )}
                        {/* PO-11: price × qty = total; a lump-sum line is «ضمن المبلغ الإجمالي». */}
                        {actor.seesPrices && l.unitPrice != null && !lumpOrder && (
                          <span className="block text-xs text-muted-foreground">
                            = <Money value={round2(parts.ordered * l.unitPrice)} />
                          </span>
                        )}
                        {actor.seesPrices && lumpOrder && <span className="block text-[11px] text-muted-foreground">{tProc("cmp2.in_lump")}</span>}
                      </p>
                    </div>
                    {pv && (
                      <p className="text-[11px] text-muted-foreground" dir="auto">
                        {t("line.piece_total", { total: figure(pv.total), base: pv.base, need: pv.need != null ? figure(pv.need) : "—" })}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground" dir="auto">
                      {[sourceKey ? tProc(`rfqpo.po.source.${sourceKey}`) : null, po.projectName || (sourceKey === "stock" ? tProc("rfqpo.list.general_stock") : null), po.deliveryLocation ? tProc("rfqpo.po.to", { place: po.deliveryLocation }) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <PoReceiverLine organizationId={po.organizationId} projectId={po.projectId} poId={po.id} notices={world.deliveries} />
                    <LineBar line={l} inTransit={transit} />
                    {lx.rejectReplaceBy && <p className="text-[11px] text-muted-foreground">{tProc("rfqpo.po.replace_by", { date: fmt(lx.rejectReplaceBy) })}</p>}
                    {(lx as RejectTermsLine).rejectDiscountState === "wait" && (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
                        <span className="flex-1">{tProc("rfqpo.po.discount_wait", { qty: figure(l.rejected), unit: l.unit })}</span>
                        {(actor.isOwner || actor.canReceive) && f && (
                          <Button size="sm" variant="outline" onClick={() => void run("release", () => releaseDiscounted(f, actor, po.id, l.id, opts), "toast.saved")}>
                            {tProc("rfqpo.po.discount_release")}
                          </Button>
                        )}
                      </div>
                    )}
                    {pmCancelOpen(px, l) && (
                      <div className="space-y-2">
                        <Callout tone="amber">{tProc("rfqpo.po.pm_cancel", { reason: pmCancelOf(px, l)?.reason || "—", by: pmCancelOf(px, l)?.byName || "—" })}</Callout>
                        {f && acts.acts && actorCanDecideLines(actor) && canCancelRemainder(po) && (
                          <Button size="sm" onClick={() => setDialog({ kind: "cancel_line", line: l })}>
                            {tProc("rfqpo.po.pm_cancel_confirm")}
                          </Button>
                        )}
                      </div>
                    )}
                    {(Number(l.rejected) || 0) > 0 && !l.rejectDecision && (
                      <Callout tone="red">
                        {tProc("rfqpo.po.rejected_at_receipt", { qty: figure(l.rejected), unit: l.unit })}
                        {(() => {
                          const reasons = lineRejectReasons(po, l, world.deliveries)
                          return reasons.length ? ` — ${reasons.map((r) => (r.note ? `${tProc(`rejectReason.${r.code}`)} (${r.note})` : tProc(`rejectReason.${r.code}`))).join("، ")}` : ""
                        })()}
                      </Callout>
                    )}
                    {l.rejectDecision && (
                      <p className="text-xs text-muted-foreground">
                        {t("line.reject_decided", { decision: tProc(`rejectDecision.${l.rejectDecision}`) })}
                        {l.rejectDecisionNote ? ` — ${l.rejectDecisionNote}` : ""}
                      </p>
                    )}
                    {l.cancelReason && parts.cancelled > 0 && <p className="text-xs text-muted-foreground">{t("line.cancelled_reason", { qty: figure(parts.cancelled), unit: l.unit, reason: l.cancelReason })}</p>}
                    {(la.decideReject || la.cancelRemainder) && f && (
                      <div className="flex flex-wrap gap-2">
                        {la.decideReject && (
                          <Button size="sm" variant="destructive" disabled={busy != null} onClick={() => setDialog({ kind: "reject", line: l })}>
                            {t("line.decide_reject", { qty: figure(l.rejected), unit: l.unit })}
                          </Button>
                        )}
                        {la.cancelRemainder && !pmCancelOpen(px, l) && (
                          <Button size="sm" variant="outline" disabled={busy != null} onClick={() => setDialog({ kind: "cancel_line", line: l })}>
                            {t("line.cancel_remainder")}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {po.lines.length === 0 && <p className="text-sm text-muted-foreground">{t("line.none")}</p>}
            </Section>

            <ScheduleSection po={px} schedule={schedule} deliveries={world.deliveries} />
            {warranty && <WarrantyCallout />}

            <OrderDeliveriesSections po={px} deliveries={world.deliveries} warehouses={warehouses} now={now} onPreviewReceiver={setReceiverViewId} onPrintReceipt={printReceiptOf} />

            {actor.seesPrices && !financeOn && (
              // Without Finance (PUR-10, Q5): no ledger here — an optional status, the advance, the invoice file to the accountant.
              <FinancelessPaymentSection po={px} actor={actor} orgId={world.orgId || ""} Section={FoldedSection} advanceAsk={advanceAsk} />
            )}

            {actor.seesPrices && financeOn && (
              <FinanceTrailSection
                po={px}
                actor={actor}
                canDecide={acts.acts && actorCanDecideLines(actor)}
                isFinance={isFinance}
                canHold={canHoldInvoice}
                onDecide={(hold) => setDialog({ kind: "decide_hold", hold })}
                onAnswerPrice={(hold, accept) => f && void run("hold", () => answerHoldPrice(f, actor, po.id, { holdId: hold.id, accept }, opts), "toast.saved")}
                // With Finance in the company, paying is Finance's own act (PUR-07): Procurement reads it, and only holds.
                onHold={() => setDialog({ kind: "hold_invoice" })}
                lead={
                  <>
                    <Row label={t("money.ex_vat")}>
                      <Money value={money.exVat} />
                    </Row>
                    <Row label={t("money.vat", { rate: Math.round(po.vatRate * 100) })}>
                      <Money value={money.vat} />
                    </Row>
                    <Row label={t("money.open")} hint={money.lumpSum ? t("money.open_lump_hint") : undefined}>
                      <Money value={money.open} />
                    </Row>
                  </>
                }
                onRelease={(hold) => f && void run("release", () => releaseHold(f, actor, isFinance, po.id, hold.id), "toast.saved")}
              />
            )}

            <PoSupplierSection
              po={po}
              orgId={world.orgId}
              open={open}
              Section={FoldedSection}
              busy={busy === "warranty"}
              canAcceptWarranty={actor.isOwner || actor.canPrepare || actor.canApprove}
              onAcceptWarranty={(w) => f && void run("warranty", () => acceptSupplierWarranty(f, actor, po, w), "supplier.toast_warranty")}
            />

            {!["done", "cancel"].includes(ps.state.k) && <PoBnplRow />}

            <DocTrailSection po={px} deliveries={world.deliveries} receiptNumber={(n) => displayReceiptNumber(n, locale)} financeOn={financeOn} />

            <Section title={t("sec.award")} folded>
              <Row label={t("award.basis")}>{tProc(`basis.${po.basis}`)}</Row>
              {po.basis === "rfq" && (
                <>
                  <Row label={t("award.offers")}>{po.offersCount}</Row>
                  {po.lowestOfferTotal != null && (
                    <Row label={t("award.lowest")}>
                      <Money value={po.lowestOfferTotal} masked={!actor.seesPrices} />
                    </Row>
                  )}
                  {po.awardReasonCode && (
                    <Row label={t("award.reason")}>
                      <span className="font-normal">
                        {tProc(`awardReason.${po.awardReasonCode}`)}
                        {po.awardReasonText ? ` — ${po.awardReasonText}` : ""}
                      </span>
                    </Row>
                  )}
                </>
              )}
              {po.agreementId && (
                <Row label={t("award.agreement")}>
                  <Link href={AGREEMENT_HREF(po.agreementId)} className="text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span dir="ltr" className="tabular-nums">
                      {displayDocNumber(po.agreementNo || "", locale) || "—"}
                    </span>
                  </Link>
                  {agreementArchived && <span className="block text-end text-[11px] font-normal text-muted-foreground">{tProc("rfqpo.po.source_archived")}</span>}
                </Row>
              )}
              {po.basis === "direct" && !po.rfqId && !po.agreementId && po.awardReasonText && (
                <Row label={t("award.reason")}>
                  <span className="font-normal">{po.awardReasonText}</span>
                </Row>
              )}
              {po.basis === "retroactive" && po.awardReasonText && (
                <Row label={t("award.reason")}>
                  <span className="font-normal">{po.awardReasonText}</span>
                </Row>
              )}
              <div className="flex flex-wrap gap-1.5">
                {po.shortCompetition && <Badge className="border-none bg-warning/10 text-[11px] text-warning">{tProc("exception.short_competition", { count: po.offersCount })}</Badge>}
                {po.noOfficialQuote && !po.agreementId && <Badge className="border-none bg-warning/10 text-[11px] text-warning">{tProc("exception.no_official_quote")}</Badge>}
                {po.approvedById && po.approvedById === po.preparedById && <Badge className="border-none bg-warning/10 text-[11px] text-warning">{tProc("exception.self_approval")}</Badge>}
              </div>
              {po.rfqId &&
                (rfqKnown || world.loading ? (
                  <Link href={`/contractor/rfqs/${po.rfqId}/offers`} className="text-xs font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t("award.open_rfq")}
                  </Link>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    <span dir="auto">{po.rfqTitle || "—"}</span> · {tProc("rfqpo.po.source_archived")}
                  </p>
                ))}
            </Section>

            <Section title={t("sec.documents")} folded>
              <div className="flex flex-wrap gap-2">
                {canPrintOrder(po, actor) && (
                  <Button variant="outline" size="sm" className="gap-2" onClick={printOrder}>
                    <Printer size={14} aria-hidden="true" />
                    {t("docs.print_po")}
                  </Button>
                )}
                {(deliveries.length > 0 || ["in_delivery", "part_received", "received", "closed"].includes(poStatus(po))) && (
                  <Button variant="outline" size="sm" className="gap-2" onClick={printStatement}>
                    <Printer size={14} aria-hidden="true" />
                    {t("docs.print_statement")}
                  </Button>
                )}
                {po.rating && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-bold text-success">
                    <Star size={12} aria-hidden="true" />
                    {tProc("rfqpo.po.rated")}
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t("docs.supplier_date")}</dt>
                <dd>
                  {advance === "requested" && !po.lines.some((l) => l.accepted > 0) ? (
                    <span className="text-warning">{tProc("enforce.date_suspended")}</span>
                  ) : (
                    <HonestDateText po={po} now={now} notices={world.deliveries} />
                  )}
                </dd>
                {terms && (
                  <>
                    <dt className="text-muted-foreground">{t("docs.payment_terms")}</dt>
                    <dd dir="auto">{terms}</dd>
                  </>
                )}
                {po.deliveryLocation && (
                  <>
                    <dt className="text-muted-foreground">{t("docs.delivery_location")}</dt>
                    <dd dir="auto">{po.deliveryLocation}</dd>
                  </>
                )}
                {po.supplierAcceptedAt && (
                  <>
                    <dt className="text-muted-foreground">{t("docs.accepted_at")}</dt>
                    <dd>
                      {fmt(po.supplierAcceptedAt)} · {po.acceptanceRecordedBy === "supplier" ? t("docs.by_supplier") : t("docs.by_us")}
                    </dd>
                  </>
                )}
              </dl>
            </Section>

            {log.length > 0 && (
              <Section title={t("sec.log")} folded>
                <ol className="space-y-2">
                  {log.map((e, i) => (
                    <li key={`${e.at}-${i}`} className="flex gap-2 text-sm">
                      <Clock size={14} className="mt-1 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0">
                        <p dir="auto">{logSentence(e)}</p>
                        <p className="text-[11px] text-muted-foreground">{fmt(e.at)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            <Section title={tThread("title")} folded>
            <DocumentThread
              portal="contractor"
              target={{ kind: "po", id: po.id, label: number, href: procLinks.order(po.id), supplierHref: procLinks.supplierOrder(po.id) }}
              parties={{ buyerOrgId: po.organizationId, supplierOrgId: po.supplierOrgId }}
              notify={{ buyer: [po.preparedById], supplier: po.supplierUserId ? [po.supplierUserId] : [] }}
              log={log.map((e) => ({ at: e.at, byName: "", text: logSentence(e) }))}
            />
            </Section>
          </div>
        </SheetContent>
      </Sheet>

      {f && (
        <>
          <ReasonDialog
            open={dialog?.kind === "return"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={t("return.title")}
            description={t("return.desc")}
            label={t("return.label")}
            submitLabel={t("return.submit")}
            effects={[t("return.effect")]}
            onSubmit={(reason) => run("return", () => poAct("return", { poId: po.id, reason }, locale), "toast.returned")}
          />
          <CancelOrderDialog
            open={dialog?.kind === "cancel_order"}
            onOpenChange={(o) => !o && setDialog(null)}
            number={number}
            rfqNumber={rfqLabel}
            canReaward={Boolean(po.rfqId && po.offerId && rfqKnown)}
            canBack={Boolean(po.purchaseSource || po.rfqId)}
            canNone={!po.purchaseSource}
            defaultWhy={ps.state.k === "dec" ? "dec" : ps.state.k === "nacc" ? "nacc" : null}
            onSubmit={({ why, note, then }) => run("cancel", () => poAct("cancel", { poId: po.id, why, note: note || null, then }, locale), "toast.cancelled")}
          />
          <ReasonDialog
            open={dialog?.kind === "close_short"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={t("close_short.title")}
            description={t("close_short.desc")}
            label={t("close_short.label")}
            submitLabel={t("close_short.submit")}
            effects={[t(financeOn ? "close_short.effect" : "close_short.effect_nofin")]}
            onSubmit={(reason) => run("close", () => poAct("close-short", { poId: po.id, reason }, locale), "toast.closed_short")}
          />
          <CancelWithFeeDialog
            open={dialog?.kind === "cancel_line"}
            onOpenChange={(o) => !o && setDialog(null)}
            context={dialog?.kind === "cancel_line" ? t("cancel_line.context", { line: dialog.line.name, qty: figure(lineToArrive(dialog.line)), unit: dialog.line.unit }) : null}
            fromProjects={dialog?.kind === "cancel_line" ? pmCancelOf(px, dialog.line)?.reason || null : null}
            seesPrices={actor.seesPrices}
            onSubmit={({ reason, fee }) => (dialog?.kind === "cancel_line" ? run("cancel_line", () => cancelRemainderWithFee(f, actor, po.id, { lineId: dialog.line.id, reason, fee }, opts), "toast.remainder_cancelled") : Promise.resolve(false))}
          />
          <DateDialog
            open={dialog?.kind === "accept"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={t("accept.title")}
            description={t("accept.desc")}
            dateLabel={t("accept.date")}
            submitLabel={t("accept.submit")}
            defaultDate={po.promisedDate || dayOf(po.requestedDeliveryDate) || null}
            effects={[t("accept.effect"), ...(advance === "requested" || advance === "pending" ? [tProc(financeOn ? "rfqpo.po.accept_advance_effect" : "rfqpo.po.accept_advance_effect_nofin", { pct: Number(px.advancePercent) || 0 })] : [])]}
            now={now}
            onSubmit={({ date }) => run("accept", () => recordSupplierAcceptance(f, actor, po.id, { promisedDate: date, by: "buyer" }, opts), "toast.accepted")}
          />
          {noticeOpen && <RecordNoticeDialog po={po} open={noticeOpen} onOpenChange={setNoticeOpen} />}
          {(() => {
            const d = deliveryOf(forwardId)
            if (!d) return null
            const place = placeOf(d)
            return <ForwardReceiptDialog open onOpenChange={(o) => !o && setForwardId(null)} delivery={d} po={po} orgId={world.orgId || ""} placeWarehouseId={place.id} placeName={place.name} noticeNumber={noticeRawOf(d)} />
          })()}
          {(() => {
            const d = deliveryOf(receiverViewId)
            return d ? <ReceiverPreviewDialog open onOpenChange={(o) => !o && setReceiverViewId(null)} delivery={d} po={po} placeName={placeOf(d).name} /> : null
          })()}
          <SupplierDateDialog open={dialog?.kind === "date"} onOpenChange={(o) => !o && setDialog(null)} po={px} now={now} onSubmit={({ date, note }) => run("date", () => poAct("date", { poId: po.id, date, note: note || null }, locale), "toast.date_updated")} />
          <DecideHoldDialog
            hold={dialog?.kind === "decide_hold" ? dialog.hold : null}
            po={px}
            actor={actor}
            onOpenChange={(o) => !o && setDialog(null)}
            onSubmit={({ decision, note, price }) => (dialog?.kind === "decide_hold" ? run("hold", () => decideHold(f, actor, po.id, { holdId: dialog.hold.id, decision, note, price }, opts), "toast.saved") : Promise.resolve(false))}
          />
          <HoldInvoiceDialog open={dialog?.kind === "hold_invoice"} lines={po.lines} onOpenChange={(o) => !o && setDialog(null)} onSubmit={(input) => run("hold_invoice", () => holdInvoice(f, actor, isFinance, po.id, input), "toast.hold_sent")} />
          <RejectDecisionDialog
            open={dialog?.kind === "reject"}
            onOpenChange={(o) => !o && setDialog(null)}
            line={dialog?.kind === "reject" ? dialog.line : null}
            initialDecision={dialog?.kind === "reject" ? dialog.decision : undefined}
            onSubmit={({ decision, note, replaceBy, discountPrice }) => (dialog?.kind === "reject" ? run("reject", () => poAct("reject-decision", { poId: po.id, lineId: dialog.line.id, decision, note: note || null, replaceBy: replaceBy || null, discountPrice: discountPrice ?? null }, locale), decision === "replace" ? "toast.reject_replace" : decision === "discount" ? "toast.reject_discount" : "toast.reject_return") : Promise.resolve(false))}
          />
          <PoSendDialog
            open={dialog?.kind === "send"}
            onOpenChange={(o) => !o && setDialog(null)}
            po={po}
            orgName={world.orgName}
            seesPrices={actor.seesPrices}
            onSubmit={async ({ channel, contact }) => {
              let link: string | null = null
              const ok = await run(
                "send",
                async () => {
                  link = (await poAct("send", { poId: po.id, channel, contact }, locale)).link ?? null
                },
                channel === "portal" ? "toast.sent_portal" : "toast.sent_offline"
              )
              return { ok, link }
            }}
          />
          <PoRateDialog
            open={dialog?.kind === "rate"}
            onOpenChange={(o) => !o && setDialog(null)}
            po={po}
            receipts={receipts}
            onSubmit={(input: RatingInput) => run("rate", () => ratePurchaseOrder(f, actor, po.id, { ...input, receipts: world.deliveries }, opts), "toast.rated")}
          />
        </>
      )}
    </>
  )
}
