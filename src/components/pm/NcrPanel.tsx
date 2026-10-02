"use client"

// Execution › Non-conformance on a PM 1.0 project (WF-18, NCR-01), as the
// prototype's qaPanel: work that went against the specification — what, the
// item, the day found, the root cause (no root cause, no save: without it the
// fault repeats in the next villa), severity and the rework cost (money
// holders only; a cost on us that is never billed). A corrective and
// preventive plan; closed on the day the consultant accepted it, with the
// actual cost. An open NCR blocks closing.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { AlertTriangle, Check, CheckCheck, FileWarning, Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { usePmProjectNo } from "@/hooks/usePmProjectNo"
import { PmAccessError } from "@/lib/pm/access"
import type { PmAttachment } from "@/lib/pm/attachments"
import { projectDocNo } from "@/lib/pm/exec-numbers"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { isOpenNcr, NCR_SEVERITIES, NCR_STATUSES, ncrBlocks, ncrCost, ncrNo, ncrStepBlocks, PM_NCRS, type NcrSeverity, type NcrStatus, type PmNcr } from "@/lib/pm/ncr"
import { acceptNcr, PmNcrError, raiseNcr, submitNcrPlan, type NcrActor } from "@/lib/pm/ncr-writes"
import { cn } from "@/lib/utils"
import { AttachmentTag, PmFilesField } from "./PmAttachments"

const TONE: Record<NcrStatus, PillTone> = { open: "bad", plan: "warn", done: "ok" }
const num = (v: string) => (v.trim() === "" ? null : Number(v))

