"use client"

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { CRM_OPPORTUNITIES } from "@/lib/crm"
import { OPP_FILES, type OpportunityFile } from "@/lib/crm-opportunity-writes"

/** A deal's files and photos (OPP-10), newest first. The organisation filter is what lets the rules allow the list. */
export function useOpportunityFiles(opportunityId: string | null | undefined, orgId: string | null | undefined) {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => {
    if (!firestore || !opportunityId || !orgId) return null
    return query(collection(firestore, CRM_OPPORTUNITIES, opportunityId, OPP_FILES), where("organizationId", "==", orgId))
  }, [firestore, opportunityId, orgId])
  const { data, isLoading } = useCollection(q)
  const files = useMemo(
    () => ((data || []) as OpportunityFile[]).slice().sort((a, b) => (b.at || "").localeCompare(a.at || "")),
    [data]
  )
  return { files, isLoading }
}
