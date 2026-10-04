"use client"

// Supply › Requests & needs on a PM 1.0 project (prototype supReq · needSide ·
// openReq). The engineer asks for a material on a BOQ item and says when it is
// needed; the project manager approves it technically; Procurement (who asks the
// store first) and the workshop execute; the site receives it here and it lives
// in the project store until closed. Completed and stopped requests fold away.
// The requests are the `purchaseRequests` Procurement's needs desk reads.

import { ShowMoreRow } from "@/components/module-ui/ShowMoreRow"
import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, ArrowLeftRight, Box, Check, ClipboardList, Clock, Factory, Link2, Plus, ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Callout } from "@/components/module-ui/Callout"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { collection } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useSupplyWorld, type SupplyWorld } from "@/hooks/useSupplyWorld"
import { pmCan } from "@/lib/pm/access"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { storeBalance, storeIdOf, storeState } from "@/lib/pm/store"
import { pmApprovalLimit } from "@/lib/pm/subcontract"
import { PM_VARIATIONS, voNo, type PmVariation } from "@/lib/pm/variation"
import {
  changeOptions,
  approvalChecks,
  approveBlocks,
  requestSample,
  daysBetween,
  invWhyText,
  lineDays,
  lineGot,
  lineInTransit,
  lineLink,
  lineNeed,
  lineOut,
  linePhase,
  lineRejected,
  lineSplit,
  needsWithin,
  openChanges,
  receivable,
  reqLive,
  reqNo,
  reqPct,
  reqState,
  type LinePhase,
  type OrderFact,
  type PmMaterialRequest,
  type ReqLine,
  type ReqState,
} from "@/lib/pm/supply"
import { approveMaterialRequest, decideChange, withdrawMaterialRequest, type SupplyActor } from "@/lib/pm/supply-writes"
import { lastPaid } from "@/lib/procurement/prices"
import { cn } from "@/lib/utils"
import { CheckLine } from "./ContractBits"
import { PlantRequestsPanel } from "./PlantRequestsPanel"
import { ChangeOnClientDialog, NewRequestDialog, qty, ReceiveDialog, RejectRequestDialog, StopLineDialog, useLocaleDir, useProjectOrderFacts, useSupplyRun, type SupplyItem } from "./SupplyDialogs"

const STATE_TONE: Record<ReqState, PillTone> = { wait: "warn", rej: "bad", go: "info", done: "ok", shut: "module", cx: "mute" }
const CAP = 7

type LineDialog = { kind: "rcv" | "stop" | "own"; request: PmMaterialRequest; index: number }

