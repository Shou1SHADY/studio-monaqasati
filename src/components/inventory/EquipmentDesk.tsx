"use client"

// Warehouses → the equipment desk. The approved equipment requests of every open
// project of the company, waiting for the store keeper's answer: allocate a unit
// of the fleet, busy until a date, an alternative, or not in the fleet. An
// allocated or hired unit is then received on site; busy or none is the hire
// trigger on the project. Until this desk existed the site typed the answer
// itself.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Clock, Loader2, Lock, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { ChoiceChips, FormHint } from "@/components/pm/ContractBits"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useOrgPlantRequests } from "@/hooks/useOrgPlantRequests"
import { usePermissions } from "@/hooks/usePermissions"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { pmDate, todayDay } from "@/lib/pm/format"
import { deskAnswered, deskQueue, deskReplyBlocks, deskSummary, deskUrgency, type DeskRequest, type DeskUrgency } from "@/lib/pm/plant-desk"
import { PlantDeskError, answerPlantRequest } from "@/lib/pm/plant-desk-writes"
import { PLANT_REPLIES, plantDays, plantNo, type PlantReplyKind } from "@/lib/pm/supply"
import { cn } from "@/lib/utils"

const URGENCY_TONE: Record<DeskUrgency, PillTone> = { late: "bad", soon: "warn", later: "mute" }
const REPLY_TONE: Record<string, string> = { alloc: "text-success", alt: "text-warning", late: "text-warning", none: "text-destructive", hire: "text-cta" }

