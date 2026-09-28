"use client"

// Execution › Punch list on a PM 1.0 project (WF-17, PN-01…03), as the
// prototype's execPunch: three tiles (open · closed · effect), then the list —
// open items first, critical before normal. "Fixed" waits for the confirmation
// and is not closed until it is recorded: who confirmed, on which day, with
// what proof. Each step carries its own day and photos (before · after · the
// walk minute). While any item is open there is no final acceptance.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { AlertTriangle, Check, CheckCheck, ListTodo, Loader2, Lock, Plus, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import type { PmAttachment } from "@/lib/pm/attachments"
import { pmDate, todayDay } from "@/lib/pm/format"
import { isOpenPunch, PM_PUNCH, PUNCH_SEVERITIES, PUNCH_SOURCES, PUNCH_STATUSES, punchBlocks, punchNo, punchStepBlocks, type PunchItem, type PunchSeverity, type PunchSource, type PunchStatus } from "@/lib/pm/punch"
import { PmPunchError, raisePunch, recordConfirmation, recordFix, type PunchActor } from "@/lib/pm/punch-writes"
import { cn } from "@/lib/utils"
import { AttachmentTag, PmFilesField } from "./PmAttachments"

const TONE: Record<PunchStatus, PillTone> = { open: "warn", fix: "info", done: "ok" }

