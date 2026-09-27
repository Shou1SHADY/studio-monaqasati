"use client"

// Execution › Inspections on a PM 1.0 project (WF-15). Open requests await a
// result; a failed one is a red decision — its item cannot be measured — with
// "Re-inspect" booking the next attempt. The items that require inspection
// before measurement are set by whoever holds approve.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { ClipboardCheck, ListChecks, RotateCcw, SearchCheck, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DecisionRow } from "@/components/module-ui/DecisionRow"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { pmDate, todayDay } from "@/lib/pm/format"
import { isKnownStatus, PM_INSPECTIONS, wirNo, type PmInspection, type WirStatus } from "@/lib/pm/inspection"
import { reinspect, setInspectionRequired, type InspectionActor } from "@/lib/pm/inspection-writes"
import { RecordResultDialog } from "./RecordResultDialog"
import { RequestInspectionDialog } from "./RequestInspectionDialog"
import type { SheetItem } from "./WriteSheetDialog"

const TONE: Record<WirStatus, PillTone> = { open: "warn", pass: "ok", cond: "info", fail: "bad" }

export function InspectionsPanel({
  projectId,
  items,
  access,
  actor,
  onItemsChanged,
}: {
  projectId: string
  items: SheetItem[]
  access: PmAccess
  actor: InspectionActor
  onItemsChanged?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [requesting, setRequesting] = useState(false)
  const [recording, setRecording] = useState<PmInspection | null>(null)
  const [again, setAgain] = useState<PmInspection | null>(null)
  const [againOn, setAgainOn] = useState(todayDay())
  const [picking, setPicking] = useState(false)
  const [required, setRequired] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_INSPECTIONS) : null), [firestore, projectId])
  const { data } = useCollection(q)
  const list = useMemo(() => ((data ?? []) as unknown as PmInspection[]).slice().sort((a, b) => b.seq - a.seq), [data])
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const canQa = !access.ctx.archived && access.allowed("qa.record")
  const canSet = !access.ctx.archived && access.allowed("project.edit")
  const failed = list.filter((w) => w.status === "fail")
  const open = list.filter((w) => w.status === "open")
  const gatedCount = items.filter((i) => i.gate?.pmInspect).length

  const itemLabel = (w: PmInspection) => {
    const i = byId.get(w.itemId)
    return `${i?.code ?? w.code ?? "?"} — ${i?.description ?? ""}`
  }
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
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : "error.save"), variant: "destructive" })
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
    <Panel
      title={t("wir.title")}
      icon={SearchCheck}
      count={open.length + failed.length || undefined}
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
      {(failed.length > 0 || open.length > 0) && (
        <ul className="mb-4 divide-y overflow-hidden rounded-xl border">
          {failed.map((w) => (
            <DecisionRow
              key={w.id}
              severity="red"
              icon={ShieldAlert}
              title={t("wir.failed_title", { no: wirNo(w.seq) })}
              detail={`${itemLabel(w)} · ${w.location}`}
              action={
                canQa ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setAgainOn(todayDay())
                      setAgain(w)
                    }}
                  >
                    <RotateCcw size={14} className="me-1.5" aria-hidden="true" />
                    {t("wir.reinspect")}
                  </Button>
                ) : undefined
              }
            />
          ))}
          {open.map((w) => {
            const last = w.attempts[w.attempts.length - 1]
            return (
              <DecisionRow
                key={w.id}
                severity="amber"
                icon={SearchCheck}
                title={t("wir.open_title", { no: wirNo(w.seq), n: last?.n ?? 1 })}
                detail={`${itemLabel(w)} · ${w.location} · ${pmDate(last?.on, locale)}`}
                action={
                  canQa ? (
                    <Button size="sm" onClick={() => setRecording(w)}>
                      {t("wir.record")}
                    </Button>
                  ) : undefined
                }
              />
            )
          })}
        </ul>
      )}

      {list.length === 0 ? (
        <EmptyState icon={SearchCheck} title={t("wir.empty")} description={t("wir.empty_desc", { count: gatedCount })} />
      ) : (
        <ul className="space-y-2">
          {list.map((w) => (
            <li key={w.id} className="rounded-xl border p-3">
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                {t("wir.no", { no: wirNo(w.seq) })}
                <StatusPill tone={isKnownStatus(w.status) ? TONE[w.status] : "bad"}>{statusText(w.status)}</StatusPill>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                {itemLabel(w)} · {w.location} · {w.party === "other" ? t("amend.other_stated", { text: w.partyText ?? "" }) : t(`wir.party.${w.party}`)}
              </p>
              <ol className="mt-1.5 space-y-0.5 text-xs">
                {w.attempts.map((a) => (
                  <li key={a.n}>
                    {t("wir.attempt", {
                      n: a.n,
                      date: pmDate(a.on, locale),
                      result: a.result ? statusText(a.result) : t("wir.status.open"),
                      who: a.rByName || "—",
                    })}
                    {a.note ? ` — ${a.note}` : ""}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}

      {canQa && <RequestInspectionDialog open={requesting} onOpenChange={setRequesting} projectId={projectId} access={access} actor={actor} items={items} onSaved={onItemsChanged} />}
      {recording && <RecordResultDialog open onOpenChange={(o) => !o && setRecording(null)} projectId={projectId} access={access} actor={actor} inspection={recording} itemLabel={itemLabel(recording)} onSaved={onItemsChanged} />}

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
    </Panel>
  )
}
