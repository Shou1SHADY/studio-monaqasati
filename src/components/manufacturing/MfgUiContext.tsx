"use client"

// One Manufacturing session per page: the live data, the computed world every
// screen reads (order views, schedule, reservations), who is looking and as
// which of the five roles, their decision queue — and the overlays any screen
// can open: the order panel, an order form, a request, a product, or one of
// the workshop-wide forms (a stop, a block notice, a stock order).
//
// A row in the Workshop, a card on the board and a line in Today all open the
// same panel and the same forms through `openOrder` / `openAction`, so an
// order looks and behaves the same wherever it is found.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useMfgData, type MfgData } from "@/hooks/useMfgData"
import {
  nextStep,
  ownsCandidate,
  waitingOn,
  type Candidate,
  type Persona,
} from "@/lib/manufacturing-engine"
import {
  buildDecisions,
  buildWorld,
  myStations,
  personasOf,
  type DecisionItem,
  type MfgWorld,
  type OrderView,
} from "@/lib/manufacturing-view"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { MfgOrderDrawer } from "./MfgOrderDrawer"
import { MfgActionForms } from "./MfgActionForms"
import { MfgGlobalForms } from "./MfgGlobalForms"

/** Every decision a work order takes — one form each (section 4 of the PRD). */
export type OrderAction =
  | { kind: "survey" }
  | { kind: "release" }
  | { kind: "rush" }
  | { kind: "submitDrawing" }
  | { kind: "slab" }
  | { kind: "gate"; index: number }
  | { kind: "requestMaterials"; departmentId: string }
  | { kind: "confirmReceipt"; departmentId: string; requestNumber: string }
  /** Record output & hand over — at QC & packing it is the quality release. */
  | { kind: "output"; index: number }
  | { kind: "qc"; index: number }
  | { kind: "reviewScrap"; scrapId: string }
  | { kind: "clarifyScrap"; scrapId: string }
  | { kind: "remake"; source: "scrap" | "breakage" }
  | { kind: "close" }
  | { kind: "deliver" }
  | { kind: "purchase"; itemName: string }
  | { kind: "override"; index: number }
  /** Apply an incoming change, or change/cancel a stock order. */
  | { kind: "change" }
  | { kind: "variance"; departmentId: string }

/** Workshop-wide forms, not tied to one order. */
export type GlobalAction =
  | { kind: "stockOrder" }
  | { kind: "stop"; departmentId?: string }
  | { kind: "blockNotice"; lot?: string }
  | { kind: "answerRequest"; requestId: string }
  | { kind: "sendEstimate"; estimateId: string }
  | { kind: "recalcEstimate"; estimateId: string }
  | { kind: "product"; productId?: string }

/** The form a candidate opens; null for steps other modules own. */
export function candidateAction(c: Candidate): OrderAction | null {
  switch (c.key) {
    case "qc_decision":
      return { kind: "qc", index: c.index ?? 0 }
    case "scrap_review":
      return c.scrapId ? { kind: "reviewScrap", scrapId: c.scrapId } : null
    case "scrap_clarify":
      return c.scrapId ? { kind: "clarifyScrap", scrapId: c.scrapId } : null
    case "remake_scrap":
      return { kind: "remake", source: "scrap" }
    case "remake_breakage":
      return { kind: "remake", source: "breakage" }
    case "apply_change":
      return { kind: "change" }
    case "survey":
      return { kind: "survey" }
    case "release":
      return { kind: "release" }
    case "shortage":
      return c.itemName ? { kind: "purchase", itemName: c.itemName } : null
    case "submit_drawing":
      return { kind: "submitDrawing" }
    case "slab":
      return { kind: "slab" }
    case "gate":
      return { kind: "gate", index: c.index ?? 0 }
    case "confirm_receipt":
      return c.departmentId && c.requestNumber ? { kind: "confirmReceipt", departmentId: c.departmentId, requestNumber: c.requestNumber } : null
    case "request_materials":
      return c.departmentId ? { kind: "requestMaterials", departmentId: c.departmentId } : null
    case "output":
    case "qc_release":
      return { kind: "output", index: c.index ?? 0 }
    case "close":
      return { kind: "close" }
    case "deliver":
      return { kind: "deliver" }
    default:
      return null
  }
}

export interface MfgPermissions {
  canManage: boolean
  canWork: boolean
  canQc: boolean
  canCost: boolean
  canView: boolean
  seesMoney: boolean
}

export interface MfgUi {
  portal: CrmPortal
  base: string
  data: MfgData
  perms: MfgPermissions
  today: string
  nowMs: number
  world: MfgWorld
  views: OrderView[]
  viewById: Map<string, OrderView>
  /** The roles this person holds, and the one their Today is shown as. */
  personas: Persona[]
  persona: Persona | null
  setPersona: (p: Persona) => void
  /** Stations the viewer records under the current persona. */
  stations: string[]
  /** Today's decisions for the current persona. */
  decisions: DecisionItem[]
  /** Money is shown to the manager, the cost controller and management only. */
  seesMoney: boolean
  /** The viewer's next step on an order under any role they hold (ORD-04). */
  nextStepOf: (v: OrderView) => Candidate | null
  /** The first step when it belongs to someone else — "awaiting …". */
  waitingOf: (v: OrderView) => Candidate | null
  owns: (c: Candidate) => boolean
  openOrder: (orderId: string) => void
  openAction: (orderId: string, action: OrderAction) => void
  openCandidate: (orderId: string, c: Candidate) => void
  openGlobal: (action: GlobalAction) => void
}

