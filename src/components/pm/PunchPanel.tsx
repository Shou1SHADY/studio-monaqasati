"use client"

// Execution › Punch list on a PM 1.0 project (WF-17, PN-01…03). Open items
// first, critical before normal; "fixed" waits for the raising party's
// confirmation and is not closed until it is recorded. While any item is open
// there is no final acceptance.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { CheckCheck, ListTodo, Loader2, Plus, Wrench } from "lucide-react"
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
import { pmDate } from "@/lib/pm/format"
import { isOpenPunch, PM_PUNCH, PUNCH_SEVERITIES, PUNCH_SOURCES, PUNCH_STATUSES, punchBlocks, punchNo, type PunchItem, type PunchSeverity, type PunchSource, type PunchStatus } from "@/lib/pm/punch"
import { PmPunchError, raisePunch, recordConfirmation, recordFix, type PunchActor } from "@/lib/pm/punch-writes"

const TONE: Record<PunchStatus, PillTone> = { open: "warn", fix: "info", done: "ok" }

export function PunchPanel({ projectId, access, actor }: { projectId: string; access: PmAccess; actor: PunchActor }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [raising, setRaising] = useState(false)
  const [what, setWhat] = useState("")
  const [location, setLocation] = useState("")
  const [severity, setSeverity] = useState<PunchSeverity>("b")
  const [source, setSource] = useState<PunchSource>("cons")
  const [sourceText, setSourceText] = useState("")
  const [fixing, setFixing] = useState<PunchItem | null>(null)
  const [fixNote, setFixNote] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_PUNCH) : null), [firestore, projectId])
  const { data } = useCollection(q)
  const items = useMemo(() => {
    const rank = (p: PunchItem) => (p.status === "done" ? 2 : 0) + (p.severity === "a" ? 0 : 1)
    return ((data ?? []) as unknown as PunchItem[]).slice().sort((a, b) => rank(a) - rank(b) || b.seq - a.seq)
  }, [data])
  const open = items.filter(isOpenPunch)
  const canQa = !access.ctx.archived && access.allowed("qa.record")
  const partyName = (p: PunchItem) => (p.source === "oth" ? t("amend.other_stated", { text: p.sourceText ?? "" }) : t(`punch.source.${p.source}`))
  const blocks = punchBlocks({ archived: access.ctx.archived, what, location, source, sourceText })

  const fail = (err: unknown) => {
    console.error(err)
    toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmPunchError && err.blocks[0] ? `punch.block.${err.blocks[0]}` : "error.save"), variant: "destructive" })
  }

  const raise = async () => {
    if (!firestore || blocks.length) return
    setBusy("raise")
    try {
      const seq = await raisePunch(firestore, access.ctx, projectId, actor, { what, location, severity, source, sourceText })
      toast({ title: t("punch.raised", { no: punchNo(seq) }) })
      setRaising(false)
      setWhat("")
      setLocation("")
      setSourceText("")
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const fix = async () => {
    if (!firestore || !fixing) return
    setBusy("fix")
    try {
      await recordFix(firestore, access.ctx, projectId, actor, fixing.seq, fixNote)
      toast({ title: t("punch.fixed", { no: punchNo(fixing.seq), party: partyName(fixing) }) })
      setFixing(null)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const confirm = async (p: PunchItem) => {
    if (!firestore) return
    setBusy(`c${p.seq}`)
    try {
      await recordConfirmation(firestore, access.ctx, projectId, actor, p.seq)
      toast({ title: t("punch.closed", { no: punchNo(p.seq), count: Math.max(0, open.length - 1) }) })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  return (
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
      {open.length > 0 && <Callout tone="warn" className="mb-4">{t("punch.blocks_final", { count: open.length })}</Callout>}
      {items.length === 0 ? (
        <EmptyState icon={ListTodo} title={t("punch.empty")} description={t("punch.empty_desc")} />
      ) : (
        <ul className="space-y-2">
          {items.map((p) => {
            const known = (PUNCH_STATUSES as readonly string[]).includes(p.status)
            return (
              <li key={p.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      <span dir="auto">
                        {t("punch.no", { no: punchNo(p.seq) })} — {p.what}
                      </span>
                      <StatusPill tone={p.severity === "a" ? "bad" : "mute"}>{t(`punch.sev.${p.severity}`)}</StatusPill>
                      <StatusPill tone={known ? TONE[p.status] : "bad"}>{known ? t(`punch.status.${p.status}`, { party: partyName(p) }) : t("unknown_state")}</StatusPill>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                      {t("punch.line", { location: p.location, party: partyName(p), date: pmDate(p.day, locale) })}
                    </p>
                    {p.fix && <p className="mt-0.5 text-xs text-muted-foreground">{t("punch.fix_line", { date: pmDate(p.fix.on, locale), who: p.fix.byName || "—", note: p.fix.note || "" })}</p>}
                    {p.conf && <p className="mt-0.5 text-xs text-muted-foreground">{t("punch.conf_line", { date: pmDate(p.conf.on, locale), who: p.conf.byName || "—" })}</p>}
                  </div>
                  {canQa && p.status === "open" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setFixNote("")
                        setFixing(p)
                      }}
                    >
                      <Wrench size={14} className="me-1.5" aria-hidden="true" />
                      {t("punch.record_fix")}
                    </Button>
                  )}
                  {canQa && p.status === "fix" && (
                    <Button size="sm" onClick={() => void confirm(p)} disabled={busy !== null}>
                      {busy === `c${p.seq}` ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <CheckCheck size={14} className="me-1.5" aria-hidden="true" />}
                      {t("punch.record_conf", { party: partyName(p) })}
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
            <DialogTitle>{t("punch.new")}</DialogTitle>
            <DialogDescription>{t("punch.new_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pn-what">{t("punch.what")}</Label>
              <Input id="pn-what" value={what} onChange={(e) => setWhat(e.target.value)} disabled={busy !== null} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pn-loc">{t("punch.location")}</Label>
              <Input id="pn-loc" value={location} onChange={(e) => setLocation(e.target.value)} disabled={busy !== null} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
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
              </div>
            </div>
            {source === "oth" && (
              <div className="space-y-1.5">
                <Label htmlFor="pn-src-text">{t("punch.source_text")}</Label>
                <Input id="pn-src-text" value={sourceText} onChange={(e) => setSourceText(e.target.value)} disabled={busy !== null} />
              </div>
            )}
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("punch.record_fix")}</DialogTitle>
            <DialogDescription>{fixing ? t("punch.fix_desc", { party: partyName(fixing) }) : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="pn-fix-note">{t("punch.fix_note")}</Label>
            <Textarea id="pn-fix-note" value={fixNote} onChange={(e) => setFixNote(e.target.value)} disabled={busy !== null} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFixing(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void fix()} disabled={busy !== null}>
              {busy === "fix" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("punch.record_fix")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
