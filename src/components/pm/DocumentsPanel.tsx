"use client"

// File › Documents on a PM 1.0 project (DOC-01): the register of documents and
// their revisions, answering which revision is current. A drawing revised
// after the last certificate is stale — the work was measured against an older
// drawing. The last certificate is read only by those who see amounts (the
// rules keep certificates from everyone else); for them the project's
// `pm.lastIpcOn` is used when the certificate write keeps it.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { FileText, Loader2, Paperclip, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MfgFileField } from "@/components/manufacturing/MfgFileField"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import {
  currentRevision,
  DOC_TYPES,
  isStale,
  issuedAfterCertificate,
  lastCertificateDay,
  nextRevisionCode,
  PM_DOCS,
  previousCode,
  revisionBlocks,
  type DocType,
  type PmDocument,
  type PmFile,
} from "@/lib/pm/documents"
import { issueRevision, PmDocError, registerDocument, type DocActor } from "@/lib/pm/documents-writes"
import { pmDate, todayDay } from "@/lib/pm/format"
import { cn } from "@/lib/utils"

const chip = (on: boolean) =>
  cn(
    "min-h-11 rounded-lg border px-3 py-1.5 text-start text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
    on ? "border-module bg-module/10 text-foreground" : "hover:border-module/40",
  )