export function EquipmentDesk() {
  const t = useTranslations("Portal.EquipmentDesk")
  const tp = useTranslations("Portal.PM")
  const locale = useLocale()
  const { user } = useUser()
  const { profile, organizationId } = useResolvedProfile(user?.uid)
  const { can, isLoading: permsLoading } = usePermissions()
  const { loading, rows } = useOrgPlantRequests(organizationId || null)
  const [answering, setAnswering] = useState<DeskRequest | null>(null)
  const today = todayDay()

  const queue = useMemo(() => deskQueue(rows), [rows])
  const answered = useMemo(() => deskAnswered(rows), [rows])
  const summary = useMemo(() => deskSummary(rows, today), [rows, today])
  const actorName = ((profile as { name?: string } | null)?.name || user?.displayName || user?.email || "") as string

  if (permsLoading) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={28} aria-hidden="true" />
      </div>
    )
  }
  if (!can("warehouses.manage")) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Lock size={24} aria-hidden="true" />
        </div>
        <h1 className="text-xl font-black">{t("no_access_title")}</h1>
        <p className="text-sm text-muted-foreground">{t("no_access_desc")}</p>
      </div>
    )
  }

  const replyLine = (r: DeskRequest) => {
    const rp = r.rep
    if (!rp) return ""
    if (rp.k === "alloc") return tp("plantreq.rep.alloc_line", { unit: rp.unit ?? "" })
    if (rp.k === "late") return tp("plantreq.rep.late_line", { date: rp.free ? pmDate(rp.free, locale) : "—" })
    if (rp.k === "alt") return tp("plantreq.rep.alt_line", { text: rp.text ?? "" })
    if (rp.k === "none") return tp("plantreq.rep.none_line")
    return tp("plantreq.rep.hire_line")
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-6">
      <header className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
          <Wrench size={20} aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-black text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("desc")}</p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Kpi label={t("kpi_waiting")} value={summary.waiting} />
        <Kpi label={t("kpi_soon")} value={summary.soon} tone={summary.soon > 0 ? "warn" : undefined} />
        <Kpi label={t("kpi_late")} value={summary.late} tone={summary.late > 0 ? "bad" : undefined} />
      </div>

      <Panel title={t("waiting_title")} bodyClassName="p-0">
        {loading ? (
          <div className="flex justify-center p-10">
            <Loader2 className="animate-spin text-primary" size={24} aria-hidden="true" />
          </div>
        ) : queue.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("waiting_empty")}</p>
        ) : (
          <div className="divide-y">
            {queue.map((r) => {
              const urgency = deskUrgency(r, today)
              return (
                <div key={`${r.projectId}-${r.id}`} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <b className="text-sm" dir="auto">
                      {tp("plantreq.no", { no: plantNo(r.seq) })} — {r.what}
                    </b>
                    <p className="text-xs text-muted-foreground" dir="auto">
                      {r.projectName}
                      {r.projectNo ? ` · ${r.projectNo}` : ""} · {tp(`plantreq.cat.${r.category}`)}
                      {r.qty > 1 ? ` × ${r.qty}` : ""} · {tp("plantreq.range", { from: pmDate(r.from, locale), to: pmDate(r.to, locale) })} · {tp("plantreq.days", { n: plantDays(r.from, r.to) })}
                      {r.operator ? ` · ${tp("plantreq.with_op")}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground" dir="auto">
                      {t("requested_by", { name: r.byName || "—" })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusPill tone={URGENCY_TONE[urgency]}>
                      <Clock size={11} aria-hidden="true" />
                      {t(`urgency_${urgency}`)}
                    </StatusPill>
                    <Button size="sm" onClick={() => setAnswering(r)}>
                      {t("answer")}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <Panel title={t("answered_title")} bodyClassName="p-0">
        {answered.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("answered_empty")}</p>
        ) : (
          <div className="divide-y">
            {answered.map((r) => (
              <div key={`${r.projectId}-${r.id}`} className="px-4 py-3">
                <b className="text-sm" dir="auto">
                  {tp("plantreq.no", { no: plantNo(r.seq) })} — {r.what}
                </b>
                <p className="text-xs text-muted-foreground" dir="auto">
                  {r.projectName} · {tp(`plantreq.cat.${r.category}`)}
                  {r.qty > 1 ? ` × ${r.qty}` : ""}
                </p>
                <p className={cn("mt-1 text-xs font-bold", REPLY_TONE[r.rep?.k ?? ""])} dir="auto">
                  {replyLine(r)}
                  {r.rep?.byName ? <span className="font-normal text-muted-foreground"> · {tp("plantreq.rep.recorded_by", { name: r.rep.byName })}</span> : null}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {answering && <AnswerDialog request={answering} actor={{ uid: user?.uid ?? "", name: actorName }} onClose={() => setAnswering(null)} />}
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "warn" | "bad" }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-black tabular-nums", tone === "bad" && "text-destructive", tone === "warn" && "text-warning")} dir="ltr">
        {value}
      </p>
    </div>
  )
}

function AnswerDialog({ request, actor, onClose }: { request: DeskRequest; actor: { uid: string; name: string }; onClose: () => void }) {
  const t = useTranslations("Portal.EquipmentDesk")
  const tp = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [k, setK] = useState<PlantReplyKind | null>(null)
  const [unit, setUnit] = useState("")
  const [free, setFree] = useState("")
  const [text, setText] = useState("")
  const [on, setOn] = useState(today)
  const [busy, setBusy] = useState(false)
  const blocks = deskReplyBlocks({ projectClosed: false, r: request, k, unit, free, text, on, today })

  const save = async () => {
    if (!firestore || !actor.uid) return
    setBusy(true)
    try {
      await answerPlantRequest(firestore, actor, request.projectId, request.seq, { k, unit, free, text, on })
      toast({ title: t("saved", { no: plantNo(request.seq) }) })
      onClose()
    } catch (err) {
      console.error(err)
      const blocked = err instanceof PlantDeskError && err.code === "blocked" ? err.blocks[0] : null
      toast({ title: blocked ? tp(`plantreq.block.${blocked}`) : t("save_failed"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("answer_title")}</DialogTitle>
          <DialogDescription dir="auto">
            {tp("plantreq.no", { no: plantNo(request.seq) })} — {request.what} · {request.projectName}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Callout tone="info">{t("answer_note")}</Callout>
          <div className="space-y-1.5">
            <Label>{tp("plantreq.rep.kind")} *</Label>
            <ChoiceChips label={tp("plantreq.rep.kind")} options={PLANT_REPLIES.map((x) => ({ id: x, label: tp(`plantreq.st.${x}`) }))} value={k} onChange={setK} />
          </div>
          {k === "alloc" && (
            <div className="space-y-1.5">
              <Label htmlFor="desk-unit">{tp("plantreq.rep.unit")} *</Label>
              <Input id="desk-unit" dir="auto" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={tp("plantreq.rep.unit_ph")} />
            </div>
          )}
          {k === "late" && (
            <div className="space-y-1.5">
              <Label htmlFor="desk-free">{tp("plantreq.rep.free")} *</Label>
              <Input id="desk-free" type="date" dir="ltr" value={free} onChange={(e) => setFree(e.target.value)} />
              <FormHint>{tp("plantreq.rep.late_hint")}</FormHint>
            </div>
          )}
          {(k === "alt" || k === "none") && (
            <div className="space-y-1.5">
              <Label htmlFor="desk-text">
                {k === "alt" ? tp("plantreq.rep.alt") : tp("plantreq.rep.detail")} {k === "alt" && "*"}
              </Label>
              <Input id="desk-text" dir="auto" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="desk-on">{tp("plantreq.rep.on")}</Label>
            <Input id="desk-on" type="date" dir="ltr" max={today} value={on} onChange={(e) => setOn(e.target.value)} />
          </div>
          <BlockingReasons title={tp("cannot_save")} reasons={k ? blocks.filter((b) => b !== "archived").map((b) => tp(`plantreq.block.${b}`)) : []} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={blocks.length > 0 || busy}>
            {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {tp("plantreq.rep.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
