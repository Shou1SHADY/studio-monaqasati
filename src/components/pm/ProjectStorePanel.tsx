"use client"

// Supply › Project store on a PM 1.0 project (prototype storePanel · ledRow ·
// rcvSide · valSide · openLed · formPmv · formRate). A ledger, not a building:
// every material that reached the project until it is used, returned, moved or
// written off. Beside it: what is on its way and waits for the site to confirm
// its receipt, and — for money holders — where the materials went, at cost.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { collection, doc, query, where } from "firebase/firestore"
import { AlertTriangle, ArrowLeftRight, Box, Check, CircleDollarSign, HardHat, Plus, Ruler, Truck, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Callout } from "@/components/module-ui/Callout"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useSupplyWorld, type SupplyWorld } from "@/hooks/useSupplyWorld"
import { pmCan } from "@/lib/pm/access"
import type { PmAttachment } from "@/lib/pm/attachments"
import { PM_SETTINGS } from "@/lib/pm/info-writes"
import { pmDate, pmMoney, pmPct } from "@/lib/pm/format"
import {
  isCustodyMove,
  itemProgress,
  itemUse,
  LOSS_WHY,
  moveBlocks,
  pendingMoves,
  ratedOn,
  RX_FROM,
  storeAllDone,
  storeAllowance,
  storeBalance,
  storeCodes,
  storeGroup,
  storeNeedLeft,
  storeOut,
  storeReceived,
  storeState,
  storeUsed,
  whereWent,
  type LoggedMove,
  type LossWhy,
  type PmStoreLine,
  type RxFrom,
  type StoreFilter,
  type StoreMove,
  type StoreState,
} from "@/lib/pm/store"
import { engineerHold, PM_SUBCONTRACTS, type PmSubcontract } from "@/lib/pm/subcontract"
import { lineOut, linePhase, receivable, reqNo, type PmMaterialRequest } from "@/lib/pm/supply"
import { confirmMoveIn, decideStoreMove, logStoreMove, setMaterialRate, type SupplyActor } from "@/lib/pm/supply-writes"
import { cn } from "@/lib/utils"
import { ChoiceChips, FormHint } from "./ContractBits"
import { AttachmentTag, PmFilesField } from "./PmAttachments"
import { SubStoreMoveDialog } from "./SubCustodyDialogs"
import { qty, ReceiveDialog, StopLineDialog, useLocaleDir, useSupplyRun, type SupplyItem } from "./SupplyDialogs"

const ST_TONE: Record<StoreState, PillTone> = { open: "info", close: "warn", done: "ok", zero: "mute", neg: "bad", pend: "warn" }
const CAP = 7
const PLUS = new Set(["op", "rc", "xi", "rx"])

