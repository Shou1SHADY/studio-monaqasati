"use client"

// Equipment requests on a PM 1.0 project (prototype eqReqPanel · formEQR): the
// engineer says what plant is needed, for which activity and when — never where
// it comes from. The project manager approves; the approved request is the plant
// desk's to answer (allocated · busy until · alternative · none). There is no
// desk module yet, so the site records the reply it was given. An allocated unit
// is received on site (it becomes a unit in «المعدات في الموقع»); busy or none is
// the hire trigger — the approver sends it to Procurement as a timed hire.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Check, Link2, Loader2, Plus, ShoppingCart, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import type { PmAttachment } from "@/lib/pm/attachments"
import { pmDate, todayDay } from "@/lib/pm/format"
import { FUEL_LEVELS, handoverBlocks, hasMeter, PLANT_CONDITIONS, type PlantCondition } from "@/lib/pm/plant"
import { PmPlantError, receivePlant } from "@/lib/pm/plant-writes"
import { addDays, PM_ACTIVITIES, type PmActivity } from "@/lib/pm/programme"
import {
  PLANT_CATEGORIES,
  PLANT_REPLIES,
  PLANT_WHY,
  plantBlocks,
  plantDays,
  plantHasOperator,
  plantHireable,
  plantNo,
  plantReceivable,
  plantReplyBlocks,
  plantState,
  PM_PLANT,
  type PlantCategory,
  type PlantReplyKind,
  type PlantWhy,
  type PmPlantRequest,
} from "@/lib/pm/supply"
import { decidePlant, hirePlantInstead, recordPlantReply, requestPlant, type SupplyActor } from "@/lib/pm/supply-writes"
import { cn } from "@/lib/utils"
import { ChoiceChips, FormHint } from "./ContractBits"
import { PmFilesField } from "./PmAttachments"
import { useLocaleDir, useSupplyRun } from "./SupplyDialogs"

const TONE: Record<ReturnType<typeof plantState>, PillTone> = { wait: "warn", rej: "bad", desk: "info", alloc: "ok", late: "warn", alt: "info", none: "bad", hire: "info", got: "ok" }
const REPLY_TONE: Record<string, string> = { alloc: "text-success", alt: "text-warning", late: "text-warning", none: "text-destructive", hire: "text-cta" }

