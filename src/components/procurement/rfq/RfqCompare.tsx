"use client"

// The comparison tab wired to the page's world (the RFQ page hands it everything it has read): price history for «آخر شراء», the
// verified-supplier test of «الأقل من الموثّقين بعرض رسمي», the picks (pinned to offer versions), the award review and what follows it.

import { useCallback, useEffect, useMemo, useState } from "react"
import { collection, query, where } from "firebase/firestore"
import { useLocale, useTranslations } from "next-intl"
import { ToastAction } from "@/components/ui/toast"
import { Callout } from "@/components/module-ui/Callout"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { RfqWorld, AwardSelection } from "@/hooks/useRfqWorld"
import { useRouter } from "@/i18n/routing"
import { logFinanceAudit } from "@/lib/finance-audit"
import { awardSupplierOrgId } from "@/lib/procurement/award"
import { pickAllOf, planAward, type AwardPicks, type PlanOffer, type PlanRfq } from "@/lib/procurement/award-plan"
import { procLinks } from "@/lib/procurement/events"
import { displayPoNumber } from "@/lib/procurement/format"
import { PRICE_HISTORY, type PriceHistoryEntry } from "@/lib/procurement/prices"
import { locksOf } from "@/lib/procurement/rfq-server/award-locks"
import { supplierFactsWithRecord } from "@/lib/procurement/supplier-file"
import { AwardReviewDialog, type AwardDone } from "./AwardReviewDialog"
import { RfqCompareGrid } from "./RfqCompareGrid"

