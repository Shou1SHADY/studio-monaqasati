"use client"

// The files that were attached on the company's records before the document thread existed,
// read where they live — nothing is copied or backfilled. Top-level collections are read by
// the company's own id (one equality filter each, so no composite index); a project's records
// and a deal's files are subcollections, opened only for the projects and deals whose own
// counters say they hold some. Every read is of the viewer's own company.

import { useEffect, useMemo, useState } from "react"
import { useLocale } from "next-intl"
import { collection, onSnapshot, query, where, type Firestore } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { RecordFile } from "@/lib/document-library"
import {
  PM_SUBS,
  crmRecordFiles,
  handoverRecordFiles,
  offerRecordFiles,
  opportunityHasFiles,
  pmSubsWithRecords,
  projectRecordFiles,
  receiptRecordFiles,
  rfqRecordFiles,
  type PmSub,
} from "@/lib/document-records"

type Doc = Record<string, unknown> & { id: string }

const MAX_STREAMS = 250

function useSubcollections(paths: string[], orgId: string | null | undefined): { rows: Map<string, Doc[]>; loading: boolean } {
  const firestore = useFirestore()
  const signature = useMemo(() => [...paths].sort().slice(0, MAX_STREAMS).join("|"), [paths])
  const [rows, setRows] = useState<Map<string, Doc[]>>(() => new Map())

  useEffect(() => {
    if (!firestore || !signature) return
    const put = (path: string, docs: Doc[]) => setRows((prev) => new Map(prev).set(path, docs))
    const unsubscribe = signature.split("|").map((path) => {
      const [root, ...rest] = path.split("/")
      const target = collection(firestore, root, ...rest)
      // A deal's file rule reads the file's own organizationId, so the query has to name it; a project's records are guarded by the project.
      return onSnapshot(
        root === "crmOpportunities" ? query(target, where("organizationId", "==", orgId)) : target,
        (snap) => put(path, snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
        (err) => {
          if (err.code !== "permission-denied") console.warn("document library:", path, err.code)
          put(path, [])
        }
      )
    })
    return () => unsubscribe.forEach((stop) => stop())
  }, [firestore, signature, orgId])

  const loading = signature !== "" && signature.split("|").some((path) => !rows.has(path))
  return { rows, loading }
}

const byId = (...lists: Array<Doc[] | null>): Doc[] => {
  const seen = new Map<string, Doc>()
  for (const l of lists) for (const d of l ?? []) seen.set(d.id, d)
  return [...seen.values()]
}

const ownedBy = (firestore: Firestore | null, orgId: string | null | undefined, name: string, field: string) =>
  firestore && orgId ? query(collection(firestore, name), where(field, "==", orgId)) : null

export function useRecordFiles(orgId: string | null | undefined): { loading: boolean; files: RecordFile[] } {
  const firestore = useFirestore()
  const locale = useLocale()

  const rfqsQ = useMemoFirebase(() => ownedBy(firestore, orgId, "rfqs", "organizationId"), [firestore, orgId])
  const offersAsBuyerQ = useMemoFirebase(() => ownedBy(firestore, orgId, "offers", "contractorOrgId"), [firestore, orgId])
  const offersAsSupplierQ = useMemoFirebase(() => ownedBy(firestore, orgId, "offers", "organizationId"), [firestore, orgId])
  const deliveriesAsBuyerQ = useMemoFirebase(() => ownedBy(firestore, orgId, "deliveries", "contractorOrgId"), [firestore, orgId])
  const deliveriesAsSupplierQ = useMemoFirebase(() => ownedBy(firestore, orgId, "deliveries", "supplierOrgId"), [firestore, orgId])
  const handoversQ = useMemoFirebase(() => ownedBy(firestore, orgId, "pmHandovers", "organizationId"), [firestore, orgId])
  const projectsQ = useMemoFirebase(() => ownedBy(firestore, orgId, "projects", "organizationId"), [firestore, orgId])
  const dealsQ = useMemoFirebase(() => ownedBy(firestore, orgId, "crmOpportunities", "organizationId"), [firestore, orgId])

  const rfqs = useCollection<Doc>(rfqsQ)
  const offersAsBuyer = useCollection<Doc>(offersAsBuyerQ)
  const offersAsSupplier = useCollection<Doc>(offersAsSupplierQ)
  const deliveriesAsBuyer = useCollection<Doc>(deliveriesAsBuyerQ)
  const deliveriesAsSupplier = useCollection<Doc>(deliveriesAsSupplierQ)
  const handovers = useCollection<Doc>(handoversQ)
  const projects = useCollection<Doc>(projectsQ)
  const deals = useCollection<Doc>(dealsQ)

  const projectList = useMemo(() => (projects.data ?? []).map((p) => ({ id: p.id, name: typeof p.name === "string" ? p.name : null, pm: (p.pm as Record<string, unknown> | null | undefined) ?? null })), [projects.data])
  const dealList = useMemo(() => (deals.data ?? []).filter(opportunityHasFiles).map((d) => ({ id: d.id, title: typeof d.title === "string" ? d.title : null, docNumber: typeof d.docNumber === "string" ? d.docNumber : null })), [deals.data])

  const paths = useMemo(
    () => [...projectList.flatMap((p) => pmSubsWithRecords(p).map((sub) => `projects/${p.id}/${sub}`)), ...dealList.map((d) => `crmOpportunities/${d.id}/files`)],
    [projectList, dealList]
  )
  const streams = useSubcollections(paths, orgId)

  const files = useMemo(() => {
    const out: RecordFile[] = []
    for (const r of rfqs.data ?? []) out.push(...rfqRecordFiles(r))
    for (const o of byId(offersAsBuyer.data, offersAsSupplier.data)) out.push(...offerRecordFiles(o))
    for (const d of byId(deliveriesAsBuyer.data, deliveriesAsSupplier.data)) out.push(...receiptRecordFiles(d, locale))
    for (const h of handovers.data ?? []) out.push(...handoverRecordFiles(h, locale))
    for (const p of projectList) {
      for (const sub of PM_SUBS as readonly PmSub[]) {
        for (const r of streams.rows.get(`projects/${p.id}/${sub}`) ?? []) out.push(...projectRecordFiles(sub, r, p))
      }
    }
    for (const d of dealList) {
      for (const f of streams.rows.get(`crmOpportunities/${d.id}/files`) ?? []) out.push(...crmRecordFiles(f, d, locale))
    }
    return out
  }, [rfqs.data, offersAsBuyer.data, offersAsSupplier.data, deliveriesAsBuyer.data, deliveriesAsSupplier.data, handovers.data, projectList, dealList, streams.rows, locale])

  const loading = [rfqs, offersAsBuyer, offersAsSupplier, deliveriesAsBuyer, deliveriesAsSupplier, handovers, projects, deals].some((q) => q.isLoading) || streams.loading
  return { loading, files }
}