export function PunchPanel({ projectId, orgId, access, actor, bare }: { projectId: string; orgId?: string | null; access: PmAccess; actor: PunchActor; bare?: boolean }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [raising, setRaising] = useState(false)
  const [what, setWhat] = useState("")
  const [location, setLocation] = useState("")
  const [severity, setSeverity] = useState<PunchSeverity>("b")
  const [source, setSource] = useState<PunchSource>("cons")
  const [sourceText, setSourceText] = useState("")
  const [day, setDay] = useState(today)
  const [files, setFiles] = useState<PmAttachment[]>([])
  const [fixing, setFixing] = useState<PunchItem | null>(null)
  const [fixNote, setFixNote] = useState("")
  const [fixOn, setFixOn] = useState(today)
  const [fixFiles, setFixFiles] = useState<PmAttachment[]>([])
  const [confirming, setConfirming] = useState<PunchItem | null>(null)
  const [confParty, setConfParty] = useState<PunchSource>("cons")
  const [confText, setConfText] = useState("")
  const [confOn, setConfOn] = useState(today)
  const [confFiles, setConfFiles] = useState<PmAttachment[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_PUNCH) : null), [firestore, projectId])
  const { data } = useCollection(q)
  const items = useMemo(() => {
    const rank = (p: PunchItem) => (p.status === "done" ? 2 : 0) + (p.severity === "a" ? 0 : 1)
    return ((data ?? []) as unknown as PunchItem[]).slice().sort((a, b) => rank(a) - rank(b) || b.seq - a.seq)
  }, [data])
  const open = items.filter(isOpenPunch)
  const critical = open.filter((p) => p.severity === "a").length
  const canQa = !access.ctx.archived && access.allowed("qa.record")
  const srcName = (s: PunchSource, text?: string | null) => (s === "oth" ? t("amend.other_stated", { text: text ?? "" }) : t(`punch.source.${s}`))
  const partyName = (p: PunchItem) => srcName(p.source, p.sourceText)
  const blocks = punchBlocks({ archived: access.ctx.archived, what, location, source, sourceText, day, today })
  const fixBlocks = fixing ? punchStepBlocks({ archived: access.ctx.archived, status: fixing.status, step: "fix", note: fixNote, day: fixOn, today, after: fixing.day }) : []
  const confBlocks = confirming
    ? punchStepBlocks({ archived: access.ctx.archived, status: confirming.status, step: "confirm", party: confParty, partyText: confText, day: confOn, today, after: confirming.fix?.on ?? confirming.day })
    : []

  const fail = (err: unknown) => {
    console.error(err)
    toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmPunchError && err.blocks[0] ? `punch.block.${err.blocks[0]}` : "error.save"), variant: "destructive" })
  }

  const raise = async () => {
    if (!firestore || blocks.length) return
    setBusy("raise")
    try {
      const seq = await raisePunch(firestore, access.ctx, projectId, actor, { what, location, severity, source, sourceText, day, files })
      toast({ title: t("punch.raised", { no: punchNo(seq) }) })
      setRaising(false)
      setWhat("")
      setLocation("")
      setSourceText("")
      setDay(todayDay())
      setFiles([])
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const fix = async () => {
    if (!firestore || !fixing || fixBlocks.length) return
    setBusy("fix")
    try {
      await recordFix(firestore, access.ctx, projectId, actor, fixing.seq, fixNote, { on: fixOn, files: fixFiles })
      toast({ title: t("punch.fixed", { no: punchNo(fixing.seq), party: partyName(fixing) }) })
      setFixing(null)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const confirm = async () => {
    if (!firestore || !confirming || confBlocks.length) return
    setBusy("conf")
    try {
      await recordConfirmation(firestore, access.ctx, projectId, actor, confirming.seq, { on: confOn, party: confParty, partyText: confText, files: confFiles })
      toast({ title: t("punch.closed", { no: punchNo(confirming.seq), count: Math.max(0, open.length - 1) }) })
      setConfirming(null)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {!bare && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <AlertTriangle size={12} aria-hidden="true" />
              {t("punch.k_open")}
            </p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", open.length ? "text-destructive" : "text-success")}>{open.length}</p>
            <p className="text-xs text-muted-foreground">{t("punch.k_open_sub", { count: critical })}</p>
          </div>
          <div className="rounded-xl border bg-card p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Check size={12} aria-hidden="true" />
              {t("punch.k_closed")}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{items.length - open.length}</p>
            <p className="text-xs text-muted-foreground">{t("punch.k_closed_sub", { count: items.length })}</p>
          </div>
          <div className="rounded-xl border bg-card p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Lock size={12} aria-hidden="true" />
              {t("punch.k_effect")}
            </p>
            <p className="mt-1 text-sm font-bold">{open.length ? t("punch.k_blocks") : t("punch.k_clear")}</p>
            <p className="text-xs text-muted-foreground">{t("punch.k_effect_sub")}</p>
          </div>
        </div>
      )}
      <Panel
        title={t("punch.title")}
        icon={ListTodo}
        count={open.length || undefined}
        actions={
          canQa ? (
            <Button size="sm" onClick={() => setRaising(true)}>
              <Plus size={15} className="me-1.5" aria-hidden="true" />
              {t("punch.new")}
            </Button>
          ) : null
        }
      >
        {bare && open.length > 0 && (
          <Callout tone="warn" className="mb-4">
            {t("punch.blocks_final", { count: open.length })}
          </Callout>
        )}
        {items.length === 0 ? (
          <EmptyState icon={ListTodo} title={t("punch.empty")} description={t("punch.empty_desc")} />
        ) : (
          <ul className="space-y-2">
            {items.map((p) => {
              const known = (PUNCH_STATUSES as readonly string[]).includes(p.status)
              return (
                <li key={p.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="text-sm font-bold" dir="auto">
                        {t("punch.no", { no: punchNo(p.seq) })} — {p.what}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                        {t("punch.line2", { location: p.location, party: partyName(p), date: pmDate(p.day, locale), who: p.byName || "—" })}
                      </p>
                      {p.fix && (
                        <p className="mt-0.5 text-xs font-semibold text-success" dir="auto">
                          {t("punch.fix_line2", { note: p.fix.note || "—", date: pmDate(p.fix.on, locale), who: p.fix.byName || "—" })}
                        </p>
                      )}
                      {p.conf && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("punch.conf_line2", { party: srcName(p.conf.party, p.conf.partyText), date: pmDate(p.conf.on, locale), who: p.conf.byName || "—" })}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <AttachmentTag files={p.files} />
                      <AttachmentTag files={p.fix?.files} tone="teal" />
                      <AttachmentTag files={p.conf?.files} tone="teal" />
                      <StatusPill tone={p.severity === "a" ? "bad" : "mute"}>{t(`punch.sev.${p.severity}`)}</StatusPill>
                      <StatusPill tone={known ? TONE[p.status] : "bad"}>{known ? t(`punch.status.${p.status}`, { party: partyName(p) }) : t("unknown_state")}</StatusPill>
                      {canQa && p.status === "open" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setFixNote("")
                            setFixOn(todayDay())
                            setFixFiles([])
                            setFixing(p)
                          }}
                        >
                          <Wrench size={14} className="me-1.5" aria-hidden="true" />
                          {t("punch.record_fix")}
                        </Button>
                      )}
                      {canQa && p.status === "fix" && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setConfParty(p.source)
                            setConfText(p.source === "oth" ? p.sourceText ?? "" : "")
                            setConfOn(todayDay())
                            setConfFiles([])
                            setConfirming(p)
                          }}
                        >
                          <CheckCheck size={14} className="me-1.5" aria-hidden="true" />
                          {t("punch.record_conf2")}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <Dialog open={raising} onOpenChange={setRaising}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("punch.new")}</DialogTitle>
            <DialogDescription>{t("punch.new_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pn-what">{t("punch.what")}</Label>
              <Input id="pn-what" value={what} placeholder={t("punch.what_ph")} onChange={(e) => setWhat(e.target.value)} disabled={busy !== null} dir="auto" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pn-loc">{t("punch.location")}</Label>
                <Input id="pn-loc" value={location} placeholder={t("punch.location_ph")} onChange={(e) => setLocation(e.target.value)} disabled={busy !== null} dir="auto" />
                <p className="text-[11px] text-muted-foreground">{t("punch.location_hint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pn-day">{t("punch.day")}</Label>
                <Input id="pn-day" type="date" dir="ltr" max={today} value={day} onChange={(e) => setDay(e.target.value)} disabled={busy !== null} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pn-src">{t("punch.raised_by")}</Label>
                <Select value={source} onValueChange={(v) => setSource(v as PunchSource)} disabled={busy !== null}>
                  <SelectTrigger id="pn-src">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PUNCH_SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`punch.source.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">{t("punch.raised_hint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pn-sev">{t("punch.severity")}</Label>
                <Select value={severity} onValueChange={(v) => setSeverity(v as PunchSeverity)} disabled={busy !== null}>
                  <SelectTrigger id="pn-sev">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PUNCH_SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`punch.sev.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {source === "oth" && (
              <div className="space-y-1.5">
                <Label htmlFor="pn-src-text">{t("punch.source_text")}</Label>
                <Input id="pn-src-text" value={sourceText} onChange={(e) => setSourceText(e.target.value)} disabled={busy !== null} />
              </div>
            )}
            <PmFilesField orgId={orgId} folder={`projects/${projectId}/punch`} value={files} onChange={setFiles} label={t("punch.photo")} hint={t("punch.photo_hint")} disabled={busy !== null} />
            <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`punch.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRaising(false)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void raise()} disabled={busy !== null || blocks.length > 0}>
              {busy === "raise" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("punch.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fixing !== null} onOpenChange={(o) => !o && setFixing(null)}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("punch.record_fix")}</DialogTitle>
            <DialogDescription>{fixing ? t("punch.fix_note2", { party: partyName(fixing) }) : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pn-fix-note">
                {t("punch.fix_what")}
                <span className="ms-0.5 text-destructive">*</span>
              </Label>
              <Textarea id="pn-fix-note" value={fixNote} placeholder={t("punch.fix_ph")} onChange={(e) => setFixNote(e.target.value)} disabled={busy !== null} dir="auto" />
              <p className="text-[11px] text-muted-foreground">{t("punch.fix_hint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pn-fix-on">{t("punch.fix_date")}</Label>
              <Input id="pn-fix-on" type="date" dir="ltr" max={today} value={fixOn} onChange={(e) => setFixOn(e.target.value)} disabled={busy !== null} />
            </div>
            <PmFilesField orgId={orgId} folder={`projects/${projectId}/punch`} value={fixFiles} onChange={setFixFiles} label={t("punch.after_photo")} hint={t("punch.after_hint")} disabled={busy !== null} />
            <BlockingReasons title={t("cannot_save")} reasons={fixBlocks.map((b) => t(`punch.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFixing(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void fix()} disabled={busy !== null || fixBlocks.length > 0}>
              {busy === "fix" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("punch.record_fix")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("punch.conf_title")}</DialogTitle>
            <DialogDescription dir="auto">{confirming ? `${t("punch.no", { no: punchNo(confirming.seq) })} — ${confirming.what}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Callout tone="info">{t("punch.conf_note")}</Callout>
            <div className="space-y-1.5">
              <Label htmlFor="pn-conf-party">{t("punch.conf_who")}</Label>
              <Select value={confParty} onValueChange={(v) => setConfParty(v as PunchSource)} disabled={busy !== null}>
                <SelectTrigger id="pn-conf-party">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PUNCH_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`punch.source.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {confParty === "oth" && (
              <div className="space-y-1.5">
                <Label htmlFor="pn-conf-text">{t("punch.source_text")}</Label>
                <Input id="pn-conf-text" value={confText} onChange={(e) => setConfText(e.target.value)} disabled={busy !== null} />
              </div>
            )}
            {confirming?.fix && <Callout tone="info">{t("punch.recorded_fix", { note: confirming.fix.note || "—", date: pmDate(confirming.fix.on, locale), who: confirming.fix.byName || "—" })}</Callout>}
            <div className="space-y-1.5">
              <Label htmlFor="pn-conf-on">{t("punch.conf_date")}</Label>
              <Input id="pn-conf-on" type="date" dir="ltr" max={today} value={confOn} onChange={(e) => setConfOn(e.target.value)} disabled={busy !== null} />
            </div>
            <PmFilesField orgId={orgId} folder={`projects/${projectId}/punch`} value={confFiles} onChange={setConfFiles} label={t("punch.conf_proof")} hint={t("punch.conf_proof_hint")} disabled={busy !== null} />
            <BlockingReasons title={t("cannot_save")} reasons={confBlocks.map((b) => t(`punch.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void confirm()} disabled={busy !== null || confBlocks.length > 0}>
              {busy === "conf" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("punch.close_item")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
