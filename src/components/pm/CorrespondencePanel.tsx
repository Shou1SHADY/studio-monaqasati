"use client"

// File › Correspondence on a PM 1.0 project (COR-01): letters sent and
// received with their dates, party, reply deadline and the reply with its own
// date. An open letter past its deadline shows red — it is half a claim. The
// consultant portal sits under it, as in the prototype.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { ArrowDownLeft, ArrowUpRight, Loader2, Mail, Paperclip, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { MfgFileField } from "@/components/manufacturing/MfgFileField"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import {
  DEFAULT_REPLY_DAYS,
  isLetterLate,
  isLetterOpen,
  LETTER_DIRS,
  LETTER_PARTIES,
  LETTER_STATUSES,
  lateBy,
  letterAge,
  letterBlocks,
  letterLabel,
  letterNumber,
  PM_LETTERS,
  replyBlocks,
  type LetterDir,
  type LetterParty,
  type LetterStatus,
  type PmLetter,
} from "@/lib/pm/correspondence"
import { logLetter, logReply, PmLetterError, type LetterActor } from "@/lib/pm/correspondence-writes"
import type { PmFile } from "@/lib/pm/documents"
import { pmDate, todayDay } from "@/lib/pm/format"
import { cn } from "@/lib/utils"
import { ConsultantPortalPanel } from "./ConsultantPortalPanel"

const TONE: Record<LetterStatus, PillTone> = { out: "warn", rep: "ok", in: "info", done: "mute" }

const chip = (on: boolean) =>
  cn(
    "min-h-11 rounded-lg border px-3 py-1.5 text-start text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
    on ? "border-module bg-module/10 text-foreground" : "hover:border-module/40",
  )

