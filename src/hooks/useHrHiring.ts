"use client"

// HR 1.0 — Hiring's world (optional: hire): the company's openings, candidates
// and — for pay roles only — the candidates' money, read the way the rules let
// each role read `hrHiring`: government relations asks for the documents
// without pay (`pay == false`), never an amount (RL-03). Null when the switch
// is off or the viewer holds no hiring role — then no row and no lot exists.

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { HrAccess } from "@/hooks/useHrAccess"
import { HR_HIRING, type Candidate, type CandidatePay, type Opening } from "@/lib/hr/hiring"
import type { HiringWorld } from "@/lib/hr/hiring-today"

/** Who reads Hiring: the HR manager, government relations and management (the prototype's tab). */
export const readsHiring = (access: Pick<HrAccess, "ctx" | "settings">) =>
  access.settings.features.includes("hire") && (access.ctx.owner || access.ctx.roles.has("manager") || access.ctx.roles.has("gov") || access.ctx.roles.has("management"))

export function useHrHiring(access: HrAccess): HiringWorld | null {
  const firestore = useFirestore()
  const orgId = access.orgId
  const on = readsHiring(access)
  const money = access.allowed("pay.view")
  const q = useMemoFirebase(
    () => (firestore && orgId && on ? (money ? query(collection(firestore, HR_HIRING), where("organizationId", "==", orgId)) : query(collection(firestore, HR_HIRING), where("organizationId", "==", orgId), where("pay", "==", false))) : null),
    [firestore, orgId, on, money]
  )
  const { data } = useCollection(q)
  const policies = access.settings.policies
  return useMemo(() => {
    if (!on) return null
    const docs = (data ?? []) as unknown as Array<Opening | Candidate | CandidatePay>
    const openings = docs.filter((d): d is Opening => d.kind === "opening")
    const candidates = docs.filter((d): d is Candidate => d.kind === "candidate")
    const pays = new Map(docs.filter((d): d is CandidatePay => d.kind === "offer").map((p) => [p.candidateId, p]))
    return { openings, candidates, pays, policies }
  }, [on, data, policies])
}
