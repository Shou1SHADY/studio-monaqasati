"use client"

// Suspend / resume a PM 1.0 project (live ⇄ hold; 1.1 PRJ-02, WF-28). The reason
// comes from a list ("other" stated), the day is not in the future nor before the
// start, and a note is optional. Every suspension is a line in the log under the
// suspender's name, closed by whoever resumed it — `PmHoldLog` shows it on the
// project details. Approve only.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { History, Loader2, MoreHorizontal, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { IconButton } from "@/components/module-ui/IconButton"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { Chip } from "@/components/module-ui/Chip"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { pmDate, todayDay } from "@/lib/pm/format"
import { HOLD_REASONS, holdBlocks, holdProject, isHoldReason, PmHoldError, resumeProject, type HoldEntry, type HoldReason } from "@/lib/pm/hold-writes"
import { lifecycleOf } from "@/lib/pm/lifecycle"

type HoldPm = {
  lifecycle?: string | null
  startedAt?: string | null
  startOn?: string | null
  holdSince?: string | null
  holdK?: string | null
  holdWhy?: string | null
  holdNote?: string | null
  holdBy?: string | null
  holdByName?: string | null
  holdLog?: HoldEntry[] | null
}
type HoldProject = { pm?: HoldPm | null; status?: string | null }

const dayGap = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000))

/** The suspension's reason in the reader's language: the listed reason, the stated text for "other",
 * or — for one recorded before the list — the text as typed. */
export function useHoldReason() {
  const t = useTranslations("Portal.PM")
  return (k: string | null | undefined, why: string | null | undefined) => {
    if (isHoldReason(k)) return k === "oth" ? t("hold.reason_other", { text: why ?? "" }) : t(`hold.reason.${k}`)
    return why?.trim() || "—"
  }
}

/** `trigger="menu"` (the project head, PM 1.1 UX-04): Postpone is a secondary act, so it sits behind a «…» button
 * instead of a third full button that ran off a phone's screen; Resume — the one act left on a postponed project — stays a button. */