export function CorrespondencePanel({
  projectId,
  orgId,
  projectName,
  pm,
  items,
  access,
  actor,
}: {
  projectId: string
  orgId: string
  projectName: string
  pm: { no?: string | null; lettersOut?: number; lettersIn?: number; portal?: { sentOn?: string | null; seenOn?: string | null } | null }
  items: Array<{ id: string; code: string; description: string }>
  access: PmAccess
  actor: LetterActor
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()

  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_LETTERS) : null), [firestore, projectId])
  const { data } = useCollection(q)
  const letters = useMemo(() => ((data ?? []) as unknown as PmLetter[]).slice().sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.seq - a.seq)), [data])
  const open = letters.filter(isLetterOpen)
  const late = letters.filter((l) => isLetterLate(l, today))
  const canWrite = !access.ctx.archived && access.allowed("correspondence.write")

  const [adding, setAdding] = useState(false)
  const [dir, setDir] = useState<LetterDir>("out")
  const [party, setParty] = useState<LetterParty>("cons")
  const [subject, setSubject] = useState("")
  const [day, setDay] = useState(today)
  const [due, setDue] = useState(String(DEFAULT_REPLY_DAYS))
  const [links, setLinks] = useState("")
  const [file, setFile] = useState<PmFile | null>(null)

  const [replying, setReplying] = useState<PmLetter | null>(null)
  const [replyText, setReplyText] = useState("")
  const [replyOn, setReplyOn] = useState(today)
  const [replyFile, setReplyFile] = useState<PmFile | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const dueNum = due.trim() === "" ? 0 : Number(due)
  const blocks = letterBlocks({ archived: access.ctx.archived, subject, day, due: dueNum, today })
  const rBlocks = replying ? replyBlocks({ archived: access.ctx.archived, status: replying.status, text: replyText, on: replyOn, letterDay: replying.day, today }) : []
  const nextNo = letterLabel({ dir, no: letterNumber(pm.no, ((dir === "out" ? pm.lettersOut : pm.lettersIn) ?? 0) + 1) }, locale)

  const fail = (err: unknown, prefix: string) => {
    console.error(err)
    toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmLetterError && err.blocks[0] ? `${prefix}.${err.blocks[0]}` : "error.save"), variant: "destructive" })
  }

  const openAdd = () => {
    setDir("out")
    setParty("cons")
    setSubject("")
    setDay(today)
    setDue(String(DEFAULT_REPLY_DAYS))
    setLinks("")
    setFile(null)
    setAdding(true)
  }

  const saveLetter = async () => {
    if (!firestore || blocks.length) return
    setBusy("add")
    try {
      const r = await logLetter(firestore, access.ctx, projectId, actor, { dir, party, subject, day, due: dueNum, links, file })
      toast({ title: t("corr.logged", { no: letterLabel({ dir, no: r.no }, locale) }) })
      setAdding(false)
    } catch (err) {
      fail(err, "corr.block")
    } finally {
      setBusy(null)
    }
  }

  const saveReply = async () => {
    if (!firestore || !replying || rBlocks.length) return
    setBusy("reply")
    try {
      await logReply(firestore, access.ctx, projectId, actor, replying.seq, { text: replyText, on: replyOn, file: replyFile })
      toast({ title: t("corr.replied", { no: letterLabel(replying, locale) }) })
      setReplying(null)
    } catch (err) {
      fail(err, "corr.reply_block")
    } finally {
      setBusy(null)
    }
  }

  const fileLink = (f: PmFile) => (
    <a
      key={f.url}
      href={f.url}
      target="_blank"
      rel="noreferrer"
      aria-label={t("corr.open_file", { name: f.name })}
      className="inline-flex items-center gap-1 rounded-full bg-cta/10 px-2 py-0.5 text-[11px] font-bold text-cta hover:bg-cta/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Paperclip size={11} aria-hidden="true" />1
    </a>
  )

  return (
    <div className="space-y-4">
      <Panel
        title={
          <span className="flex items-center gap-2">
            {t("corr.title")}
            <StatusPill tone={late.length ? "bad" : "mute"}>{open.length}</StatusPill>
          </span>
        }
        icon={Mail}
        actions={
          canWrite ? (
            <Button size="sm" onClick={openAdd}>
              <Plus size={15} className="me-1.5" aria-hidden="true" />
              {t("corr.new")}
            </Button>
          ) : null
        }
      >
        <p className="mb-3 text-xs text-muted-foreground">{t("corr.sub")}</p>
        {letters.length === 0 ? (
          <EmptyState icon={Mail} title={t("corr.empty")} description={t("corr.empty_desc")} />
        ) : (
          <ul className="space-y-2">
            {letters.map((l) => {
              const isLate = isLetterLate(l, today)
              const closed = l.status === "rep" || l.status === "done"
              const known = (LETTER_STATUSES as readonly string[]).includes(l.status)
              const files = [l.file, l.reply?.file].filter((f): f is PmFile => Boolean(f))
              return (
                <li
                  key={l.id}
                  className={cn("flex flex-wrap items-start gap-3 rounded-xl border border-s-4 p-3", closed ? "border-s-success" : isLate ? "border-s-destructive" : "border-s-warning")}
                >
                  <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", l.dir === "out" ? "bg-module/10 text-module" : "bg-cta/10 text-cta")}>
                    {l.dir === "out" ? <ArrowUpRight size={14} className="rtl-flip" aria-hidden="true" /> : <ArrowDownLeft size={14} className="rtl-flip" aria-hidden="true" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">
                      <bdi dir="ltr">{letterLabel(l, locale)}</bdi> — <span dir="auto">{l.subject}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {(LETTER_PARTIES as readonly string[]).includes(l.party) ? t(`corr.party.${l.party}`) : l.party} ·{" "}
                      {t(l.dir === "out" ? "corr.sent" : "corr.received", { date: pmDate(l.day, locale) })}
                      {l.due > 0 ? ` · ${t("corr.deadline", { days: t("days", { count: l.due }) })}` : ""}
                      {l.links?.length ? (
                        <>
                          {" · "}
                          <span dir="auto">{l.links.join(" · ")}</span>
                        </>
                      ) : null}
                    </p>
                    {l.status === "rep" && l.reply && (
                      <p className="mt-0.5 text-xs font-semibold text-success" dir="auto">
                        {t("corr.reply_line", { date: pmDate(l.reply.on, locale), text: l.reply.text })}
                      </p>
                    )}
                    {isLate && (
                      <p className="mt-0.5 text-xs font-bold text-destructive">
                        {t("corr.late", { age: t("days", { count: letterAge(l, today) }), over: t("days", { count: lateBy(l, today) }) })}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {files.map(fileLink)}
                    <StatusPill tone={known ? TONE[l.status] : "bad"}>{known ? t(`corr.status.${l.status}`) : t("unknown_state")}</StatusPill>
                    {canWrite && isLetterOpen(l) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setReplyText("")
                          setReplyOn(today)
                          setReplyFile(null)
                          setReplying(l)
                        }}
                      >
                        {t("corr.log_reply")}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <ConsultantPortalPanel projectId={projectId} projectName={projectName} portal={pm.portal ?? null} letters={letters} items={items} access={access} />

      <Dialog open={adding} onOpenChange={(o) => busy === null && setAdding(o)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("corr.form_title")}</DialogTitle>
            <DialogDescription>
              <span dir="auto">{projectName}</span> — <bdi dir="ltr">{nextNo}</bdi>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("corr.dir_label")}</legend>
              <div className="flex flex-wrap gap-2">
                {LETTER_DIRS.map((k) => (
                  <button key={k} type="button" aria-pressed={dir === k} disabled={busy !== null} onClick={() => setDir(k)} className={chip(dir === k)}>
                    {t(`corr.dir.${k}`)}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("corr.party_label")}</legend>
              <div className="flex flex-wrap gap-2">
                {LETTER_PARTIES.map((k) => (
                  <button key={k} type="button" aria-pressed={party === k} disabled={busy !== null} onClick={() => setParty(k)} className={chip(party === k)}>
                    {t(`corr.party.${k}`)}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="corr-subject">
                {t("corr.subject")} <span className="text-destructive">*</span>
              </Label>
              <Input id="corr-subject" dir="auto" value={subject} placeholder={t("corr.subject_ph")} onChange={(e) => setSubject(e.target.value)} disabled={busy !== null} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="corr-day">{t("corr.day")}</Label>
                <Input id="corr-day" type="date" dir="ltr" value={day} max={today} onChange={(e) => setDay(e.target.value)} disabled={busy !== null} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="corr-due">{t("corr.due")}</Label>
                <Input id="corr-due" type="number" min={0} step={1} dir="ltr" value={due} onChange={(e) => setDue(e.target.value)} disabled={busy !== null} />
                <p className="text-[11px] text-muted-foreground">{t("corr.due_hint")}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="corr-links">{t("corr.links")}</Label>
              <Input id="corr-links" dir="auto" value={links} placeholder={t("corr.links_ph")} onChange={(e) => setLinks(e.target.value)} disabled={busy !== null} />
              <p className="text-[11px] text-muted-foreground">{t("corr.links_hint")}</p>
            </div>
            {orgId && <MfgFileField orgId={orgId} area="pm" folder={`projects/${projectId}/letters`} value={file} onChange={setFile} label={t("corr.attach")} />}
            <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`corr.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void saveLetter()} disabled={busy !== null || blocks.length > 0}>
              {busy === "add" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("corr.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={replying !== null} onOpenChange={(o) => !o && busy === null && setReplying(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("corr.reply_title")}</DialogTitle>
            {replying && (
              <DialogDescription>
                <bdi dir="ltr">{letterLabel(replying, locale)}</bdi> — <span dir="auto">{replying.subject}</span>
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="corr-reply">
                {t("corr.reply_text")} <span className="text-destructive">*</span>
              </Label>
              <Textarea id="corr-reply" dir="auto" value={replyText} placeholder={t("corr.reply_ph")} onChange={(e) => setReplyText(e.target.value)} disabled={busy !== null} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="corr-reply-day">{t("corr.reply_day")}</Label>
              <Input id="corr-reply-day" type="date" dir="ltr" value={replyOn} min={replying?.day} max={today} onChange={(e) => setReplyOn(e.target.value)} disabled={busy !== null} />
              {replying && (
                <p className="text-[11px] text-muted-foreground">{t(replying.dir === "out" ? "corr.reply_hint_out" : "corr.reply_hint_in", { date: pmDate(replying.day, locale) })}</p>
              )}
            </div>
            {orgId && <MfgFileField orgId={orgId} area="pm" folder={`projects/${projectId}/letters`} value={replyFile} onChange={setReplyFile} label={t("corr.reply_attach")} />}
            <BlockingReasons title={t("cannot_save")} reasons={rBlocks.map((b) => t(`corr.reply_block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplying(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void saveReply()} disabled={busy !== null || rBlocks.length > 0}>
              {busy === "reply" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("corr.log_reply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
