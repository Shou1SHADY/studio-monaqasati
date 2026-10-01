"use client"

// Execution › Inspections on a PM 1.0 project (WF-15), as the prototype's
// execWIR: one list, newest first — what and where, the item, who raised it
// (and the day it was raised — the day the request was created, never the day
// it is booked for) and who inspects; an open request shows its due day and
// how long it has been overdue, a decided one the day it was booked for, its
// result day and who recorded it; the
// request's documents and the signed form sit beside it. A failed one is
// re-inspected as the next attempt. The footer names the items that still need
// a passed inspection before their measurement can be approved. The items that
// require inspection are set by whoever holds approve.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { AlertTriangle, Check, ClipboardCheck, Clock, ListChecks, RotateCcw, SearchCheck, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { pmDate, todayDay } from "@/lib/pm/format"
import { currentAttempt, isKnownStatus, isOpenOrFailed, itemsNeedingPass, overdueDays, PM_INSPECTIONS, resultDay, wirNo, type PmInspection, type WirStatus } from "@/lib/pm/inspection"
import { PmInspectionError, reinspect, setInspectionRequired, type InspectionActor } from "@/lib/pm/inspection-writes"
import { cn } from "@/lib/utils"
import { AttachmentTag } from "./PmAttachments"
import { RecordResultDialog } from "./RecordResultDialog"
import { RequestInspectionDialog } from "./RequestInspectionDialog"
import type { SheetItem } from "./WriteSheetDialog"
import { usePmUnits } from "@/hooks/usePmUnits"

const TONE: Record<WirStatus, PillTone> = { open: "warn", pass: "ok", cond: "info", fail: "bad" }
const TILE: Record<WirStatus, string> = { open: "bg-warning/10 text-warning", pass: "bg-success/10 text-success", cond: "bg-success/10 text-success", fail: "bg-destructive/10 text-destructive" }

/** The day a request was raised: the day it was created, as the reader's own
 * day (like `todayDay`). The stamp is the server's — a Timestamp, or its text.
 * While it is still pending there is no day to show; the booked day is never
 * shown in its place. */
