"use client"

// A PM project's sub-tab rail with the prototype's counts (SEGS, E-00a, C-46):
// each sub-tab shows what waits in it, red when something is lost or late, "!"
// where it is a state and not a number, and a «قراءة» tag where the viewer only
// reads another module's records. Collections are read only while their group
// is open, and only what the viewer may read (certificates and orders for money).

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { SegmentedNav, type Segment, type SegmentTone } from "@/components/module-ui/SegmentedNav"
import type { PmAccess } from "@/hooks/usePmAccess"
import { usePmExecCounts } from "@/hooks/usePmExecCounts"
import type { LookaheadSections } from "@/hooks/usePmLookahead"
import { useProjectCost } from "@/hooks/useProjectCost"
import { seatActive, seatFromMember } from "@/lib/pm/access"
import type { Acceptances } from "@/lib/pm/acceptance"
import { PM_ADDENDA } from "@/lib/pm/addenda"
import { PM_CERTIFICATES, type CertificateStatus } from "@/lib/pm/certificate"
import { noticeLate, PM_CLAIMS, type PmClaim } from "@/lib/pm/claim"
import { closeoutRows, storeHoldings, type CloseRow } from "@/lib/pm/closeout"
import { PM_LETTERS, type PmLetter } from "@/lib/pm/correspondence"
import { PM_DOCS, staleDocuments, type PmDocument } from "@/lib/pm/documents"
import { todayDay } from "@/lib/pm/format"
import { matchRows } from "@/lib/pm/match"
import { PM_NCRS, type NcrStatus } from "@/lib/pm/ncr"
import type { ProjectGroup } from "@/lib/pm/project-tabs"
import { PM_PUNCH, type PunchStatus } from "@/lib/pm/punch"
import { PM_STORE, storeGroup, storeLineOf, storeState, type PmStoreLine, type StoreItem } from "@/lib/pm/store"
import { PM_SUB_CERTIFICATES } from "@/lib/pm/subcontract"
import { PURCHASE_REQUESTS, reqState, requestOf } from "@/lib/pm/supply"
import { tabBadges } from "@/lib/pm/tab-badges"
import type { ContractTerms } from "@/lib/pm/terms"
import { PM_VARIATIONS, type VoStatus } from "@/lib/pm/variation"
import type { LookItem } from "@/lib/pm/weekly-plan"

const READ_ONLY = new Set(["pmPo", "pmMatch"])
// The client-money closeout rows are counted only for whoever reads the certificates (as CloseoutPanel shows them).
const MONEY_ROWS = new Set<CloseRow["key"]>(["unbilled", "in_progress", "overdue", "retention", "vo_pending"])
const DAY_MS = 86_400_000

function useRows<T>(projectId: string, name: string, on: boolean) {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && on ? collection(firestore, "projects", projectId, name) : null), [firestore, projectId, name, on])
  return ((useCollection(q).data ?? []) as unknown as T[])
}

export interface SubTabProject {
  lifecycle: string
  /** The last approved monthly reconciliation. */
  eac?: { on: string } | null
  acceptances?: Acceptances
  cutPool?: number
  retentionHeld?: number
  retentionReleased?: boolean
  /** Someone pays us (terms.payer ≠ none): the client-money closeout rows apply. */
  hasClient: boolean
  /** The project store section is on. */
  storeOn: boolean
}

