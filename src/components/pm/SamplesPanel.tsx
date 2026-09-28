"use client"

// Material samples on a PM 1.0 project (WF-16, SUB-01…03, INV-18), as the
// prototype's supSubm: a gate before purchasing — nothing is bought or built
// before its sample is approved, and no sample is not consent. The register
// shows what was submitted, the item, the proposed supplier, the revisions,
// the consultant's turnaround (open days in amber) and the average at the
// foot; a rejected one is resubmitted as the next revision. Whoever approves
// marks the items whose contract requires a sample.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Loader2, Plus, RotateCcw, Settings2, TestTube } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
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
import { PmAccessError } from "@/lib/pm/access"
import type { PmAttachment } from "@/lib/pm/attachments"
import { pmDate, todayDay } from "@/lib/pm/format"
import {
  averageTurnaround,
  canResubmit,
  PM_SUBMITTALS,
  replyBlocks,
  SAMPLE_REPLIES,
  SAMPLE_STATUSES,
  sampleApproved,
  sampleNo,
  submitBlocks,
  turnaround,
  type PmSubmittal,
  type SampleStatus,
} from "@/lib/pm/sample"
import { PmSampleError, recordSampleReply, setSampleRequired, submitSample, type SampleActor } from "@/lib/pm/sample-writes"
import { cn } from "@/lib/utils"
import { AttachmentTag, PmFilesField } from "./PmAttachments"

const STATUS_TONE: Record<SampleStatus, PillTone> = { sub: "info", appA: "ok", appB: "ok", rej: "bad" }

export interface SampleItem {
  id: string
  code: string
  description: string
  pmSample?: boolean | null
  pmSub?: string | null
}

type Draft = { itemId: string; what: string; supplier: string; day: string; files: PmAttachment[] }
const EMPTY = (): Draft => ({ itemId: "", what: "", supplier: "", day: todayDay(), files: [] })

