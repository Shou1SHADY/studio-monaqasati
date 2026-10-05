"use client"

// HR 1.0 — what the growth features read (optional `train` and `perf`), the way the rules let each viewer read
// it: sessions and cycles by the company; reviews by the HR manager and management whole, by a rater those that
// name him, by the employee his own once approved (and his self-assessment); the training cost requests by money
// roles and Finance. Nothing is read with the feature off.

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { HrAccess } from "@/hooks/useHrAccess"
import { HR_EVENTS } from "@/lib/hr/collections"
import { currentCycle, HR_REVIEWS, type HrReview, type ReviewCycle, type SelfReview } from "@/lib/hr/performance"
import { HR_TRAINING, type TrainingSession } from "@/lib/hr/training"
import type { TrainingCostEvent } from "@/lib/hr/training-writes"

export interface HrGrowth {
  train: boolean
  perf: boolean
  sessions: TrainingSession[]
  cycles: ReviewCycle[]
  cycle: ReviewCycle | null
  /** The current cycle's reviews the viewer may read. */
  reviews: HrReview[]
  /** His own approved review in the current cycle, and his self-assessment. */
  mine: HrReview | null
  myself: SelfReview | null
  /** Training cost requests (money roles). */
  costs: TrainingCostEvent[]
  isLoading: boolean
}

export function useHrGrowth(access: Pick<HrAccess, "orgId" | "ctx" | "settings" | "allowed">): HrGrowth {
  const firestore = useFirestore()
  const orgId = access.orgId
  const uid = access.ctx.uid
  const features = access.settings.features
  const train = features.includes("train")
  const perf = features.includes("perf")
  const office = access.ctx.owner || access.ctx.roles.has("manager") || access.ctx.roles.has("management")
  const money = access.allowed("pay.view")

  const sessQ = useMemoFirebase(() => (firestore && orgId && train ? query(collection(firestore, HR_TRAINING), where("organizationId", "==", orgId), where("kind", "==", "session")) : null), [firestore, orgId, train])
  const { data: sessData, isLoading: sessLoading } = useCollection(sessQ)
  // Training needs come from reviews: the office reads them with the feature `perf` too.
  const reviewsOn = perf || (train && office)
  const cycQ = useMemoFirebase(() => (firestore && orgId && reviewsOn ? query(collection(firestore, HR_REVIEWS), where("organizationId", "==", orgId), where("kind", "==", "cycle")) : null), [firestore, orgId, reviewsOn])
  const { data: cycData, isLoading: cycLoading } = useCollection(cycQ)
  const cycles = useMemo(() => (cycData ?? []) as unknown as ReviewCycle[], [cycData])
  const cycle = useMemo(() => currentCycle(cycles), [cycles])
  const cid = cycle?.id ?? null

  const revQ = useMemoFirebase(() => {
    if (!firestore || !orgId || !cid || !reviewsOn) return null
    const base = [where("organizationId", "==", orgId), where("cycleId", "==", cid)]
    if (office) return query(collection(firestore, HR_REVIEWS), ...base, where("kind", "==", "review"))
    return uid ? query(collection(firestore, HR_REVIEWS), ...base, where("raterUserId", "==", uid)) : null
  }, [firestore, orgId, cid, reviewsOn, office, uid])
  const { data: revData, isLoading: revLoading } = useCollection(revQ)

  const mineQ = useMemoFirebase(
    () => (firestore && orgId && cid && perf && uid ? query(collection(firestore, HR_REVIEWS), where("organizationId", "==", orgId), where("cycleId", "==", cid), where("employeeUserId", "==", uid), where("st", "in", ["ok", "ack"])) : null),
    [firestore, orgId, cid, perf, uid]
  )
  const { data: mineData } = useCollection(mineQ)
  const selfQ = useMemoFirebase(
    () => (firestore && orgId && perf && uid ? query(collection(firestore, HR_REVIEWS), where("organizationId", "==", orgId), where("employeeUserId", "==", uid), where("st", "==", "self")) : null),
    [firestore, orgId, perf, uid]
  )
  const { data: selfData } = useCollection(selfQ)

  const costQ = useMemoFirebase(() => (firestore && orgId && train && money ? query(collection(firestore, HR_EVENTS), where("organizationId", "==", orgId), where("kind", "==", "TRN")) : null), [firestore, orgId, train, money])
  const { data: costData } = useCollection(costQ)

  return useMemo(() => {
    const reviews = ((revData ?? []) as unknown as HrReview[]).filter((r) => r.kind === "review")
    const mine = ((mineData ?? []) as unknown as HrReview[]).find((r) => r.kind === "review") ?? null
    const myself = cid ? (((selfData ?? []) as unknown as SelfReview[]).find((s) => s.review.startsWith(`${cid}__`)) ?? null) : null
    return {
      train,
      perf,
      sessions: ((sessData ?? []) as unknown as TrainingSession[]).slice().sort((a, b) => a.at.localeCompare(b.at)),
      cycles,
      cycle,
      reviews,
      mine,
      myself,
      costs: (costData ?? []) as unknown as TrainingCostEvent[],
      isLoading: sessLoading || cycLoading || revLoading,
    }
  }, [revData, mineData, selfData, sessData, costData, cycles, cycle, cid, train, perf, sessLoading, cycLoading, revLoading])
}
