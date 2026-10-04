"use client"

// Manpower requests from Projects (PRD AS-02, WF-12), on HR's Workplaces tab:
// each open request with its coverage computed in the law's order — who is
// free now, who a site ending frees, the visas, hire or temporary labour —
// with honest dates and anyone excluded named; the HR manager answers and the
// plan goes back to the project as it is.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Loader2, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useHrPeople } from "@/hooks/useHrPeople"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { hrDate, todayDay } from "@/lib/hr/format"
import { answerManpowerRequest, coverage, MANPOWER_REQUESTS, type CoverageLine, type ManpowerRequest } from "@/lib/hr/manpower"
import { HrWriteError } from "@/lib/hr/write-guard"

/** One coverage line in words — shared with the project's panel. */
export function CoverageLines({ lines, excluded }: { lines: CoverageLine[]; excluded: Array<{ name: string; reason: string }> }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  return (
    <div className="space-y-1.5">
      <ul className="space-y-1 text-sm">
        {lines.map((l, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-2">
            <span className="font-bold tabular-nums">{l.count}</span>
            <span>{t(`mp.src.${l.source}`)}</span>
            <span className="text-xs text-muted-foreground">{t("mp.from_date", { date: hrDate(l.date, locale) })}</span>
            {l.names?.length ? (
              <span className="text-xs text-muted-foreground" dir="auto">
                · {l.names.join("، ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {excluded.length > 0 && (
        <p className="text-xs text-destructive">{t("mp.excluded", { list: excluded.map((x) => `${x.name} (${t(`mp.why.${x.reason}`)})`).join("، ") })}</p>
      )}
    </div>
  )
}

export function HrManpowerPanel({ access }: { access: HrAccess }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile } = usePermissions()
  const { toast } = useToast()
  const today = todayDay()
  const { employees, sites } = useHrPeople(access)
  const q = useMemoFirebase(() => (firestore && access.orgId ? query(collection(firestore, MANPOWER_REQUESTS), where("organizationId", "==", access.orgId)) : null), [firestore, access.orgId])
  const { data } = useCollection(q)
  const requests = ((data ?? []) as unknown as ManpowerRequest[]).filter((r) => r.state !== "withdrawn").sort((a, b) => (b.requested?.at ?? "").localeCompare(a.requested?.at ?? ""))
  const open = requests.filter((r) => r.state === "open")
  const [answering, setAnswering] = useState<ManpowerRequest | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const plan = useMemo(
    () => (answering ? coverage({ trade: answering.trade, count: answering.count, from: answering.from, today, siteId: answering.siteId, employees, sites, visas: access.settings.establishment.visas ?? null }) : null),
    [answering, today, employees, sites, access.settings.establishment.visas]
  )

  if (!requests.length) return null

  const submit = async () => {
    if (!firestore || !answering || !plan) return
    setBusy(true)
    try {
      await answerManpowerRequest(firestore, access.ctx, answering.id, { uid: user?.uid ?? "", name: (profile?.name as string) || null }, { plan: plan.lines, excluded: plan.excluded, note })
      toast({ title: t("mp.answered_ok") })
      setAnswering(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? `err.${err.code}` : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t("mp.title")} icon={UsersRound} count={open.length || undefined}>
      <ul className="divide-y rounded-xl border">
        {requests.slice(0, 10).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1 basis-60 space-y-0.5">
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                <SourceBadge module="project-management" label={r.projectName} />
                {t("mp.line", { count: r.count, trade: t(`trade.${r.trade}` as "trade.mason"), date: hrDate(r.from, locale) })}
                <StatusPill tone={r.state === "open" ? "warn" : "ok"}>{t(`mp.state.${r.state}`)}</StatusPill>
              </p>
              {r.note && (
                <p className="text-xs text-muted-foreground" dir="auto">
                  {r.note}
                </p>
              )}
              {r.answer && <CoverageLines lines={r.answer.plan} excluded={r.answer.excluded} />}
            </div>
            {r.state === "open" && access.allowed("manpower.answer") && (
              <Button
                size="sm"
                onClick={() => {
                  setNote("")
                  setAnswering(r)
                }}
              >
                {t("mp.answer")}
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={answering !== null} onOpenChange={(o) => !o && setAnswering(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("mp.answer")}</DialogTitle>
            <DialogDescription>
              {answering ? `${answering.projectName} · ${t("mp.line", { count: answering.count, trade: t(`trade.${answering.trade}` as "trade.mason"), date: hrDate(answering.from, locale) })}` : ""}
            </DialogDescription>
          </DialogHeader>
          {plan && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-muted-foreground">{t("mp.plan", { covered: plan.covered, count: answering?.count ?? 0 })}</p>
              <CoverageLines lines={plan.lines} excluded={plan.excluded} />
              <p className="text-[11px] text-muted-foreground">{t("mp.plan_note")}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="mp-note">{t("req.note")}</Label>
            <Textarea id="mp-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnswering(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !plan}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("mp.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