export function raisedDay(w: { createdAt?: unknown }): string | null {
  const v = w.createdAt
  const d = typeof v === "string" ? new Date(v) : v && typeof (v as { toDate?: unknown }).toDate === "function" ? (v as { toDate: () => Date }).toDate() : null
  if (!d || Number.isNaN(d.getTime())) return null
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

/** The message for a refused write: the guard's refusal, else the write's own
 * reason (`wir.block.*` — not failed, no day, archived), else "could not save". */
export function wirRefusalKey(err: unknown): string {
  if (err instanceof PmAccessError) return `refused.${err.code}`
  if (err instanceof PmInspectionError && err.blocks[0]) return `wir.block.${err.blocks[0]}`
  return "error.save"
}

export function InspectionsPanel({
  projectId,
  orgId,
  items,
  access,
  actor,
  bare,
  onItemsChanged,
  unitsOn,
}: {
  projectId: string
  orgId?: string | null
  items: SheetItem[]
  access: PmAccess
  actor: InspectionActor
  /** Inside the combined «الفحص والملاحظات» view: no intro note. */
  bare?: boolean
  onItemsChanged?: () => void
  /** The delivery-units section is on: a request may name its unit. */
  unitsOn?: boolean
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const { units } = usePmUnits(projectId, Boolean(unitsOn))
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [requesting, setRequesting] = useState(false)
  const [recording, setRecording] = useState<PmInspection | null>(null)
  const [again, setAgain] = useState<PmInspection | null>(null)
  const [againOn, setAgainOn] = useState(today)
  const [picking, setPicking] = useState(false)
  const [required, setRequired] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_INSPECTIONS) : null), [firestore, projectId])
  const { data } = useCollection(q)
  const list = useMemo(() => ((data ?? []) as unknown as PmInspection[]).slice().sort((a, b) => b.seq - a.seq), [data])
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const canQa = !access.ctx.archived && access.allowed("qa.record")
  const canSet = !access.ctx.archived && access.allowed("project.edit")
  const openCount = list.filter(isOpenOrFailed).length
  const gatedCount = items.filter((i) => i.gate?.pmInspect).length
  const need = itemsNeedingPass(items)

  const partyName = (w: PmInspection) => (w.party === "other" ? t("amend.other_stated", { text: w.partyText ?? "" }) : t(`wir.party.${w.party}`))
  const statusText = (s: unknown) => (isKnownStatus(s) ? t(`wir.status.${s}`) : t("unknown_state"))

  const bookAgain = async () => {
    if (!firestore || !again) return
    setBusy(true)
    try {
      await reinspect(firestore, access.ctx, projectId, actor, again.seq, { on: againOn })
      toast({ title: t("wir.rebooked", { no: wirNo(again.seq), n: again.attempts.length + 1 }) })
      setAgain(null)
      onItemsChanged?.()
    } catch (err) {
      console.error(err)
      toast({ title: t(wirRefusalKey(err)), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const saveRequired = async () => {
    if (!firestore) return
    const changes = items.filter((i) => Boolean(i.gate?.pmInspect) !== required.has(i.id)).map((i) => ({ itemId: i.id, on: required.has(i.id) }))
    setBusy(true)
    try {
      if (changes.length) await setInspectionRequired(firestore, access.ctx, projectId, changes)
      toast({ title: t("wir.required_saved") })
      setPicking(false)
      onItemsChanged?.()
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : "error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {!bare && <Callout tone="info">{t("wir.intro")}</Callout>}
      <Panel
        title={t("wir.title")}
        icon={SearchCheck}
        count={openCount || undefined}
        bodyClassName="p-0"
        actions={
          <>
            {canSet && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRequired(new Set(items.filter((i) => i.gate?.pmInspect).map((i) => i.id)))
                  setPicking(true)
                }}
              >
                <ListChecks size={15} className="me-1.5" aria-hidden="true" />
                {t("wir.required_btn", { count: gatedCount })}
              </Button>
            )}
            {canQa && (
              <Button size="sm" onClick={() => setRequesting(true)}>
                <ClipboardCheck size={15} className="me-1.5" aria-hidden="true" />
                {t("wir.new")}
              </Button>
            )}
          </>
        }
      >
        {list.length > 0 && <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("wir.sub", { open: openCount, total: list.length })}</p>}
        {list.length === 0 ? (
          <EmptyState icon={SearchCheck} title={t("wir.empty")} description={t("wir.empty_desc", { count: gatedCount })} />
        ) : (
          <ul className="divide-y">
            {list.map((w) => {
              const a = currentAttempt(w)
              const st: WirStatus = isKnownStatus(w.status) ? w.status : "open"
              const item = byId.get(w.itemId)
              const late = a ? overdueDays(a, today) : 0
              const raised = raisedDay(w as { createdAt?: unknown })
              const Icon = st === "fail" ? X : st === "open" ? Clock : Check
              return (
                <li key={w.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", TILE[st])}>
                    <Icon size={15} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-sm font-bold" dir="auto">
                      {t("wir.no", { no: wirNo(w.seq) })} — {w.location}
                      {(a?.n ?? 1) > 1 && <span className="ms-1 text-xs font-semibold text-muted-foreground">({t("wir.attempt_n", { n: a?.n ?? 1 })})</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                      <span dir="ltr">{item?.code ?? w.code ?? "?"}</span>
                      {item?.description ? ` · ${item.description.slice(0, 40)}` : ""} · {t("wir.raised", { who: w.attempts[0]?.byName || "—", date: raised ? pmDate(raised, locale) : "" })} · {partyName(w)}
                    </p>
                    {a &&
                      (st === "open" ? (
                        <p className={cn("mt-0.5 text-xs", late > 0 ? "font-semibold text-destructive" : "text-muted-foreground")}>
                          {t("wir.due", { date: pmDate(a.on, locale) })}
                          {late > 0 ? ` — ${t("wir.overdue", { count: late })}` : ""}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("wir.on")} {pmDate(a.on, locale)} · {t("wir.result_on", { date: pmDate(resultDay(a), locale) })}
                          {a.rByName ? ` · ${a.rByName}` : ""}
                        </p>
                      ))}
                    {a?.note && (
                      <p className={cn("mt-0.5 text-xs font-semibold", st === "fail" ? "text-destructive" : "text-warning")} dir="auto">
                        {a.note}
                      </p>
                    )}
                    {w.attempts.length > 1 && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">{t("wir.history", { count: w.attempts.length })}</summary>
                        <ol className="mt-1 space-y-0.5">
                          {w.attempts.map((x) => (
                            <li key={x.n}>
                              {t("wir.attempt", { n: x.n, date: pmDate(x.on, locale), result: x.result ? statusText(x.result) : t("wir.status.open"), who: x.rByName || "—" })}
                              {x.note ? ` — ${x.note}` : ""}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <AttachmentTag files={a?.files} />
                    <AttachmentTag files={a?.rFiles} tone="teal" />
                    <StatusPill tone={isKnownStatus(w.status) ? TONE[w.status] : "bad"}>{statusText(w.status)}</StatusPill>
                    {st === "open" && canQa && (
                      <Button size="sm" onClick={() => setRecording(w)}>
                        {t("wir.record")}
                      </Button>
                    )}
                    {st === "fail" && canQa && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAgainOn(today)
                          setAgain(w)
                        }}
                      >
                        <RotateCcw size={14} className="me-1.5" aria-hidden="true" />
                        {t("wir.reinspect")}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {need.length > 0 && (
          <p className="flex items-start gap-1.5 border-t bg-muted/30 px-4 py-2.5 text-xs font-semibold text-warning">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {t("wir.need_footer", { count: need.length })}{" "}
              <span dir="ltr">{need.slice(0, 3).map((i) => i.code).join(" · ")}</span>
            </span>
          </p>
        )}
      </Panel>

      {canQa && <RequestInspectionDialog open={requesting} onOpenChange={setRequesting} projectId={projectId} orgId={orgId} access={access} actor={actor} items={items} inspections={list} units={units} onSaved={onItemsChanged} />}
      {recording && (
        <RecordResultDialog
          open
          onOpenChange={(o) => !o && setRecording(null)}
          projectId={projectId}
          orgId={orgId}
          access={access}
          actor={actor}
          inspection={recording}
          itemLabel={`${byId.get(recording.itemId)?.code ?? recording.code ?? "?"} — ${byId.get(recording.itemId)?.description ?? ""}`}
          partyName={partyName(recording)}
          onSaved={onItemsChanged}
        />
      )}

      <Dialog open={again !== null} onOpenChange={(o) => !o && setAgain(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("wir.reinspect")}</DialogTitle>
            <DialogDescription>{t("wir.reinspect_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="wir-again">{t("wir.on")}</Label>
            <Input id="wir-again" type="date" dir="ltr" value={againOn} onChange={(e) => setAgainOn(e.target.value)} disabled={busy} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAgain(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void bookAgain()} disabled={busy || !againOn}>
              {t("wir.reinspect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("wir.required_title")}</DialogTitle>
            <DialogDescription>{t("wir.required_desc")}</DialogDescription>
          </DialogHeader>
          <ul className="max-h-[55vh] divide-y overflow-y-auto rounded-xl border">
            {items.map((i) => (
              <li key={i.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                  <Checkbox
                    checked={required.has(i.id)}
                    onCheckedChange={(on) =>
                      setRequired((cur) => {
                        const n = new Set(cur)
                        if (on === true) n.add(i.id)
                        else n.delete(i.id)
                        return n
                      })
                    }
                    disabled={busy}
                  />
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {i.code}
                  </span>
                  <span className="min-w-0 truncate" dir="auto">
                    {i.description}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPicking(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void saveRequired()} disabled={busy}>
              {t("wir.required_save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