export function SupplyRequestsPanel({
  projectId,
  orgId,
  items,
  startOn,
  withStore,
  withPlant,
  access,
  actor,
  onOpenStore,
}: {
  projectId: string
  orgId: string
  items: SupplyItem[]
  startOn: string | null
  withStore: boolean
  withPlant: boolean
  access: PmAccess
  actor: SupplyActor
  onOpenStore?: (storeId: string) => void
}) {
  const t = useTranslations("Portal.PM")
  const world = useSupplyWorld(projectId, orgId)
  const orderOf = useProjectOrderFacts(projectId, orgId)
  const today = todayDay()
  const [all, setAll] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [composer, setComposer] = useState<null | { seed: { itemId: string; key: string; name: string; unit: string; q: number } | null }>(null)
  const [lineDialog, setLineDialog] = useState<LineDialog | null>(null)
  const [rejecting, setRejecting] = useState<PmMaterialRequest | null>(null)
  const canReq = !access.ctx.archived && access.allowed("supply.request")

  const live = useMemo(() => world.requests.filter(reqLive).sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || (a.needBy || "9999").localeCompare(b.needBy || "9999")), [world.requests])
  const shut = useMemo(() => world.requests.filter((r) => !reqLive(r)), [world.requests])
  const needs = useMemo(() => needsWithin({ stores: world.stores, items, requests: world.requests, activities: world.activities, startOn, today }), [world, items, startOn, today])
  const open = world.requests.find((r) => r.id === openId) ?? null

  const newBtn = canReq ? (
    <Button size="sm" onClick={() => setComposer({ seed: null })}>
      <Plus size={15} className="me-1.5" aria-hidden="true" />
      {t("sup.new")}
    </Button>
  ) : null

  const requestsPanel = (
    <div className="space-y-3">
      <Panel title={t("sup.title")} icon={ShoppingCart} count={live.length} actions={newBtn} bodyClassName="p-0">
        <p className="px-4 pt-3 text-xs text-muted-foreground">{t("sup.sub")}</p>
        {!canReq && !access.ctx.archived && <p className="px-4 pt-2 text-xs text-amber-700 dark:text-amber-400">{t("sup.no_seat")}</p>}
        {world.requests.length === 0 ? (
          <EmptyState icon={ClipboardList} title={t("sup.empty")} className="py-8" />
        ) : live.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("sup.none_open")}</p>
        ) : (
          <div className="divide-y">
            {live.slice(0, all ? undefined : CAP).map((r) => (
              <RequestRow key={r.id} r={r} world={world} items={items} access={access} actor={actor} projectId={projectId} onOpen={() => setOpenId(r.id)} onReject={() => setRejecting(r)} />
            ))}
          </div>
        )}
        {live.length > CAP && !all && (
          <ShowMoreRow onClick={() => setAll(true)}>
            {t("sup.show_more", { count: live.length - CAP })}
          </ShowMoreRow>
        )}
        {live.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t px-4 py-2 text-[11px] text-muted-foreground">
            <Seg icon={ArrowLeftRight}>{t("sup.lgd.store")}</Seg>
            <Seg icon={ShoppingCart}>{t("sup.lgd.buy")}</Seg>
            <Seg icon={Link2}>{t("sup.lgd.proc")}</Seg>
            <Seg tone="prp">{t("sup.lgd.expected")}</Seg>
            <Seg tone="w">{t("sup.lgd.way")}</Seg>
          </div>
        )}
      </Panel>
      {shut.length > 0 && (
        <details className="overflow-hidden rounded-xl border bg-card">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Check size={16} className="text-module" aria-hidden="true" />
            {t("sup.closed_title")}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{shut.length}</span>
            <span className="text-xs font-normal text-muted-foreground">{t("sup.closed_sub")}</span>
          </summary>
          <div className="divide-y border-t">
            {shut.map((r) => (
              <RequestRow key={r.id} r={r} world={world} items={items} access={access} actor={actor} projectId={projectId} onOpen={() => setOpenId(r.id)} onReject={() => setRejecting(r)} />
            ))}
          </div>
        </details>
      )}
      {withPlant && <PlantRequestsPanel projectId={projectId} orgId={orgId} access={access} actor={actor} />}
    </div>
  )

  return (
    <>
      {withStore ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          {requestsPanel}
          <Panel title={t("sup.need.title")} icon={Box} count={needs.gaps.length} bodyClassName="p-0">
            <p className="px-4 pt-3 text-xs text-muted-foreground">{t("sup.need.sub")}</p>
            {needs.gaps.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("sup.need.none")}</p>
            ) : (
              <div className="divide-y">
                {needs.gaps.map((n) => {
                  const it = items.find((i) => i.id === n.itemId)
                  return (
                    <div key={`${n.key}|${n.itemId}`} className="flex items-start gap-2 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold" dir="auto">
                          {n.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground" dir="auto">
                          <span dir="ltr">{n.code}</span>
                          {it ? ` — ${it.description}` : ""}
                        </p>
                        <p className="text-xs font-bold text-destructive">{t("sup.need.short", { q: qty(n.gap), unit: n.unit })}</p>
                      </div>
                      {canReq && (
                        <Button size="sm" variant="outline" onClick={() => setComposer({ seed: { itemId: n.itemId, key: n.key, name: n.name, unit: n.unit, q: n.gap } })}>
                          <Plus size={13} className="me-1" aria-hidden="true" />
                          {t("sup.need.ask")}
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {needs.covered > 0 && <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t("sup.need.covered", { count: needs.covered })}</p>}
          </Panel>
        </div>
      ) : (
        requestsPanel
      )}

      <RequestDrawer
        request={open}
        projectId={projectId}
        world={world}
        items={items}
        orderOf={orderOf}
        startOn={startOn}
        access={access}
        actor={actor}
        onClose={() => setOpenId(null)}
        onLine={(d) => {
          setOpenId(null)
          setLineDialog(d)
        }}
        onReject={(r) => {
          setOpenId(null)
          setRejecting(r)
        }}
        onOpenStore={onOpenStore}
      />
      {composer && <NewRequestDialog projectId={projectId} orgId={orgId} access={access} actor={actor} items={items} world={world} startOn={startOn} seed={composer.seed} onClose={() => setComposer(null)} />}
      {lineDialog?.kind === "rcv" && <ReceiveDialog projectId={projectId} orgId={orgId} withStore={withStore} access={access} actor={actor} request={lineDialog.request} index={lineDialog.index} onClose={() => setLineDialog(null)} />}
      {lineDialog?.kind === "stop" && <StopLineDialog projectId={projectId} access={access} actor={actor} request={lineDialog.request} index={lineDialog.index} onClose={() => setLineDialog(null)} />}
      {lineDialog?.kind === "own" && <ChangeOnClientDialog projectId={projectId} access={access} actor={actor} request={lineDialog.request} index={lineDialog.index} onClose={() => setLineDialog(null)} />}
      {rejecting && <RejectRequestDialog projectId={projectId} access={access} actor={actor} request={rejecting} onClose={() => setRejecting(null)} />}
    </>
  )
}

function Seg({ tone, icon: Icon, children, title }: { tone?: "ok" | "w" | "cx" | "prp"; icon?: typeof Link2; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]",
        tone === "ok" && "border-success/30 bg-success/10 text-success",
        tone === "w" && "border-warning/30 bg-warning/10 text-warning",
        tone === "cx" && "border-border bg-muted text-muted-foreground line-through",
        tone === "prp" && "border-dashed border-violet/40 bg-violet/5 text-violet",
        !tone && "border-border bg-background text-foreground"
      )}
    >
      {Icon && <Icon size={11} aria-hidden="true" />}
      {children}
    </span>
  )
}

const needText = (t: ReturnType<typeof useTranslations>, needBy: string | null | undefined, today: string) => {
  if (!needBy) return null
  const d = daysBetween(today, needBy)
  return d > 0 ? t("sup.need_in", { count: d }) : t("sup.overdue", { count: -d })
}

function PhaseSegs({ r, l }: { r: PmMaterialRequest; l: ReqLine }) {
  const t = useTranslations("Portal.PM")
  const p = linePhase(r, l)
  const got = lineGot(l)
  if (p === "held") return <Seg tone="w">{t("sup.chg.pill")}</Seg>
  if (p === "refused") return <Seg tone="cx">{t("sup.chg.rejected")}</Seg>
  if (p === "prop") return <Seg tone="prp">{qty(l.qty)}</Seg>
  if (p === "cx" && got > 0)
    return (
      <>
        <Seg tone="ok">
          {qty(got)} · {t("sup.ph_s.done")}
        </Seg>
        <Seg tone="cx">
          {qty(Math.max(0, l.qty - got))} · {t("sup.ph_s.cx")}
        </Seg>
      </>
    )
  if (p === "part")
    return (
      <Seg tone="w" icon={phaseIcon(r, l, p)}>
        {qty(l.qty)} · {t("sup.ph_s.part", { q: qty(got) })}
      </Seg>
    )
  return (
    <Seg tone={p === "done" ? "ok" : p === "cx" ? "cx" : undefined} icon={phaseIcon(r, l, p)} title={t(`sup.ph.${p}`)}>
      {qty(l.qty)} · {t(`sup.ph_s.${p}`)}
    </Seg>
  )
}

/** The line's portions once Inventory replied: from a main store, and bought. */
function SplitSegs({ r, l }: { r: PmMaterialRequest; l: ReqLine }) {
  const t = useTranslations("Portal.PM")
  const split = lineSplit(l)
  const p = linePhase(r, l)
  if (!split || p === "prop" || p === "held" || p === "refused" || p === "cx") return null
  return (
    <>
      {split.store > 0 && (
        <Seg tone={lineInTransit(l) > 0 ? "w" : undefined} icon={ArrowLeftRight} title={l.inv?.warehouseName ?? undefined}>
          {qty(split.store)} · {t("sup.lgd.store")}
        </Seg>
      )}
      {split.buy > 0 && (
        <Seg icon={ShoppingCart}>
          {qty(split.buy)} · {t("sup.lgd.buy")}
        </Seg>
      )}
    </>
  )
}

const phaseIcon = (r: PmMaterialRequest, l: ReqLine, p: LinePhase) => (p === "mfg" ? Factory : p === "ask" ? Link2 : lineLink(r, l).poId ? ShoppingCart : ArrowLeftRight)

function ChangeTag({ l }: { l: ReqLine }) {
  const t = useTranslations("Portal.PM")
  if (!l.chg || l.chg.st === "wait" || l.chg.st === "no") return null
  return <Seg>{l.chg.st === "own" ? t("sup.chg.on_client") : t("sup.chg.on_us")}</Seg>
}

function CloseTag({ l }: { l: ReqLine }) {
  const t = useTranslations("Portal.PM")
  if (!l.cl || l.cl.t === "full") return null
  return <StatusPill tone={l.cl.t === "cancel" ? "mute" : "module"}>{l.cl.t === "cancel" ? t("sup.cl.cancel_s") : t("sup.cl.short_s")}</StatusPill>
}

function RequestRow({ r, world, items, access, actor, projectId, onOpen, onReject }: { r: PmMaterialRequest; world: SupplyWorld; items: SupplyItem[]; access: PmAccess; actor: SupplyActor; projectId: string; onOpen: () => void; onReject: () => void }) {
  const t = useTranslations("Portal.PM")
  const { locale } = useLocaleDir()
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const today = todayDay()
  const st = reqState(r)
  const ch = openChanges(r).length
  const canDecide = !access.ctx.archived && access.allowed("request.decide") && r.status === "pending"
  // The same blocks the drawer shows: a blocked request opens the drawer, where
  // the reason is listed, instead of failing at the write with a bare toast.
  const blocked = canDecide && approveBlocks({ archived: access.ctx.archived, request: r, sample: requestSample(r, items) }).length > 0
  const over = r.status === "pending" ? r.lines.filter((l) => l.itemId && !l.chg && (() => {
    const n = lineNeed({ key: l.key, stores: world.stores, items, requests: world.requests, except: r.id })
    return n !== null && l.qty > n * 1.05
  })()).length : 0
  const pct = reqPct(r)
  const nt = reqLive(r) ? needText(t, r.needBy, today) : null
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 rounded text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex flex-wrap items-center gap-1.5">
          <b className="text-sm" dir="auto">
            {r.title || t("sup.untitled")}
          </b>
          <StatusPill tone={STATE_TONE[st]}>{t(`sup.st.${st}`)}</StatusPill>
          {ch > 0 && <StatusPill tone="warn">{t("sup.chg.count", { count: ch })}</StatusPill>}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {r.seq ? t("sup.no", { no: reqNo(r.seq) }) : t("sup.legacy")} · {r.requestedByUserName || "—"} · {pmDate(r.day, locale)}
          {nt && ` · ${nt}`}
        </p>
        <div className="mt-1.5 space-y-1">
          {r.lines.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-bold text-muted-foreground" dir="ltr">
                {l.code || t("sup.general_s")}
              </span>
              <span dir="auto">{l.name}</span>
              <span className="text-muted-foreground" dir="ltr">
                {qty(l.qty)} {l.unit}
              </span>
              <ChangeTag l={l} />
              <PhaseSegs r={r} l={l} />
              <SplitSegs r={r} l={l} />
              <CloseTag l={l} />
            </div>
          ))}
        </div>
        {over > 0 && (
          <p className="mt-1 flex items-center gap-1 text-xs font-bold text-warning">
            <AlertTriangle size={11} aria-hidden="true" />
            {t("sup.over_row")}
          </p>
        )}
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {st === "go" && (
          <div className="w-24 space-y-0.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-success" style={{ width: `${Math.round(pct * 100)}%` }} />
            </div>
            <p className="text-[11px] text-muted-foreground">{t("sup.received_pct", { pct: Math.round(pct * 100) })}</p>
          </div>
        )}
        {canDecide &&
          (r.lines.some((l) => l.chg?.st !== "wait") ? (
            <div className="flex gap-1">
              <Button variant="success" size="sm" className="h-7" disabled={busy !== null} onClick={() => (blocked ? onOpen() : firestore && void run("ok", () => approveMaterialRequest(firestore, access.ctx, projectId, actor, r.id), t("sup.approved", { no: reqNo(r.seq ?? 0) })))}>
                <Check size={13} className="me-1" aria-hidden="true" />
                {ch ? t("sup.approve_rest") : t("sup.approve")}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-destructive" onClick={onReject}>
                {t("sup.reject")}
              </Button>
            </div>
          ) : (
            <span className="text-xs font-bold text-warning">{t("sup.decide_change_first")}</span>
          ))}
      </div>
    </div>
  )
}