export function PmSubTabNav({
  projectId,
  orgId,
  group,
  tabs,
  active,
  onSelect,
  access,
  items,
  sections,
  weeklyPlan,
  terms,
  lastIpcOn,
  hasManager,
  project,
}: {
  projectId: string
  orgId: string | null
  group: ProjectGroup
  tabs: Array<{ key: string; label: string }>
  active: string
  onSelect: (key: string) => void
  access: PmAccess
  items: LookItem[]
  sections: LookaheadSections
  weeklyPlan: boolean
  terms: ContractTerms | null
  lastIpcOn: string | null
  hasManager: boolean
  project: SubTabProject
}) {
  const tPm = useTranslations("Portal.PM")
  const today = todayDay()
  const money = access.has("money")
  const has = (key: string) => tabs.some((x) => x.key === key)
  const exec = usePmExecCounts(projectId, { enabled: group === "exec", items, sections, weeklyPlan, today })
  const contract = group === "contract"
  const supply = group === "supply"
  const moneyGroup = group === "money"
  const file = group === "file"
  const close = file && has("pmClose")
  const addenda = useRows<{ status: string }>(projectId, PM_ADDENDA, contract && (money || access.has("approve")))
  const variations = useRows<{ status: VoStatus; value?: number }>(projectId, PM_VARIATIONS, contract || close)
  const claims = useRows<PmClaim>(projectId, PM_CLAIMS, contract)
  const subCerts = useRows<{ status: string }>(projectId, PM_SUB_CERTIFICATES, group === "exec")
  const docs = useRows<PmDocument>(projectId, PM_DOCS, file)
  const letters = useRows<PmLetter>(projectId, PM_LETTERS, file)
  const requests = useRows<Record<string, unknown> & { id: string }>(projectId, PURCHASE_REQUESTS, supply)
  const stores = useRows<Partial<PmStoreLine> & { id: string }>(projectId, PM_STORE, supply || (close && project.storeOn))
  const certs = useRows<{ status: CertificateStatus; net: number; dueOn?: string | null; collected?: number | null }>(projectId, PM_CERTIFICATES, (moneyGroup || close) && money)
  const punch = useRows<{ status: PunchStatus }>(projectId, PM_PUNCH, close)
  const ncrs = useRows<{ status: NcrStatus }>(projectId, PM_NCRS, close)
  const members = useRows<Record<string, unknown> & { id: string }>(projectId, "members", group === "settings")
  const cost = useProjectCost(projectId, orgId, moneyGroup && money && has("pmMatch"))

  const badges = useMemo(() => {
    const storeItems: StoreItem[] = items.map((i) => ({ id: i.id, code: i.code, description: "", unit: i.unit ?? "", quantity: i.quantity, executed: i.executed }))
    const lines = stores.map((d) => storeLineOf(d.id, d))
    const states = lines.map((x) => storeState(x, storeItems))
    const overdue = certs.some((c) => (c.status === "appr" || c.status === "part") && Boolean(c.dueOn) && (c.dueOn as string).slice(0, 10) < today && (c.collected ?? 0) < 1)
    const eacAge = project.eac ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${project.eac.on.slice(0, 10)}T00:00:00Z`)) / DAY_MS) : null
    const rows = close
      ? closeoutRows({
          hasClient: project.hasClient,
          acceptances: project.acceptances ?? {},
          punch,
          ncrs,
          variations: variations.map((v) => ({ status: v.status, value: Number(v.value) || 0 })),
          items: items.map((i) => ({ rate: i.rate, executed: i.executed, billed: (i as LookItem & { billed?: number }).billed ?? 0 })),
          cutPool: project.cutPool ?? 0,
          certificates: certs,
          retentionHeld: project.retentionHeld ?? 0,
          retentionReleased: project.retentionReleased === true,
          storeLines: project.storeOn ? storeHoldings(lines, storeItems).lines : null,
          letters,
          today,
        })
      : []
    return tabBadges({
      today,
      hasManager,
      liveSeats: members.map((m) => seatFromMember(m, m.id)).filter((s) => s && seatActive(s, today)).length,
      addendaDrafts: addenda.filter((a) => a.status === "draft").length,
      variations,
      claimsOpen: claims.filter((c) => c.status === "draft" || c.status === "notice" || c.status === "sub").length,
      claimNoticeLate: terms ? claims.some((c) => noticeLate(c, terms, today)) : false,
      subCertificates: subCerts,
      staleDocuments: staleDocuments(docs, lastIpcOn).length,
      letters,
      closeoutOpen: rows.filter((r) => !r.ok && (money || !MONEY_ROWS.has(r.key))).length,
      requestsWaiting: requests.map(requestOf).filter((r) => reqState(r) === "wait").length,
      storeAct: states.filter((st) => storeGroup(st) === "act").length,
      storeNegative: states.includes("neg"),
      samples: items,
      certificatesOpen: certs.filter((c) => c.status === "int" || c.status === "sub").length,
      certificateOverdue: overdue,
      matchOver: money ? matchRows(cost.pos, cost.invoices).filter((r) => r.state === "over").length : 0,
      cvrStale: project.lifecycle === "live" && (eacAge === null || eacAge > 35),
    })
  }, [today, hasManager, members, addenda, variations, claims, terms, subCerts, docs, lastIpcOn, letters, requests, stores, items, certs, punch, ncrs, close, project, money, cost.pos, cost.invoices])

  const segments: Segment[] = tabs.map((x) => {
    const e = (exec as Record<string, { count?: number; tone?: SegmentTone } | undefined>)[x.key]
    const b = badges[x.key]
    const count = e?.count ?? b?.n
    const tone: SegmentTone | undefined = e?.tone ?? (b ? b.tone : undefined)
    return { id: x.key, label: x.label, count, tone, readOnlyLabel: READ_ONLY.has(x.key) ? tPm("seg_read") : undefined }
  })

  return <SegmentedNav ariaLabel={tPm(`grp.${group}`)} active={active} onSelect={onSelect} segments={segments} />
}