export function SamplesPanel({
  projectId,
  orgId,
  items,
  access,
  actor,
  onItemsChanged,
}: {
  projectId: string
  orgId?: string | null
  items: SampleItem[]
  access: PmAccess
  actor: SampleActor
  onItemsChanged?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [replying, setReplying] = useState<{ s: PmSubmittal; reply: string; note: string; on: string; files: PmAttachment[] } | null>(null)
  const [editing, setEditing] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_SUBMITTALS) : null), [firestore, projectId])
  const { data } = useCollection(q)
  const subs = useMemo(() => ((data ?? []) as unknown as PmSubmittal[]).slice().sort((a, b) => b.day.localeCompare(a.day) || b.seq - a.seq), [data])
  const required = items.filter((i) => i.pmSample)
  const missing = required.filter((i) => !sampleApproved(i))
  const openCount = subs.filter((s) => s.status === "sub" || (s.status === "rej" && canResubmit(s, subs))).length
  const avg = averageTurnaround(subs, today)
  const resubmitted = subs.filter((s) => s.rev > 1).length
  const canRecord = !access.ctx.archived && access.allowed("submittal.record")
  const canMark = !access.ctx.archived && access.allowed("project.edit")
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const label = (id: string) => {
    const i = byId.get(id)
    return i ? [i.code, i.description].filter(Boolean).join(" · ") : id
  }
  const chosen = draft ? byId.get(draft.itemId) : undefined
  const blocks = draft ? submitBlocks({ archived: access.ctx.archived, itemId: draft.itemId || null, supplier: draft.supplier, pmSub: chosen?.pmSub, what: draft.what, day: draft.day, today }) : []
  const openOnItem = draft?.itemId ? subs.find((s) => s.itemId === draft.itemId && s.status === "sub") : undefined
  const rBlocks = replying ? replyBlocks({ archived: access.ctx.archived, status: replying.s.status, reply: replying.reply || undefined, note: replying.note, on: replying.on, today, submittedOn: replying.s.day }) : []

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    if (!firestore) return false
    setBusy(key)
    try {
      await fn()
      toast({ title: ok })
      onItemsChanged?.()
      return true
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmSampleError && err.blocks[0] ? `sample.block.${err.blocks[0]}` : "error.save"), variant: "destructive" })
      return false
    } finally {
      setBusy(null)
    }
  }

  const firstMissing = required.find((i) => !sampleApproved(i) && i.pmSub !== "sub")

  return (
    <div className="space-y-4">
      <Callout tone="info">{t("sample.intro")}</Callout>
      {missing.length > 0 && (
        <Callout tone="warn" title={t("sample.missing2", { count: missing.length })}>
          <span dir="ltr">
            {missing
              .slice(0, 4)
              .map((i) => i.code)
              .join(" · ")}
            {missing.length > 4 ? " …" : ""}
          </span>
        </Callout>
      )}
      <Panel
        title={t("sample.title2")}
        icon={TestTube}
        count={openCount || undefined}
        bodyClassName="p-0"
        actions={
          <>
            {canMark && (
              <Button size="sm" variant="outline" onClick={() => setEditing(new Set(required.map((i) => i.id)))}>
                <Settings2 size={15} className="me-1.5" aria-hidden="true" />
                {t("sample.mark")}
              </Button>
            )}
            {canRecord && (
              <Button size="sm" onClick={() => setDraft({ ...EMPTY(), itemId: firstMissing?.id ?? "", what: firstMissing?.description ?? "" })} disabled={!items.length}>
                <Plus size={15} className="me-1.5" aria-hidden="true" />
                {t("sample.submit")}
              </Button>
            )}
          </>
        }
      >
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("sample.sub2", { open: openCount, total: subs.length })}</p>
        {subs.length === 0 ? (
          <EmptyState icon={TestTube} title={t("sample.empty")} description={t("sample.empty_desc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-start font-semibold">{t("sample.col_no")}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t("sample.item")}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t("sample.col_supplier")}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t("sample.col_revs")}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t("sample.col_turn")}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t("sample.col_status")}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {subs.map((s) => {
                  const known = (SAMPLE_STATUSES as readonly string[]).includes(s.status)
                  const i = byId.get(s.itemId)
                  const turn = turnaround(s, today)
                  return (
                    <tr key={s.id} className="align-top">
                      <td className="px-4 py-2.5">
                        <p className="font-semibold" dir="auto">
                          {s.what || i?.description || s.code}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("sample.no", { no: sampleNo(s.seq) })} · {pmDate(s.day, locale)}
                        </p>
                        {s.reply?.note && (
                          <p className={cn("mt-0.5 text-xs font-semibold", s.status === "rej" ? "text-destructive" : "text-warning")} dir="auto">
                            {s.reply.note}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        <span dir="ltr">{i?.code ?? s.code}</span>
                        {i?.description && (
                          <p className="text-muted-foreground" dir="auto">
                            {i.description.slice(0, 26)}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs" dir="auto">
                        {s.supplier}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <StatusPill tone={s.rev > 1 ? "warn" : "mute"}>{s.rev}</StatusPill>
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs">
                        {turn.open ? <span className="font-bold text-warning">{t("sample.open_for", { count: turn.days })}</span> : t("days", { count: turn.days })}
                        <div className="mt-1 flex justify-center gap-1">
                          <AttachmentTag files={s.files} />
                          <AttachmentTag files={s.reply?.files} tone="teal" />
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusPill tone={known ? STATUS_TONE[s.status] : "bad"}>{known ? t(`sample.status.${s.status}`) : t("unknown_state")}</StatusPill>
                      </td>
                      <td className="px-4 py-2.5 text-end">
                        {canRecord && s.status === "sub" && (
                          <Button size="sm" onClick={() => setReplying({ s, reply: "", note: "", on: today, files: [] })}>
                            {t("sample.record_reply")}
                          </Button>
                        )}
                        {canRecord && canResubmit(s, subs) && (
                          <Button size="sm" variant="outline" onClick={() => setDraft({ itemId: s.itemId, what: s.what ?? i?.description ?? "", supplier: s.supplier, day: today, files: [] })}>
                            <RotateCcw size={14} className="me-1.5" aria-hidden="true" />
                            {t("sample.resubmit")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {avg !== null && (
          <p className="border-t bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
            {t("sample.avg", { days: t("days", { count: avg }), count: resubmitted })}
          </p>
        )}
      </Panel>

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("sample.form_title")}</DialogTitle>
            <DialogDescription>{t("sample.form_note")}</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t("sample.item")}</Label>
                <SearchableSelect
                  value={draft.itemId}
                  onChange={(v) => setDraft({ ...draft, itemId: v, what: draft.what || byId.get(v)?.description || "" })}
                  options={[...items]
                    .sort((a, b) => Number(Boolean(b.pmSample)) - Number(Boolean(a.pmSample)))
                    .map((i) => ({ value: i.id, label: label(i.id) + (i.pmSample && sampleApproved(i) ? ` (${t("sample.approved_tag")})` : ""), keywords: i.code, group: i.pmSample ? t("sample.group_required") : t("sample.group_other") }))}
                  placeholder={t("sample.pick_item")}
                  searchPlaceholder={t("sample.search_item")}
                  noResultsText={t("sample.no_item")}
                  ariaLabel={t("sample.item")}
                  disabled={busy !== null}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smp-what">{t("sample.what")}</Label>
                <Input id="smp-what" value={draft.what} placeholder={t("sample.what_ph")} onChange={(e) => setDraft({ ...draft, what: e.target.value })} disabled={busy !== null} dir="auto" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="smp-sup">{t("sample.supplier2")}</Label>
                  <Input id="smp-sup" value={draft.supplier} placeholder={t("sample.supplier_ph")} onChange={(e) => setDraft({ ...draft, supplier: e.target.value })} disabled={busy !== null} dir="auto" />
                  <p className="text-[11px] text-muted-foreground">{t("sample.supplier_hint")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smp-day">{t("sample.submitted_on")}</Label>
                  <Input id="smp-day" type="date" dir="ltr" max={today} value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })} disabled={busy !== null} />
                  <p className="text-[11px] text-muted-foreground">{t("sample.submitted_hint")}</p>
                </div>
              </div>
              {openOnItem && <Callout tone="warn">{t("sample.open_warn", { no: sampleNo(openOnItem.seq), days: t("days", { count: turnaround(openOnItem, today).days }) })}</Callout>}
              <PmFilesField orgId={orgId} folder={`projects/${projectId}/samples`} value={draft.files} onChange={(files) => setDraft({ ...draft, files })} label={t("sample.files")} hint={t("sample.files_hint")} disabled={busy !== null} />
              <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`sample.block.${b}`))} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy !== null || blocks.length > 0}
              onClick={async () => {
                if (!firestore || !draft) return
                const ok = await run("sub", () => submitSample(firestore, access.ctx, projectId, actor, draft), t("sample.submitted"))
                if (ok) setDraft(null)
              }}
            >
              {busy === "sub" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("sample.submit_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={replying !== null} onOpenChange={(o) => !o && setReplying(null)}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("sample.record_reply")}</DialogTitle>
            <DialogDescription dir="auto">{replying ? `${t("sample.no", { no: sampleNo(replying.s.seq) })} — ${replying.s.what || label(replying.s.itemId)}` : ""}</DialogDescription>
          </DialogHeader>
          {replying && (
            <div className="space-y-4">
              <Callout tone="info">{t("sample.reply_note", { date: pmDate(replying.s.day, locale), days: t("days", { count: turnaround(replying.s, today).days }), code: replying.s.code ?? "" })}</Callout>
              <RadioGroup value={replying.reply} onValueChange={(v) => setReplying({ ...replying, reply: v })} className="gap-2" aria-label={t("sample.reply")}>
                {SAMPLE_REPLIES.map((r) => (
                  <label key={r} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm">
                    <RadioGroupItem value={r} />
                    {t(`sample.status.${r}`)}
                  </label>
                ))}
              </RadioGroup>
              <div className="space-y-1.5">
                <Label htmlFor="smp-note">
                  {t("sample.consultant_note")}
                  {(replying.reply === "rej" || replying.reply === "appB") && <span className="ms-0.5 text-destructive">*</span>}
                </Label>
                <Textarea id="smp-note" value={replying.note} placeholder={replying.reply === "rej" ? t("sample.note_ph_rej") : t("sample.note_ph")} onChange={(e) => setReplying({ ...replying, note: e.target.value })} dir="auto" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smp-rd">{t("sample.reply_date")}</Label>
                <Input id="smp-rd" type="date" dir="ltr" max={today} value={replying.on} onChange={(e) => setReplying({ ...replying, on: e.target.value })} />
              </div>
              <PmFilesField orgId={orgId} folder={`projects/${projectId}/samples`} value={replying.files} onChange={(files) => setReplying({ ...replying, files })} label={t("sample.reply_files")} disabled={busy !== null} />
              {replying.reply === "rej" && <Callout tone="block">{t("sample.rej_warn")}</Callout>}
              <BlockingReasons title={t("cannot_save")} reasons={rBlocks.map((b) => t(`sample.block.${b}`))} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplying(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy !== null || rBlocks.length > 0}
              onClick={async () => {
                if (!firestore || !replying) return
                const ok = await run(
                  "reply",
                  () => recordSampleReply(firestore, access.ctx, projectId, actor, replying.s.seq, { reply: replying.reply || undefined, note: replying.note, on: replying.on, files: replying.files }),
                  t("sample.replied")
                )
                if (ok) setReplying(null)
              }}
            >
              {busy === "reply" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("sample.save_reply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("sample.mark")}</DialogTitle>
            <DialogDescription>{t("sample.mark_desc")}</DialogDescription>
          </DialogHeader>
          {editing && (
            <ul className="space-y-1.5">
              {items.map((i) => (
                <li key={i.id}>
                  <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm">
                    <Checkbox
                      checked={editing.has(i.id)}
                      onCheckedChange={(v) => {
                        const next = new Set(editing)
                        if (v === true) next.add(i.id)
                        else next.delete(i.id)
                        setEditing(next)
                      }}
                    />
                    <span dir="auto">{label(i.id)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy !== null}
              onClick={async () => {
                if (!firestore || !editing) return
                const changes = items.filter((i) => Boolean(i.pmSample) !== editing.has(i.id))
                const ok = await run(
                  "mark",
                  async () => {
                    for (const i of changes) await setSampleRequired(firestore, access.ctx, projectId, i.id, editing.has(i.id))
                  },
                  t("sample.marked", { count: editing.size })
                )
                if (ok) setEditing(null)
              }}
            >
              {busy === "mark" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("sample.save_mark")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
