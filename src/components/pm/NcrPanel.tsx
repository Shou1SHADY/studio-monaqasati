"use client"

// Execution › Non-conformance on a PM 1.0 project (WF-18, NCR-01): work that
// failed the specification — item, severity, root cause and cost; a corrective
// plan; closed when the consultant accepts it. An open NCR blocks closing.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { CheckCheck, FileWarning, Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { pmDate, pmMoney } from "@/lib/pm/format"
import { isOpenNcr, NCR_SEVERITIES, NCR_STATUSES, ncrBlocks, ncrNo, PM_NCRS, type NcrSeverity, type NcrStatus, type PmNcr } from "@/lib/pm/ncr"
import { acceptNcr, PmNcrError, raiseNcr, submitNcrPlan, type NcrActor } from "@/lib/pm/ncr-writes"

const TONE: Record<NcrStatus, PillTone> = { open: "bad", plan: "warn", done: "ok" }

export function NcrPanel({ projectId, items, access, actor }: { projectId: string; items: Array<{ id: string; code: string; description: string }>; access: PmAccess; actor: NcrActor }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [raising, setRaising] = useState(false)
  const [itemId, setItemId] = useState("")
  const [severity, setSeverity] = useState<NcrSeverity>("b")
  const [root, setRoot] = useState("")
  const [cost, setCost] = useState("")
  const [planning, setPlanning] = useState<PmNcr | null>(null)
  const [planText, setPlanText] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_NCRS) : null), [firestore, projectId])
  const { data } = useCollection(q)
  const ncrs = useMemo(() => ((data ?? []) as unknown as PmNcr[]).slice().sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.seq - a.seq), [data])
  const open = ncrs.filter(isOpenNcr)
  const canQa = !access.ctx.archived && access.allowed("qa.record")
  const money = access.has("money")
  const costNum = cost.trim() === "" ? 0 : Number(cost)
  const blocks = ncrBlocks({ archived: access.ctx.archived, itemId: itemId || null, root, cost: costNum })
  const itemName = (id: string) => {
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
      title={t("ncr.title")}
      icon={FileWarning}
      count={open.length || undefined}
      actions={
        canQa && items.length > 0 ? (
          <Button size="sm" variant="outline" onClick={() => setRaising(true)}>
            <Plus size={15} className="me-1.5" aria-hidden="true" />
            {t("ncr.new")}
          </Button>
        ) : null
      }
    >
      {ncrs.length === 0 ? (
        <EmptyState icon={FileWarning} title={t("ncr.empty")} description={t("ncr.empty_desc")} />
      ) : (
        <ul className="space-y-2">
          {ncrs.map((n) => {
            const known = (NCR_STATUSES as readonly string[]).includes(n.status)
            return (
              <li key={n.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      <span dir="auto">
                        {t("ncr.no", { no: ncrNo(n.seq) })} — {itemName(n.itemId)}
                      </span>
                      <StatusPill tone={n.severity === "a" ? "bad" : "mute"}>{t(`ncr.sev.${n.severity}`)}</StatusPill>
                      <StatusPill tone={known ? TONE[n.status] : "bad"}>{known ? t(`ncr.status.${n.status}`) : t("unknown_state")}</StatusPill>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                      {t("ncr.line", { root: n.root, date: pmDate(n.day, locale) })}
                      {money && n.cost > 0 ? ` · ${pmMoney(n.cost)}` : ""}
                    </p>
                    {n.plan && <p className="mt-0.5 text-xs" dir="auto">{t("ncr.plan_line", { text: n.plan.text, who: n.plan.byName || "—" })}</p>}
                    {n.accepted && <p className="mt-0.5 text-xs text-muted-foreground">{t("ncr.accepted_line", { date: pmDate(n.accepted.on, locale), who: n.accepted.byName || "—" })}</p>}
                  </div>
                  {canQa && n.status === "open" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPlanText("")
                        setPlanning(n)
                      }}
                    >
                      {t("ncr.submit_plan")}
                    </Button>
                  )}
                  {canQa && n.status === "plan" && (
                    <Button size="sm" disabled={busy !== null} onClick={() => firestore && void run(`a${n.seq}`, () => acceptNcr(firestore, access.ctx, projectId, actor, n.seq), t("ncr.closed", { no: ncrNo(n.seq) }))}>
                      {busy === `a${n.seq}` ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <CheckCheck size={14} className="me-1.5" aria-hidden="true" />}
                      {t("ncr.record_acceptance")}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={raising} onOpenChange={setRaising}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("ncr.new")}</DialogTitle>
            <DialogDescription>{t("ncr.new_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("ncr.item")}</Label>
              <SearchableSelect
                value={itemId}
                onChange={setItemId}
                options={items.map((i) => ({ value: i.id, label: itemName(i.id), keywords: i.code }))}
                placeholder={t("ncr.pick_item")}
                searchPlaceholder={t("ncr.search_item")}
                noResultsText={t("ncr.no_item")}
                ariaLabel={t("ncr.item")}
                disabled={busy !== null}
              />
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
              <div className="space-y-1.5">
                <Label htmlFor="ncr-cost">{t("ncr.cost")}</Label>
                <Input id="ncr-cost" dir="ltr" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} disabled={busy !== null} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ncr-root">{t("ncr.root")}</Label>
              <Textarea id="ncr-root" value={root} onChange={(e) => setRoot(e.target.value)} disabled={busy !== null} />
            </div>
            <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`ncr.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRaising(false)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy !== null || blocks.length > 0}
              onClick={async () => {
                if (!firestore) return
                const ok = await run("raise", () => raiseNcr(firestore, access.ctx, projectId, actor, { itemId, severity, root, cost: costNum }), t("ncr.raised"))
                if (ok) {
                  setRaising(false)
                  setItemId("")
                  setRoot("")
                  setCost("")
                }
              }}
            >
              {busy === "raise" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("ncr.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={planning !== null} onOpenChange={(o) => !o && setPlanning(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("ncr.submit_plan")}</DialogTitle>
            <DialogDescription>{t("ncr.plan_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ncr-plan">{t("ncr.plan")}</Label>
            <Textarea id="ncr-plan" value={planText} onChange={(e) => setPlanText(e.target.value)} disabled={busy !== null} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanning(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy !== null || !planText.trim()}
              onClick={async () => {
                if (!firestore || !planning) return
                const ok = await run("plan", () => submitNcrPlan(firestore, access.ctx, projectId, actor, planning.seq, planText), t("ncr.plan_saved"))
                if (ok) setPlanning(null)
              }}
            >
              {busy === "plan" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("ncr.submit_plan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
