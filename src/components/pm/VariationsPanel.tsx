"use client"

// Contract › Variations on a PM 1.0 project (WF-06, VO-01…03, CON-06). Logged
// the day it is asked with its source; priced; submitted to the client; the
// written approval (or the rejection and its reason) recorded. Only an approved
// variation enters the contract value; work before approval is flagged.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Check, Hammer, Loader2, Plus, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { pmDate, pmMoney } from "@/lib/pm/format"
import { approvedValue, logBlocks, VO_SOURCES, VO_STATUSES, voNo, workBeforeApproval, type PmVariation, type VoSource, type VoStatus } from "@/lib/pm/variation"
import { approveVariation, logVariation, PmVariationError, priceVariation, recordVariationProgress, rejectVariation, submitVariation, type VoActor } from "@/lib/pm/variation-writes"

const TONE: Record<VoStatus, PillTone> = { draft: "mute", wait: "warn", appr: "ok", rej: "bad" }

type Edit = { vo: PmVariation; value: string; cost: string; pct: string; instructionNo: string }
type Decide = { vo: PmVariation; approve: boolean; text: string }

export function VariationsPanel({ projectId, baseValue, access, actor }: { projectId: string; baseValue: number; access: PmAccess; actor: VoActor }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [logging, setLogging] = useState(false)
  const [title, setTitle] = useState("")
  const [source, setSource] = useState<VoSource>("client")
  const [sourceText, setSourceText] = useState("")
  const [instructionNo, setInstructionNo] = useState("")
  const [value, setValue] = useState("")
  const [cost, setCost] = useState("")
  const [pct, setPct] = useState("0")
  const [edit, setEdit] = useState<Edit | null>(null)
  const [decide, setDecide] = useState<Decide | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, "pmVariations") : null), [firestore, projectId])
  const { data } = useCollection(q)
  const vos = useMemo(() => ((data ?? []) as unknown as PmVariation[]).slice().sort((a, b) => b.seq - a.seq), [data])
  const money = access.has("money")
  const canLog = !access.ctx.archived && access.allowed("variation.log")
  const canDecide = !access.ctx.archived && access.allowed("variation.decide")
  const approved = approvedValue(vos)
  const risky = workBeforeApproval(vos)
  const num = (s: string) => (s.trim() === "" ? 0 : Number(s))
  const blocks = logBlocks({ archived: access.ctx.archived, title, source, sourceText, value: num(value), cost: num(cost), executedPct: num(pct) / 100 })
  const sourceName = (v: PmVariation) => (v.source === "oth" ? t("amend.other_stated", { text: v.sourceText ?? "" }) : t(`vo.source.${v.source}`))

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    if (!firestore) return false
    setBusy(key)
    try {
      await fn()
      toast({ title: ok })
      return true
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmVariationError && err.blocks[0] ? `vo.block.${err.blocks[0]}` : "error.save"), variant: "destructive" })
      return false
    } finally {
      setBusy(null)
    }
  }

  const log = async () => {
    if (!firestore || blocks.length) return
    const ok = await run("log", () => logVariation(firestore, access.ctx, projectId, actor, { title, source, sourceText, instructionNo, value: num(value), cost: num(cost), executedPct: num(pct) / 100 }), t("vo.logged"))
    if (ok) {
      setLogging(false)
      setTitle("")
      setSourceText("")
      setInstructionNo("")
      setValue("")
      setCost("")
      setPct("0")
    }
  }

  return (
    <Panel
      title={t("vo.title")}
      icon={Hammer}
      count={vos.filter((v) => v.status === "wait").length || undefined}
      actions={
        canLog ? (
          <Button size="sm" onClick={() => setLogging(true)}>
            <Plus size={15} className="me-1.5" aria-hidden="true" />
            {t("vo.new")}
          </Button>
        ) : null
      }
    >
      {money && (
        <div className="mb-4 grid gap-x-6 sm:grid-cols-3">
          <KeyValueRow label={t("vo.base_value")} value={pmMoney(baseValue)} ltr />
          <KeyValueRow label={t("vo.approved_value")} value={pmMoney(approved)} ltr />
          <KeyValueRow label={t("vo.live_value")} value={pmMoney(baseValue + approved)} ltr strong />
        </div>
      )}
      {risky.length > 0 && <Callout tone="warn" className="mb-4">{t("vo.work_before_approval", { count: risky.length })}</Callout>}
      {vos.length === 0 ? (
        <EmptyState icon={Hammer} title={t("vo.empty")} description={t("vo.empty_desc")} />
      ) : (
        <ul className="space-y-2">
          {vos.map((v) => {
            const known = (VO_STATUSES as readonly string[]).includes(v.status)
            return (
              <li key={v.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      <span dir="auto">
                        {t("vo.no", { no: voNo(v.seq) })} — {v.title}
                      </span>
                      <StatusPill tone={known ? TONE[v.status] : "bad"}>{known ? t(`vo.status.${v.status}`) : t("unknown_state")}</StatusPill>
                      {!v.instructionNo && <StatusPill tone="warn">{t("vo.no_instruction")}</StatusPill>}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                      {t("vo.line", { source: sourceName(v), date: pmDate(v.day, locale), pct: Math.round(v.executedPct * 100) })}
                      {v.instructionNo ? ` · ${t("vo.instruction", { no: v.instructionNo })}` : ""}
                    </p>
                    {money && (
                      <p className="mt-0.5 text-xs tabular-nums" dir="auto">
                        {t("vo.money", { value: pmMoney(v.value), cost: pmMoney(v.cost) })}
                      </p>
                    )}
                    {v.decision && (
                      <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                        {v.status === "rej"
                          ? t("vo.rejected_line", { date: pmDate(v.decision.on, locale), who: v.decision.byName || "—", reason: v.decision.reason || "" })
                          : t("vo.approved_line", { date: pmDate(v.decision.on, locale), who: v.decision.byName || "—", ref: v.decision.ref || "—" })}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canLog && v.status !== "rej" && (
                      <Button size="sm" variant="outline" onClick={() => setEdit({ vo: v, value: String(v.value), cost: String(v.cost), pct: String(Math.round(v.executedPct * 100)), instructionNo: v.instructionNo ?? "" })}>
                        {t("vo.update")}
                      </Button>
                    )}
                    {canLog && v.status === "draft" && (
                      <Button size="sm" disabled={busy !== null || !(v.value > 0)} onClick={() => firestore && void run(`s${v.seq}`, () => submitVariation(firestore, access.ctx, projectId, v.seq), t("vo.submitted"))}>
                        <Send size={14} className="me-1.5" aria-hidden="true" />
                        {t("vo.submit")}
                      </Button>
                    )}
                    {canDecide && v.status === "wait" && (
                      <>
                        <Button size="sm" onClick={() => setDecide({ vo: v, approve: true, text: "" })}>
                          <Check size={14} className="me-1.5" aria-hidden="true" />
                          {t("vo.approve")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setDecide({ vo: v, approve: false, text: "" })}>
                          <X size={14} className="me-1.5" aria-hidden="true" />
                          {t("vo.reject")}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={logging} onOpenChange={setLogging}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("vo.new")}</DialogTitle>
            <DialogDescription>{t("vo.new_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Callout tone="info">{t("vo.three_way")}</Callout>
            <div className="space-y-1.5">
              <Label htmlFor="vo-title">{t("vo.what")}</Label>
              <Input id="vo-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy !== null} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="vo-src">{t("vo.source_label")}</Label>
                <Select value={source} onValueChange={(v) => setSource(v as VoSource)} disabled={busy !== null}>
                  <SelectTrigger id="vo-src">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VO_SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`vo.source.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vo-ins">{t("vo.instruction_label")}</Label>
                <Input id="vo-ins" dir="ltr" value={instructionNo} onChange={(e) => setInstructionNo(e.target.value)} disabled={busy !== null} />
              </div>
            </div>
            {source === "oth" && (
              <div className="space-y-1.5">
                <Label htmlFor="vo-src-text">{t("vo.source_text")}</Label>
                <Input id="vo-src-text" value={sourceText} onChange={(e) => setSourceText(e.target.value)} disabled={busy !== null} />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="vo-val">{t("vo.value")}</Label>
                <Input id="vo-val" dir="ltr" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy !== null} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vo-cost">{t("vo.cost")}</Label>
                <Input id="vo-cost" dir="ltr" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} disabled={busy !== null} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vo-pct">{t("vo.pct")}</Label>
                <Input id="vo-pct" dir="ltr" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} disabled={busy !== null} />
              </div>
            </div>
            <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`vo.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogging(false)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void log()} disabled={busy !== null || blocks.length > 0}>
              {busy === "log" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("vo.log")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("vo.update")}</DialogTitle>
            <DialogDescription>{t("vo.update_desc")}</DialogDescription>
          </DialogHeader>
          {edit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ve-val">{t("vo.value")}</Label>
                <Input id="ve-val" dir="ltr" inputMode="decimal" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} disabled={busy !== null || edit.vo.status !== "draft"} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ve-cost">{t("vo.cost")}</Label>
                <Input id="ve-cost" dir="ltr" inputMode="decimal" value={edit.cost} onChange={(e) => setEdit({ ...edit, cost: e.target.value })} disabled={busy !== null || edit.vo.status !== "draft"} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ve-pct">{t("vo.pct")}</Label>
                <Input id="ve-pct" dir="ltr" inputMode="decimal" value={edit.pct} onChange={(e) => setEdit({ ...edit, pct: e.target.value })} disabled={busy !== null} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ve-ins">{t("vo.instruction_label")}</Label>
                <Input id="ve-ins" dir="ltr" value={edit.instructionNo} onChange={(e) => setEdit({ ...edit, instructionNo: e.target.value })} disabled={busy !== null} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy !== null}
              onClick={async () => {
                if (!firestore || !edit) return
                const ok = await run(
                  "edit",
                  async () => {
                    if (edit.vo.status === "draft" && (num(edit.value) !== edit.vo.value || num(edit.cost) !== edit.vo.cost)) {
                      await priceVariation(firestore, access.ctx, projectId, edit.vo.seq, { value: num(edit.value), cost: num(edit.cost), instructionNo: edit.instructionNo })
                    }
                    await recordVariationProgress(firestore, access.ctx, projectId, edit.vo.seq, num(edit.pct) / 100, edit.instructionNo)
                  },
                  t("vo.saved")
                )
                if (ok) setEdit(null)
              }}
            >
              {busy === "edit" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("vo.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={decide !== null} onOpenChange={(o) => !o && setDecide(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{decide?.approve ? t("vo.approve") : t("vo.reject")}</DialogTitle>
            <DialogDescription>{decide?.approve ? t("vo.approve_desc") : t("vo.reject_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="vo-dec">{decide?.approve ? t("vo.approval_ref") : t("vo.reason")}</Label>
            <Textarea id="vo-dec" value={decide?.text ?? ""} onChange={(e) => decide && setDecide({ ...decide, text: e.target.value })} disabled={busy !== null} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecide(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              variant={decide?.approve ? "default" : "destructive"}
              disabled={busy !== null || (!decide?.approve && !decide?.text.trim())}
              onClick={async () => {
                if (!firestore || !decide) return
                const ok = await run(
                  "dec",
                  () => (decide.approve ? approveVariation(firestore, access.ctx, projectId, actor, decide.vo.seq, decide.text) : rejectVariation(firestore, access.ctx, projectId, actor, decide.vo.seq, decide.text)),
                  decide.approve ? t("vo.approved", { no: voNo(decide.vo.seq) }) : t("vo.rejected", { no: voNo(decide.vo.seq) })
                )
                if (ok) setDecide(null)
              }}
            >
              {busy === "dec" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {decide?.approve ? t("vo.approve") : t("vo.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
