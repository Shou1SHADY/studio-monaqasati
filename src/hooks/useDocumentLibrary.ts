"use client"

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useRecordFiles } from "@/hooks/useRecordFiles"
import { DOCUMENT_NOTES, entryFromDoc, mergeEntries } from "@/lib/document-thread"
import { filesOf, mergeLibrary, type LibraryItem } from "@/lib/document-library"

/**
 * Every file the viewer's company may see: the thread entries of kind "file" stored for the
 * company as buyer and as supplier (a shared file turns up in both and is kept once), and the
 * files attached on its records before the thread existed, read where they live. A file that
 * is both is listed once, as the thread entry. `records: false` counts the thread alone.
 */
export function useDocumentLibrary(orgId: string | null | undefined, options: { records?: boolean } = {}): { loading: boolean; files: LibraryItem[] } {
  const withRecords = options.records !== false
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
  const records = useRecordFiles(withRecords ? orgId : null)
  const files = useMemo(() => {
    const read = (rows: unknown) => ((rows || []) as Array<{ id: string } & Record<string, unknown>>).map(({ id, ...rest }) => entryFromDoc(id, rest))
    return mergeLibrary(filesOf(mergeEntries(read(buyer.data), read(supplier.data))), records.files)
  }, [buyer.data, supplier.data, records.files])
  return { loading: buyer.isLoading || supplier.isLoading || records.loading, files }
}
