"use client"

// Equipment requests on a PM 1.0 project (prototype eqReqPanel · formEQR): the
// engineer says what plant is needed, for which activity and when — never where
// it comes from. The project manager approves; the approved request is the plant
// desk's to answer (fleet, transfer or hire). There is no plant desk module yet,
// so an approved request shows as waiting on it.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Check, Loader2, Plus, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { pmDate, todayDay } from "@/lib/pm/format"
import { addDays, PM_ACTIVITIES, type PmActivity } from "@/lib/pm/programme"
import { PLANT_CATEGORIES, PLANT_WHY, plantBlocks, plantDays, plantHasOperator, plantNo, PM_PLANT, type PlantCategory, type PlantWhy, type PmPlantRequest } from "@/lib/pm/supply"
import { decidePlant, requestPlant, type SupplyActor } from "@/lib/pm/supply-writes"
import { ChoiceChips, FormHint } from "./ContractBits"
import { useLocaleDir, useSupplyRun } from "./SupplyDialogs"

export function PlantRequestsPanel({ projectId, access, actor }: { projectId: string; access: PmAccess; actor: SupplyActor }) {
  const t = useTranslations("Portal.PM")
  const { locale } = useLocaleDir()
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const [open, setOpen] = useState(false)
  const pq = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_PLANT) : null), [firestore, projectId])
  const aq = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_ACTIVITIES) : null), [firestore, projectId])
  const { data } = useCollection(pq)
  const { data: aData } = useCollection(aq)
  const list = useMemo(() => ((data ?? []) as unknown as PmPlantRequest[]).slice().sort((a, b) => b.seq - a.seq), [data])
  const acts = useMemo(() => ((aData ?? []) as unknown as PmActivity[]).slice().sort((a, b) => a.from.localeCompare(b.from)), [aData])
  const canReq = !access.ctx.archived && access.allowed("plant.request")
  const canOk = !access.ctx.archived && access.allowed("request.decide")
  const waiting = list.filter((r) => r.status === "wait").length

  return (
    <>
      <Panel
        title={t("plant.title")}
        icon={Truck}
        actions={
          <>
            {waiting > 0 && <StatusPill tone="warn">{t("plant.awaiting_you", { count: waiting })}</StatusPill>}
            {canReq && (
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus size={15} className="me-1.5" aria-hidden="true" />
                {t("plant.new")}
              </Button>
            )}
          </>
        }
        bodyClassName="p-0"
      >
        <p className="px-4 pt-3 text-xs text-muted-foreground">{t("plant.sub")}</p>
        {list.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("plant.empty")}</p>
        ) : (
          <div className="divide-y">
            {list.map((r) => (
              <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <b className="text-sm" dir="auto">
                    {t("plant.no", { no: plantNo(r.seq) })} — {r.what}
                  </b>
                  <p className="text-xs text-muted-foreground">
                    {t(`plant.cat.${r.category}`)}
                    {r.qty > 1 ? ` × ${r.qty}` : ""} · {r.activityName || t("plant.no_activity")} · {t("plant.range", { from: pmDate(r.from, locale), to: pmDate(r.to, locale) })} · {t("plant.days", { count: plantDays(r.from, r.to) })}
                    {r.operator ? ` · ${t("plant.with_op")}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground" dir="auto">
                    {t(`plant.why.${r.whyK}`)}
                    {r.why ? ` — ${r.why}` : ""}
                  </p>
                  {r.status === "go" && <p className="mt-1 text-xs">{t("plant.with_desk")}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <StatusPill tone={r.status === "wait" ? "warn" : r.status === "rej" ? "bad" : "info"}>{t(`plant.st.${r.status}`)}</StatusPill>
                  {r.status === "wait" && canOk && (
                    <div className="flex gap-1">
                      <Button size="sm" className="h-7 bg-success text-success-foreground hover:bg-success/90" disabled={busy !== null} onClick={() => firestore && void run(`ok${r.seq}`, () => decidePlant(firestore, access.ctx, projectId, actor, r.seq, true), t("plant.approved", { no: plantNo(r.seq) }))}>
                        <Check size={13} className="me-1" aria-hidden="true" />
                        {t("sup.approve")}
                      </Button>
                      <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={() => firestore && void run(`no${r.seq}`, () => decidePlant(firestore, access.ctx, projectId, actor, r.seq, false), t("plant.rejected", { no: plantNo(r.seq) }))}>
                        {t("sup.reject")}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="p-3">
          <Callout tone="info">{t("plant.trigger")}</Callout>
        </div>
      </Panel>
      {open && <PlantDialog projectId={projectId} access={access} actor={actor} acts={acts} onClose={() => setOpen(false)} />}
    </>
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
      () => (status === "go" ? t("plant.sent_desk", { no: plantNo(seq) }) : t("plant.sent_pm", { no: plantNo(seq) }))
    )
    if (done) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("plant.form.title")}</DialogTitle>
          <DialogDescription>{t("plant.form.desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("plant.form.category")} *</Label>
            <ChoiceChips label={t("plant.form.category")} options={PLANT_CATEGORIES.map((k) => ({ id: k, label: t(`plant.cat.${k}`) }))} value={c} onChange={setC} />
            <FormHint>{c ? t(`plant.cat_hint.${c}`) : t("plant.form.pick_cat")}</FormHint>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-what">{t("plant.form.what")} *</Label>
            <Input id="pl-what" dir="auto" placeholder={t("plant.form.what_ph")} value={what} onChange={(e) => setWhat(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>
              {t("plant.form.activity")} {live.length > 0 && "*"}
            </Label>
            {live.length ? (
              <>
                <ChoiceChips
                  label={t("plant.form.activity")}
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
                <FormHint>{t("plant.form.activity_hint")}</FormHint>
              </>
            ) : (
              <Callout tone="info">{t("plant.form.no_programme")}</Callout>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pl-from">{t("plant.form.from")}</Label>
              <Input id="pl-from" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
              {a && <FormHint>{t("plant.form.act_starts", { date: pmDate(a.from, locale) })}</FormHint>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-to">{t("plant.form.to")}</Label>
              <Input id="pl-to" type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
              {a && <FormHint>{t("plant.form.act_ends", { date: pmDate(a.to, locale) })}</FormHint>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-q">{t("plant.form.qty")}</Label>
              <Input id="pl-q" type="number" min={1} step={1} dir="ltr" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {c && plantHasOperator(c) && (
              <div className="space-y-1.5">
                <Label>{t("plant.form.operator")}</Label>
                <ChoiceChips label={t("plant.form.operator")} options={[{ id: "1", label: t("plant.with_op") }, { id: "0", label: t("plant.form.bare") }]} value={op ? "1" : "0"} onChange={(v) => setOp(v === "1")} />
              </div>
            )}
          </div>
          {c && plantHasOperator(c) && <FormHint>{t("plant.form.op_hint")}</FormHint>}
          <div className="space-y-1.5">
            <Label>{t("plant.form.why")} *</Label>
            <ChoiceChips label={t("plant.form.why")} options={PLANT_WHY.map((k) => ({ id: k, label: t(`plant.why.${k}`) }))} value={whyK} onChange={setWhyK} />
            <FormHint>{t("plant.form.why_hint")}</FormHint>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-why">
              {whyK === "oth" ? t("plant.form.state_it") : t("plant.form.detail")} {whyK === "oth" ? "*" : <span className="text-xs text-muted-foreground">{t("sup.form.optional")}</span>}
            </Label>
            <Input id="pl-why" dir="auto" placeholder={t("plant.form.detail_ph")} value={why} onChange={(e) => setWhy(e.target.value)} />
            <FormHint>{whyK === "oth" ? t("plant.form.oth_hint") : t("plant.form.detail_hint")}</FormHint>
          </div>
          {days > 0 && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <KeyValueRow label={t("plant.form.period")} value={t("plant.days", { count: days })} />
              <KeyValueRow label={t("plant.form.charged")} value={<span className="text-xs">{t("plant.form.charged_body")}</span>} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            {t("sup.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={blocks.length > 0 || busy !== null}>
            {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {t("plant.form.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