export function PmHoldControl({ projectId, project, access, actor, trigger = "button" }: { projectId: string; project: HoldProject; access: PmAccess; actor: { uid: string; name: string | null }; trigger?: "button" | "menu" }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [k, setK] = useState<HoldReason | null>(null)
  const [text, setText] = useState("")
  const [note, setNote] = useState("")
  const [since, setSince] = useState(todayDay())
  const [busy, setBusy] = useState(false)
  const life = lifecycleOf(project)
  const can = !access.ctx.archived && access.allowed("project.suspend")
  if (!can || (life !== "live" && life !== "hold")) return null
  const today = todayDay()
  const startOn = (project.pm?.startedAt ?? project.pm?.startOn ?? "").slice(0, 10) || null
  const blocks = holdBlocks({ archived: access.ctx.archived, lifecycle: life, to: "hold", k, text, since, startOn, today })

  const run = async (fn: () => Promise<void>, ok: string) => {
    if (!firestore) return
    setBusy(true)
    try {
      await fn()
      toast({ title: ok })
      setOpen(false)
    } catch (err) {
      console.error(err)
      toast({ title: err instanceof PmAccessError ? t(`refused.${err.code}`) : err instanceof PmHoldError && err.blocks[0] ? t(`hold.block.${err.blocks[0]}`) : t("error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  if (life === "hold")
    return (
      <Button size="sm" variant="outline" disabled={busy} onClick={() => firestore && void run(() => resumeProject(firestore, access.ctx, projectId, actor), t("hold.resumed"))}>
        {busy ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <Play size={14} className="me-1.5" aria-hidden="true" />}
        {t("hold.resume")}
      </Button>
    )

  return (
    <>
      {/* The menu is not modal: a dialog opened from a modal menu inherits its locked pointer events. */}
      {trigger === "menu" ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton icon={MoreHorizontal} label={t("head.more")} variant="outline" className="rounded-xl border border-border bg-card shadow-none hover:bg-muted md:h-9 md:w-9" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => {
              setK(null)
              setText("")
              setNote("")
              setSince(today)
              setOpen(true)
            }} className="gap-2">
              <Pause size={14} aria-hidden="true" />
              {t("hold.hold")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setK(null)
            setText("")
            setNote("")
            setSince(today)
            setOpen(true)
          }}
        >
          <Pause size={14} className="me-1.5" aria-hidden="true" />
          {t("hold.hold")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => !o && !busy && setOpen(false)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("hold.title")}</DialogTitle>
            <DialogDescription>{t("hold.desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                {t("hold.why")} <span className="text-destructive">*</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {HOLD_REASONS.map((r) => (
                  <Chip key={r} selected={k === r} onClick={() => setK(r)} disabled={busy}>
                    {t(`hold.reason.${r}`)}
                  </Chip>
                ))}
              </div>
              {k === "oth" && (
                <Input dir="auto" aria-label={t("hold.reason_text")} placeholder={t("hold.reason_text_ph")} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
              )}
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="hold-since">{t("hold.since")}</Label>
              <Input id="hold-since" type="date" dir="ltr" min={startOn ?? undefined} max={today} value={since} onChange={(e) => setSince(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hold-note">{t("hold.note_label")}</Label>
              <Input id="hold-note" dir="auto" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("hold.why_ph")} disabled={busy} />
            </div>
            <Callout tone="warn">{t("hold.note", { date: pmDate(since || today, locale) })}</Callout>
            <BlockingReasons title={t("cannot_save")} reasons={k ? blocks.filter((b) => b !== "archived").map((b) => t(`hold.block.${b}`)) : []} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button disabled={busy || blocks.length > 0} onClick={() => firestore && void run(() => holdProject(firestore, access.ctx, projectId, actor, { k, text, note, since }), t("hold.held"))}>
              {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
              {t("hold.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The suspension log (WF-28): every suspension with its reason, its days, who suspended it
 * and who ended it — newest first. Nothing when the project was never suspended. */
export function PmHoldLog({ pm }: { pm: HoldPm }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const reason = useHoldReason()
  const today = todayDay()
  const log = (pm.holdLog ?? []).slice().reverse()
  if (!log.length) return null
  return (
    <section aria-labelledby="pm-hold-log" className="mt-3 rounded-lg border bg-muted/30 p-3">
      <h4 id="pm-hold-log" className="flex items-center gap-1.5 text-xs font-bold">
        <History size={13} aria-hidden="true" />
        {t("hold.log_title")}
      </h4>
      <ul className="mt-2 space-y-2">
        {log.map((e, i) => {
          const legacy = !e.k
          const days = dayGap(e.since, e.until ?? today)
          return (
            <li key={`${e.since}-${i}`} className="text-xs leading-relaxed">
              <p className="flex flex-wrap items-center gap-1.5">
                <b dir="auto">{reason(e.k, e.why)}</b>
                {e.until == null ? <StatusPill tone="warn">{t("hold.log_open")}</StatusPill> : null}
              </p>
              <p className="text-muted-foreground">
                {e.until
                  ? t("hold.log_span", { from: pmDate(e.since, locale), to: pmDate(e.until, locale), days: t("days", { count: days }) })
                  : t("hold.log_since", { from: pmDate(e.since, locale), days: t("days", { count: days }) })}
              </p>
              {e.note && (
                <p className="text-muted-foreground" dir="auto">
                  {e.note}
                </p>
              )}
              <p className="text-muted-foreground">
                {legacy
                  ? t("hold.log_resumed_by", { name: e.byName || "—" })
                  : [t("hold.log_by", { name: e.byName || "—" }), e.until ? t(e.end === "final" ? "hold.log_final_by" : "hold.log_resumed_by", { name: e.resByName || "—" }) : null].filter(Boolean).join(" · ")}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
