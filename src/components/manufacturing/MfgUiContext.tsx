"use client"

// One Manufacturing session per page: the data subscription, the derived order
// views every screen reads, the role-filtered decision queue, and the three
// overlays any screen can open — the order drawer, an order action form, and
// the new-order wizard. A card on the board, a row in the table and a line in
// Today all open the same drawer through `openOrder`, so an order looks and
// behaves the same wherever it is found.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { usePermissions } from "@/hooks/usePermissions"
import { useMfgData, type MfgData } from "@/hooks/useMfgData"
import { buildDecisions, type Decision } from "@/lib/manufacturing-engine"
import { toNoteSlice, toOrderSlice } from "@/lib/manufacturing-writes"
import { buildOrderViews, computeKpis, type MfgKpis, type OrderView } from "@/lib/manufacturing-view"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { MfgOrderDrawer } from "./MfgOrderDrawer"
import { MfgActionForms } from "./MfgActionForms"
import { MfgNewOrderWizard } from "./MfgNewOrderWizard"

/** Every action a work order offers, each with the argument it needs. */
export type OrderAction =
  | { kind: "output"; index: number }
  | { kind: "qc"; index: number }
  | { kind: "materials"; departmentId: string }
  | { kind: "note" }
  | { kind: "confirmNote"; noteId: string }
  | { kind: "breakage" }
  | { kind: "measurement" }
  | { kind: "slab" }
  | { kind: "drawing" }
  | { kind: "release" }
  | { kind: "rush" }
  | { kind: "approveScrap"; scrapId: string }

export interface MfgPermissions {
  canManage: boolean
  canWork: boolean
  canQc: boolean
  canCost: boolean
  seesMoney: boolean
  canReceive: boolean
  /** Raise a manufacturing request (projects, sales or the workshop itself). */
  canRequest: boolean
  /** Create work orders directly. */
  canCreate: boolean
}

export interface MfgUi {
  portal: CrmPortal
  base: string
  data: MfgData
  perms: MfgPermissions
  today: string
  views: OrderView[]
  viewById: Map<string, OrderView>
  kpis: MfgKpis
  /** Today's decisions, filtered to what the signed-in role can act on. */
  decisions: Decision[]
  openOrder: (orderId: string) => void
  openAction: (orderId: string, action: OrderAction) => void
  openNewOrder: () => void
}

const MfgUiContext = createContext<MfgUi | null>(null)

export function useMfgUi(): MfgUi {
  const ctx = useContext(MfgUiContext)
  if (!ctx) throw new Error("useMfgUi must be used inside <MfgUiProvider>")
  return ctx
}

/** Who may act on each decision — the queue shows a person only their own work. */
export function decisionAllowed(d: Decision, p: MfgPermissions): boolean {
  switch (d.kind) {
    case "answer_request":
      return p.canManage
    case "send_estimate":
    case "log_quote":
    case "chase_quote":
      return p.canCost || p.canManage
    case "release_ready":
    case "release_blocked":
      return p.canManage || p.canCost
    case "record_slab":
      return p.canQc || p.canManage
    case "chase_drawing":
      return p.canManage || p.canWork
    case "materials_missing":
    case "confirm_materials":
      return p.canWork
    case "qc_decision":
      return p.canQc
    case "approve_scrap":
      return p.canCost || p.canManage
    case "issue_note":
      return p.canManage
    case "confirm_note":
      return p.canReceive || p.canManage
    case "breakage_decision":
      return p.canManage || p.canCost
    case "hour_variance":
      return p.seesMoney && (p.canManage || p.canCost)
    case "will_miss_date":
      return p.canManage || p.canCost
  }
}

export function MfgUiProvider({ portal, children }: { portal: CrmPortal; children: ReactNode }) {
  const data = useMfgData()
  const { can } = usePermissions()
  const today = new Date().toISOString().slice(0, 10)

  const perms: MfgPermissions = useMemo(
    () => ({
      canManage: data.canManage,
      canWork: data.canWork,
      canQc: data.canQc,
      canCost: data.canCost,
      seesMoney: data.seesMoney,
      canReceive: can("warehouses.receive") || can("warehouses.manage"),
      canRequest: can("projects.edit") || can("sales.manage") || data.canManage,
      canCreate: data.canManage || data.canCost,
    }),
    [data.canManage, data.canWork, data.canQc, data.canCost, data.seesMoney, can]
  )

  const views = useMemo(
    () =>
      buildOrderViews(
        { v2Orders: data.v2Orders, productById: data.productById, notesByOrder: data.notesByOrder, schedule: data.schedule, settings: data.settings },
        today
      ),
    [data.v2Orders, data.productById, data.notesByOrder, data.schedule, data.settings, today]
  )
  const viewById = useMemo(() => new Map(views.map((v) => [v.id, v])), [views])
  const kpis = useMemo(
    () => computeKpis(views, data.scheduleInputs, data.departments, data.settings.features.time),
    [views, data.scheduleInputs, data.departments, data.settings.features.time]
  )

  const decisions = useMemo(() => {
    const all = buildDecisions({
      orders: data.v2Orders
        .filter((o) => data.productById.has(o.productId || ""))
        .map((o) => ({
          order: toOrderSlice(o),
          product: data.productById.get(o.productId || "")!,
          notes: (data.notesByOrder.get(o.id) || []).map((n) => ({ ...toNoteSlice(n), id: n.id })),
        })),
      requests: data.requests.map((r) => ({
        id: r.id,
        state: r.status === "new" ? "new" : "answered",
        ageHours: r.requestedAt ? Math.max(0, (Date.now() - new Date(r.requestedAt).getTime()) / 3600000) : 0,
      })),
      estimates: data.estimates.map((e) => ({ id: e.id, state: e.state, sentAt: e.sentAt, quotedAt: e.quotedAt })),
      schedule: data.schedule,
      departments: data.departments,
      settings: data.settings,
      today,
    })
    return all.filter((d) => decisionAllowed(d, perms))
  }, [data.v2Orders, data.productById, data.notesByOrder, data.requests, data.estimates, data.schedule, data.departments, data.settings, today, perms])

  const [drawerOrderId, setDrawerOrderId] = useState<string | null>(null)
  const [action, setAction] = useState<{ orderId: string; action: OrderAction } | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

  const openOrder = useCallback((orderId: string) => setDrawerOrderId(orderId), [])
  const openAction = useCallback((orderId: string, a: OrderAction) => setAction({ orderId, action: a }), [])
  const openNewOrder = useCallback(() => setWizardOpen(true), [])

  const value: MfgUi = {
    portal,
    base: `/${portal}/manufacturing`,
    data,
    perms,
    today,
    views,
    viewById,
    kpis,
    decisions,
    openOrder,
    openAction,
    openNewOrder,
  }

  return (
    <MfgUiContext.Provider value={value}>
      {children}
      <MfgOrderDrawer orderId={drawerOrderId} onClose={() => setDrawerOrderId(null)} />
      {action && <MfgActionForms orderId={action.orderId} action={action.action} onClose={() => setAction(null)} />}
      {wizardOpen && <MfgNewOrderWizard onClose={() => setWizardOpen(false)} onCreated={(id) => { setWizardOpen(false); setDrawerOrderId(id) }} />}
    </MfgUiContext.Provider>
  )
}
