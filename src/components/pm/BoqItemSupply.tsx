"use client"

// The Supply side of a BOQ item's drawer (prototype openItem: «المواد» · «مواد
// البند» · «طلبات المواد على البند»). Read from the project store ledger and the
// material requests on the item; the orders Procurement placed for it are among
// the item's commitments, above. Money is not shown here.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useSupplyWorld } from "@/hooks/useSupplyWorld"
import { todayDay } from "@/lib/pm/format"
import { suppliedBySubcontractor } from "@/lib/pm/item-supply"
import { PM_SUBCONTRACTS, type PmSubcontract } from "@/lib/pm/subcontract"
import { ratedOn, storeBalance, storeState, type StoreItem, type StoreState } from "@/lib/pm/store"
import { needsWithin, onTheWay, reqNo, reqPct, reqState, type ReqState } from "@/lib/pm/supply"

const qty = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US")
const ST_TONE: Record<StoreState, PillTone> = { open: "info", close: "warn", done: "ok", zero: "mute", neg: "bad", pend: "warn" }
const RQ_TONE: Record<ReqState, PillTone> = { wait: "warn", rej: "bad", go: "info", done: "ok", shut: "mute", cx: "mute" }

export function BoqItemSupply({
  projectId,
  orgId,
  item,
  items,
  startOn,
  onOpenStore,
}: {
  projectId: string
  orgId?: string | null
  item: StoreItem
  /** Every BOQ line — a material's balance is shared across the items that use it. */
  items: StoreItem[]
  startOn?: string | null
  onOpenStore?: (storeId: string) => void
}) {
  const t = useTranslations("Portal.PM")
  const world = useSupplyWorld(projectId, orgId)
  const today = todayDay()
  const mats = useMemo(() => world.stores.filter((x) => item.id in (x.rates || {})), [world.stores, item.id])
  const need = useMemo(
    () => needsWithin({ stores: mats, items, requests: world.requests, activities: world.activities, startOn: startOn ?? null, today }),
    [mats, items, world.requests, world.activities, startOn, today]
  )
  // What 30 days of work on the item consume, before anything on site or on the way:
  // the same reckoning with an empty ledger and no requests, so every row is the need itself.
  const need30 = useMemo(
    () => needsWithin({ stores: mats.map((x) => ({ ...x, moves: [] })), items, requests: [], activities: world.activities, startOn: startOn ?? null, today }).gaps,
    [mats, items, world.activities, startOn, today]
  )
  const firestore = useFirestore()
  const scQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_SUBCONTRACTS) : null), [firestore, projectId])
  const { data: contracts } = useCollection(scQ)
  const bySub = suppliedBySubcontractor(item.id, (contracts ?? []) as unknown as PmSubcontract[], mats.length)
  const reqs = useMemo(() => world.requests.filter((r) => r.lines.some((l) => l.itemId === item.id)).filter((r) => reqState(r) !== "rej" && reqState(r) !== "cx"), [world.requests, item.id])

  return (
    <>
      {mats.length > 0 && (
        <DrawerSection title={t("boqsup.need_title")}>
          {mats.map((x) => {
            const row = need.gaps.find((g) => g.key === x.key && g.itemId === item.id)
            const bal = Math.max(0, storeBalance(x, items))
            const way = onTheWay(world.requests, x.key)
            const n = need30.find((g) => g.key === x.key && g.itemId === item.id)?.need ?? 0
            return (
              <div key={x.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                <span className="min-w-0 truncate font-semibold" dir="auto">
                  {x.name}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  <span>{t("boqsup.need_line_30", { need: qty(n), site: qty(bal), way: qty(way) })}</span>
                  {row ? <StatusPill tone="bad">{t("boqsup.gap", { q: qty(row.gap) })}</StatusPill> : <StatusPill tone="ok">{t("boqsup.covered")}</StatusPill>}
                </span>
              </div>
            )
          })}
        </DrawerSection>
      )}
      <DrawerSection title={t("boqsup.mats_title")} count={mats.length}>
        {mats.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">{t(bySub ? "boqsup.by_sub" : "boqsup.no_mats")}</p>
        ) : (
          <>
            <p className="pb-1 text-[11px] text-muted-foreground">{t("boqsup.shared")}</p>
            {mats.map((x) => {
              const r = ratedOn(x, item.id)
              const src = x.rates[item.id]
              const st = storeState(x, items)
              const has = x.moves.length > 0
              const body = (
                <>
                  <span className="min-w-0">
                    <b className="block truncate text-xs" dir="auto">
                      {x.name}
                    </b>
                    <span className="text-[11px] text-muted-foreground" dir="auto">
                      {r ? t("boqsup.rate", { r: qty(r.r ?? 0), unit: x.unit, per: item.unit, w: r.w }) : t("boqsup.declared")}
                      {src?.src === "chg" ? ` · ${t("boqsup.by_change")}${src.voSeq ? ` — ${t("boqsup.on_client")}` : ""}` : ""}
                    </span>
                  </span>
                  {has ? (
                    <StatusPill tone={ST_TONE[st]}>
                      <span dir="ltr">
                        {qty(storeBalance(x, items))} {x.unit}
                      </span>
                    </StatusPill>
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted-foreground">{t("boqsup.not_arrived")}</span>
                  )}
                </>
              )
              return onOpenStore && has ? (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => onOpenStore(x.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md py-2 text-start hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {body}
                </button>
              ) : (
                <div key={x.id} className="flex items-center justify-between gap-2 py-2">
                  {body}
                </div>
              )
            })}
          </>
        )}
      </DrawerSection>
      {reqs.length > 0 && (
        <DrawerSection title={t("boqsup.req_title")} count={reqs.length}>
          {reqs.map((r) => {
            const st = reqState(r)
            const mine = r.lines.filter((l) => l.itemId === item.id)
            return (
              <div key={r.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                <span className="min-w-0 truncate" dir="auto">
                  <b>{r.seq ? t("sup.no", { no: reqNo(r.seq) }) : t("sup.legacy")}</b> — {mine.map((l) => l.name).join(" · ")}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <StatusPill tone={RQ_TONE[st]}>{t(`sup.st.${st}`)}</StatusPill>
                  {st === "go" && <span className="text-muted-foreground">{t("boqsup.in_pct", { pct: Math.round(reqPct(r) * 100) })}</span>}
                </span>
              </div>
            )
          })}
        </DrawerSection>
      )}
    </>
  )
}
