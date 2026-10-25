"use client"

// Contract › Variations on a PM 1.0 project (WF-06, VO-01…03, CON-06). Logged
// the day it was asked — with who asked (whom it is claimed from), the
// instruction, the lines it touches and its time impact; priced; submitted;
// the written approval or the rejection recorded as it arrived, dated, with its
// paper. Only an approved variation enters the contract value; what is executed
// before that is money at risk, shown every day.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { ArrowLeftRight, Check, CircleDollarSign, Loader2, Paperclip, Plus, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { MfgFileField, type UploadedFile } from "@/components/manufacturing/MfgFileField"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useTableLabels } from "@/hooks/useTableLabels"
import { PmAccessError } from "@/lib/pm/access"
import { pmDate, pmMoney, pmPct, todayDay } from "@/lib/pm/format"
import {
  approvedValue,
  decisionDateBlocks,
  logBlocks,
  stepBlocks,
  valueAtRisk,
  VO_SOURCES,
  VO_STATUSES,
  voAtRisk,
  voMarginPct,
  voNo,
  workBeforeApproval,
  type PmVariation,
  type VoSource,
  type VoStatus,
} from "@/lib/pm/variation"
import { approveVariation, logVariation, PmVariationError, priceVariation, recordVariationProgress, rejectVariation, setVariationInstruction, submitVariation, type VoActor } from "@/lib/pm/variation-writes"
import { PURCHASE_REQUESTS, requestOf } from "@/lib/pm/supply"
import { cn } from "@/lib/utils"
import { CheckLine, ChoiceChips, FileLinks, FormHint } from "./ContractBits"

const TONE: Record<VoStatus, PillTone> = { draft: "mute", wait: "warn", appr: "ok", rej: "bad" }

type Item = { id: string; code: string; description: string }
type Price = { vo: PmVariation; value: string; cost: string; days: string; file: UploadedFile | null }
type Progress = { vo: PmVariation; pct: string; instructionNo: string; note: string }
type Decide = { vo: PmVariation; approve: boolean; text: string; on: string; file: UploadedFile | null }

const num = (s: string) => (s.trim() === "" ? 0 : Number(s))
const oneFile = (f: UploadedFile | null) => (f ? [f] : [])