export function RfqCompare({ world, selection, onSelectionHandled }: { world: RfqWorld; selection: AwardSelection | null; onSelectionHandled: () => void }) {
  const ta = useTranslations("Portal.Procurement.award2")
  const locale = useLocale()
  const firestore = useFirestore()
  const router = useRouter()
  const { toast } = useToast()
  const { rfq, access, actor } = world
  const historyQ = useMemoFirebase(() => (firestore && world.orgId ? query(collection(firestore, PRICE_HISTORY), where("organizationId", "==", world.orgId)) : null), [firestore, world.orgId])
  const { data: historyRaw } = useCollection(historyQ)
  const history = useMemo(() => (historyRaw || []) as unknown as PriceHistoryEntry[], [historyRaw])
  const [picks, setPicks] = useState<AwardPicks>({})
  const [reviewOpen, setReviewOpen] = useState(false)
  const offers = world.offers as unknown as PlanOffer[]
  const planRfq = rfq as unknown as PlanRfq | null
  const planActor = useMemo(() => ({ uid: actor.uid, isOwner: actor.isOwner, canPrepare: actor.canPrepare, canApprove: actor.canApprove }), [actor])

  const verifiedOf = useCallback(
    (offer: PlanOffer): boolean => {
      const id = awardSupplierOrgId(offer as never)
      if (!id) return false
      const base = world.profiles[id]?.facts
      if (!base) return false
      return supplierFactsWithRecord(base, world.records.get(id)).verified === true
    },
    [world.profiles, world.records]
  )

  const locks = useMemo(() => locksOf(world.orders), [world.orders])
  const ctx = useMemo(() => ({ today: world.today, policies: world.policies, decisions: world.decisions, locked: locks.locked, liveOfferIds: locks.liveOfferIds }), [world.today, world.policies, world.decisions, locks])

  const projectOffersQ = useMemoFirebase(
    () => (firestore && rfq?.projectId && world.orgId ? query(collection(firestore, "offers"), where("projectId", "==", rfq.projectId), where("contractorOrgId", "==", world.orgId)) : null),
    [firestore, rfq?.projectId, world.orgId]
  )
  const { data: projectOffers } = useCollection(projectOffersQ)
  const awardBudget = useMemo(() => {
    const budget = Number(world.project?.budget)
    if (!world.project || !Number.isFinite(budget) || !budget) return null
    const committed = ((projectOffers || []) as Array<{ rfqId?: string; status?: string; awardedTotal?: number; price?: string }>)
      .filter((o) => o.rfqId !== world.rfqId && (o.status === "مقبول" || o.status === "تم التسليم"))
      .reduce((sum, o) => sum + (Number(o.awardedTotal) || parseFloat(o.price || "") || 0), 0)
    return { budget, committed }
  }, [world.project, projectOffers, world.rfqId])

  // The offers tab's «رسِّ…» lands here: the picks it names are marked, and the review opens when it asked to.
  useEffect(() => {
    if (!selection || !planRfq) return
    const ev = planAward({ rfq: planRfq, offers, picks: [] }, { ...ctx, actor: planActor, onTimeOf: () => null, hasRecord: () => true }).evaluation
    const offer = offers.find((o) => o.id === selection.offerId)
    if (offer) {
      const all = pickAllOf(ev, offer, ctx, {})
      const next: AwardPicks = selection.lines.length ? Object.fromEntries(Object.entries(all).filter(([li]) => selection.lines.includes(Number(li)))) : all
      setPicks(next)
      if (selection.review && Object.keys(next).length) setReviewOpen(true)
    }
    onSelectionHandled()
  }, [selection])

  const done = (d: AwardDone) => {
    setReviewOpen(false)
    setPicks({})
    if (d.budgetReason && firestore && awardBudget && rfq?.projectId) {
      logFinanceAudit(firestore, rfq.projectId, {
        action: "budget_exception_override",
        actorId: world.userId,
        actorName: (world.profile as { name?: string } | null)?.name || "",
        targetType: "offer",
        targetId: d.orders.map((o) => o.offerId).join(","),
        amount: d.total,
        reason: d.budgetReason,
        meta: { rfqTitle: rfq.title || "", budget: awardBudget.budget, committedBefore: awardBudget.committed, projectedTotal: awardBudget.committed + d.total, overageAmount: awardBudget.committed + d.total - awardBudget.budget },
      })
    }
    const first = d.orders[0]
    toast({
      title: ta("done_title"),
      description: ta("done", { count: d.orders.length, numbers: d.orders.map((o) => displayPoNumber(o.docNumber, locale)).join(" · ") }),
      action: first ? (
        <ToastAction altText={ta("open_order")} onClick={() => router.push(procLinks.order(first.id))}>
          {ta("open_order")}
        </ToastAction>
      ) : undefined,
    })
  }

  if (!planRfq) return null
  const open = planRfq.status === "New"
  return (
    <>
      <RfqCompareGrid
        rfq={planRfq}
        offers={offers}
        decisions={world.decisions}
        orders={world.orgOrders}
        receipts={world.receipts}
        history={history}
        policies={world.policies}
        verifiedOf={verifiedOf}
        picks={picks}
        onPicksChange={setPicks}
        canPick={open && access.canDecide}
        showPrices={access.seesPrices}
        today={world.today}
        actor={planActor}
        onReview={() => setReviewOpen(true)}
        awardedBlock={planRfq.status === "Awarded" ? <AwardedBlock orders={world.orders} /> : null}
      />
      <AwardReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        rfq={planRfq}
        offers={offers}
        decisions={world.decisions}
        orders={world.orgOrders}
        receipts={world.receipts}
        policies={world.policies}
        picks={picks}
        onPicksChange={setPicks}
        actor={planActor}
        today={world.today}
        budget={awardBudget}
        onDone={done}
      />
    </>
  )
}

/** After an award: the orders it made and the reason (WF-12). */
function AwardedBlock({ orders }: { orders: RfqWorld["orders"] }) {
  const t = useTranslations("Portal.Procurement.cmp2")
  const locale = useLocale()
  const live = orders.filter((o) => o.status !== "cancelled")
  if (!live.length) return null
  return (
    <Callout tone="info" title={t("awarded_in", { count: live.length })}>
      <ul className="space-y-0.5 text-xs">
        {live.map((o) => (
          <li key={o.id} dir="auto">
            <bdi dir="ltr">{displayPoNumber(o.docNumber, locale)}</bdi> · {o.supplierName}
            {o.awardReasonText ? ` — ${t("award_reason", { reason: o.awardReasonText })}` : ""}
          </li>
        ))}
      </ul>
    </Callout>
  )
}
