"use client"

// HR — the platform records (`hrGovTasks`): acts recorded done, tasks a pay change or a reconciliation made,
// each platform's last reconciliation. Read by the HR office roles (no amount is ever in them); `on` is the
// feature switch — with `gov` and `mudad` off, nothing is read.

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { HrAccess } from "@/hooks/useHrAccess"
import { HR_GOV, type GovDoc } from "@/lib/hr/platforms"

const OFFICE = ["manager", "gov", "payroll", "management"] as const

export function useHrGovDocs(access: Pick<HrAccess, "orgId" | "ctx">, on: boolean): GovDoc[] {
  const firestore = useFirestore()
  const orgId = access.orgId
  const office = access.ctx.owner || OFFICE.some((r) => access.ctx.roles.has(r))
  const q = useMemoFirebase(() => (firestore && orgId && on && office ? query(collection(firestore, HR_GOV), where("organizationId", "==", orgId)) : null), [firestore, orgId, on, office])
  const { data } = useCollection(q)
  return useMemo(() => ((data ?? []) as unknown as GovDoc[]), [data])
}