export function VariationsPanel({
  projectId,
  orgId = "",
  baseValue,
  items = [],
  access,
  actor,
}: {
  projectId: string
  /** The org the attachments are stored under (no upload without it). */
  orgId?: string
  baseValue: number
  items?: Item[]
  access: PmAccess
  actor: VoActor
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const labels = useTableLabels()
  const today = todayDay()
  const [logging, setLogging] = useState(false)
  const [title, setTitle] = useState("")
  const [source, setSource] = useState<VoSource>("client")
  const [sourceText, setSourceText] = useState("")
  const [instructionNo, setInstructionNo] = useState("")
  const [requestedOn, setRequestedOn] = useState(today)
  const [itemIds, setItemIds] = useState<string[]>([])
  const [value, setValue] = useState("")
  const [cost, setCost] = useState("")
  const [days, setDays] = useState("")
  const [file, setFile] = useState<UploadedFile | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [price, setPrice] = useState<Price | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [decide, setDecide] = useState<Decide | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, "pmVariations") : null), [firestore, projectId])
  const { data } = useCollection(q)
  const vos = useMemo(() => ((data ?? []) as unknown as PmVariation[]).slice().sort((a, b) => b.seq - a.seq), [data])
  const open = vos.find((v) => v.id === openId) ?? null
  const rejecting = decide !== null && !decide.approve
  const reqQ = useMemoFirebase(() => (firestore && rejecting ? collection(firestore, "projects", projectId, PURCHASE_REQUESTS) : null), [firestore, projectId, rejecting])
  const { data: reqData } = useCollection(reqQ)
  // Material lines put "on the client" under this variation: its rejection hands each back to the manager.
  const linkedBack = useMemo(
    () =>
      decide && !decide.approve
        ? ((reqData ?? []) as Array<Record<string, unknown> & { id: string }>).map(requestOf).reduce((a, r) => a + r.lines.filter((l) => l.chg?.st === "own" && l.chg.voSeq === decide.vo.seq).length, 0)
        : 0,
    [reqData, decide]
  )
  const money = access.has("money")
  const canLog = !access.ctx.archived && access.allowed("variation.log")
  const canDecide = !access.ctx.archived && access.allowed("variation.decide")
  // VO-03 (1.1 `vopc`): the executed share is approve's to record — never down, logged.
  const canProgress = !access.ctx.archived && access.allowed("variation.progress")
  const pctChanged = (p: Progress) => Math.abs(num(p.pct) / 100 - p.vo.executedPct) > 0.00001
  const progressBlocks = (p: Progress) =>
    stepBlocks({ archived: access.ctx.archived, status: p.vo.status, step: "progress", executedPct: num(p.pct) / 100, billedPct: p.vo.billedPct, currentPct: p.vo.executedPct })
  const approved = approvedValue(vos)
  const risk = valueAtRisk(vos)
  const risky = workBeforeApproval(vos)
  const codeOf = useMemo(() => new Map(items.map((i) => [i.id, i.code])), [items])
  const blocks = logBlocks({ archived: access.ctx.archived, title, source, sourceText, value: num(value), cost: num(cost), executedPct: 0, requestedOn, days: num(days), today })
  const sourceName = (v: Pick<PmVariation, "source" | "sourceText">) => (v.source === "oth" && v.sourceText ? t("amend.other_stated", { text: v.sourceText }) : t(`vo.source.${v.source}`))
  const codes = (v: PmVariation) => (v.itemIds ?? []).map((id) => codeOf.get(id) || "").filter(Boolean)
  const allFiles = (v: PmVariation) => [...(v.files ?? []), ...(v.decision?.files ?? [])]

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

  const reset = () => {
    setTitle("")
    setSource("client")
    setSourceText("")
    setInstructionNo("")
    setRequestedOn(today)
    setItemIds([])
    setValue("")
    setCost("")
    setDays("")
    setFile(null)
  }

  const log = async () => {
    if (!firestore || blocks.length) return
    const ok = await run(
      "log",
      () =>
        logVariation(firestore, access.ctx, projectId, actor, {
          title,
          source,
          sourceText,
          instructionNo,
          value: money ? num(value) : 0,
          cost: money ? num(cost) : 0,
          executedPct: 0,
          requestedOn,
          itemIds,
          days: money ? num(days) : 0,
          files: oneFile(file),
        }),
      t("vo.logged")
    )
    if (ok) {
      setLogging(false)
      reset()
    }
  }

  const newButton = canLog ? (
    <Button size="sm" onClick={() => setLogging(true)}>
      <Plus size={15} className="me-1.5" aria-hidden="true" />
      {t("vo.new")}
    </Button>
  ) : null

  const logMargin = num(value) > 0 ? num(value) - num(cost) : null
  const priceMargin = price && num(price.value) > 0 ? num(price.value) - num(price.cost) : null
  const decideBlocks = decide ? [...(!decide.approve && !decide.text.trim() ? ["no_reason"] : []), ...decisionDateBlocks({ on: decide.on || null, requestedOn: decide.vo.day, today })] : []

  const columns: DataColumn<PmVariation>[] = [
    {
      key: "vo",
      header: t("vo.col.vo"),
      cell: (v) => {
        const cs = codes(v)
        return (
          <button type="button" className="rounded-sm text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setOpenId(v.id)}>
            <b className="block hover:text-module" dir="auto">
              {v.title}
            </b>
            <span className="text-xs text-muted-foreground">
              <span className="font-mono" dir="ltr">
                {t("vo.no", { no: voNo(v.seq) })}
              </span>
              {" · "}
              {pmDate(v.day, locale)}
              {cs.length > 0 && ` · ${t("vo.items_line", { codes: cs.join(", ") })}`}
              {" · "}
              <span dir="auto">{sourceName(v)}</span>
              {v.instructionNo ? <span dir="auto"> · {v.instructionNo}</span> : <span className="text-warning"> · {t("vo.no_instruction")}</span>}
            </span>
          </button>
        )
      },
    },
    {
      key: "status",
      header: t("vo.col.status"),
      cell: (v) => {
        const known = (VO_STATUSES as readonly string[]).includes(v.status)
        const files = allFiles(v)
        return (
          <span className="flex flex-wrap items-center gap-1">
            <StatusPill tone={known ? TONE[v.status] : "bad"}>{known ? t(`vo.status.${v.status}`) : t("unknown_state")}</StatusPill>
            {files.length > 0 && (
              <StatusPill tone="info">
                <Paperclip size={11} aria-hidden="true" />
                {files.length}
              </StatusPill>
            )}
            {(v.days ?? 0) > 0 && <StatusPill tone="mute">+{t("days", { count: v.days ?? 0 })}</StatusPill>}
          </span>
        )
      },
    },
    {
      key: "executed",
      header: t("vo.col.executed"),
      sortValue: (v) => v.executedPct,
      cell: (v) => {
        const pct = Math.round(v.executedPct * 100)
        return (
          <div className="w-24">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" dir="ltr">
              <div className={cn("h-full rounded-full", v.status === "appr" ? "bg-success" : "bg-destructive")} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <p className="mt-0.5 text-[11px] tabular-nums" dir="ltr">
              {pct}%
            </p>
          </div>
        )
      },
    },
    ...(money
      ? ([
          {
            key: "value",
            header: t("vo.col.value"),
            numeric: true,
            sortValue: (v) => v.value,
            cell: (v) => (v.value > 0 ? <span className="whitespace-nowrap">{pmMoney(v.value)}</span> : <span className="text-xs text-muted-foreground">{t("vo.no_value")}</span>),
          },
          {
            key: "impact",
            header: t("vo.col.impact"),
            numeric: true,
            hideBelow: "lg",
            cell: (v) =>
              v.status === "appr" && v.value > 0 ? (
                <span className="whitespace-nowrap font-semibold text-success">+{pmMoney(v.value)}</span>
              ) : v.value > 0 ? (
                <span className="text-xs text-muted-foreground">{t("vo.not_added")}</span>
              ) : (
                "—"
              ),
          },
        ] satisfies DataColumn<PmVariation>[])
      : []),
  ]

  return (
    <div className="space-y-4">
      {risk > 0 && (
        <Callout tone="block" title={money ? t("vo.at_risk_title", { amount: pmMoney(risk) }) : t("vo.work_before_approval", { count: risky.length })}>
          {t("vo.at_risk_body")}
        </Callout>
      )}

      <Panel
        title={t("vo.title")}
        icon={ArrowLeftRight}
        count={vos.filter((v) => v.status === "wait" || v.status === "draft").length || undefined}
        description={vos.length ? t("vo.sub") : undefined}
        actions={newButton}
        bodyClassName="p-0"
      >
        {money && vos.length > 0 && (
          <div className="grid grid-cols-1 gap-x-6 border-b px-4 py-1 sm:grid-cols-3">
            <KeyValueRow label={t("vo.base_value")} value={pmMoney(baseValue)} ltr />
            <KeyValueRow label={t("vo.approved_value")} value={pmMoney(approved)} ltr />
            <KeyValueRow label={t("vo.live_value")} value={pmMoney(baseValue + approved)} ltr strong />
          </div>
        )}
        <DataTable
          columns={columns}
          rows={vos}
          rowKey={(v) => v.id}
          caption={t("vo.title")}
          labels={labels}
          bordered={false}
          dense
          maxHeight="70vh"
          onRowClick={(v) => setOpenId(v.id)}
          empty={<EmptyState bare icon={ArrowLeftRight} title={t("vo.empty")} description={t("vo.empty_desc")} />}
        />
      </Panel>

      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side={locale === "ar" ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-2xl" dir={locale === "ar" ? "rtl" : "ltr"}>
          {open && (
            <>
              <SheetHeader className="pe-8 text-start">
                <SheetTitle dir="auto">{open.title}</SheetTitle>
                <SheetDescription className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="module">{t("vo.no", { no: voNo(open.seq) })}</StatusPill>
                  <StatusPill tone={TONE[open.status] ?? "bad"}>{t(`vo.status.${open.status}`)}</StatusPill>
                  <span>{pmDate(open.day, locale)}</span>
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-3">
                {open.status !== "appr" && open.executedPct > 0 && (
                  <Callout tone="block" title={t("vo.drawer_risk_title", { pct: Math.round(open.executedPct * 100) })}>
                    {money ? t("vo.drawer_risk_body", { amount: pmMoney(voAtRisk(open)) }) : t("vo.at_risk_body")}
                  </Callout>
                )}
                {money && (
                  <div className="px-1">
                    <KeyValueRow label={t("vo.claimed_value")} value={open.value > 0 ? pmMoney(open.value) : "—"} ltr strong />
                    <KeyValueRow
                      label={t("vo.est_cost")}
                      value={
                        <span className="inline-flex flex-wrap items-baseline justify-end gap-x-2">
                          <bdi dir="ltr">{open.cost > 0 ? pmMoney(open.cost) : "—"}</bdi>
                          {voMarginPct(open) !== null && <span className="text-xs font-normal text-muted-foreground">{t("vo.margin_pct", { pct: pmPct((voMarginPct(open) ?? 0) / 100) })}</span>}
                        </span>
                      }
                    />
                  </div>
                )}
                <DrawerSection title={t("vo.reason_basis")}>
                  <KeyValueRow label={t("vo.source_label")} value={sourceName(open)} />
                  <KeyValueRow label={t("vo.instruction_label")} value={open.instructionNo || <span className="text-warning">{t("vo.no_instruction")}</span>} />
                  {codes(open).length > 0 && <KeyValueRow label={t("vo.items_affected")} value={<span dir="ltr">{codes(open).join(" · ")}</span>} />}
                  {(open.days ?? 0) > 0 && <KeyValueRow label={t("vo.days")} value={t("days", { count: open.days ?? 0 })} />}
                  <KeyValueRow label={t("vo.col.executed")} value={`${Math.round(open.executedPct * 100)}%`} ltr />
                  {open.byName && <KeyValueRow label={t("vo.logged_by")} value={`${open.byName} · ${pmDate(open.loggedOn ?? open.day, locale)}`} />}
                </DrawerSection>
                {(open.pcLog?.length ?? 0) > 0 && (
                  <DrawerSection title={t("vo.pc_log")} count={open.pcLog?.length}>
                    <ul className="space-y-1 py-1 text-xs">
                      {(open.pcLog ?? [])
                        .slice()
                        .reverse()
                        .map((e, i) => (
                          <li key={`${e.d}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2">
                            <span>
                              <span dir="ltr" className="font-semibold tabular-nums">
                                {Math.round(e.from * 100)}% → {Math.round(e.to * 100)}%
                              </span>
                              {e.note && (
                                <span className="ms-2 text-muted-foreground" dir="auto">
                                  {e.note}
                                </span>
                              )}
                            </span>
                            <span className="text-muted-foreground">{t("vo.pc_by", { who: e.byName || "—", date: pmDate(e.d, locale) })}</span>
                          </li>
                        ))}
                    </ul>
                  </DrawerSection>
                )}
                <DrawerSection title={t("vo.before_counts")}>
                  <CheckLine ok={open.value > 0} title={t("vo.check.priced")} note={open.value > 0 ? (money ? pmMoney(open.value) : t("vo.check.yes")) : t("vo.check.priced_no")} />
                  <CheckLine ok={open.status === "appr"} title={t("vo.check.written")} note={open.status === "appr" ? t("vo.check.on_file") : t("vo.check.missing")} />
                  <CheckLine ok={open.status === "appr"} title={t("vo.check.added")} note={open.status === "appr" ? t("vo.check.yes") : t("vo.check.no")} />
                </DrawerSection>
                {open.decision && open.status === "appr" && (
                  <p className="text-xs text-muted-foreground">{t("vo.approved_line", { date: pmDate(open.decision.on, locale), who: open.decision.byName || "—", ref: open.decision.ref || "—" })}</p>
                )}
                {open.status === "rej" && open.decision && (
                  <Callout tone="block" title={t("vo.rejected_title", { date: pmDate(open.decision.on, locale) })}>
                    {open.decision.reason && (
                      <span className="block" dir="auto">
                        {open.decision.reason}
                      </span>
                    )}
                    {t("vo.rejected_body")}
                  </Callout>
                )}
                {allFiles(open).length > 0 && (
                  <DrawerSection title={t("vo.files")} count={allFiles(open).length}>
                    <FileLinks files={allFiles(open)} className="py-2" />
                  </DrawerSection>
                )}
                {(canLog || canDecide) && open.status !== "rej" && (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    {canLog && money && open.status === "draft" && (
                      <Button size="sm" onClick={() => setPrice({ vo: open, value: open.value ? String(open.value) : "", cost: open.cost ? String(open.cost) : "", days: open.days ? String(open.days) : "", file: null })}>
                        <CircleDollarSign size={14} className="me-1.5" aria-hidden="true" />
                        {open.value > 0 ? t("vo.edit_price") : t("vo.price_it")}
                      </Button>
                    )}
                    {canLog && open.status === "draft" && (
                      <Button size="sm" variant="ghost" disabled={busy !== null || !(open.value > 0)} onClick={() => firestore && void run(`s${open.seq}`, () => submitVariation(firestore, access.ctx, projectId, open.seq), t("vo.submitted"))}>
                        <Send size={14} className="me-1.5" aria-hidden="true" />
                        {t("vo.submit")}
                      </Button>
                    )}
                    {(canProgress || canLog) && (
                      <Button size="sm" variant="ghost" onClick={() => setProgress({ vo: open, pct: String(Math.round(open.executedPct * 100)), instructionNo: open.instructionNo ?? "", note: "" })}>
                        {t("vo.update")}
                      </Button>
                    )}
                    {canDecide && open.status === "wait" && (
                      <>
                        <Button variant="success" size="sm" onClick={() => setDecide({ vo: open, approve: true, text: open.instructionNo ?? "", on: today, file: null })}>
                          <Check size={14} className="me-1.5" aria-hidden="true" />
                          {t("vo.approve")}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDecide({ vo: open, approve: false, text: "", on: today, file: null })}>
                          <X size={14} className="me-1.5" aria-hidden="true" />
                          {t("vo.reject")}
                        </Button>
                      </>
                    )}
                    {open.status !== "appr" && <FormHint>{open.status === "draft" && !(open.value > 0) ? t("vo.submit_blocked") : t("vo.approval_note")}</FormHint>}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={logging} onOpenChange={(o) => !busy && setLogging(o)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("vo.form_title")}</DialogTitle>
            <DialogDescription>{t("vo.new_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="vo-title">
                {t("vo.what")} <span className="text-warning">*</span>
              </Label>
              <Input id="vo-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("vo.what_ph")} disabled={busy !== null} dir="auto" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("vo.source_label")}</Label>
              <ChoiceChips label={t("vo.source_label")} options={VO_SOURCES.map((s) => ({ id: s, label: t(`vo.source.${s}`) }))} value={source} onChange={setSource} disabled={busy !== null} />
              <FormHint>{t("vo.source_hint")}</FormHint>
              {source === "oth" && (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="vo-src-text">
                    {t("vo.source_text")} <span className="text-warning">*</span>
                  </Label>
                  <Input id="vo-src-text" value={sourceText} onChange={(e) => setSourceText(e.target.value)} placeholder={t("vo.source_text_ph")} disabled={busy !== null} dir="auto" />
                  <FormHint>{t("vo.other_hint")}</FormHint>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="vo-ins">{t("vo.instruction_label_opt")}</Label>
                <Input id="vo-ins" value={instructionNo} onChange={(e) => setInstructionNo(e.target.value)} placeholder={t("vo.instruction_ph")} disabled={busy !== null} dir="auto" />
                {!instructionNo.trim() && <FormHint>{t("vo.instruction_hint")}</FormHint>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vo-day">{t("vo.requested_on")}</Label>
                <Input id="vo-day" type="date" dir="ltr" max={today} value={requestedOn} onChange={(e) => setRequestedOn(e.target.value)} disabled={busy !== null} />
                <FormHint>{t("vo.requested_hint")}</FormHint>
              </div>
            </div>
            {items.length > 0 && (
              <div className="space-y-1.5">
                <Label>{t("vo.items_label")}</Label>
                <div className="max-h-32 overflow-y-auto">
                  <ChoiceChips
                    multi
                    label={t("vo.items_label")}
                    options={items.map((i) => ({ id: i.id, label: <span dir="ltr">{i.code || i.description.slice(0, 18)}</span> }))}
                    value={itemIds}
                    onChange={(id) => setItemIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))}
                    disabled={busy !== null}
                  />
                </div>
                <FormHint>
                  {itemIds.length
                    ? items
                        .filter((i) => itemIds.includes(i.id))
                        .map((i) => i.description.slice(0, 30))
                        .join(" · ")
                    : t("vo.items_none")}
                </FormHint>
              </div>
            )}
            {money ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="vo-val">{t("vo.claimed_value")}</Label>
                    <Input id="vo-val" dir="ltr" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("vo.not_priced_ph")} disabled={busy !== null} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="vo-cost">{t("vo.your_cost")}</Label>
                    <Input id="vo-cost" dir="ltr" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" disabled={busy !== null} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="vo-days">{t("vo.days_label")}</Label>
                    <Input id="vo-days" dir="ltr" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="0" disabled={busy !== null} />
                  </div>
                </div>
                {logMargin !== null && (
                  <KeyValueRow
                    className="rounded-xl border px-3"
                    label={t("vo.your_margin")}
                    value={<span className={logMargin > 0 ? "text-success" : "text-destructive"}>{`${pmMoney(logMargin)} · ${pmPct(logMargin / num(value))}`}</span>}
                    ltr
                    strong
                  />
                )}
              </>
            ) : (
              <Callout tone="info">{t("vo.no_money_note")}</Callout>
            )}
            {num(days) > 0 && <Callout tone="warn">{t("vo.eot_warn", { days: t("days", { count: num(days) }) })}</Callout>}
            <MfgFileField orgId={orgId} area="pm" folder={`projects/${projectId}/variations`} value={file} onChange={setFile} label={t("vo.support_files")} hint={t("vo.support_hint")} />
            <Callout tone="warn" title={t("vo.is_it_title")}>
              {t("vo.is_it_body")}
            </Callout>
            <Callout tone="info">{t("vo.logging_note")}</Callout>
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

      <Dialog open={price !== null} onOpenChange={(o) => !o && !busy && setPrice(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("vo.price_title")}</DialogTitle>
            <DialogDescription dir="auto">{price ? `${t("vo.no", { no: voNo(price.vo.seq) })} — ${price.vo.title}` : ""}</DialogDescription>
          </DialogHeader>
          {price && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="vp-val">
                    {t("vo.claimed_value")} <span className="text-warning">*</span>
                  </Label>
                  <Input id="vp-val" dir="ltr" inputMode="decimal" value={price.value} onChange={(e) => setPrice({ ...price, value: e.target.value })} placeholder="0" disabled={busy !== null} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vp-cost">{t("vo.your_cost")}</Label>
                  <Input id="vp-cost" dir="ltr" inputMode="decimal" value={price.cost} onChange={(e) => setPrice({ ...price, cost: e.target.value })} placeholder="0" disabled={busy !== null} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vp-days">{t("vo.days_label")}</Label>
                  <Input id="vp-days" dir="ltr" inputMode="numeric" value={price.days} onChange={(e) => setPrice({ ...price, days: e.target.value })} placeholder="0" disabled={busy !== null} />
                </div>
              </div>
              {priceMargin !== null && (
                <div className="rounded-xl border px-3">
                  <KeyValueRow label={t("vo.margin")} value={<span className={priceMargin > 0 ? "text-success" : "text-destructive"}>{`${pmMoney(priceMargin)} · ${pmPct(priceMargin / num(price.value))}`}</span>} ltr />
                  {num(price.cost) > 0 && num(price.value) < num(price.cost) && <p className="pb-2 text-xs font-bold text-destructive">{t("vo.below_cost")}</p>}
                </div>
              )}
              <MfgFileField orgId={orgId} area="pm" folder={`projects/${projectId}/variations`} value={price.file} onChange={(f) => setPrice({ ...price, file: f })} label={t("vo.quote_file")} hint={t("vo.quote_hint")} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrice(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy !== null || !price || !(num(price.value) > 0)}
              onClick={async () => {
                if (!firestore || !price) return
                const ok = await run(
                  "price",
                  () => priceVariation(firestore, access.ctx, projectId, price.vo.seq, { value: num(price.value), cost: num(price.cost), instructionNo: price.vo.instructionNo, days: num(price.days), files: oneFile(price.file) }),
                  t("vo.saved")
                )
                if (ok) setPrice(null)
              }}
            >
              {busy === "price" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("vo.save_price")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={progress !== null} onOpenChange={(o) => !o && !busy && setProgress(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("vo.update")}</DialogTitle>
            <DialogDescription>{t("vo.update_desc")}</DialogDescription>
          </DialogHeader>
          {progress && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {canProgress && (
                  <div className="space-y-1.5">
                    <Label htmlFor="ve-pct">{t("vo.pct")}</Label>
                    <Input id="ve-pct" dir="ltr" inputMode="decimal" value={progress.pct} onChange={(e) => setProgress({ ...progress, pct: e.target.value })} disabled={busy !== null} />
                    <p className="text-xs text-muted-foreground">{t("vo.pct_never_down", { pct: Math.round(progress.vo.executedPct * 100) })}</p>
                  </div>
                )}
                {canLog && (
                  <div className="space-y-1.5">
                    <Label htmlFor="ve-ins">{t("vo.instruction_label")}</Label>
                    <Input id="ve-ins" value={progress.instructionNo} onChange={(e) => setProgress({ ...progress, instructionNo: e.target.value })} disabled={busy !== null} dir="auto" />
                  </div>
                )}
              </div>
              {canProgress && (
                <div className="space-y-1.5">
                  <Label htmlFor="ve-note">{t("vo.pc_note")}</Label>
                  <Input id="ve-note" value={progress.note} onChange={(e) => setProgress({ ...progress, note: e.target.value })} disabled={busy !== null} dir="auto" />
                </div>
              )}
              {canProgress && pctChanged(progress) && <BlockingReasons title={t("cannot_save")} reasons={progressBlocks(progress).map((b) => t(`vo.block.${b}`))} />}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setProgress(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy !== null || (progress !== null && canProgress && pctChanged(progress) && progressBlocks(progress).length > 0)}
              onClick={async () => {
                if (!firestore || !progress) return
                const p = progress
                const insChanged = canLog && p.instructionNo.trim() !== "" && p.instructionNo.trim() !== (p.vo.instructionNo ?? "")
                const ok = await run(
                  "progress",
                  async () => {
                    if (canProgress && pctChanged(p)) await recordVariationProgress(firestore, access.ctx, projectId, actor, p.vo.seq, num(p.pct) / 100, p.note)
                    if (insChanged) await setVariationInstruction(firestore, access.ctx, projectId, p.vo.seq, p.instructionNo)
                  },
                  t("vo.saved")
                )
                if (ok) setProgress(null)
              }}
            >
              {busy === "progress" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("vo.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={decide !== null} onOpenChange={(o) => !o && !busy && setDecide(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{decide?.approve ? t("vo.approve_title") : t("vo.reject_title")}</DialogTitle>
            <DialogDescription dir="auto">{decide ? `${t("vo.no", { no: voNo(decide.vo.seq) })} — ${decide.vo.title}` : ""}</DialogDescription>
          </DialogHeader>
          {decide && (
            <div className="space-y-4">
              {decide.approve && <Callout tone="info">{money ? t("vo.approve_note", { amount: pmMoney(decide.vo.value) }) : t("vo.approve_desc")}</Callout>}
              {!decide.approve && (
                <div className="space-y-1.5">
                  <Label htmlFor="vo-why">
                    {t("vo.reason_as_came")} <span className="text-warning">*</span>
                  </Label>
                  <Textarea id="vo-why" value={decide.text} onChange={(e) => setDecide({ ...decide, text: e.target.value })} placeholder={t("vo.reason_ph")} disabled={busy !== null} dir="auto" />
                  <FormHint>{t("vo.reason_hint")}</FormHint>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="vo-on">{decide.approve ? t("vo.approval_date") : t("vo.reject_date")}</Label>
                  <Input id="vo-on" type="date" dir="ltr" min={decide.vo.day} max={today} value={decide.on} onChange={(e) => setDecide({ ...decide, on: e.target.value })} disabled={busy !== null} />
                </div>
                {decide.approve && (
                  <div className="space-y-1.5">
                    <Label htmlFor="vo-ref">{t("vo.approval_ref")}</Label>
                    <Input id="vo-ref" value={decide.text} onChange={(e) => setDecide({ ...decide, text: e.target.value })} placeholder={t("vo.approval_ref_ph")} disabled={busy !== null} dir="auto" />
                  </div>
                )}
              </div>
              <MfgFileField
                orgId={orgId}
                area="pm"
                folder={`projects/${projectId}/variations`}
                value={decide.file}
                onChange={(f) => setDecide({ ...decide, file: f })}
                label={decide.approve ? t("vo.signed_file") : t("vo.reply_file")}
                hint={decide.approve ? t("vo.signed_hint") : t("vo.reply_hint")}
              />
              {!decide.approve && decide.vo.executedPct > 0 && (
                <Callout tone="block">{money ? t("vo.rej_executed", { pct: Math.round(decide.vo.executedPct * 100), amount: pmMoney(voAtRisk(decide.vo)) }) : t("vo.rej_executed_nomoney", { pct: Math.round(decide.vo.executedPct * 100) })}</Callout>
              )}
              {!decide.approve && linkedBack > 0 && <Callout tone="warn">{t("vo.rej_linked_back", { count: linkedBack })}</Callout>}
              <BlockingReasons title={t("cannot_save")} reasons={decideBlocks.map((b) => t(`vo.block.${b}`))} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecide(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              variant={decide?.approve ? "default" : "destructive"}
              disabled={busy !== null || decideBlocks.length > 0}
              onClick={async () => {
                if (!firestore || !decide) return
                const input = { on: decide.on, files: oneFile(decide.file) }
                const ok = await run(
                  "dec",
                  () =>
                    decide.approve
                      ? approveVariation(firestore, access.ctx, projectId, actor, decide.vo.seq, decide.text, input)
                      : rejectVariation(firestore, access.ctx, projectId, actor, decide.vo.seq, decide.text, input),
                  decide.approve ? t("vo.approved", { no: voNo(decide.vo.seq) }) : t("vo.rejected", { no: voNo(decide.vo.seq) })
                )
                if (ok) setDecide(null)
              }}
            >
              {busy === "dec" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {decide?.approve ? t("vo.record_approval") : t("vo.record_rejection")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