export function ProjectStorePanel({
  projectId,
  orgId,
  items,
  access,
  actor,
  openStoreId,
  onOpenedStore,
}: {
  projectId: string
  orgId: string
  items: SupplyItem[]
  access: PmAccess
  actor: SupplyActor
  openStoreId?: string | null
  onOpenedStore?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const world = useSupplyWorld(projectId, orgId)
  const [filter, setFilter] = useState<StoreFilter | null>(null)
  const [all, setAll] = useState(false)
  const [allRcv, setAllRcv] = useState(false)
  const [ledId, setLedId] = useState<string | null>(null)
  const [rcv, setRcv] = useState<{ request: PmMaterialRequest; index: number } | null>(null)
  const [stop, setStop] = useState<{ request: PmMaterialRequest; index: number } | null>(null)
  const money = access.has("money")
  const canRcv = !access.ctx.archived && access.allowed("supply.receive")

  const lines = useMemo(() => world.stores.filter((s) => s.moves.length > 0), [world.stores])
  const groups = useMemo(() => {
    const g: Record<StoreFilter, PmStoreLine[]> = { act: [], open: [], done: [] }
    for (const x of lines) g[storeGroup(storeState(x, items))].push(x)
    return g
  }, [lines, items])
  const f = filter ?? (groups.act.length ? "act" : "open")
  const cost = (x: PmStoreLine) => world.costOf(x) ?? 0
  const list = groups[f].slice().sort((a, b) => Math.max(0, storeBalance(b, items)) * cost(b) - Math.max(0, storeBalance(a, items)) * cost(a))
  const shownLed = ledId ?? openStoreId ?? null

  const rows = useMemo(() => {
    const out: Array<{ r: PmMaterialRequest; index: number }> = []
    for (const r of world.requests) if (r.status === "approved") r.lines.forEach((l, index) => receivable(r, l) && out.push({ r, index }))
    return out.sort((a, b) => (a.r.needBy || "9999").localeCompare(b.r.needBy || "9999"))
  }, [world.requests])
  const ww = useMemo(() => whereWent(lines, items, (x) => world.costOf(x)), [lines, items, world])

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title={t("store.title")} icon={Box} count={groups.open.length + groups.act.length} bodyClassName="p-0">
          <p className="px-4 pt-3 text-xs text-muted-foreground">{t("store.sub")}</p>
          {lines.length === 0 ? (
            <EmptyState icon={Box} title={t("store.empty")} description={t("store.empty_desc")} className="py-8" />
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 px-4 pb-1 pt-3">
                {(["act", "open", "done"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={f === k}
                    onClick={() => setFilter(k)}
                    className={cn("rounded-full border px-3 py-1 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", f === k ? "border-module bg-module/10 text-module" : "hover:bg-muted")}
                  >
                    {t(`store.f.${k}`)} <b className="tabular-nums">{groups[k].length}</b>
                  </button>
                ))}
              </div>
              {list.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("store.nothing")}</p>
              ) : (
                <div className="divide-y">
                  {list.slice(0, all ? undefined : CAP).map((x) => (
                    <LedgerRow key={x.id} x={x} items={items} onOpen={() => setLedId(x.id)} />
                  ))}
                </div>
              )}
              {list.length > CAP && !all && (
                <button type="button" className="w-full border-t py-2 text-xs font-bold text-module hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setAll(true)}>
                  {t("sup.show_more", { count: list.length - CAP })}
                </button>
              )}
            </>
          )}
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t("store.foot")}</p>
        </Panel>

        <div className="space-y-4">
          <Panel title={t("store.rcv.title")} icon={Truck} count={rows.length} bodyClassName="p-0">
            <p className="px-4 pt-3 text-xs text-muted-foreground">{t("store.rcv.sub")}</p>
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("store.rcv.none")}</p>
            ) : (
              <div className="divide-y">
                {rows.slice(0, allRcv ? undefined : 5).map(({ r, index }) => {
                  const l = r.lines[index]
                  const ph = linePhase(r, l)
                  return (
                    <div key={`${r.id}:${index}`} className="flex items-center gap-2 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold" dir="auto">
                          {qty(lineOut(l))} {l.unit} {l.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.seq ? t("sup.no", { no: reqNo(r.seq) }) : t("sup.legacy")} · {ph === "mfg" ? t("store.rcv.from_mfg") : `${r.poNumber ? `${r.poNumber} · ` : ""}${t("store.rcv.with_supplier")}`}
                        </p>
                      </div>
                      {canRcv && (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => setRcv({ request: r, index })}>
                          {t("sup.receive")}
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {rows.length > 5 && !allRcv && (
              <button type="button" className="w-full border-t py-2 text-xs font-bold text-module hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setAllRcv(true)}>
                {t("store.rcv.all", { count: rows.length })}
              </button>
            )}
          </Panel>

          {money && (
            <Panel title={t("store.ww.title")} icon={CircleDollarSign}>
              <p className="-mt-1 mb-2 text-xs text-muted-foreground">{t("store.ww.sub")}</p>
              <KeyValueRow label={t("store.ww.received")} value={pmMoney(ww.received)} ltr />
              <KeyValueRow label={t("store.ww.measured")} value={pmMoney(ww.measured)} ltr />
              <KeyValueRow label={t("store.ww.declared")} value={pmMoney(ww.declared)} ltr />
              <KeyValueRow label={t("store.ww.losses")} value={<span className={cn(ww.losses > 0 && "text-destructive")}>{pmMoney(ww.losses)}</span>} ltr />
              <KeyValueRow label={t("store.ww.out")} value={pmMoney(ww.out)} ltr />
              <KeyValueRow label={t("store.ww.now")} value={pmMoney(ww.now)} ltr strong />
              {ww.idle > 0 && <KeyValueRow label={t("store.ww.idle")} value={<span className="text-destructive">{pmMoney(ww.idle)}</span>} ltr />}
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t("store.ww.note")}
                {ww.uncosted > 0 && ` ${t("store.ww.uncosted", { count: ww.uncosted })}`}
              </p>
            </Panel>
          )}
        </div>
      </div>

      <LedgerDrawer
        line={shownLed ? world.stores.find((s) => s.id === shownLed) ?? null : null}
        projectId={projectId}
        orgId={orgId}
        world={world}
        items={items}
        access={access}
        actor={actor}
        onClose={() => {
          setLedId(null)
          onOpenedStore?.()
        }}
        onStop={(d) => {
          setLedId(null)
          onOpenedStore?.()
          setStop(d)
        }}
      />
      {rcv && <ReceiveDialog projectId={projectId} orgId={orgId} access={access} actor={actor} request={rcv.request} index={rcv.index} onClose={() => setRcv(null)} />}
      {stop && <StopLineDialog projectId={projectId} access={access} actor={actor} request={stop.request} index={stop.index} onClose={() => setStop(null)} />}
    </>
  )
}

function LedgerRow({ x, items, onOpen }: { x: PmStoreLine; items: SupplyItem[]; onOpen: () => void }) {
  const t = useTranslations("Portal.PM")
  const st = storeState(x, items)
  const rc = storeReceived(x)
  const use = storeUsed(x, items)
  const out = storeOut(x)
  const bal = storeBalance(x, items)
  const codes = storeCodes(x, items).map((id) => items.find((i) => i.id === id)?.code ?? "")
  const pc = (v: number) => (rc > 0 ? Math.max(0, Math.min(100, (v / rc) * 100)) : 0)
  const extra =
    st === "pend"
      ? t("store.x.pend", { count: pendingMoves(x).length })
      : st === "close"
        ? t("store.x.close")
        : st === "neg"
          ? t("store.x.neg", { q: qty(-bal) })
          : st === "done" && bal > 0
            ? t("store.x.waste", { pct: pmPct(bal / Math.max(use, 1e-9)) })
            : ""
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 px-4 py-3 text-start hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <b className="text-sm" dir="auto">
            {x.name}
          </b>
          <StatusPill tone={ST_TONE[st]}>{t(`store.st.${st}`)}</StatusPill>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {codes.length ? (
            <>
              {t("store.used_by")}{" "}
              <span className="font-bold" dir="ltr">
                {codes.slice(0, 3).join(" · ")}
              </span>
              {codes.length > 3 ? ` +${codes.length - 3}` : ""}
            </>
          ) : (
            t("store.no_item")
          )}
        </p>
        <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
          <span className="h-full bg-success" style={{ width: `${pc(use)}%` }} />
          <span className="h-full bg-warning" style={{ width: `${pc(out)}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("store.in_used", { rc: qty(rc), use: qty(use) })}
          {out > 0 && ` · ${t("store.out_q", { q: qty(out) })}`}
          {extra && (
            <>
              {" · "}
              <b className={cn(st === "done" ? "text-success" : st === "neg" ? "text-destructive" : "text-warning")}>{extra}</b>
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <b className={cn("text-base tabular-nums", bal < 0 && "text-destructive")} dir="ltr">
          {qty(bal)}
        </b>
        <span className="text-xs text-muted-foreground">{t("store.on_site", { unit: x.unit })}</span>
      </div>
    </button>
  )
}

type MoveDialogState = { t: LoggedMove }

function LedgerDrawer({
  line: x,
  projectId,
  orgId,
  world,
  items,
  access,
  actor,
  onClose,
  onStop,
}: {
  line: PmStoreLine | null
  projectId: string
  orgId: string
  world: SupplyWorld
  items: SupplyItem[]
  access: PmAccess
  actor: SupplyActor
  onClose: () => void
  onStop: (d: { request: PmMaterialRequest; index: number }) => void
}) {
  const t = useTranslations("Portal.PM")
  const { locale, dir, side } = useLocaleDir()
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const [move, setMove] = useState<MoveDialogState | null>(null)
  const [rate, setRate] = useState<string | null>(null)
  const [issue, setIssue] = useState(false)
  const scQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_SUBCONTRACTS) : null), [firestore, projectId])
  const setQ = useMemoFirebase(() => (firestore && orgId ? doc(firestore, PM_SETTINGS, orgId) : null), [firestore, orgId])
  const { data: orgSettings } = useDoc<{ selfApproval?: boolean }>(setQ)
  const selfAllowed = orgSettings?.selfApproval === true
  const { data: scData } = useCollection(scQ)
  const contracts = useMemo(() => (scData ?? []) as unknown as PmSubcontract[], [scData])
  if (!x) return <Sheet open={false} />
  const st = storeState(x, items)
  const rc = storeReceived(x)
  const use = storeUsed(x, items)
  const bal = storeBalance(x, items)
  const codes = storeCodes(x, items)
  const pend = pendingMoves(x)
  const allow = storeAllowance(x, items)
  const need = storeNeedLeft(x, items)
  const wl = x.moves.filter((m) => m.t === "loss" && m.st === "ok" && m.why === "waste").reduce((a, m) => a + m.q, 0)
  const can = !access.ctx.archived && access.allowed("store.move")
  const canApprove = !access.ctx.archived && access.allowed("store.approve")
  const canRate = !access.ctx.archived && access.allowed("item.rate.set")
  const cost = world.costOf(x)
  const unrated = items.some((i) => !ratedOn(x, i.id))
  const way = world.requests.flatMap((r) => (r.status === "approved" ? r.lines.map((l, index) => ({ r, l, index })) : [])).filter(({ l }) => l.key === x.key && !l.cl && lineOut(l) > 0)
  const statusBody: Record<StoreState, [("info" | "warn" | "block"), string]> = {
    close: ["warn", t("store.sb.close", { q: qty(bal), unit: x.unit, allow: qty(allow) })],
    neg: ["block", t("store.sb.neg", { q: qty(-bal), unit: x.unit })],
    pend: ["warn", t("store.sb.pend")],
    done: ["info", bal > 0 ? t("store.sb.done_waste", { q: qty(bal), unit: x.unit, pct: pmPct(bal / Math.max(use, 1e-9)) }) : t("store.sb.done")],
    zero: ["info", t("store.sb.zero")],
    open: ["info", t("store.sb.open")],
  }

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent side={side} className="w-full overflow-y-auto sm:max-w-xl" dir={dir}>
          <SheetHeader className="text-start">
            <SheetTitle dir="auto">{x.name}</SheetTitle>
            <SheetDescription className="flex flex-wrap items-center gap-2">
              <StatusPill tone={ST_TONE[st]}>{t(`store.st.${st}`)}</StatusPill>
              <span>{t("store.used_by_n", { count: codes.length })}</span>
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Stat label={t("store.d.received")} value={qty(rc)} sub={x.unit} />
              <Stat label={t("store.d.used")} value={qty(use)} sub={t("store.d.used_sub")} />
              <Stat label={t("store.d.now")} value={qty(bal)} sub={pend.length ? t("store.x.pend", { count: pend.length }) : x.unit} bad={bal < 0} />
            </div>
            <DrawerSection title={t("store.d.per_item")}>
              {codes.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">{t("store.d.no_item")}</p>
              ) : (
                codes.map((id) => {
                  const it = items.find((i) => i.id === id)
                  const r = ratedOn(x, id)
                  const dx = it && r ? Math.max(0, it.executed - r.ex0) : 0
                  return (
                    <div key={id} className="flex items-center gap-2 border-b py-2 last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold" dir="auto">
                          <span dir="ltr">{it?.code}</span> — {it?.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r ? t("store.d.calc", { dx: qty(dx), unit: it?.unit ?? "", r: qty(r.r ?? 0), w: r.w }) : t("store.d.declared")}
                          {itemProgress(it) >= 99.5 && ` · ${t("store.d.item_done")}`}
                        </p>
                      </div>
                      <b className="shrink-0 tabular-nums" dir="ltr">
                        {qty(itemUse(x, it))}
                      </b>
                      {canRate && (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => setRate(id)}>
                          {r ? t("store.rate.correct") : t("store.rate.set")}
                        </Button>
                      )}
                    </div>
                  )
                })
              )}
            </DrawerSection>
            <div className="rounded-lg border p-3">
              <KeyValueRow label={t("store.d.allow")} value={`${qty(allow)} ${x.unit}${wl ? ` · ${t("store.d.logged_loss", { q: qty(wl) })}` : ""}`} />
              {need > 0 && <KeyValueRow label={t("store.d.need")} value={`${qty(need)} ${x.unit}`} />}
              {!storeAllDone(x, items) && need > 0 && bal > need + allow && <KeyValueRow label={<span className="font-bold text-warning">{t("store.d.surplus")}</span>} value={<span className="text-warning">{`${qty(bal - need)} ${x.unit}`}</span>} />}
            </div>
            {way.length > 0 && (
              <DrawerSection title={t("store.d.way")} count={way.length}>
                {way.map(({ r, l, index }) => {
                  const it = items.find((i) => i.id === l.itemId)
                  const done = itemProgress(it) >= 99.5
                  return (
                    <div key={`${r.id}:${index}`} className="flex items-center gap-2 border-b py-2 text-xs last:border-0">
                      <span className="min-w-0 flex-1">
                        <b className="tabular-nums" dir="ltr">
                          {qty(lineOut(l))} {x.unit}
                        </b>{" "}
                        · {r.seq ? t("sup.no", { no: reqNo(r.seq) }) : t("sup.legacy")} · <span dir="ltr">{l.code || ""}</span>
                        {done && (
                          <StatusPill tone="warn" className="ms-1">
                            {t("store.d.item_complete")}
                          </StatusPill>
                        )}
                      </span>
                      {!access.ctx.archived && (pmCan(access.ctx, "approve") || r.requestedByUserId === actor.uid) && (
                        <Button size="sm" variant={done ? "default" : "outline"} className="h-7" onClick={() => onStop({ request: r, index })}>
                          {t("sup.stop.title")}
                        </Button>
                      )}
                    </div>
                  )
                })}
              </DrawerSection>
            )}
            <Callout tone={statusBody[st][0]}>
              {statusBody[st][1]}
              {st === "neg" && can && (
                <span className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setMove({ t: "rx" })}>
                    {t("store.mv.rx")}
                  </Button>
                  {canRate && codes.some((id) => ratedOn(x, id)) && (
                    <Button size="sm" variant="outline" onClick={() => setRate(codes.find((id) => ratedOn(x, id)) ?? null)}>
                      {t("store.rate.correct_the")}
                    </Button>
                  )}
                </span>
              )}
            </Callout>
            <DrawerSection title={t("store.d.moves")} count={x.moves.length}>
              {x.moves
                .map((m, i) => ({ m, i }))
                .sort((a, b) => b.m.on.localeCompare(a.m.on) || b.i - a.i)
                .map(({ m, i }) => (
                  <MoveRow
                    key={i}
                    m={m}
                    locale={locale}
                    canApprove={canApprove}
                    canMove={can}
                    mine={m.by === actor.uid && !selfAllowed}
                    busy={busy}
                    onDecide={(d) => firestore && void run(`d${i}${d}`, () => decideStoreMove(firestore, access.ctx, projectId, actor, x.id, i, d, cost), t(`store.mv_done.${d === "ok" ? (m.t === "loss" ? "loss_ok" : m.t === "use" ? "use_ok" : "rx_ok") : d}`, { code: m.code ?? "" }))}
                    onConfirm={() => firestore && void run(`x${i}`, () => confirmMoveIn(firestore, access.ctx, projectId, actor, x.id, i, cost), t("store.mv_done.xi"))}
                  />
                ))}
            </DrawerSection>
            {can && (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                {contracts.length > 0 && engineerHold(x, items, contracts) > 0.005 && (
                  <Button size="sm" variant="outline" onClick={() => setIssue(true)}>
                    <HardHat size={14} className="me-1.5" aria-hidden="true" />
                    {t("store.mv.iss")}
                  </Button>
                )}
                {bal > 0.005 && unrated && (
                  <Button size="sm" variant="outline" onClick={() => setMove({ t: "use" })}>
                    <Check size={14} className="me-1.5" aria-hidden="true" />
                    {t("store.mv.use")}
                  </Button>
                )}
                {bal > 0.005 && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setMove({ t: "ret" })}>
                      <Undo2 size={14} className="me-1.5" aria-hidden="true" />
                      {t("store.mv.ret")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setMove({ t: "xo" })}>
                      <ArrowLeftRight size={14} className="me-1.5" aria-hidden="true" />
                      {t("store.mv.xo")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setMove({ t: "loss" })}>
                      <AlertTriangle size={14} className="me-1.5" aria-hidden="true" />
                      {t("store.mv.loss")}
                    </Button>
                  </>
                )}
                {st !== "neg" && (
                  <Button size="sm" variant="outline" onClick={() => setMove({ t: "rx" })}>
                    <Plus size={14} className="me-1.5" aria-hidden="true" />
                    {t("store.mv.rx_s")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      {move && <MoveDialog projectId={projectId} orgId={orgId} x={x} items={items} access={access} actor={actor} initial={move.t} onClose={() => setMove(null)} />}
      {rate && <RateDialog projectId={projectId} x={x} item={items.find((i) => i.id === rate)} access={access} onClose={() => setRate(null)} />}
      {issue && <SubStoreMoveDialog projectId={projectId} orgId={orgId} kind="iss" lines={world.stores} items={items} contracts={contracts} storeId={x.id} access={access} actor={actor} onClose={() => setIssue(false)} />}
    </>
  )
}

function Stat({ label, value, sub, bad }: { label: string; value: string; sub: string; bad?: boolean }) {
  return (
    <div className="rounded-xl border p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-black tabular-nums", bad && "text-destructive")} dir="ltr">
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  )
}

function MoveRow({ m, locale, canApprove, canMove, mine, busy, onDecide, onConfirm }: { m: StoreMove; locale: string; canApprove: boolean; canMove: boolean; mine: boolean; busy: string | null; onDecide: (d: "ok" | "rej" | "sup") => void; onConfirm: () => void }) {
  const t = useTranslations("Portal.PM")
  const plus = PLUS.has(m.t)
  const custody = isCustodyMove(m.t)
  const approvable = (m.t === "loss" || m.t === "use" || m.t === "rx") && m.st === "wait"
  const note = m.note ? ` — ${m.note}` : ""
  const det =
    m.t === "rc"
      ? [m.grn ? t("sup.grn", { no: m.grn }) : "", m.source || t("store.mv_det.purchase"), m.reqSeq ? t("sup.no", { no: reqNo(m.reqSeq) }) : "", m.code || "", m.dn ? t("store.mv_det.dn", { no: m.dn }) : t("store.mv_det.no_dn"), m.rej ? t("sup.rej_s", { q: qty(m.rej) }) : ""].filter(Boolean).join(" · ")
      : m.t === "rx"
        ? `${m.from ? t(`store.rx_from.${m.from}`) : ""}${m.otherProjectName ? ` · ${m.otherProjectName}` : ""}${note}`
        : m.t === "use"
          ? t("store.mv_det.on_item", { code: m.code ?? "" })
          : m.t === "ret"
            ? m.warehouseName ?? ""
            : m.t === "xo" || m.t === "xi"
              ? m.otherProjectName ?? ""
              : m.t === "loss" || m.t === "sret"
                ? `${m.why ? t(`store.loss_why.${m.why}`) : ""}${m.sup ? ` · ${t("store.mv_det.on_supplier")}` : ""}${note}`
                : custody
                  ? `${m.subName ?? ""}${m.recovery ? ` · ${t("store.mv_det.recovery")}` : ""}${note}`
                  : ""
  const waitLabel = m.st === "wait" ? (approvable ? t("store.w.approval") : m.t === "xi" ? t("store.w.xi") : m.t === "xo" ? t("store.w.xo") : m.t === "sret" ? t("store.w.sret") : t("store.w.inv")) : null
  return (
    <div className="flex flex-wrap items-center gap-2 border-b py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold">
          {t(`store.mt.${m.t}`)} {waitLabel && <StatusPill tone="warn">{waitLabel}</StatusPill>}
          {m.st === "rej" && <StatusPill tone="mute">{t("store.w.rejected")}</StatusPill>}
        </p>
        <p className="text-xs text-muted-foreground" dir="auto">
          {pmDate(m.on, locale)} · {m.byName || "—"}
          {det && ` · ${det}`}
          {m.apprName && ` · ${t("store.mv_det.appr", { name: m.apprName })}`}
          {m.self && ` · ${t("store.mv_det.self")}`}
          {m.t === "ret" && m.st === "done" && ` · ${t("store.mv_det.inv_ok", { name: m.invByName || "—" })}`}
        </p>
      </div>
      <AttachmentTag files={m.files} />
      <b className={cn("shrink-0 tabular-nums", m.st === "rej" || custody ? "text-muted-foreground" : plus ? "text-success" : "text-foreground")} dir="ltr">
        {custody ? "" : plus ? "+" : "−"}
        {qty(m.q)}
      </b>
      {approvable && canApprove && (mine ? (
        <span className="text-xs text-muted-foreground">{t("store.mine")}</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" className="h-7 bg-success text-success-foreground hover:bg-success/90" disabled={busy !== null} onClick={() => onDecide("ok")}>
            {t("sup.approve")}
          </Button>
          {m.t === "loss" && m.why !== "theft" && (
            <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={() => onDecide("sup")}>
              {t("store.on_supplier")}
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-destructive" disabled={busy !== null} onClick={() => onDecide("rej")}>
            {t("sup.reject")}
          </Button>
        </div>
      ))}
      {m.t === "xi" && m.st === "wait" && canMove && (
        <Button size="sm" className="h-7" disabled={busy !== null} onClick={onConfirm}>
          {t("store.confirm_in")}
        </Button>
      )}
    </div>
  )
}

const MOVES: LoggedMove[] = ["use", "ret", "xo", "loss", "rx"]

function MoveDialog({ projectId, orgId, x, items, access, actor, initial, onClose }: { projectId: string; orgId: string; x: PmStoreLine; items: SupplyItem[]; access: PmAccess; actor: SupplyActor; initial: LoggedMove; onClose: () => void }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const [m, setM] = useState<LoggedMove>(initial)
  const [q, setQ] = useState("")
  const [itemId, setItemId] = useState("")
  const [wh, setWh] = useState<string | null>(null)
  const [tp, setTp] = useState<string | null>(null)
  const [why, setWhy] = useState<LossWhy | null>(null)
  const [from, setFrom] = useState<RxFrom | null>(null)
  const [fp, setFp] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [files, setFiles] = useState<PmAttachment[]>([])
  const bal = Math.max(0, storeBalance(x, items))
  const unrated = items.filter((i) => !ratedOn(x, i.id))
  const modes = MOVES.filter((k) => k === "rx" || (bal > 0.005 && (k !== "use" || unrated.length)))
  const wq = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const pq = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: wData } = useCollection(wq)
  const { data: pData } = useCollection(pq)
  const warehouses = ((wData ?? []) as Array<{ id: string; name?: string; projectId?: string | null }>).filter((w) => !w.projectId)
  const projects = ((pData ?? []) as Array<{ id: string; name?: string; pm?: { lifecycle?: string } | null; enabledSections?: string[] }>).filter((p) => p.id !== projectId && p.pm && p.pm.lifecycle !== "closed" && p.pm.lifecycle !== "done")
  const xoProjects = projects.filter((p) => (p.enabledSections ?? []).includes("store"))
  const qn = Number(q)
  const blocks = moveBlocks({ archived: access.ctx.archived, t: m, q: qn, balance: bal, itemId: itemId || null, itemRated: false, warehouseId: wh, toProjectId: tp, why, from, note })
  const it = items.find((i) => i.id === itemId)

  const save = async () => {
    if (!firestore) return
    const done = await run(
      "mv",
      () =>
        logStoreMove(firestore, access.ctx, projectId, actor, x.id, {
          t: m,
          q: qn,
          itemId: m === "use" ? itemId : null,
          warehouseId: wh,
          warehouseName: warehouses.find((w) => w.id === wh)?.name ?? null,
          toProjectId: tp,
          toProjectName: projects.find((p) => p.id === tp)?.name ?? null,
          why,
          from,
          fromProjectId: fp,
          fromProjectName: projects.find((p) => p.id === fp)?.name ?? null,
          note,
          files,
        }),
      () => t(`store.mv_logged.${m === "loss" && why === "nc" ? "nc" : m}`, { q: qty(qn), unit: x.unit, code: it?.code ?? "", to: projects.find((p) => p.id === tp)?.name ?? warehouses.find((w) => w.id === wh)?.name ?? "" })
    )
    if (done) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(`store.mv.${m}`)}</DialogTitle>
          <DialogDescription dir="auto">
            {x.name} — {t("store.on_project", { q: qty(bal), unit: x.unit })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ChoiceChips label={t("store.mv.kind")} options={modes.map((k) => ({ id: k, label: t(`store.mv.${k}`) }))} value={m} onChange={setM} />
          <div className="space-y-1.5">
            <Label htmlFor="mv-q">{t("store.mv.qty")} *</Label>
            <div className="flex items-center gap-2">
              <Input id="mv-q" type="number" min={0} dir="ltr" className="w-36" placeholder="0" value={q} onChange={(e) => setQ(e.target.value)} />
              <span className="text-xs text-muted-foreground">{x.unit}</span>
            </div>
            {m !== "rx" && qn > bal + 0.005 && <FormHint tone="bad">{t("store.mv.over", { q: qty(bal) })}</FormHint>}
          </div>
          {m === "use" && (
            <div className="space-y-1.5">
              <Label htmlFor="mv-item">{t("store.mv.which_item")} *</Label>
              <select id="mv-item" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">{t("store.mv.choose_item")}</option>
                {unrated.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} — {i.description}
                  </option>
                ))}
              </select>
              <FormHint>{t("store.mv.use_hint")}</FormHint>
            </div>
          )}
          {m === "ret" && (
            <div className="space-y-1.5">
              <Label>{t("store.mv.to")}</Label>
              {warehouses.length ? <ChoiceChips label={t("store.mv.to")} options={warehouses.map((w) => ({ id: w.id, label: w.name || w.id }))} value={wh} onChange={setWh} /> : <FormHint tone="warn">{t("store.mv.no_wh")}</FormHint>}
              <FormHint>{t("store.mv.ret_hint")}</FormHint>
            </div>
          )}
          {m === "xo" && (
            <div className="space-y-1.5">
              <Label>{t("store.mv.to_project")} *</Label>
              {xoProjects.length ? <ChoiceChips label={t("store.mv.to_project")} options={xoProjects.map((p) => ({ id: p.id, label: p.name || p.id }))} value={tp} onChange={setTp} /> : <FormHint>{t("store.mv.no_project")}</FormHint>}
              <FormHint>{t("store.mv.xo_hint")}</FormHint>
            </div>
          )}
          {m === "loss" && (
            <>
              <div className="space-y-1.5">
                <Label>{t("store.mv.reason")} *</Label>
                <ChoiceChips label={t("store.mv.reason")} options={LOSS_WHY.map((w) => ({ id: w, label: t(`store.loss_why.${w}`) }))} value={why} onChange={setWhy} />
                <FormHint>{why === "nc" ? t("store.mv.nc_hint") : why === "theft" ? t("store.mv.theft_hint") : t("store.mv.loss_hint")}</FormHint>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mv-note">
                  {why === "theft" ? t("store.mv.report") : why === "oth" ? t("store.mv.state_it") : t("store.mv.what_happened")} {why === "oth" && "*"}
                </Label>
                <Input id="mv-note" dir="auto" placeholder={why === "theft" ? t("store.mv.report_ph") : t("store.mv.loss_ph")} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </>
          )}
          {m === "rx" && (
            <>
              <div className="space-y-1.5">
                <Label>{t("store.mv.from")} *</Label>
                <ChoiceChips label={t("store.mv.from")} options={RX_FROM.map((w) => ({ id: w, label: t(`store.rx_from.${w}`) }))} value={from} onChange={setFrom} />
                <FormHint>{from ? t(`store.mv.rx_hint.${from}`) : t("store.mv.rx_hint.oth")}</FormHint>
              </div>
              {from === "prj" && projects.length > 0 && <ChoiceChips label={t("store.mv.which_project")} options={projects.map((p) => ({ id: p.id, label: p.name || p.id }))} value={fp} onChange={setFp} />}
              <div className="space-y-1.5">
                <Label htmlFor="mv-rxnote">
                  {from === "oth" ? t("store.mv.state_source") : t("store.mv.note")} {from === "oth" && "*"}
                </Label>
                <Input id="mv-rxnote" dir="auto" placeholder={t("store.mv.rx_ph")} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </>
          )}
          {m !== "use" && (
            <PmFilesField
              orgId={orgId}
              folder={`projects/${projectId}/store`}
              value={files}
              onChange={setFiles}
              label={m === "loss" ? t("store.mv.files_loss") : m === "rx" ? t("store.mv.files_rx") : t("store.mv.files_out")}
              hint={m === "loss" ? t("store.mv.files_loss_hint") : m === "rx" ? t("store.mv.files_rx_hint") : t("store.mv.files_out_hint")}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            {t("sup.back")}
          </Button>
          <Button variant={m === "loss" ? "destructive" : "default"} onClick={() => void save()} disabled={blocks.length > 0 || busy !== null}>
            {t(`store.mv.${m}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RateDialog({ projectId, x, item, access, onClose }: { projectId: string; x: PmStoreLine; item: SupplyItem | undefined; access: PmAccess; onClose: () => void }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const had = item ? ratedOn(x, item.id) : null
  const [r, setR] = useState(had?.r != null ? String(had.r) : "")
  const [w, setW] = useState(String(x.rates?.[item?.id ?? ""]?.w ?? 5))
  if (!item) return null
  const rn = Number(r)
  const wn = Number(w)
  const ok = rn > 0 && wn >= 0 && wn <= 30
  const save = async () => {
    if (!firestore) return
    const done = await run("rate", () => setMaterialRate(firestore, access.ctx, projectId, x.id, item.id, rn, wn), had ? t("store.rate.corrected", { r: qty(rn) }) : t("store.rate.saved", { r: qty(rn), unit: x.unit, per: item.unit }))
    if (done) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{had ? t("store.rate.correct_the") : t("store.rate.set_the")}</DialogTitle>
          <DialogDescription dir="auto">
            {x.name} — {item.code} {item.description}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rt-r">{t("store.rate.per", { unit: x.unit, per: item.unit })} *</Label>
            <Input id="rt-r" type="number" min={0} step="any" dir="ltr" placeholder="0.00" value={r} onChange={(e) => setR(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rt-w">{t("store.rate.waste")}</Label>
            <Input id="rt-w" type="number" min={0} max={30} dir="ltr" value={w} onChange={(e) => setW(e.target.value)} />
          </div>
        </div>
        <Callout tone="info">{had ? t("store.rate.note_correct") : t("store.rate.note_new")}</Callout>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            {t("sup.back")}
          </Button>
          <Button onClick={() => void save()} disabled={!ok || busy !== null}>
            <Ruler size={14} className="me-1.5" aria-hidden="true" />
            {t("store.rate.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

