"use client"

// Execution › Site & the week › Plant on site (WF-14, EQP-08…15), as the
// prototype's eqSitePanel: what is on site, what it did (the last ten days as
// coloured squares, utilisation), when it goes back, its licence gate, and —
// for money holders — what it has cost, charged on possession not use. Idle
// five days or past its return date is red. A request alone stops nothing:
// the charge runs until the desk confirms. Tools are custody, never day-rated.

import { useMemo, useState, type ComponentProps } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { AlertTriangle, Check, Loader2, Plus, Truck, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import type { PmAttachment } from "@/lib/pm/attachments"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import {
  backBlocks,
  dayBlocks,
  dayCost,
  dayLog,
  FUEL_LEVELS,
  handoverBlocks,
  hasMeter,
  IDLE_ALERT_DAYS,
  idleSince,
  licenceState,
  offBlocks,
  OFF_REASONS,
  onSite,
  overdueDays,
  PLANT_CATEGORIES,
  PLANT_CONDITIONS,
  PLANT_DAY_STATES,
  PLANT_OWNERSHIP,
  plantCost,
  PM_PLANT,
  utilisation,
  type OffReason,
  type PlantCategory,
  type PlantCondition,
  type PlantDayState,
  type PlantOwnership,
  type PmPlant,
} from "@/lib/pm/plant"
import { handBackPlant, logPlantDay, PmPlantError, receivePlant, recordOffHireConfirmation, requestOffHire } from "@/lib/pm/plant-writes"
import { addDays } from "@/lib/pm/programme"
import { cn } from "@/lib/utils"
import { PmFilesField } from "./PmAttachments"

const SQUARE: Record<PlantDayState, string> = { work: "bg-success", down: "bg-destructive", idle: "bg-warning", stby: "bg-cta", move: "bg-muted-foreground/40" }
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

type Mode = { kind: "receive" } | { kind: "day"; p: PmPlant } | { kind: "off"; p: PmPlant } | { kind: "desk"; p: PmPlant } | { kind: "back"; p: PmPlant }

export function PlantPanel({ projectId, orgId, access, actor }: { projectId: string; orgId?: string | null; access: PmAccess; actor: { uid: string; name: string | null } }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_PLANT) : null), [firestore, projectId])
  const { data } = useCollection(q)
  const list = useMemo(() => ((data ?? []) as unknown as PmPlant[]).slice().sort((a, b) => a.seq - b.seq), [data])
  const on = onSite(list)
  const back = list.filter((p) => p.status === "back")
  const money = access.has("money")
  const canReq = !access.ctx.archived && access.allowed("plant.request")
  const canDay = !access.ctx.archived && access.allowed("daily.write")
  const red = on.some((p) => overdueDays(p, today) > 0 || idleSince(p) >= IDLE_ALERT_DAYS)
  const cost = list.reduce((a, p) => a + plantCost(p), 0)
  const [mode, setMode] = useState<Mode | null>(null)
  const [busy, setBusy] = useState(false)

  const [f, setF] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<PmAttachment[]>([])
  const open = (m: Mode, init: Record<string, string>) => {
    setF(init)
    setFiles([])
    setMode(m)
  }
  const numOrNull = (v?: string) => (v === undefined || v.trim() === "" ? null : Number(v))

  const cat = (f.category as PlantCategory) || "light"
  const blocks: string[] = !mode
    ? []
    : mode.kind === "receive"
      ? handoverBlocks({ archived: access.ctx.archived, name: f.name ?? "", qty: Number(f.qty || 0), from: f.from ?? "", to: f.to ?? "", category: cat, meter: numOrNull(f.meter), dayRate: numOrNull(f.rate), licenceTo: f.licence || null, condition: (f.condition as PlantCondition) || "ok", remark: f.remark, today })
      : mode.kind === "day"
        ? dayBlocks({ archived: access.ctx.archived, status: mode.p.status, day: f.day ?? "", from: mode.p.from, today, st: f.st })
        : mode.kind === "off"
          ? offBlocks({ archived: access.ctx.archived, status: mode.p.status, why: (f.why as OffReason) || null, whyText: f.whyText, ready: f.ready ?? "", today })
          : mode.kind === "desk"
            ? [...(f.no?.trim() ? [] : ["no_number"]), ...(f.on && f.on <= today ? [] : ["bad_day"])]
            : backBlocks({ archived: access.ctx.archived, plant: mode.p, meter: numOrNull(f.meter), condition: (f.condition as PlantCondition) || "ok", remark: f.remark })

  const save = async () => {
    if (!firestore || !mode || blocks.length) return
    setBusy(true)
    try {
      if (mode.kind === "receive") {
        const seq = await receivePlant(firestore, access.ctx, projectId, actor, {
          tag: f.tag ?? "",
          name: f.name ?? "",
          category: cat,
          ownership: (f.own as PlantOwnership) || "own",
          supplier: f.supplier,
          qty: Number(f.qty || 1),
          dayRate: money ? numOrNull(f.rate) : null,
          from: f.from ?? today,
          to: f.to ?? today,
          licenceTo: f.licence || null,
          meter: numOrNull(f.meter),
          fuel: f.fuel,
          accessories: f.acc,
          condition: (f.condition as PlantCondition) || "ok",
          remark: f.remark,
          files,
        })
        toast({ title: t("plant.received", { no: seq }) })
      } else if (mode.kind === "day") {
        await logPlantDay(firestore, access.ctx, projectId, mode.p.seq, { day: f.day ?? today, st: f.st as PlantDayState })
        toast({ title: t("plant.logged") })
      } else if (mode.kind === "off") {
        await requestOffHire(firestore, access.ctx, projectId, actor, mode.p.seq, { ready: f.ready ?? today, why: (f.why as OffReason) || null, whyText: f.whyText })
        toast({ title: t("plant.off_requested") })
      } else if (mode.kind === "desk") {
        await recordOffHireConfirmation(firestore, access.ctx, projectId, actor, mode.p.seq, { no: f.no ?? "", on: f.on ?? today })
        toast({ title: t("plant.desk_recorded") })
      } else {
        await handBackPlant(firestore, access.ctx, projectId, actor, mode.p.seq, { meter: numOrNull(f.meter), fuel: f.fuel, accessories: f.acc, condition: (f.condition as PlantCondition) || "ok", remark: f.remark, files })
        toast({ title: t("plant.handed_back") })
      }
      setMode(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmPlantError && err.blocks[0] ? `plant.block.${err.blocks[0]}` : "error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const field = (k: string, label: string, props: ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`pl-${k}`}>{label}</Label>
      <Input id={`pl-${k}`} value={f[k] ?? ""} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))} disabled={busy} {...props} />
    </div>
  )
  const choice = <T extends string>(k: string, label: string, opts: readonly T[], text: (o: T) => string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`pl-${k}`}>{label}</Label>
      <Select value={f[k] ?? ""} onValueChange={(v) => setF((s) => ({ ...s, [k]: v }))} disabled={busy}>
        <SelectTrigger id={`pl-${k}`}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {opts.map((o) => (
            <SelectItem key={o} value={o}>
              {text(o)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
  const noteFields = (withMeter: boolean) => (
    <>
      {withMeter && (
        <div className="grid gap-3 sm:grid-cols-2">
          {field("meter", t("plant.meter"), { type: "number", min: "0", dir: "ltr" })}
          {choice("fuel", t("plant.fuel"), FUEL_LEVELS, (o) => (o === "full" ? t("plant.fuel_full") : o))}
        </div>
      )}
      {field("acc", t("plant.acc"), { placeholder: t("plant.acc_ph"), dir: "auto" })}
      <p className="-mt-2 text-[11px] text-muted-foreground">{t("plant.acc_hint")}</p>
      {choice("condition", t("plant.condition"), PLANT_CONDITIONS, (o) => t(`plant.cond.${o}`))}
      {f.condition && f.condition !== "ok" && field("remark", t("plant.remark"), { dir: "auto" })}
      <PmFilesField orgId={orgId} folder={`projects/${projectId}/plant`} value={files} onChange={setFiles} label={t("plant.photos")} hint={t("plant.photos_hint")} disabled={busy} />
    </>
  )

  return (
    <Panel
      title={t("plant.title")}
      icon={Truck}
      bodyClassName="p-0"
      actions={
        <>
          <StatusPill tone={red ? "bad" : "ok"}>{on.length}</StatusPill>
          {money && cost > 0 && (
            <b className="text-sm tabular-nums" dir="ltr">
              {pmMoney(cost)}
            </b>
          )}
          {canReq && (
            <Button size="sm" onClick={() => open({ kind: "receive" }, { category: "light", own: "own", qty: "1", from: today, to: addDays(today, 30), condition: "ok" })}>
              <Plus size={15} className="me-1.5" aria-hidden="true" />
              {t("plant.receive")}
            </Button>
          )}
        </>
      }
    >
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("plant.sub")}</p>
      {on.length === 0 ? (
        <p className="px-4 py-5 text-center text-sm text-muted-foreground">{t("plant.empty")}</p>
      ) : (
        <ul className="divide-y">
          {on.map((p) => {
            const L = dayLog(p).slice(0, 10).reverse()
            const u = utilisation(p)
            const last = dayLog(p)[0]
            const since = idleSince(p)
            const late = overdueDays(p, today)
            const lic = licenceState(p, today)
            const rated = p.category !== "tool" && (p.dayRate ?? 0) > 0
            return (
              <li key={p.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="text-sm font-bold" dir="auto">
                    {p.tag ? <span dir="ltr">{p.tag}</span> : null}
                    {p.qty > 1 ? ` × ${p.qty}` : ""} — {p.name}
                  </p>
                  <p className="text-xs text-muted-foreground" dir="auto">
                    {t(`plant.cat.${p.category}`)} · {t(`plant.own.${p.ownership}`)}
                    {p.ownership === "hire" && p.supplier ? ` (${p.supplier})` : ""} · {t("plant.on_since", { count: Math.max(0, dayDiff(p.from, today)) })} · {t("plant.return_on", { date: pmDate(p.to, locale) })}
                  </p>
                  {L.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {L.map((x) => (
                        <span key={x.day} title={`${pmDate(x.day, locale)} · ${t(`plant.st.${x.st}`)}`} className={cn("inline-block h-3.5 w-3.5 rounded-sm", SQUARE[x.st])} aria-label={`${x.day}: ${t(`plant.st.${x.st}`)}`} />
                      ))}
                      <span className="ms-1.5 text-xs text-muted-foreground">
                        {u !== null ? t("plant.util", { pc: u }) : ""}
                        {last ? ` · ${t("plant.last_day")}: ${t(`plant.st.${last.st}`)}` : ""}
                      </span>
                    </div>
                  )}
                  {lic === "expired" && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-bold text-destructive">
                      <X size={11} aria-hidden="true" />
                      {t("plant.lic_expired")}
                    </p>
                  )}
                  {lic === "warn" && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-bold text-warning">
                      <AlertTriangle size={11} aria-hidden="true" />
                      {t("plant.lic_warn", { count: dayDiff(today, p.licenceTo ?? today) })}
                    </p>
                  )}
                  {since >= IDLE_ALERT_DAYS && <p className="mt-1 text-xs font-bold text-destructive">{t("plant.idle", { count: since })}</p>}
                  {late > 0 && <p className="mt-1 text-xs font-bold text-destructive">{t("plant.late", { count: late })}</p>}
                  {p.status === "req" && p.offReq && (
                    <p className="mt-1 text-xs">
                      {t("plant.off_line", { date: pmDate(p.offReq.on, locale) })}
                      {p.offNo ? ` — ${t("plant.off_no", { no: p.offNo })}` : ""}
                      {p.offOk ? ` · ${t("plant.desk_ok", { date: pmDate(p.offOk.on, locale) })}` : <b className="text-warning"> · {t("plant.desk_wait")}</b>}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  {!rated ? (
                    <StatusPill tone="mute">{t("plant.custody")}</StatusPill>
                  ) : money ? (
                    <>
                      <b className="text-xs tabular-nums" dir="ltr">
                        {pmMoney(plantCost(p))}
                      </b>
                      <span className="text-xs text-muted-foreground" dir="ltr">
                        {t("plant.per_day", { rate: pmMoney(p.dayRate ?? 0) })}
                      </span>
                    </>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {canDay && (
                      <Button size="sm" variant="outline" onClick={() => open({ kind: "day", p }, { day: today, st: p.days?.[today] ?? "work" })}>
                        {t("plant.log_today")}
                      </Button>
                    )}
                    {canReq && p.status === "use" && (
                      <Button size="sm" variant="outline" onClick={() => open({ kind: "off", p }, { ready: today })}>
                        {t("plant.off_hire")}
                      </Button>
                    )}
                    {canReq && p.status === "req" && !p.offOk && (
                      <Button size="sm" variant="outline" onClick={() => open({ kind: "desk", p }, { on: today })}>
                        {t("plant.desk_record")}
                      </Button>
                    )}
                    {canReq && p.status === "req" && p.offOk && (
                      <Button size="sm" onClick={() => open({ kind: "back", p }, { condition: "ok", acc: p.handover.accessories ?? "" })}>
                        <Check size={14} className="me-1.5" aria-hidden="true" />
                        {t("plant.hand_back")}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {on.some((p) => p.category === "tool") && (
        <Callout tone="info" className="m-3">
          {t("plant.tools_note")}
        </Callout>
      )}
      {back.length > 0 && (
        <details className="border-t px-4 py-2.5 text-xs">
          <summary className="cursor-pointer font-bold">{t("plant.returned", { count: back.length })}</summary>
          <ul className="mt-1 space-y-1">
            {back.map((p) => (
              <li key={p.id} dir="auto">
                {p.tag} — {p.name} · {t("plant.period", { from: pmDate(p.from, locale), to: pmDate(p.back?.on ?? p.to, locale) })}
                {p.offNo ? ` · ${t("plant.off_no", { no: p.offNo })}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mode ? t(`plant.dlg.${mode.kind}`) : ""}</DialogTitle>
            <DialogDescription dir="auto">{mode && mode.kind !== "receive" ? `${mode.p.tag} — ${mode.p.name}` : t("plant.receive_note")}</DialogDescription>
          </DialogHeader>
          {mode && (
            <div className="space-y-4">
              {mode.kind === "receive" && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {field("tag", t("plant.tag"), { dir: "ltr" })}
                    {field("name", t("plant.name"), { dir: "auto" })}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {choice("category", t("plant.category"), PLANT_CATEGORIES, (o) => t(`plant.cat.${o}`))}
                    {choice("own", t("plant.ownership"), PLANT_OWNERSHIP, (o) => t(`plant.own.${o}`))}
                    {field("qty", t("plant.qty"), { type: "number", min: "1", step: "1", dir: "ltr" })}
                  </div>
                  {f.own === "hire" && field("supplier", t("plant.supplier"), { dir: "auto" })}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {field("from", t("plant.from"), { type: "date", dir: "ltr", max: today })}
                    {field("to", t("plant.to"), { type: "date", dir: "ltr" })}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {money && cat !== "tool" && field("rate", t("plant.rate"), { type: "number", min: "0", dir: "ltr" })}
                    {hasMeter(cat) && field("licence", t("plant.licence"), { type: "date", dir: "ltr" })}
                  </div>
                  <Callout tone="info">{t("plant.handover_note")}</Callout>
                  {noteFields(hasMeter(cat))}
                </>
              )}
              {mode.kind === "day" && (
                <>
                  <Callout tone="info">{t("plant.day_note")}</Callout>
                  {choice("st", t("plant.day_state"), PLANT_DAY_STATES, (o) => t(`plant.st.${o}`))}
                  {f.st && ["idle", "stby", "down"].includes(f.st) && <p className="-mt-2 text-[11px] text-muted-foreground">{t(`plant.st_hint.${f.st}`)}</p>}
                  {field("day", t("plant.day"), { type: "date", dir: "ltr", max: today, min: mode.p.from })}
                  {money && (mode.p.dayRate ?? 0) > 0 && f.st && f.day && (
                    <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3 text-sm">
                      <span>{t("plant.charged")}</span>
                      <b className="tabular-nums" dir="ltr">
                        {pmMoney(dayCost({ ...mode.p, days: { ...(mode.p.days ?? {}), [f.day]: f.st as PlantDayState } }, f.day))}
                      </b>
                    </div>
                  )}
                </>
              )}
              {mode.kind === "off" && (
                <>
                  <Callout tone="warn">{t("plant.off_note")}</Callout>
                  {idleSince(mode.p) >= 3 && <Callout tone="warn">{t("plant.idle_warn", { count: idleSince(mode.p) })}</Callout>}
                  {field("ready", t("plant.ready"), { type: "date", dir: "ltr", min: today })}
                  <p className="-mt-2 text-[11px] text-muted-foreground">{t("plant.ready_hint")}</p>
                  {choice("why", t("plant.reason"), OFF_REASONS, (o) => t(`plant.off_why.${o}`))}
                  {f.why === "oth" && field("whyText", t("plant.reason_text"), { dir: "auto" })}
                </>
              )}
              {mode.kind === "desk" && (
                <>
                  <Callout tone="info">{t("plant.desk_note")}</Callout>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {field("no", t("plant.off_number"), { dir: "ltr" })}
                    {field("on", t("plant.desk_date"), { type: "date", dir: "ltr", max: today })}
                  </div>
                </>
              )}
              {mode.kind === "back" && (
                <>
                  <Callout tone="info">{t("plant.back_note")}</Callout>
                  {hasMeter(mode.p.category) && mode.p.handover.meter != null && <p className="text-xs text-muted-foreground">{t("plant.was_meter", { meter: mode.p.handover.meter })}</p>}
                  {noteFields(hasMeter(mode.p.category))}
                </>
              )}
              <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`plant.block.${b}`))} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {mode ? t(`plant.save.${mode.kind}`) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
