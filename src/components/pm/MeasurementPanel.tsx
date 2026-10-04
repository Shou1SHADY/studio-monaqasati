"use client"

// Execution › Measurement on a PM 1.0 project (WF-04), as the prototype lays it
// out: the items still to measure inline (completed ones hidden and counted),
// quantities typed in place with the live value, unpriced, over-remaining and
// no-inspection summary; "record" opens the sheet (date · period · proof ·
// documents). Sheets awaiting the PM are warned about above the list — their
// quantities are not in "executed" yet. Below, the sheet register: every
// change in "executed" came from one of them. Prices only for money holders.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { AlertTriangle, Check, ClipboardList, Loader2, Lock, Plus, Ruler, Search, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { usePmProjectNo } from "@/hooks/usePmProjectNo"
import { usePmUnits } from "@/hooks/usePmUnits"
import { PmAccessError } from "@/lib/pm/access"
import { certificateNo } from "@/lib/pm/certificate"
import { projectDocNo } from "@/lib/pm/exec-numbers"
import { pmDate, pmMoney } from "@/lib/pm/format"
import { gateOf, PM_INSPECTIONS, type PmInspection } from "@/lib/pm/inspection"
import { aboveContract, measureSummary, openItems, overRemaining, PM_SHEETS, recordedValue, remainingOf, sheetNo, type PmSheet, type SheetStatus } from "@/lib/pm/measurement"
import { approveSheet, PmSheetError, returnSheet, type SheetActor } from "@/lib/pm/measurement-writes"
import { matchesSearch } from "@/lib/search-text"
import type { PricingBasis } from "@/lib/pm/terms"
import { cn } from "@/lib/utils"
import { AttachmentTag } from "./PmAttachments"
import { WriteSheetDialog, type SheetItem } from "./WriteSheetDialog"
import { NativeSelect } from "@/components/module-ui/NativeSelect"

const TONE: Record<SheetStatus, PillTone> = { wait: "warn", ok: "ok", no: "bad" }
const SHOWN = 6