const MfgUiContext = createContext<MfgUi | null>(null)

export function useMfgUi(): MfgUi {
  const ctx = useContext(MfgUiContext)
  if (!ctx) throw new Error("useMfgUi must be used inside <MfgUiProvider>")
  return ctx
}

const PERSONA_KEY = "mdmak_mfg_persona"

function useNow(): { today: string; nowMs: number } {
  const [nowMs, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [])
  return { nowMs, today: new Date(nowMs).toISOString().slice(0, 10) }
}

export function MfgUiProvider({ portal, children }: { portal: CrmPortal; children: ReactNode }) {
  const data = useMfgData()
  const { today, nowMs } = useNow()

  const perms: MfgPermissions = useMemo(
    () => ({ canManage: data.canManage, canWork: data.canWork, canQc: data.canQc, canCost: data.canCost, canView: data.canView, seesMoney: data.seesMoney }),
    [data.canManage, data.canWork, data.canQc, data.canCost, data.canView, data.seesMoney]
  )

  const world = useMemo(
    () =>
      buildWorld({
        today,
        nowMs,
        settings: data.settings,
        departments: data.departments,
        products: data.productById,
        orders: data.v2Orders,
        notesByOrder: data.notesByOrder,
        salesOrders: data.salesOrders,
        stops: data.stops,
        notices: data.notices,
        stock: data.stock,
      }),
    [today, nowMs, data.settings, data.departments, data.productById, data.v2Orders, data.notesByOrder, data.salesOrders, data.stops, data.notices, data.stock]
  )

  const personas = useMemo(() => personasOf(data.engineActor, data.departments), [data.engineActor, data.departments])
  const [chosen, setChosen] = useState<Persona | null>(null)
  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("as") as Persona | null
      const saved = (fromUrl || window.localStorage.getItem(PERSONA_KEY)) as Persona | null
      if (saved) setChosen(saved)
    } catch {
      /* storage blocked */
    }
  }, [])
  const persona: Persona | null = chosen && personas.includes(chosen) ? chosen : personas[0] ?? null
  const setPersona = useCallback((p: Persona) => {
    setChosen(p)
    try {
      window.localStorage.setItem(PERSONA_KEY, p)
    } catch {
      /* storage blocked */
    }
  }, [])

  const stations = useMemo(() => (persona ? myStations(data.engineActor, data.departments, persona) : []), [persona, data.engineActor, data.departments])

  const decisions = useMemo(
    () =>
      persona
        ? buildDecisions({ world, requests: data.requests, estimates: data.estimates, departments: data.departments, settings: data.settings, actor: data.engineActor, persona, today, nowMs })
        : [],
    [persona, world, data.requests, data.estimates, data.departments, data.settings, data.engineActor, today, nowMs]
  )

  const owns = useCallback((c: Candidate) => ownsCandidate(c, data.engineActor, data.departments, data.settings), [data.engineActor, data.departments, data.settings])
  const nextStepOf = useCallback((v: OrderView) => nextStep(v.candidates, data.engineActor, data.departments, data.settings), [data.engineActor, data.departments, data.settings])
  const waitingOf = useCallback((v: OrderView) => waitingOn(v.candidates, data.engineActor, data.departments, data.settings), [data.engineActor, data.departments, data.settings])

  const [drawerOrderId, setDrawerOrderId] = useState<string | null>(null)
  const [action, setAction] = useState<{ orderId: string; action: OrderAction } | null>(null)
  const [global, setGlobal] = useState<GlobalAction | null>(null)

  const openOrder = useCallback((orderId: string) => setDrawerOrderId(orderId), [])
  const openAction = useCallback((orderId: string, a: OrderAction) => setAction({ orderId, action: a }), [])
  const openCandidate = useCallback(
    (orderId: string, c: Candidate) => {
      const a = candidateAction(c)
      if (a) setAction({ orderId, action: a })
      else setDrawerOrderId(orderId)
    },
    []
  )
  const openGlobal = useCallback((a: GlobalAction) => setGlobal(a), [])

  useEffect(() => {
    try {
      const open = new URLSearchParams(window.location.search).get("order")
      if (open) setDrawerOrderId(open)
    } catch {
      /* not in a browser */
    }
  }, [])

  const value: MfgUi = {
    portal,
    base: `/${portal}/manufacturing`,
    data,
    perms,
    today,
    nowMs,
    world,
    views: world.views,
    viewById: world.viewById,
    personas,
    persona,
    setPersona,
    stations,
    decisions,
    seesMoney: persona === "manager" || persona === "cost" || persona === "management",
    nextStepOf,
    waitingOf,
    owns,
    openOrder,
    openAction,
    openCandidate,
    openGlobal,
  }

  return (
    <MfgUiContext.Provider value={value}>
      {children}
      <MfgOrderDrawer orderId={drawerOrderId} onClose={() => setDrawerOrderId(null)} />
      {action && <MfgActionForms orderId={action.orderId} action={action.action} onClose={() => setAction(null)} />}
      {global && <MfgGlobalForms action={global} onClose={() => setGlobal(null)} onOpenOrder={(id) => { setGlobal(null); setDrawerOrderId(id) }} />}
    </MfgUiContext.Provider>
  )
}