export function NcrPanel({
  projectId,
  orgId,
  items,
  access,
  actor,
}: {
  projectId: string
  orgId?: string | null
  items: Array<{ id: string; code: string; description: string }>
  access: PmAccess
  actor: NcrActor
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const projectNo = usePmProjectNo(projectId)
  const { toast } = useToast()
  const today = todayDay()
  const [raising, setRaising] = useState(false)
  const [what, setWhat] = useState("")
  const [itemId, setItemId] = useState("")
  const [day, setDay] = useState(today)
  const [severity, setSeverity] = useState<NcrSeverity>("a")
  const [root, setRoot] = useState("")
  const [cost, setCost] = useState("")
  const [files, setFiles] = useState<PmAttachment[]>([])
  const [planning, setPlanning] = useState<PmNcr | null>(null)
  const [planText, setPlanText] = useState("")
  const [planCost, setPlanCost] = useState("")
  const [planFiles, setPlanFiles] = useState<PmAttachment[]>([])
  const [closing, setClosing] = useState<PmNcr | null>(null)
  const [closeOn, setCloseOn] = useState(today)
  const [closeCost, setCloseCost] = useState("")
  const [closeFiles, setCloseFiles] = useState<PmAttachment[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_NCRS) : null), [firestore, projectId])
  const { data } = useCollection(q)
  const ncrs = useMemo(() => ((data ?? []) as unknown as PmNcr[]).slice().sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.seq - a.seq), [data])
  const open = ncrs.filter(isOpenNcr)
  const canQa = !access.ctx.archived && access.allowed("qa.record")
  const money = access.has("money")
  const costNum = num(cost) ?? 0
  const blocks = ncrBlocks({ archived: access.ctx.archived, root, cost: costNum, what, day, today })
  const planBlocks = planning ? ncrStepBlocks({ archived: access.ctx.archived, status: planning.status, step: "plan", text: planText, cost: money ? num(planCost) : undefined }) : []
  const closeBlocks = closing ? ncrStepBlocks({ archived: access.ctx.archived, status: closing.status, step: "accept", cost: money ? num(closeCost) : undefined, day: closeOn, today, after: closing.plan?.on ?? closing.day }) : []
  const itemName = (id: string) => {
    if (!id) return t("ncr.item_none")
    const i = items.find((x) => x.id === id)
    return i ? [i.code, i.description].filter(Boolean).join(" · ") : id
  }

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    if (!firestore) return false
    setBusy(key)
    try {
      await fn()
      toast({ title: ok })
      return true
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmNcrError && err.blocks[0] ? `ncr.block.${err.blocks[0]}` : "error.save"), variant: "destructive" })
      return false
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel
      title={t("ncr.title2")}
      icon={FileWarning}
      count={open.length}
      bodyClassName="p-0"
      actions={
        canQa ? (
          <Button size="sm" onClick={() => setRaising(true)}>
            <Plus size={15} className="me-1.5" aria-hidden="true" />
            {t("ncr.new")}
          </Button>
        ) : null
      }
    >
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("ncr.sub")}</p>
      {ncrs.length === 0 ? (
        <EmptyState icon={FileWarning} title={t("ncr.empty2")} description={t("ncr.empty_desc")} />
      ) : (
        <ul className="divide-y">
          {ncrs.map((n) => {
            const known = (NCR_STATUSES as readonly string[]).includes(n.status)
            const c = ncrCost(n)
            return (
              <li key={n.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", n.status === "done" ? "bg-success/10 text-success" : n.severity === "a" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>
                  {n.status === "done" ? <Check size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-bold" dir="auto">
                    {t("ncr.no", { no: projectDocNo(projectNo, n.seq) })} — {n.what || itemName(n.itemId)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                    {n.itemId ? (
                      <>
                        <span dir="ltr">{n.code ?? "?"}</span>
                        {" · "}
                      </>
                    ) : null}
                    {pmDate(n.day, locale)} · {n.byName || "—"}
                    {money && c > 0 ? (
                      <>
                        {` · ${t("ncr.rework_cost")} `}
                        <span dir="ltr">{pmMoney(c)}</span>
                      </>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs" dir="auto">
                    {t("ncr.root")}: {n.root}
                  </p>
                  {n.plan && (
                    <p className="mt-0.5 text-xs font-semibold text-success" dir="auto">
                      {t("ncr.corrective")}: {n.plan.text}
                    </p>
                  )}
                  {n.accepted && <p className="mt-0.5 text-xs text-muted-foreground">{t("ncr.accepted_line2", { date: pmDate(n.accepted.on, locale), who: n.accepted.byName || "—" })}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <AttachmentTag files={[...(n.files ?? []), ...(n.plan?.files ?? [])]} />
                  <AttachmentTag files={n.accepted?.files} tone="teal" />
                  <StatusPill tone={n.severity === "a" ? "bad" : "mute"}>{t(`ncr.sev.${n.severity}`)}</StatusPill>
                  <StatusPill tone={known ? TONE[n.status] : "bad"}>{known ? t(`ncr.status2.${n.status}`) : t("unknown_state")}</StatusPill>
                  {canQa && n.status === "open" && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setPlanText("")
                        setPlanCost(n.cost ? String(n.cost) : "")
                        setPlanFiles([])
                        setPlanning(n)
                      }}
                    >
                      {t("ncr.submit_plan")}
                    </Button>
                  )}
                  {canQa && n.status === "plan" && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setCloseOn(todayDay())
                        setCloseCost(String(ncrCost(n) || ""))
                        setCloseFiles([])
                        setClosing(n)
                      }}
                    >
                      <CheckCheck size={14} className="me-1.5" aria-hidden="true" />
                      {t("ncr.record_closure")}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={raising} onOpenChange={setRaising}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("ncr.form_title")}</DialogTitle>
            <DialogDescription>{t("ncr.form_note")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ncr-what">
                {t("ncr.what")}
                <span className="ms-0.5 text-destructive">*</span>
              </Label>
              <Input id="ncr-what" value={what} placeholder={t("ncr.what_ph")} onChange={(e) => setWhat(e.target.value)} disabled={busy !== null} dir="auto" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("ncr.item")}</Label>
                <SearchableSelect
                  value={itemId}
                  onChange={setItemId}
                  options={[{ value: "", label: t("ncr.item_none") }, ...items.map((i) => ({ value: i.id, label: itemName(i.id), keywords: i.code }))]}
                  placeholder={t("ncr.item_none")}
                  searchPlaceholder={t("ncr.search_item")}
                  noResultsText={t("ncr.no_item")}
                  ariaLabel={t("ncr.item")}
                  disabled={busy !== null}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ncr-day">{t("ncr.day")}</Label>
                <Input id="ncr-day" type="date" dir="ltr" max={today} value={day} onChange={(e) => setDay(e.target.value)} disabled={busy !== null} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ncr-root">
                {t("ncr.root")}
                <span className="ms-0.5 text-destructive">*</span>
              </Label>
              <Textarea id="ncr-root" value={root} placeholder={t("ncr.root_ph")} onChange={(e) => setRoot(e.target.value)} disabled={busy !== null} dir="auto" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ncr-sev">{t("ncr.severity")}</Label>
                <Select value={severity} onValueChange={(v) => setSeverity(v as NcrSeverity)} disabled={busy !== null}>
                  <SelectTrigger id="ncr-sev">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NCR_SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`ncr.sev.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {money && (
                <div className="space-y-1.5">
                  <Label htmlFor="ncr-cost">{t("ncr.est_cost")}</Label>
                  <Input id="ncr-cost" type="number" min="0" dir="ltr" inputMode="decimal" value={cost} placeholder="0" onChange={(e) => setCost(e.target.value)} disabled={busy !== null} />
                  <p className="text-[11px] text-muted-foreground">{t("ncr.cost_hint")}</p>
                </div>
              )}
            </div>
            <PmFilesField orgId={orgId} folder={`projects/${projectId}/ncr`} value={files} onChange={setFiles} label={t("ncr.files")} hint={t("ncr.files_hint")} disabled={busy !== null} />
            <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`ncr.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRaising(false)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null || blocks.length > 0}
              onClick={async () => {
                if (!firestore) return
                const ok = await run("raise", () => raiseNcr(firestore, access.ctx, projectId, actor, { itemId, severity, root, cost: costNum, what, day, files }), t("ncr.raised"))
                if (ok) {
                  setRaising(false)
                  setWhat("")
                  setItemId("")
                  setRoot("")
                  setCost("")
                  setDay(todayDay())
                  setFiles([])
                }
              }}
            >
              {busy === "raise" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("ncr.log")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={planning !== null} onOpenChange={(o) => !o && setPlanning(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("ncr.plan_title")}</DialogTitle>
            <DialogDescription dir="auto">{planning ? `${t("ncr.no", { no: projectDocNo(projectNo, planning.seq) })} — ${planning.what || itemName(planning.itemId)}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ncr-plan">
                {t("ncr.plan2")}
                <span className="ms-0.5 text-destructive">*</span>
              </Label>
              <Textarea id="ncr-plan" value={planText} placeholder={t("ncr.plan_ph")} onChange={(e) => setPlanText(e.target.value)} disabled={busy !== null} dir="auto" />
              <p className="text-[11px] text-muted-foreground">{t("ncr.plan_hint")}</p>
            </div>
            {money && (
              <div className="space-y-1.5">
                <Label htmlFor="ncr-plan-cost">{t("ncr.rework_cost")}</Label>
                <Input id="ncr-plan-cost" type="number" min="0" dir="ltr" value={planCost} onChange={(e) => setPlanCost(e.target.value)} disabled={busy !== null} />
              </div>
            )}
            <PmFilesField orgId={orgId} folder={`projects/${projectId}/ncr`} value={planFiles} onChange={setPlanFiles} label={t("ncr.attachments")} disabled={busy !== null} />
            <BlockingReasons title={t("cannot_save")} reasons={planBlocks.map((b) => t(`ncr.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanning(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy !== null || planBlocks.length > 0}
              onClick={async () => {
                if (!firestore || !planning) return
                const ok = await run("plan", () => submitNcrPlan(firestore, access.ctx, projectId, actor, planning.seq, planText, { cost: money ? num(planCost) : undefined, files: planFiles }), t("ncr.plan_saved"))
                if (ok) setPlanning(null)
              }}
            >
              {busy === "plan" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("ncr.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closing !== null} onOpenChange={(o) => !o && setClosing(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("ncr.close_title")}</DialogTitle>
            <DialogDescription dir="auto">{closing ? `${t("ncr.no", { no: projectDocNo(projectNo, closing.seq) })} — ${closing.what || itemName(closing.itemId)}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {closing?.plan && <Callout tone="info">{t("ncr.submitted_plan", { text: closing.plan.text })}</Callout>}
            <div className="space-y-1.5">
              <Label htmlFor="ncr-close-on">{t("ncr.consultant_date")}</Label>
              <Input id="ncr-close-on" type="date" dir="ltr" max={today} value={closeOn} onChange={(e) => setCloseOn(e.target.value)} disabled={busy !== null} />
            </div>
            {money && (
              <div className="space-y-1.5">
                <Label htmlFor="ncr-close-cost">{t("ncr.actual_cost")}</Label>
                <Input id="ncr-close-cost" type="number" min="0" dir="ltr" value={closeCost} onChange={(e) => setCloseCost(e.target.value)} disabled={busy !== null} />
                <p className="text-[11px] text-muted-foreground">{t("ncr.cost_hint")}</p>
              </div>
            )}
            <PmFilesField orgId={orgId} folder={`projects/${projectId}/ncr`} value={closeFiles} onChange={setCloseFiles} label={t("ncr.acceptance_files")} disabled={busy !== null} />
            <BlockingReasons title={t("cannot_save")} reasons={closeBlocks.map((b) => t(`ncr.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy !== null || closeBlocks.length > 0}
              onClick={async () => {
                if (!firestore || !closing) return
                const ok = await run("close", () => acceptNcr(firestore, access.ctx, projectId, actor, closing.seq, { on: closeOn, cost: money ? num(closeCost) : undefined, files: closeFiles }), t("ncr.closed", { no: ncrNo(closing.seq) }))
                if (ok) setClosing(null)
              }}
            >
              {busy === "close" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("ncr.close_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