export function MeasurementPanel({
  projectId,
  orgId,
  basis,
  items,
  access,
  actor,
  lastIpc,
  onItemsChanged,
  startMeasuring,
  unitsOn,
}: {
  projectId: string
  /** For attachments; without it the sheet saves without files. */
  orgId?: string | null
  basis: PricingBasis
  items: SheetItem[]
  access: PmAccess
  actor: SheetActor
  /** The last certificate prepared (`pm.ipcCount` / `pm.lastIpcOn`) — «آخر قياس دخل مستخلصاً». */
  lastIpc?: { seq: number; on: string | null } | null
  onItemsChanged?: () => void
  /** Opened from the head's «قياس»: the writer is open on arrival. */
  startMeasuring?: boolean
  /** The delivery-units section is on: each line may name its unit. */
  unitsOn?: boolean
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const projectNo = usePmProjectNo(projectId)
  const { toast } = useToast()
  const [measuring, setMeasuring] = useState(() => Boolean(startMeasuring) && !access.ctx.archived && access.allowed("measurement.write"))
  const [qty, setQty] = useState<Record<string, string>>({})
  const [search, setSearch] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [unitOf, setUnitOf] = useState<Record<string, string>>({})
  const { units } = usePmUnits(projectId, Boolean(unitsOn))
  const openUnits = units.filter((u) => !u.ho)
  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? null
  const allocated = (itemId: string) => openUnits.some((u) => (u.lines[itemId]?.q ?? 0) > 0)

  const sheetsQuery = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_SHEETS) : null), [firestore, projectId])
  const wirQuery = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_INSPECTIONS) : null), [firestore, projectId])
  const { data } = useCollection(sheetsQuery)
  const { data: wirData } = useCollection(wirQuery)
  const sheets = useMemo(() => ((data ?? []) as unknown as PmSheet[]).slice().sort((a, b) => b.seq - a.seq), [data])
  const inspections = useMemo(() => (wirData ?? []) as unknown as PmInspection[], [wirData])
  const waiting = sheets.filter((s) => s.status === "wait")
  const money = access.has("money")
  const canWrite = !access.ctx.archived && access.allowed("measurement.write")
  const canApprove = !access.ctx.archived && access.allowed("measurement.approve")
  const self = access.has("approve")
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const { open, done: hidden } = openItems(items, basis)
  const shownItems = measuring && search.trim() ? open.filter((i) => matchesSearch(search, [i.code, i.description])) : open

  const lines = useMemo(
    () =>
      Object.entries(qty)
        .map(([itemId, v]) => ({ itemId, code: byId.get(itemId)?.code ?? null, qty: v.trim() === "" ? 0 : Number(v), unit: unitOf[itemId] || null }))
        .filter((l) => l.qty !== 0),
    [qty, byId, unitOf]
  )
  const noUnit = lines.filter((l) => l.qty > 0 && !l.unit && allocated(l.itemId)).length
  const sum = measureSummary(basis, lines, items)
  const blocked = sum.over > 0 || sum.noPass > 0 || sum.count === 0 || lines.some((l) => !(l.qty > 0))
  const fmt = (n: number) => n.toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { maximumFractionDigits: 2 })
  const pc = (i: SheetItem) => (i.quantity > 0 ? Math.min(100, (i.executed / i.quantity) * 100) : 0)

  const decide = async (s: PmSheet, how: "ok" | "no") => {
    if (!firestore) return
    setBusy(`${s.seq}:${how}`)
    try {
      if (how === "ok") {
        const r = await approveSheet(firestore, access.ctx, projectId, actor, s.seq)
        toast({ title: t("meas.approved", { no: sheetNo(s.seq) }), description: r.wentLive ? t("meas.went_live") : undefined })
        onItemsChanged?.()
      } else {
        await returnSheet(firestore, access.ctx, projectId, actor, s.seq, null)
        toast({ title: t("meas.returned", { no: sheetNo(s.seq) }) })
      }
    } catch (err) {
      console.error(err)
      // The gate may refuse an approval the screen offered: an inspection failed since the sheet was written.
      const key = err instanceof PmAccessError ? `refused.${err.code}` : !(err instanceof PmSheetError) ? "error.save" : err.code === "not_waiting" ? "meas.not_waiting" : err.blocks[0] ? `meas.block.${err.blocks[0]}` : "error.save"
      toast({ title: t(key), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const linesText = (s: PmSheet) =>
    s.lines
      .map((l) => {
        const i = byId.get(l.itemId)
        const q = s.status === "ok" && l.approved != null ? l.approved : l.qty
        return `${i?.code ?? l.code ?? "?"}${l.unit && unitName(l.unit) ? ` (${unitName(l.unit)})` : ""} × ${fmt(q)}${s.status === "ok" && l.approved != null && l.approved < l.qty ? ` (${t("meas.cut", { qty: l.qty })})` : ""}`
      })
      .join(" · ")

  const stop = () => {
    setMeasuring(false)
    setQty({})
    setUnitOf({})
    setSearch("")
  }

  return (
    <div className="space-y-4">
      <Callout tone="info">
        {t("meas.intro")}
        {lastIpc && lastIpc.seq > 0
          ? ` ${lastIpc.on ? t("meas.last_billed", { no: certificateNo(lastIpc.seq), date: pmDate(lastIpc.on, locale) }) : t("meas.last_billed_nodate", { no: certificateNo(lastIpc.seq) })}`
          : ""}
      </Callout>

      <Panel
        title={t("meas.period_title")}
        icon={Ruler}
        actions={
          measuring ? (
            <Button size="sm" variant="outline" onClick={stop}>
              {t("cancel")}
            </Button>
          ) : canWrite ? (
            <Button size="sm" onClick={() => setMeasuring(true)} disabled={!open.length}>
              <Plus size={15} className="me-1.5" aria-hidden="true" />
              {t("meas.start")}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
              <Lock size={12} aria-hidden="true" />
              {t("meas.no_perm")}
            </span>
          )
        }
        bodyClassName="p-0"
      >
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">
          {t("meas.period_sub")}
          {hidden > 0 ? ` · ${t("meas.hidden", { count: hidden })}` : ""}
        </p>
        {waiting.length > 0 && (
          <Callout tone="warn" className="m-4">
            {t("meas.wait_callout", { count: waiting.length })}
          </Callout>
        )}
        {items.length === 0 ? (
          <EmptyState icon={Ruler} title={t("meas.nothing_title")} description={t("meas.nothing_desc")} />
        ) : open.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("meas.all_done")}</p>
        ) : (
          <>
            {measuring && (
              <div className="border-b px-4 py-3">
                <div className="relative max-w-sm">
                  <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input aria-label={t("meas.search")} placeholder={t("meas.search")} value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9" />
                </div>
              </div>
            )}
            <ul className="divide-y">
              {shownItems.map((i) => {
                const v = qty[i.id] ?? ""
                const n = v.trim() === "" ? 0 : Number(v)
                const over = overRemaining(basis, i, n)
                const above = aboveContract(basis, i, n)
                const gate = gateOf(i.gate ?? {})
                const noPass = gate !== "free" && gate !== "passed"
                const p = pc(i)
                return (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1 basis-60">
                      <p className="text-sm font-semibold" dir="auto">
                        {i.description || i.code}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span dir="ltr" className="font-semibold underline decoration-dotted underline-offset-2">
                          {i.code}
                        </span>{" "}
                        · {t("meas.done_of", { ex: fmt(i.executed), qty: fmt(i.quantity), unit: i.unit || "" })} · <span dir="ltr">{Math.round(p)}%</span>
                      </p>
                      {over > 0 && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-destructive">
                          <AlertTriangle size={11} aria-hidden="true" />
                          {t("meas.over_line", { qty: fmt(over), unit: i.unit || "" })}
                        </p>
                      )}
                      {above > 0 && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-warning">
                          <Ruler size={11} aria-hidden="true" />
                          {t("meas.above_line", { qty: fmt(above), unit: i.unit || "" })}
                        </p>
                      )}
                      {noPass && <p className="mt-0.5 text-xs font-bold text-destructive">{t("meas.gate_line")}</p>}
                    </div>
                    {measuring ? (
                      <div className="flex items-center gap-2">
                        {openUnits.length > 0 && allocated(i.id) && (
                          <NativeSelect
                            aria-label={t("units.field")}
                            value={unitOf[i.id] ?? ""}
                            onChange={(e) => setUnitOf((u) => ({ ...u, [i.id]: e.target.value }))}
                            className={cn(
                              "h-11 rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              n > 0 && !unitOf[i.id] && "border-warning"
                            )}
                          >
                            <option value="">{t("units.meas_pick")}</option>
                            {openUnits.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                          </NativeSelect>
                        )}
                        <Input
                          aria-label={t("meas.qty_for", { code: i.code })}
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          dir="ltr"
                          placeholder="0"
                          value={v}
                          onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))}
                          className={cn("h-11 w-28", (over > 0 || n < 0 || (noPass && n > 0)) && "border-destructive")}
                        />
                        <span className="w-28 text-xs text-muted-foreground">
                          {t("meas.left")} <b className={cn(remainingOf(i) <= 0 && "text-destructive")}>{fmt(remainingOf(i))}</b> {i.unit}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
                          <div className={cn("h-full rounded-full", p >= 99.5 ? "bg-success" : "bg-module")} style={{ width: `${p}%` }} />
                        </div>
                        <span className="w-12 text-end text-xs tabular-nums" dir="ltr">
                          {Math.round(p)}%
                        </span>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            {measuring && (
              <div className="flex flex-wrap items-end gap-3 border-t bg-muted/30 px-4 py-3">
                <dl className="min-w-0 flex-1 basis-64 space-y-1 text-sm">
                  {money && (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">{t("meas.value_entered")}</dt>
                      <dd className="font-bold tabular-nums" dir="ltr">
                        {pmMoney(sum.value)}
                      </dd>
                    </div>
                  )}
                  {sum.unpriced > 0 && <p className="text-xs font-semibold text-warning">{t("meas.sum_unpriced", { count: sum.unpriced })}</p>}
                  {sum.over > 0 && <p className="text-xs font-semibold text-destructive">{t("meas.sum_over", { count: sum.over })}</p>}
                  {sum.noPass > 0 && <p className="text-xs font-semibold text-destructive">{t("meas.sum_nopass", { count: sum.noPass })}</p>}
                  {noUnit > 0 && <p className="text-xs font-semibold text-warning">{t("units.meas_unassigned", { count: noUnit })}</p>}
                </dl>
                <Button onClick={() => setConfirming(true)} disabled={blocked} variant={blocked ? "outline" : "default"}>
                  <Check size={15} className="me-1.5" aria-hidden="true" />
                  {t(self ? "meas.record_approve" : "meas.record")}
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>

      <Panel title={t("meas.sheets_title")} icon={ClipboardList} count={waiting.length || undefined} bodyClassName="p-0">
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("meas.sheets_sub")}</p>
        {sheets.length === 0 ? (
          <p className="px-4 py-5 text-center text-sm text-muted-foreground">{t("meas.sheets_empty")}</p>
        ) : (
          <ul className="divide-y">
            {(all ? sheets : sheets.slice(0, SHOWN)).map((s) => {
              const isSelf = s.status === "ok" && (s.self || s.okBy === s.by)
              return (
                <li key={s.seq} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-60">
                    <p className="text-sm font-bold">{t("meas.no", { no: projectDocNo(projectNo, s.seq) })}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("meas.row_line", { day: pmDate(s.day, locale), by: s.byName || "—", count: s.lines.length })}
                      {s.status === "ok" ? t("meas.row_ok", { ok: s.okByName || "—", date: pmDate(s.okAt, locale) }) : ""}
                      {isSelf ? t("meas.row_self") : ""}
                    </p>
                    {s.note && (
                      <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                        {s.note}
                      </p>
                    )}
                    {s.returnNote && (
                      <p className="mt-0.5 text-xs text-destructive" dir="auto">
                        {s.returnNote}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs" dir="ltr">
                      {linesText(s)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <AttachmentTag files={s.files} />
                    {money && (
                      <b className="text-xs tabular-nums" dir="ltr">
                        {pmMoney(recordedValue(s, (id) => byId.get(id)?.rate ?? 0))}
                      </b>
                    )}
                    <StatusPill tone={TONE[s.status] ?? "mute"}>{t(`meas.status.${s.status}` as "meas.status.ok")}</StatusPill>
                    {isSelf && <StatusPill tone="violet">{t("meas.self")}</StatusPill>}
                    {s.status === "wait" && canApprove && (
                      <>
                        <Button size="sm" onClick={() => void decide(s, "ok")} disabled={busy !== null}>
                          {busy === `${s.seq}:ok` ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <Check size={14} className="me-1.5" aria-hidden="true" />}
                          {t("meas.approve")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void decide(s, "no")} disabled={busy !== null}>
                          <Undo2 size={14} className="me-1.5" aria-hidden="true" />
                          {t("meas.send_back")}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {sheets.length > SHOWN && (
          <div className="border-t px-4 py-2">
            <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
              {all ? t("meas.show_less") : t("meas.show_all", { count: sheets.length })}
            </Button>
          </div>
        )}
      </Panel>

      {canWrite && (
        <WriteSheetDialog
          open={confirming}
          onOpenChange={setConfirming}
          projectId={projectId}
          orgId={orgId}
          access={access}
          actor={actor}
          items={items}
          basis={basis}
          lines={lines}
          inspections={inspections}
          unitName={unitName}
          nextNo={projectDocNo(projectNo, sheets.reduce((m, x) => Math.max(m, x.seq), 0) + 1)}
          onSaved={() => {
            stop()
            onItemsChanged?.()
          }}
        />
      )}
    </div>
  )
}
