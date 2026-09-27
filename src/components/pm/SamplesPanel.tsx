"use client"

// Execution › Material samples on a PM 1.0 project (WF-16, SUB-01…03, INV-18).
// Whoever approves marks the items whose contract requires a sample; each is
// approved only when the consultant says so — no sample is not consent.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Loader2, Plus, Settings2, TestTube } from "lucide-react"
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
import { pmDate } from "@/lib/pm/format"
import { PM_SUBMITTALS, replyBlocks, SAMPLE_REPLIES, SAMPLE_STATUSES, sampleApproved, sampleNo, sampleStateOf, submitBlocks, type PmSubmittal, type SampleState, type SampleStatus } from "@/lib/pm/sample"
import { PmSampleError, recordSampleReply, setSampleRequired, submitSample, type SampleActor } from "@/lib/pm/sample-writes"

const STATUS_TONE: Record<SampleStatus, PillTone> = { sub: "info", appA: "ok", appB: "ok", rej: "bad" }
const STATE_TONE: Record<SampleState, PillTone> = { free: "mute", approved: "ok", with_consultant: "info", rejected: "bad", not_submitted: "warn" }

export interface SampleItem {
  id: string
  code: string
  description: string
  pmSample?: boolean | null
  pmSub?: string | null
}

export function SamplesPanel({ projectId, items, access, actor, onItemsChanged }: { projectId: string; items: SampleItem[]; access: PmAccess; actor: SampleActor; onItemsChanged?: () => void }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [itemId, setItemId] = useState("")
  const [supplier, setSupplier] = useState("")
  const [replying, setReplying] = useState<{ s: PmSubmittal; reply: string; note: string } | null>(null)
  const [editing, setEditing] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_SUBMITTALS) : null), [firestore, projectId])
  const { data } = useCollection(q)
  const subs = useMemo(() => ((data ?? []) as unknown as PmSubmittal[]).slice().sort((a, b) => b.seq - a.seq), [data])
  const required = items.filter((i) => i.pmSample)
  const missing = required.filter((i) => !sampleApproved(i))
  const canRecord = !access.ctx.archived && access.allowed("submittal.record")
  const canMark = !access.ctx.archived && access.allowed("project.edit")
  const label = (id: string) => {
    const i = items.find((x) => x.id === id)
    return i ? [i.code, i.description].filter(Boolean).join(" · ") : id
  }
  const chosen = items.find((i) => i.id === itemId)
  const blocks = submitBlocks({ archived: access.ctx.archived, itemId: itemId || null, supplier, pmSub: chosen?.pmSub })
  const rBlocks = replying ? replyBlocks({ archived: access.ctx.archived, status: replying.s.status, reply: replying.reply || undefined }) : []

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

  return (
    <Panel
      title={t("sample.title")}
      icon={TestTube}
      count={missing.length || undefined}
      actions={
        <>
          {canMark && (
            <Button size="sm" variant="outline" onClick={() => setEditing(new Set(required.map((i) => i.id)))}>
              <Settings2 size={15} className="me-1.5" aria-hidden="true" />
              {t("sample.mark")}
            </Button>
          )}
          {canRecord && (
            <Button size="sm" onClick={() => setSubmitting(true)} disabled={!items.length}>
              <Plus size={15} className="me-1.5" aria-hidden="true" />
              {t("sample.submit")}
            </Button>
          )}
        </>
      }
    >
      {missing.length > 0 && <Callout tone="warn" className="mb-4">{t("sample.missing", { count: missing.length })}</Callout>}
      {required.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-2">
          {required.map((i) => {
            const s = sampleStateOf(i)
            return (
              <li key={i.id} className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs">
                <span dir="auto">{label(i.id)}</span>
                <StatusPill tone={STATE_TONE[s]}>{t(`sample.state.${s}`)}</StatusPill>
              </li>
            )
          })}
        </ul>
      )}
      {subs.length === 0 ? (
        <EmptyState icon={TestTube} title={t("sample.empty")} description={t("sample.empty_desc")} />
      ) : (
        <ul className="space-y-2">
          {subs.map((s) => {
            const known = (SAMPLE_STATUSES as readonly string[]).includes(s.status)
            return (
              <li key={s.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      <span dir="auto">
                        {t("sample.no", { no: sampleNo(s.seq) })} — {label(s.itemId)}
                      </span>
                      <StatusPill tone="mute">{t("sample.rev", { n: s.rev })}</StatusPill>
                      <StatusPill tone={known ? STATUS_TONE[s.status] : "bad"}>{known ? t(`sample.status.${s.status}`) : t("unknown_state")}</StatusPill>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                      {t("sample.line", { supplier: s.supplier, date: pmDate(s.day, locale), who: s.byName || "—" })}
                    </p>
                    {s.reply?.note && (
                      <p className="mt-0.5 text-xs" dir="auto">
                        {s.reply.note}
                      </p>
                    )}
                  </div>
                  {canRecord && s.status === "sub" && (
                    <Button size="sm" onClick={() => setReplying({ s, reply: "", note: "" })}>
                      {t("sample.record_reply")}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={submitting} onOpenChange={setSubmitting}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("sample.submit")}</DialogTitle>
            <DialogDescription>{t("sample.submit_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("sample.item")}</Label>
              <SearchableSelect
                value={itemId}
                onChange={setItemId}
                options={[...items].sort((a, b) => Number(Boolean(b.pmSample)) - Number(Boolean(a.pmSample))).map((i) => ({ value: i.id, label: label(i.id), keywords: i.code, group: i.pmSample ? t("sample.group_required") : t("sample.group_other") }))}
                placeholder={t("sample.pick_item")}
                searchPlaceholder={t("sample.search_item")}
                noResultsText={t("sample.no_item")}
                ariaLabel={t("sample.item")}
                disabled={busy !== null}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smp-sup">{t("sample.supplier")}</Label>
              <Input id="smp-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)} disabled={busy !== null} />
            </div>
            <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`sample.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitting(false)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy !== null || blocks.length > 0}
              onClick={async () => {
                if (!firestore) return
                const ok = await run("sub", () => submitSample(firestore, access.ctx, projectId, actor, { itemId, supplier }), t("sample.submitted"))
                if (ok) {
                  setSubmitting(false)
                  setItemId("")
                  setSupplier("")
                }
              }}
            >
              {busy === "sub" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("sample.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={replying !== null} onOpenChange={(o) => !o && setReplying(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sample.record_reply")}</DialogTitle>
            <DialogDescription>{t("sample.reply_desc")}</DialogDescription>
          </DialogHeader>
          {replying && (
            <div className="space-y-4">
              <RadioGroup value={replying.reply} onValueChange={(v) => setReplying({ ...replying, reply: v })} className="gap-2">
                {SAMPLE_REPLIES.map((r) => (
                  <label key={r} className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm">
                    <RadioGroupItem value={r} />
                    {t(`sample.status.${r}`)}
                  </label>
                ))}
              </RadioGroup>
              <div className="space-y-1.5">
                <Label htmlFor="smp-note">{t("sample.note")}</Label>
                <Textarea id="smp-note" value={replying.note} onChange={(e) => setReplying({ ...replying, note: e.target.value })} />
              </div>
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
                const ok = await run("reply", () => recordSampleReply(firestore, access.ctx, projectId, actor, replying.s.seq, { reply: replying.reply || undefined, note: replying.note }), t("sample.replied"))
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
    </Panel>
  )
}