export function PlantRequestsPanel({ projectId, orgId, access, actor }: { projectId: string; orgId?: string | null; access: PmAccess; actor: SupplyActor }) {
  const t = useTranslations("Portal.PM")
  const { locale } = useLocaleDir()
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const [open, setOpen] = useState(false)
  const [replyOf, setReplyOf] = useState<PmPlantRequest | null>(null)
  const [receiveOf, setReceiveOf] = useState<PmPlantRequest | null>(null)
  const pq = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_PLANT) : null), [firestore, projectId])
  const aq = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_ACTIVITIES) : null), [firestore, projectId])
  const { data } = useCollection(pq)
  const { data: aData } = useCollection(aq)
  const list = useMemo(() => ((data ?? []) as unknown as PmPlantRequest[]).slice().sort((a, b) => b.seq - a.seq), [data])
  const acts = useMemo(() => ((aData ?? []) as unknown as PmActivity[]).slice().sort((a, b) => a.from.localeCompare(b.from)), [aData])
  const canReq = !access.ctx.archived && access.allowed("plant.request")
  const canOk = !access.ctx.archived && access.allowed("request.decide")
  const waiting = list.filter((r) => r.status === "wait").length

  const replyText = (r: PmPlantRequest) => {
    const rp = r.rep
    if (!rp) return null
    if (rp.k === "alloc") return t("plantreq.rep.alloc_line", { unit: rp.unit ?? "" })
    if (rp.k === "late") return t("plantreq.rep.late_line", { date: rp.free ? pmDate(rp.free, locale) : "—" })
    if (rp.k === "alt") return t("plantreq.rep.alt_line", { text: rp.text ?? "" })
    if (rp.k === "none") return t("plantreq.rep.none_line")
    return t("plantreq.rep.hire_line")
  }

  return (
    <>
      <Panel
        title={t("plantreq.title")}
        icon={Truck}
        actions={
          <>
            {waiting > 0 && <StatusPill tone="warn">{t("plantreq.awaiting_you", { count: waiting })}</StatusPill>}
            {canReq && (
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus size={15} className="me-1.5" aria-hidden="true" />
                {t("plantreq.new")}
              </Button>
            )}
          </>
        }
        bodyClassName="p-0"
      >
        <p className="px-4 pt-3 text-xs text-muted-foreground">{t("plantreq.sub")}</p>
        {list.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("plantreq.empty")}</p>
        ) : (
          <div className="divide-y">
            {list.map((r) => {
              const st = plantState(r)
              const rt = replyText(r)
              return (
                <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <b className="text-sm" dir="auto">
                      {t("plantreq.no", { no: plantNo(r.seq) })} — {r.what}
                    </b>
                    <p className="text-xs text-muted-foreground">
                      {t(`plantreq.cat.${r.category}`)}
                      {r.qty > 1 ? ` × ${r.qty}` : ""} · {r.activityName || t("plantreq.no_activity")} · {t("plantreq.range", { from: pmDate(r.from, locale), to: pmDate(r.to, locale) })} · {t("plantreq.days", { count: plantDays(r.from, r.to) })}
                      {r.operator ? ` · ${t("plantreq.with_op")}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground" dir="auto">
                      {t(`plantreq.why.${r.whyK}`)}
                      {r.why ? ` — ${r.why}` : ""}
                    </p>
                    {rt ? (
                      <p className={cn("mt-1 flex items-center gap-1 text-xs font-bold", REPLY_TONE[r.rep?.k ?? ""])} dir="auto">
                        <Link2 size={11} aria-hidden="true" />
                        {rt}
                        {r.rep?.byName ? <span className="font-normal text-muted-foreground"> · {t("plantreq.rep.recorded_by", { name: r.rep.byName })}</span> : null}
                      </p>
                    ) : (
                      r.status === "go" && <p className="mt-1 text-xs">{t("plantreq.with_desk")}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <StatusPill tone={TONE[st]}>{t(`plantreq.st.${st}`)}</StatusPill>
                    {r.status === "wait" && canOk && (
                      <div className="flex gap-1">
                        <Button size="sm" className="h-7 bg-success text-success-foreground hover:bg-success/90" disabled={busy !== null} onClick={() => firestore && void run(`ok${r.seq}`, () => decidePlant(firestore, access.ctx, projectId, actor, r.seq, true), t("plantreq.approved", { no: plantNo(r.seq) }))}>
                          <Check size={13} className="me-1" aria-hidden="true" />
                          {t("sup.approve")}
                        </Button>
                        <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={() => firestore && void run(`no${r.seq}`, () => decidePlant(firestore, access.ctx, projectId, actor, r.seq, false), t("plantreq.rejected", { no: plantNo(r.seq) }))}>
                          {t("sup.reject")}
                        </Button>
                      </div>
                    )}
                    {r.status === "go" && !r.rep && canReq && (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => setReplyOf(r)}>
                        {t("plantreq.rep.record")}
                      </Button>
                    )}
                    {plantReceivable(r) && canReq && (
                      <Button size="sm" className="h-7" onClick={() => setReceiveOf(r)}>
                        <Check size={13} className="me-1" aria-hidden="true" />
                        {t("plantreq.receive")}
                      </Button>
                    )}
                    {plantHireable(r) && canOk && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={busy !== null}
                        onClick={() => firestore && void run(`hire${r.seq}`, () => hirePlantInstead(firestore, access.ctx, projectId, actor, r.seq), t("plantreq.hired", { no: plantNo(r.seq) }))}
                      >
                        <ShoppingCart size={13} className="me-1" aria-hidden="true" />
                        {t("plantreq.hire")}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="p-3">
          <Callout tone="info">{t("plantreq.trigger")}</Callout>
        </div>
      </Panel>
      {open && <PlantDialog projectId={projectId} access={access} actor={actor} acts={acts} onClose={() => setOpen(false)} />}
      {replyOf && <ReplyDialog projectId={projectId} r={replyOf} access={access} actor={actor} onClose={() => setReplyOf(null)} />}
      {receiveOf && <ReceiveOnSiteDialog projectId={projectId} orgId={orgId} r={receiveOf} access={access} actor={actor} onClose={() => setReceiveOf(null)} />}
    </>
  )
}

function ReplyDialog({ projectId, r, access, actor, onClose }: { projectId: string; r: PmPlantRequest; access: PmAccess; actor: SupplyActor; onClose: () => void }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const today = todayDay()
  const [k, setK] = useState<PlantReplyKind | null>(null)
  const [unit, setUnit] = useState("")
  const [free, setFree] = useState("")
  const [text, setText] = useState("")
  const [on, setOn] = useState(today)
  const blocks = plantReplyBlocks({ archived: access.ctx.archived, r, k, unit, free, text, on, today })
  const save = async () => {
    if (!firestore) return
    const ok = await run("rep", () => recordPlantReply(firestore, access.ctx, projectId, actor, r.seq, { k, unit, free, text, on }), t("plantreq.rep.saved", { no: plantNo(r.seq) }))
    if (ok) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("plantreq.rep.title")}</DialogTitle>
          <DialogDescription dir="auto">
            {t("plantreq.no", { no: plantNo(r.seq) })} — {r.what}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Callout tone="info">{t("plantreq.rep.note")}</Callout>
          <div className="space-y-1.5">
            <Label>{t("plantreq.rep.kind")} *</Label>
            <ChoiceChips label={t("plantreq.rep.kind")} options={PLANT_REPLIES.map((x) => ({ id: x, label: t(`plantreq.st.${x}`) }))} value={k} onChange={setK} />
          </div>
          {k === "alloc" && (
            <div className="space-y-1.5">
              <Label htmlFor="rp-unit">{t("plantreq.rep.unit")} *</Label>
              <Input id="rp-unit" dir="auto" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={t("plantreq.rep.unit_ph")} />
            </div>
          )}
          {k === "late" && (
            <div className="space-y-1.5">
              <Label htmlFor="rp-free">{t("plantreq.rep.free")} *</Label>
              <Input id="rp-free" type="date" dir="ltr" value={free} onChange={(e) => setFree(e.target.value)} />
              <FormHint>{t("plantreq.rep.late_hint")}</FormHint>
            </div>
          )}
          {(k === "alt" || k === "none") && (
            <div className="space-y-1.5">
              <Label htmlFor="rp-text">
                {k === "alt" ? t("plantreq.rep.alt") : t("plantreq.rep.detail")} {k === "alt" && "*"}
              </Label>
              <Input id="rp-text" dir="auto" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="rp-on">{t("plantreq.rep.on")}</Label>
            <Input id="rp-on" type="date" dir="ltr" max={today} value={on} onChange={(e) => setOn(e.target.value)} />
          </div>
          <BlockingReasons title={t("cannot_save")} reasons={k ? blocks.filter((b) => b !== "archived").map((b) => t(`plantreq.block.${b}`)) : []} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            {t("sup.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={blocks.length > 0 || busy !== null}>
            {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {t("plantreq.rep.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReceiveOnSiteDialog({ projectId, orgId, r, access, actor, onClose }: { projectId: string; orgId?: string | null; r: PmPlantRequest; access: PmAccess; actor: SupplyActor; onClose: () => void }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const money = access.has("money")
  const hired = r.rep?.k === "hire"
  const [tag, setTag] = useState(r.rep?.unit ?? "")
  const [name, setName] = useState(r.what)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(r.to >= today ? r.to : today)
  const [supplier, setSupplier] = useState("")
  const [rate, setRate] = useState("")
  const [meter, setMeter] = useState("")
  const [licence, setLicence] = useState("")
  const [herc, setHerc] = useState("")
  const [service, setService] = useState("")
  const [fuel, setFuel] = useState<string>("full")
  const [acc, setAcc] = useState("")
  const [cond, setCond] = useState<PlantCondition>("ok")
  const [remark, setRemark] = useState("")
  const [files, setFiles] = useState<PmAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v))
  const blocks = handoverBlocks({ archived: access.ctx.archived, name, qty: r.qty, from, to, category: r.category, meter: numOrNull(meter), dayRate: numOrNull(rate), licenceTo: licence || null, hercNo: herc, serviceAt: numOrNull(service), condition: cond, remark, today })

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      const seq = await receivePlant(firestore, access.ctx, projectId, actor, {
        tag,
        name,
        category: r.category,
        ownership: hired ? "hire" : "own",
        supplier: hired ? supplier : null,
        qty: r.qty,
        dayRate: money ? numOrNull(rate) : null,
        from,
        to,
        licenceTo: licence || null,
        hercNo: herc,
        serviceAt: numOrNull(service),
        meter: numOrNull(meter),
        fuel,
        accessories: acc,
        condition: cond,
        remark,
        files,
        requestSeq: r.seq,
      })
      toast({ title: t("plantreq.received", { no: plantNo(r.seq), unit: seq }) })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: err instanceof PmAccessError ? t(`refused.${err.code}`) : err instanceof PmPlantError && err.blocks[0] ? t(`plantreq.block.${err.blocks[0]}`) : t("error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("plantreq.receive")}</DialogTitle>
          <DialogDescription dir="auto">
            {t("plantreq.no", { no: plantNo(r.seq) })} — {r.what}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Callout tone="info">{t("plantreq.receive_note")}</Callout>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rv-tag">{t("plantreq.rv.tag")}</Label>
              <Input id="rv-tag" dir="auto" value={tag} onChange={(e) => setTag(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rv-name">{t("plantreq.rv.name")} *</Label>
              <Input id="rv-name" dir="auto" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rv-from">{t("plantreq.rv.from")}</Label>
              <Input id="rv-from" type="date" dir="ltr" max={today} value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rv-to">{t("plantreq.rv.to")}</Label>
              <Input id="rv-to" type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            {hired && (
              <div className="space-y-1.5">
                <Label htmlFor="rv-sup">{t("plantreq.rv.supplier")}</Label>
                <Input id="rv-sup" dir="auto" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
              </div>
            )}
            {money && r.category !== "tool" && (
              <div className="space-y-1.5">
                <Label htmlFor="rv-rate">{t("plantreq.rv.rate")}</Label>
                <Input id="rv-rate" type="number" min={0} dir="ltr" value={rate} onChange={(e) => setRate(e.target.value)} />
              </div>
            )}
            {hasMeter(r.category) && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="rv-meter">{t("plantreq.rv.meter")} *</Label>
                  <Input id="rv-meter" type="number" min={0} dir="ltr" value={meter} onChange={(e) => setMeter(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rv-lic">{t("plantreq.rv.licence")}</Label>
                  <Input id="rv-lic" type="date" dir="ltr" value={licence} onChange={(e) => setLicence(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rv-herc">{t("plant.herc")} *</Label>
                  <Input id="rv-herc" dir="ltr" value={herc} onChange={(e) => setHerc(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rv-svc">{t("plant.service_at")}</Label>
                  <Input id="rv-svc" type="number" min={0} dir="ltr" value={service} onChange={(e) => setService(e.target.value)} />
                </div>
              </>
            )}
          </div>
          {/* The rate is an amount: without `money` it is left unset here, and the unit shows as unrated on site until a money holder sets it. */}
          {!money && r.category !== "tool" && <Callout tone="info">{t("plant.rate_later")}</Callout>}
          <div className="space-y-1.5">
            <Label>{t("plantreq.rv.fuel")}</Label>
            <ChoiceChips label={t("plantreq.rv.fuel")} options={FUEL_LEVELS.map((x) => ({ id: x, label: x === "full" ? t("plantreq.rv.fuel_full") : x }))} value={fuel} onChange={setFuel} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rv-acc">{t("plantreq.rv.accessories")}</Label>
            <Input id="rv-acc" dir="auto" value={acc} onChange={(e) => setAcc(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("plantreq.rv.condition")}</Label>
            <ChoiceChips label={t("plantreq.rv.condition")} options={PLANT_CONDITIONS.map((x) => ({ id: x, label: t(`plantreq.rv.cond.${x}`) }))} value={cond} onChange={setCond} />
          </div>
          {cond !== "ok" && (
            <div className="space-y-1.5">
              <Label htmlFor="rv-rm">{t("plantreq.rv.remark")} *</Label>
              <Input id="rv-rm" dir="auto" value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
          )}
          <PmFilesField orgId={orgId} folder={`projects/${projectId}/plant`} value={files} onChange={setFiles} label={t("plantreq.rv.files")} hint={t("plantreq.rv.files_hint")} />
          <div className="rounded-lg border bg-muted/30 p-3">
            <KeyValueRow label={t("plantreq.rv.qty")} value={String(r.qty)} ltr />
          </div>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.filter((b) => b !== "archived").map((b) => t(`plantreq.block.${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("sup.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={blocks.length > 0 || busy}>
            {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {t("plantreq.receive")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PlantDialog({ projectId, access, actor, acts, onClose }: { projectId: string; access: PmAccess; actor: SupplyActor; acts: PmActivity[]; onClose: () => void }) {
  const t = useTranslations("Portal.PM")
  const { locale } = useLocaleDir()
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const today = todayDay()
  const live = acts.filter((a) => a.to >= addDays(today, -14)).slice(0, 8)
  const [c, setC] = useState<PlantCategory | null>(null)
  const [what, setWhat] = useState("")
  const [act, setAct] = useState<string | null>(null)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(addDays(today, 7))
  const [q, setQ] = useState("1")
  const [op, setOp] = useState(false)
  const [whyK, setWhyK] = useState<PlantWhy | null>(null)
  const [why, setWhy] = useState("")
  const a = live.find((x) => x.id === act) ?? null
  const input = { category: c, what, activityId: act, hasActivities: live.length > 0, from, to, qty: Number(q), whyK, why }
  const blocks = plantBlocks({ archived: access.ctx.archived, ...input })
  const days = from && to && to >= from ? plantDays(from, to) : 0

  const save = async () => {
    if (!firestore || !c || !whyK) return
    let status: "wait" | "go" = "wait"
    let seq = 0
    const done = await run(
      "plant",
      async () => {
        const out = await requestPlant(firestore, access.ctx, projectId, actor, { category: c, what, activityId: act, activityName: a?.name ?? null, hasActivities: live.length > 0, from, to, qty: Number(q), operator: op, whyK, why })
        status = out.status
        seq = out.seq
      },
      () => (status === "go" ? t("plantreq.sent_desk", { no: plantNo(seq) }) : t("plantreq.sent_pm", { no: plantNo(seq) }))
    )
    if (done) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("plantreq.form.title")}</DialogTitle>
          <DialogDescription>{t("plantreq.form.desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("plantreq.form.category")} *</Label>
            <ChoiceChips label={t("plantreq.form.category")} options={PLANT_CATEGORIES.map((k) => ({ id: k, label: t(`plantreq.cat.${k}`) }))} value={c} onChange={setC} />
            <FormHint>{c ? t(`plantreq.cat_hint.${c}`) : t("plantreq.form.pick_cat")}</FormHint>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-what">{t("plantreq.form.what")} *</Label>
            <Input id="pl-what" dir="auto" placeholder={t("plantreq.form.what_ph")} value={what} onChange={(e) => setWhat(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>
              {t("plantreq.form.activity")} {live.length > 0 && "*"}
            </Label>
            {live.length ? (
              <>
                <ChoiceChips
                  label={t("plantreq.form.activity")}
                  options={live.map((x) => ({ id: x.id, label: x.name }))}
                  value={act}
                  onChange={(id) => {
                    setAct(id)
                    const x = live.find((y) => y.id === id)
                    if (x) {
                      setFrom(x.from > today ? x.from : today)
                      setTo(x.to)
                    }
                  }}
                />
                <FormHint>{t("plantreq.form.activity_hint")}</FormHint>
              </>
            ) : (
              <Callout tone="info">{t("plantreq.form.no_programme")}</Callout>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pl-from">{t("plantreq.form.from")}</Label>
              <Input id="pl-from" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
              {a && <FormHint>{t("plantreq.form.act_starts", { date: pmDate(a.from, locale) })}</FormHint>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-to">{t("plantreq.form.to")}</Label>
              <Input id="pl-to" type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
              {a && <FormHint>{t("plantreq.form.act_ends", { date: pmDate(a.to, locale) })}</FormHint>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-q">{t("plantreq.form.qty")}</Label>
              <Input id="pl-q" type="number" min={1} step={1} dir="ltr" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {c && plantHasOperator(c) && (
              <div className="space-y-1.5">
                <Label>{t("plantreq.form.operator")}</Label>
                <ChoiceChips label={t("plantreq.form.operator")} options={[{ id: "1", label: t("plantreq.with_op") }, { id: "0", label: t("plantreq.form.bare") }]} value={op ? "1" : "0"} onChange={(v) => setOp(v === "1")} />
              </div>
            )}
          </div>
          {c && plantHasOperator(c) && <FormHint>{t("plantreq.form.op_hint")}</FormHint>}
          <div className="space-y-1.5">
            <Label>{t("plantreq.form.why")} *</Label>
            <ChoiceChips label={t("plantreq.form.why")} options={PLANT_WHY.map((k) => ({ id: k, label: t(`plantreq.why.${k}`) }))} value={whyK} onChange={setWhyK} />
            <FormHint>{t("plantreq.form.why_hint")}</FormHint>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-why">
              {whyK === "oth" ? t("plantreq.form.state_it") : t("plantreq.form.detail")} {whyK === "oth" ? "*" : <span className="text-xs text-muted-foreground">{t("sup.form.optional")}</span>}
            </Label>
            <Input id="pl-why" dir="auto" placeholder={t("plantreq.form.detail_ph")} value={why} onChange={(e) => setWhy(e.target.value)} />
            <FormHint>{whyK === "oth" ? t("plantreq.form.oth_hint") : t("plantreq.form.detail_hint")}</FormHint>
          </div>
          {days > 0 && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <KeyValueRow label={t("plantreq.form.period")} value={t("plantreq.days", { count: days })} />
              <KeyValueRow label={t("plantreq.form.charged")} value={<span className="text-xs">{t("plantreq.form.charged_body")}</span>} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            {t("sup.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={blocks.length > 0 || busy !== null}>
            {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {t("plantreq.form.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