export function DocumentsPanel({
  projectId,
  orgId,
  projectName,
  lastIpcOn,
  access,
  actor,
}: {
  projectId: string
  orgId: string
  projectName: string
  lastIpcOn?: string | null
  access: PmAccess
  actor: DocActor
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const money = access.has("money")

  const docsQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_DOCS) : null), [firestore, projectId])
  const certsQ = useMemoFirebase(() => (firestore && money ? collection(firestore, "projects", projectId, PM_CERTIFICATES) : null), [firestore, projectId, money])
  const { data: docsData } = useCollection(docsQ)
  const { data: certData } = useCollection(certsQ)
  const docs = useMemo(() => ((docsData ?? []) as unknown as PmDocument[]).map((d) => ({ ...d, revisions: d.revisions ?? [] })).sort((a, b) => a.seq - b.seq), [docsData])
  const lastCert = useMemo(
    () => (money ? lastCertificateDay((certData ?? []) as unknown as Array<{ status: string; prepOn?: string | null }>) : lastIpcOn ?? null),
    [money, certData, lastIpcOn],
  )
  const stale = docs.filter((d) => isStale(d, lastCert))
  const canManage = !access.ctx.archived && access.allowed("document.manage")

  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState<number | "new">("new")
  const [name, setName] = useState("")
  const [type, setType] = useState<DocType>("dwg")
  const [code, setCode] = useState("")
  const [day, setDay] = useState(todayDay())
  const [file, setFile] = useState<PmFile | null>(null)
  const [busy, setBusy] = useState(false)

  const picked = pick === "new" ? null : docs.find((d) => d.seq === pick) ?? null
  const pickedCurrent = picked ? currentRevision(picked) : null
  const blocks = revisionBlocks({ archived: access.ctx.archived, isNew: pick === "new", doc: picked, name, code, day, today: todayDay() })
  const warnAfterIpc = issuedAfterCertificate({ type: picked?.type ?? null, hasCurrent: Boolean(pickedCurrent), day, lastCertDay: lastCert })

  const choose = (next: number | "new") => {
    setPick(next)
    const d = next === "new" ? null : docs.find((x) => x.seq === next)
    setCode(nextRevisionCode(d ? currentRevision(d)?.code : null))
  }

  const openForm = () => {
    setName("")
    setType("dwg")
    setDay(todayDay())
    setFile(null)
    choose(docs[0]?.seq ?? "new")
    setOpen(true)
  }

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      if (pick === "new") {
        await registerDocument(firestore, access.ctx, projectId, actor, { name, type, code, day, file })
        toast({ title: code.trim() ? t("docs.saved") : t("docs.registered") })
      } else {
        await issueRevision(firestore, access.ctx, projectId, actor, pick, { code, day, file })
        toast({ title: warnAfterIpc ? t("docs.saved_stale") : t("docs.saved") })
      }
      setOpen(false)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmDocError && err.blocks[0] ? `docs.block.${err.blocks[0]}` : "error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const typeLabel = (k: string) => ((DOC_TYPES as readonly string[]).includes(k) ? t(`docs.type.${k}`) : k)
  const arrow = locale === "ar" ? "←" : "→"
  const fileOf = (d: PmDocument) => currentRevision(d)?.file ?? d.file ?? null

  return (
    <Panel
      title={t("docs.title")}
      icon={FileText}
      actions={
        canManage ? (
          <Button size="sm" variant="outline" onClick={openForm}>
            <Plus size={15} className="me-1.5" aria-hidden="true" />
            {t("docs.new")}
          </Button>
        ) : null
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">{t("docs.sub")}</p>

      {stale.length > 0 && (
        <Callout tone="block" className="mb-3">
          <b>{t("docs.stale_head", { count: stale.length })}</b>{" "}
          {stale.map((d, i) => (
            <span key={d.id}>
              {i > 0 && " · "}
              <span dir="auto">{d.name}</span> <bdi dir="ltr">{previousCode(d)}</bdi> {arrow} <b><bdi dir="ltr">{currentRevision(d)?.code}</bdi></b> ({pmDate(currentRevision(d)?.day, locale)})
            </span>
          ))}{" "}
          — {t("docs.stale_body")}
        </Callout>
      )}

      {docs.length === 0 ? (
        <EmptyState icon={FileText} title={t("docs.empty")} description={t("docs.empty_desc")} />
      ) : (
        <ul className="divide-y rounded-xl border">
          {docs.map((d) => {
            const cur = currentRevision(d)
            const prev = previousCode(d)
            const f = fileOf(d)
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold" dir="auto">
                    {d.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {typeLabel(d.type)} · {pmDate(cur?.day ?? d.day, locale)}
                    {prev ? ` · ${t("docs.superseded", { code: prev })}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {f && (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t("docs.open_file", { name: f.name })}
                      className="inline-flex items-center gap-1 rounded-full bg-cta/10 px-2 py-0.5 text-[11px] font-bold text-cta hover:bg-cta/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Paperclip size={11} aria-hidden="true" />1
                    </a>
                  )}
                  {cur ? (
                    <StatusPill tone={isStale(d, lastCert) ? "bad" : "ok"}>{t("docs.current", { code: cur.code })}</StatusPill>
                  ) : (
                    <StatusPill tone="mute">{t("docs.no_revisions")}</StatusPill>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("docs.form_title")}</DialogTitle>
            <DialogDescription dir="auto">{projectName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("docs.document")}</legend>
              <div className="flex flex-wrap gap-2">
                {docs.map((d) => (
                  <button key={d.id} type="button" aria-pressed={pick === d.seq} disabled={busy} onClick={() => choose(d.seq)} className={chip(pick === d.seq)}>
                    <span dir="auto">{d.name}</span> <span className="text-xs text-muted-foreground" dir="ltr">{currentRevision(d)?.code ?? "—"}</span>
                  </button>
                ))}
                <button type="button" aria-pressed={pick === "new"} disabled={busy} onClick={() => choose("new")} className={cn(chip(pick === "new"), "inline-flex items-center gap-1")}>
                  <Plus size={13} aria-hidden="true" />
                  {t("docs.new_document")}
                </button>
              </div>
            </fieldset>

            {pick === "new" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="doc-name">
                    {t("docs.name")} <span className="text-destructive">*</span>
                  </Label>
                  <Input id="doc-name" dir="auto" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">{t("docs.type_label")}</legend>
                  <div className="flex flex-wrap gap-2">
                    {DOC_TYPES.map((k) => (
                      <button key={k} type="button" aria-pressed={type === k} disabled={busy} onClick={() => setType(k)} className={chip(type === k)}>
                        {t(`docs.type.${k}`)}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="doc-code">{t("docs.code")}</Label>
                <Input id="doc-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
                <p className="text-[11px] text-muted-foreground">{pickedCurrent ? t("docs.code_hint", { code: pickedCurrent.code }) : pick === "new" ? t("docs.code_hint_new") : null}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-day">{t("docs.day")}</Label>
                <Input id="doc-day" type="date" dir="ltr" value={day} max={todayDay()} onChange={(e) => setDay(e.target.value)} disabled={busy} />
              </div>
            </div>

            {warnAfterIpc && (
              <Callout tone="warn">{t("docs.after_ipc")}</Callout>
            )}

            {orgId && <MfgFileField orgId={orgId} area="pm" folder={`projects/${projectId}/docs`} value={file} onChange={setFile} label={t("docs.attach")} />}

            <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`docs.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("docs.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
