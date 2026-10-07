"use client"

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { DOCUMENT_NOTES, entryFromDoc, mergeEntries } from "@/lib/document-thread"
import { filesOf, type LibraryFile } from "@/lib/document-library"

/**
 * Every file the viewer's company may see on any document: the thread entries of kind
 * "file" stored for the company as buyer and as supplier, merged (a shared file turns up
 * in both and is kept once).
 */
export function useDocumentLibrary(orgId: string | null | undefined): { loading: boolean; files: LibraryFile[] } {
  const firestore = useFirestore()
  const asBuyer = useMemoFirebase(
    () => (firestore && orgId ? query(collection(firestore, DOCUMENT_NOTES), where("kind", "==", "file"), where("buyerOrgId", "==", orgId)) : null),
    [firestore, orgId]
  )
  const asSupplier = useMemoFirebase(
    () => (firestore && orgId ? query(collection(firestore, DOCUMENT_NOTES), where("kind", "==", "file"), where("supplierOrgId", "==", orgId)) : null),
    [firestore, orgId]
  )
  const buyer = useCollection(asBuyer)
  const supplier = useCollection(asSupplier)
  const files = useMemo(() => {
    const read = (rows: unknown) => ((rows || []) as Array<{ id: string } & Record<string, unknown>>).map(({ id, ...rest }) => entryFromDoc(id, rest))
    return filesOf(mergeEntries(read(buyer.data), read(supplier.data)))
  }, [buyer.data, supplier.data])
  return { loading: buyer.isLoading || supplier.isLoading, files }
}