function RequestDrawer({
  request: r,
  projectId,
  world,
  items,
  orderOf,
  startOn,
  access,
  actor,
  onClose,
  onLine,
  onReject,
  onOpenStore,
}: {
  request: PmMaterialRequest | null
  projectId: string
  world: SupplyWorld
  items: SupplyItem[]
  /** The order behind a line, as far as the project sees it (is it coming yet?). */
  orderOf: (poId: string | null | undefined) => OrderFact
  startOn: string | null
  access: PmAccess
  actor: SupplyActor
  onClose: () => void
  onLine: (d: LineDialog) => void
  onReject: (r: PmMaterialRequest) => void
  onOpenStore?: (storeId: string) => void
}) {
  const t = useTranslations("Portal.PM")
  const { locale, dir, side } = useLocaleDir()
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const today = todayDay()
  const hasOwn = Boolean(r?.lines.some((l) => l.chg?.voSeq))
  const voQ = useMemoFirebase(() => (firestore && hasOwn ? collection(firestore, "projects", projectId, PM_VARIATIONS) : null), [firestore, projectId, hasOwn])
  const { data: voData } = useCollection(voQ)
  const vos = (voData ?? []) as unknown as PmVariation[]
  if (!r) return <Sheet open={false} />
  const st = reqState(r)
  const prop = r.status === "pending"
  const approver = !access.ctx.archived && access.allowed("request.decide")
  const canClose = !access.ctx.archived && (pmCan(access.ctx, "approve") || r.requestedByUserId === actor.uid) && access.allowed("supply.stopUnarrived")
  const canRcv = !access.ctx.archived && access.allowed("supply.receive")
  const itemIds = [...new Set(r.lines.map((l) => l.itemId))]
  const checks = prop ? approvalChecks({ request: r, requests: world.requests, stores: world.stores, items, startOn, today }) : null
  const blocks = checks ? approveBlocks({ archived: access.ctx.archived, request: r, sample: checks.sample }) : []
  const pct = reqPct(r)
  const allIn = r.lines.every((l) => l.cl || lineOut(l) <= 0)
  const nt = reqLive(r) ? needText(t, r.needBy, today) : null
  const sampleNote = checks
    ? checks.sample === null
      ? t("sup.chk.sample_free")
      : t(`sup.chk.sample_${checks.sample}`)
    : ""

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={side} className="w-full overflow-y-auto sm:max-w-xl" dir={dir}>
        <SheetHeader className="text-start">
          <SheetTitle dir="auto">{r.title || t("sup.untitled")}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            {r.seq ? <StatusPill tone="module">{t("sup.no", { no: reqNo(r.seq) })}</StatusPill> : null}
            <StatusPill tone={STATE_TONE[st]}>{t(`sup.st.${st}`)}</StatusPill>
            <span>
              {r.requestedByUserName || "—"} · {pmDate(r.day, locale)}
            </span>
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label={t("sup.d.need")} value={r.needBy ? pmDate(r.needBy, locale) : t("sup.d.no_date")} sub={nt ?? "—"} />
            <Stat label={t("sup.d.materials")} value={String(r.lines.length)} sub={itemIds.length === 1 && itemIds[0] ? t("sup.d.on_item", { code: r.lines[0].code || "" }) : itemIds.length === 1 ? t("sup.general") : t("sup.d.on_items", { count: itemIds.length })} />
            <Stat label={t("sup.d.by")} value={r.mfgRequestId ? t("sup.d.by_mfg") : t("sup.d.by_proc")} sub={prop ? t("sup.d.by_prop") : t("sup.d.by_live")} />
          </div>
          {r.status === "rejected" && !r.withdrawn && <Callout tone="block" title={t("sup.st.rej")}>{(r as { rejectReason?: string | null }).rejectReason || t("sup.rej_no_reason")}</Callout>}
          <DrawerSection title={t("sup.d.lines")} count={r.lines.length}>
            <div className="space-y-2 py-1">
              {r.lines.map((l, i) => (
                <DrawerLine
                  key={i}
                  r={r}
                  l={l}
                  index={i}
                  world={world}
                  items={items}
                  order={orderOf(lineLink(r, l).poId)}
                  startOn={startOn}
                  approver={approver}
                  money={access.has("money")}
                  voStatus={l.chg?.voSeq ? vos.find((v) => v.id === voNo(l.chg?.voSeq ?? 0))?.status ?? null : null}
                  limit={pmApprovalLimit(access.ctx.ceiling)}
                  canClose={canClose}
                  canRcv={canRcv}
                  busy={busy}
                  onUs={() => firestore && void run(`us${i}`, () => decideChange(firestore, access.ctx, projectId, actor, r.id, i, { st: "us" }), t("sup.chg.us_done", { name: l.name, code: l.code || "—" }))}
                  onNo={() => firestore && void run(`no${i}`, () => decideChange(firestore, access.ctx, projectId, actor, r.id, i, { st: "no" }), t("sup.chg.no_done", { name: l.name }))}
                  onLine={onLine}
                  onOpenStore={onOpenStore}
                />
              ))}
            </div>
          </DrawerSection>
          {prop && checks && (
            <DrawerSection title={t("sup.chk.title")}>
              {!approver && <CheckLine ok={false} title={t("sup.chk.not_yours")} note={t("sup.chk.not_yours_note")} />}
              <CheckLine ok={checks.sample !== "rej" && checks.sample !== "none"} title={t("sup.chk.sample")} note={sampleNote} />
              <CheckLine ok={checks.held === 0} title={t("sup.chk.changes")} note={checks.held ? t("sup.chk.changes_held", { count: checks.held }) : t("sup.chk.changes_none")} />
              <CheckLine ok={checks.over.length === 0} title={t("sup.chk.qty")} note={checks.over.length ? t("sup.chk.qty_over", { count: checks.over.length }) : t("sup.chk.qty_ok")} />
              <CheckLine ok={checks.long.length === 0} title={t("sup.chk.period")} note={checks.long.length ? t("sup.chk.period_long", { name: checks.long[0].line.name, days: checks.long[0].days }) : t("sup.chk.period_ok")} />
              <CheckLine ok={checks.dup === 0} title={t("sup.chk.dup")} note={checks.dup ? t("sup.chk.dup_yes", { count: checks.dup }) : t("sup.chk.dup_no")} />
              <CheckLine ok={checks.daysToNeed === null || checks.daysToNeed > 3} title={t("sup.chk.lead")} note={needText(t, r.needBy, today) ?? t("sup.chk.lead_none")} />
              <div className="flex flex-wrap gap-2 pt-2">
                {approver && (
                  <>
                    <Button variant="success" size="sm"  disabled={blocks.length > 0 || busy !== null} onClick={() => firestore && void run("ok", () => approveMaterialRequest(firestore, access.ctx, projectId, actor, r.id), t("sup.approved", { no: reqNo(r.seq ?? 0) })).then((ok) => ok && onClose())}>
                      <Check size={14} className="me-1.5" aria-hidden="true" />
                      {checks.held ? t("sup.approve_hold") : t("sup.approve_send")}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => onReject(r)}>
                      {t("sup.reject")}
                    </Button>
                  </>
                )}
                {r.requestedByUserId === actor.uid && !access.ctx.archived && (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => firestore && void run("wd", () => withdrawMaterialRequest(firestore, access.ctx, projectId, actor, r.id), t("sup.withdrawn", { no: reqNo(r.seq ?? 0) })).then((ok) => ok && onClose())}>
                    {t("sup.withdraw")}
                  </Button>
                )}
              </div>
              {blocks.filter((b) => b !== "not_pending").map((b) => (
                <p key={b} className="text-xs font-bold text-destructive">
                  {t(`sup.block.${b}`)}
                </p>
              ))}
            </DrawerSection>
          )}
          {r.status !== "rejected" || r.withdrawn ? (
            <DrawerSection title={t("sup.trail.title")}>
              <ol className="space-y-2 py-1">
                <TrailStep done title={t("sup.trail.requested")} note={`${r.requestedByUserName || "—"} · ${pmDate(r.day, locale)}`} module="project-management" who={t("own.pm")} />
                <TrailStep
                  done={!prop && !r.withdrawn}
                  title={t("sup.trail.approved")}
                  note={prop ? t("sup.trail.await_pm") : r.withdrawn ? t("sup.trail.withdrawn") : pmDate(r.approvedOn, locale)}
                  module="project-management"
                  who={t("own.pm")}
                />
                <TrailStep done={!prop && (Boolean(r.poId) || allIn)} title={t("sup.trail.buy")} note={prop ? t("sup.trail.buy_prop") : r.poNumber ? t("sup.trail.po", { no: r.poNumber }) : r.rfqNumber ? t("sup.trail.rfq", { no: r.rfqNumber }) : t("sup.trail.in_progress")} module="procurement" who={t("own.proc")} />
                <TrailStep done={!prop && st !== "cx" && allIn} title={t("sup.trail.received")} note={prop ? "—" : allIn ? t("sup.trail.complete") : t("sup.received_pct", { pct: Math.round(pct * 100) })} module="project-management" who={t("own.pm")} />
                <TrailStep done={false} title={t("sup.trail.store")} note={t("sup.trail.store_note")} module="project-management" who={t("own.pm")} />
              </ol>
            </DrawerSection>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-black">{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  )
}

function TrailStep({ done, title, note, module, who }: { done: boolean; title: string; note: string; module: "project-management" | "procurement" | "warehouses"; who: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", done ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{done ? <Check size={12} aria-hidden="true" /> : <Clock size={12} aria-hidden="true" />}</span>
      <div className="min-w-0">
        <p className="text-sm font-bold">{title}</p>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {note} <SourceBadge module={module} label={who} />
        </p>
      </div>
    </li>
  )
}

function DrawerLine({
  r,
  l,
  index,
  world,
  items,
  order,
  startOn,
  approver,
  money,
  voStatus,
  limit,
  canClose,
  canRcv,
  busy,
  onUs,
  onNo,
  onLine,
  onOpenStore,
}: {
  r: PmMaterialRequest
  l: ReqLine
  index: number
  world: SupplyWorld
  items: SupplyItem[]
  order: OrderFact
  startOn: string | null
  approver: boolean
  money: boolean
  /** The status of the variation a change "on the client" is linked to. */
  voStatus: string | null
  /** The decider's riyal limit — «على حسابنا» above it is the owner's. */
  limit: number
  canClose: boolean
  canRcv: boolean
  busy: string | null
  onUs: () => void
  onNo: () => void
  onLine: (d: LineDialog) => void
  onOpenStore?: (storeId: string) => void
}) {
  const t = useTranslations("Portal.PM")
  // Inventory's reason is stored as a code: it is read here in the reader's
  // language, from the messages Inventory's own desk writes it with.
  const ti = useTranslations("Portal.InvPm")
  const { locale } = useLocaleDir()
  const today = todayDay()
  const invWhy = invWhyText(l.inv, (code) => (ti.has(`rep.why.${code}`) ? ti(`rep.why.${code}`) : null)) ?? "—"
  const by = lineLink(r, l)
  const item = l.itemId ? items.find((i) => i.id === l.itemId) : undefined
  const prop = r.status === "pending"
  const store = world.stores.find((s) => s.key === l.key)
  const rate = store && l.itemId ? store.rates[l.itemId] : undefined
  const phase = linePhase(r, l)
  const got = lineGot(l)
  const out = lineOut(l)
  const need = prop && l.itemId ? lineNeed({ key: l.key, stores: world.stores, items, requests: world.requests, except: r.id }) : null
  const days = prop && l.itemId ? lineDays({ stores: world.stores, items, itemId: l.itemId, key: l.key, qty: l.qty, startOn, today }) : null
  const over = need !== null && l.qty > need * 1.05 ? l.qty - need : 0
  const heldLive = l.chg?.st === "wait" && !prop
  const since = r.approvedOn ? Math.max(0, daysBetween(r.approvedOn, today)) : 0
  const last = world.history.length ? lastPaid(world.history, l.name, l.unit) : null
  const est = l.chg ? last : null
  const canChg = approver && (r.status === "pending" || reqState(r) === "go")
  const opts = changeOptions({ line: l, voStatus, estimate: est ? est.price * l.qty : null, limit })

  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" dir="auto">
            {l.name}
          </p>
          <p className="text-xs text-muted-foreground" dir="auto">
            {item ? (
              <>
                <span className="font-bold" dir="ltr">
                  {item.code}
                </span>{" "}
                — {item.description}
              </>
            ) : (
              t("sup.general")
            )}
          </p>
        </div>
        <b className="shrink-0 text-sm tabular-nums" dir="ltr">
          {qty(l.qty)} <span className="text-xs font-normal">{l.unit}</span>
          {money && last && !l.chg && <span className="block text-[11px] font-normal text-muted-foreground">{t("sup.line_cost", { amount: pmMoney(last.price * l.qty) })}</span>}
        </b>
      </div>
      {l.inv && (
        <p className={cn("rounded-md px-2 py-1 text-xs", l.inv.k === "issue" ? "bg-success/10 text-success" : "bg-warning/10 text-warning")} dir="auto">
          <b>{t("sup.inv.title")}</b>{" "}
          {l.inv.k === "issue"
            ? l.inv.warehouseName
              ? t("sup.inv.issue_wh", { q: qty(l.inv.q ?? 0), unit: l.unit, warehouse: l.inv.warehouseName })
              : t("sup.inv.issue", { q: qty(l.inv.q ?? 0), unit: l.unit })
            : t("sup.inv.none", { why: invWhy })}
          {l.inv.k === "issue" && (l.inv.kept ?? 0) > 0 && ` · ${t("sup.inv.kept", { q: qty(l.inv.kept ?? 0), unit: l.unit, why: invWhy })}`}
          {l.inv.note ? ` · ${l.inv.note}` : ""}
          {l.inv.byName ? ` · ${l.inv.byName}` : ""}
        </p>
      )}
      {l.chg ? (
        <div className="space-y-1.5 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
          <p>
            <b className="text-warning">{t("sup.chg.box_title")}</b>
            {l.chg.why && <span dir="auto"> · {l.chg.why}</span>}
          </p>
          {money && <p className="text-muted-foreground">{est ? t("sup.chg.estimate", { amount: pmMoney(est.price * l.qty) }) : t("sup.chg.no_estimate")}</p>}
          {l.chg.st === "wait" ? (
            canChg ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="h-7" disabled={busy !== null || opts.usOverLimit} onClick={onUs}>
                    {t("sup.chg.us")}
                  </Button>
                  <Button size="sm" className="h-7" onClick={() => onLine({ kind: "own", request: r, index })}>
                    {t("sup.chg.own")}
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-destructive" disabled={busy !== null} onClick={onNo}>
                    {t("sup.chg.no")}
                  </Button>
                </div>
                <p className="text-muted-foreground">{t("sup.chg.hint")}</p>
                {opts.usOverLimit && <p className="font-semibold text-warning">{t("sup.chg.over_limit")}</p>}
              </>
            ) : (
              <p className="text-muted-foreground">{t("sup.chg.await")}</p>
            )
          ) : (
            <p>
              <b>{t("sup.chg.decision")}</b> {t(`sup.chg.st.${l.chg.st}`)}
              {l.chg.voSeq ? ` · ${t("vo.no", { no: String(l.chg.voSeq).padStart(2, "0") })}` : ""}
              {l.chg.voSeq && voStatus ? (
                <StatusPill tone={voStatus === "appr" ? "ok" : voStatus === "rej" ? "bad" : voStatus === "wait" ? "warn" : "mute"} className="ms-1">
                  {t(`vo.status.${voStatus}`)}
                </StatusPill>
              ) : null}
              {l.chg.ref ? ` · ${t("sup.chg.instruction", { ref: l.chg.ref })}` : l.chg.st === "own" ? <span className="text-warning"> · {t("sup.chg.no_instruction")}</span> : null}
              {l.chg.byName ? ` · ${l.chg.byName}` : ""}
            </p>
          )}
          {opts.clientRejected && !l.cl && (
            <div className="space-y-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2">
              <p className="font-bold text-destructive">{t("sup.chg.client_rejected", { no: voNo(l.chg.voSeq ?? 0) })}</p>
              {canChg && (
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="h-7" disabled={busy !== null || opts.usOverLimit} onClick={onUs}>
                    {t("sup.chg.us_after")}
                  </Button>
                  {canClose && lineOut(l) > 0 && (
                    <Button size="sm" variant="outline" className="h-7" onClick={() => onLine({ kind: "stop", request: r, index })}>
                      {t("sup.stop.title")}
                    </Button>
                  )}
                </div>
              )}
              {opts.usOverLimit && <p className="font-semibold text-warning">{t("sup.chg.over_limit")}</p>}
            </div>
          )}
        </div>
      ) : item && rate && rate.src === "first" && rate.r == null ? (
        <p className="text-xs text-warning">{t("sup.first_no_rate")}</p>
      ) : item && rate ? (
        <p className="text-xs text-muted-foreground">
          {rate.r != null ? t("sup.rate_txt", { r: qty(rate.r), unit: l.unit, per: item.unit, w: rate.w }) : t("sup.no_rate")}
          {need !== null && ` · ${t("sup.form.still_need", { q: qty(need) })}`}
          {days !== null && ` · ${t("sup.days_work", { days })}`}
        </p>
      ) : !item ? (
        <p className="text-xs text-muted-foreground">{t("sup.gen_expensed")}</p>
      ) : null}
      {prop && over > 0 && <Callout tone="warn">{t("sup.form.over", { q: qty(over) })}</Callout>}
      {heldLive ? (
        <p className="text-xs font-bold text-warning">{t("sup.held_note")}</p>
      ) : l.chg?.st !== "no" ? (
        <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs">
          <span className="min-w-0 flex-1">
            <b className="tabular-nums" dir="ltr">
              {qty(l.qty)}
            </b>{" "}
            {prop ? t("sup.ph.prop") : t(`sup.ph.${phase}`)}
            {by.poNumber && !prop ? ` · ${by.poNumber}` : ""}
            {(l.receipts || []).length > 0 && ` · ${(l.receipts || []).map((x) => `${t("sup.grn", { no: x.grn })} ${qty(x.q)}${x.rej ? ` (${t("sup.rej_s", { q: qty(x.rej) })})` : ""}`).join(" · ")}`}
          </span>
          {prop ? (
            <StatusPill tone="mute">{t("sup.expected")}</StatusPill>
          ) : phase === "done" ? (
            <StatusPill tone="ok">{t("sup.ph_s.done")}</StatusPill>
          ) : phase === "cx" ? (
            <StatusPill tone="mute">{got ? t("sup.cx_rest", { q: qty(Math.max(0, l.qty - got)) }) : t("sup.ph_s.cx")}</StatusPill>
          ) : receivable(r, l, order) && canRcv ? (
            <Button size="sm" className="h-7" onClick={() => onLine({ kind: "rcv", request: r, index })}>
              {t("sup.receive")}
            </Button>
          ) : (
            <SourceBadge module={phase === "mfg" ? "manufacturing" : "procurement"} label={t("sup.with_since", { who: phase === "mfg" ? t("own.mfg") : t("own.proc"), count: since })} />
          )}
        </div>
      ) : null}
      {!prop && r.status !== "rejected" && !heldLive && l.chg?.st !== "no" && (
        l.cl ? (
          <div className="rounded-md border bg-muted/30 p-2 text-xs">
            <p>
              <b>{t(`sup.cl.${l.cl.t}`)}</b> · {pmDate(l.cl.on, locale)} · {l.cl.by === "sys" ? t("sup.cl.auto") : l.cl.byName || "—"}
              {l.cl.why === "chg" ? ` · ${t("sup.chg.rejected")}` : l.cl.why === "rcv" ? ` · ${t("sup.rcv.short")}` : l.cl.why ? ` · ${l.cl.why === "oth" ? l.cl.whyNote || "" : t(`sup.close_why.${l.cl.why}`)}` : ""}
            </p>
            <p className="mt-1 flex flex-wrap gap-3 text-muted-foreground">
              <span>
                {t("sup.stop.requested")} <b className="tabular-nums">{qty(l.qty)}</b>
              </span>
              <span>
                {t("sup.stop.received")} <b className="tabular-nums">{qty(got)}</b>
              </span>
              {l.qty - got > 0.005 && l.cl.t !== "full" && (
                <span>
                  {t("sup.cl.cancelled_q")} <b className="tabular-nums">{qty(l.qty - got)}</b>
                </span>
              )}
              {lineRejected(l) > 0 && (
                <span>
                  {t("sup.cl.rejected_q")} <b className="tabular-nums">{qty(lineRejected(l))}</b>
                </span>
              )}
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{t("sup.got_of", { got: qty(got), q: qty(l.qty), unit: l.unit })}</span>
            {canClose && out > 0 && (
              <Button size="sm" variant="outline" className="h-7" onClick={() => onLine({ kind: "stop", request: r, index })}>
                {got > 0 ? t("sup.stop.title") : t("sup.stop.cancel_title")}
              </Button>
            )}
          </div>
        )
      )}
      {!prop && store && store.moves.length > 0 && (
        <button type="button" className="rounded text-xs font-bold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenStore?.(storeIdOf(l.key))}>
          <Box size={11} className="me-1 inline" aria-hidden="true" />
          {t("sup.in_store", { q: qty(storeBalance(store, items)), unit: store.unit, st: t(`store.st.${storeState(store, items)}`) })}
        </button>
      )}
    </div>
  )
}
