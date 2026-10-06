"use client"

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { DOCUMENT_NOTES, entryFromDoc, mergeEntries, type ThreadEntry } from "@/lib/document-thread"

/**
 * One document's thread, as the viewer's company may read it. An entry stores its
 * companies in two fields, so the thread is two queries — the buyer's and the
 * supplier's side — merged; a shared entry turns up in both and is kept once.
 */
export function useDocumentThread(targetKey: string | null, orgId: string | null | undefined): { loading: boolean; entries: ThreadEntry[] } {
  const firestore = useFirestore()
  const asBuyer = useMemoFirebase(
    () => (firestore && targetKey && orgId ? query(collection(firestore, DOCUMENT_NOTES), where("targetKey", "==", targetKey), where("buyerOrgId", "==", orgId)) : null),
    [firestore, targetKey, orgId]
  )
  const asSupplier = useMemoFirebase(
    () => (firestore && targetKey && orgId ? query(collection(firestore, DOCUMENT_NOTES), where("targetKey", "==", targetKey), where("supplierOrgId", "==", orgId)) : null),
    [firestore, targetKey, orgId]
  )
  const buyer = useCollection(asBuyer)
  const supplier = useCollection(asSupplier)
  const entries = useMemo(() => {
    const read = (rows: unknown) => ((rows || []) as Array<{ id: string } & Record<string, unknown>>).map(({ id, ...rest }) => entryFromDoc(id, rest))
    return mergeEntries(read(buyer.data), read(supplier.data))
  }, [buyer.data, supplier.data])
  return { loading: buyer.isLoading || supplier.isLoading, entries }
}
