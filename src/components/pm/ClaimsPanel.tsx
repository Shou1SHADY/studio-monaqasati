"use client"

// Contract › Claims & programme on a PM 1.0 project (WF-07, CLM-01…03, PRG-02).
// The effective duration is the original plus approved extensions; expected
// delay damages run on it under the terms in force. A claim's notice deadline
// runs from its event; the client's response is mandatory, days mandatory
// unless rejected, and granted days issue a new programme revision.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { CalendarClock, Gavel, Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { progressOf } from "@/lib/pm/acceptance"
import { inForce, PM_ADDENDA, type PmAddendum } from "@/lib/pm/addenda"
import {
  CLAIM_KINDS,
  CLAIM_RESPONSES,
  CLAIM_STATUSES,
  claimBlocks,
  claimNo,
  delayAndDamages,
  grantedDays,
  noticeDeadline,
  noticeLate,
  PM_CLAIMS,
  programmeRevision,
  respondBlocks,
  type ClaimKind,
  type ClaimStatus,
  type PmClaim,
} from "@/lib/pm/claim"
import { draftClaim, PmClaimError, respondToClaim, sendClaimNotice, submitClaim, type ClaimActor } from "@/lib/pm/claim-writes"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { plannedEnd } from "@/lib/pm/lifecycle"
import type { ContractTerms } from "@/lib/pm/terms"
import { approvedValue, PM_VARIATIONS, type PmVariation } from "@/lib/pm/variation"

const TONE: Record<ClaimStatus, PillTone> = { draft: "mute", notice: "info", sub: "warn", appr: "ok", part: "ok", rej: "bad" }

export function ClaimsPanel({
  projectId,
  lifecycle,
  original,
  startOn,
  durationDays,
  baseValue,
  items,
  access,
  actor,
}: {
  projectId: string
  lifecycle: string
  original: ContractTerms
  startOn: string | null
  durationDays: number
  baseValue: number
  items: Array<{ quantity: number; rate: number; executed: number }>
  access: PmAccess
  actor: ClaimActor
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [drafting, setDrafting] = useState(false)
  const [kind, setKind] = useState<ClaimKind>("time")
  const [cause, setCause] = useState("")
  const [eventOn, setEventOn] = useState(today)
  const [days, setDays] = useState("")
  const [amount, setAmount] = useState("")
  const [responding, setResponding] = useState<{ c: PmClaim; response: string; days: string; amount: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const money = access.has("money")
  const seesTerms = money || access.has("approve")
  const claimQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_CLAIMS) : null), [firestore, projectId])
  const { data: claimData } = useCollection(claimQ)
  const addQ = useMemoFirebase(() => (firestore && seesTerms ? collection(firestore, "projects", projectId, PM_ADDENDA) : null), [firestore, projectId, seesTerms])
  const { data: addenda } = useCollection(addQ)
  const voQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_VARIATIONS) : null), [firestore, projectId])
  const { data: vos } = useCollection(voQ)

  const claims = useMemo(() => ((claimData ?? []) as unknown as PmClaim[]).slice().sort((a, b) => b.seq - a.seq), [claimData])
  const terms = useMemo(() => inForce(original, (addenda ?? []) as unknown as PmAddendum[]), [original, addenda])
  const extension = grantedDays(claims)
  const effective = durationDays + extension
  const contractValue = baseValue + approvedValue((vos ?? []) as unknown as PmVariation[])
  const delay = delayAndDamages({ lifecycle, startOn, effectiveDays: effective, progress: progressOf(items), contractValue, damages: terms.damages, today })

  const canDraft = !access.ctx.archived && access.allowed("claim.draft")
  const canSubmit = !access.ctx.archived && access.allowed("claim.submit")
  const canRespond = !access.ctx.archived && access.allowed("claim.respond")
  const num = (s: string) => (s.trim() === "" ? 0 : Number(s))
  const blocks = claimBlocks({ archived: access.ctx.archived, lifecycle, kind, cause, eventOn, daysAsked: num(days), amountAsked: num(amount), today })
  const rBlocks = responding
    ? respondBlocks({ archived: access.ctx.archived, status: responding.c.status, kind: responding.c.kind, response: responding.response || undefined, days: responding.days === "" ? null : Number(responding.days), amount: responding.amount === "" ? null : Number(responding.amount) })
    : []

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    if (!firestore) return false
    setBusy(key)
    try {
      await fn()
      toast({ title: ok })
      return true
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmClaimError && err.blocks[0] ? `claim.block.${err.blocks[0]}` : "error.save"), variant: "destructive" })
      return false
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <Panel title={t("claim.programme")} icon={CalendarClock}>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <KeyValueRow label={t("claim.original_days")} value={t("days", { count: durationDays })} />
          <KeyValueRow label={t("claim.extension")} value={t("days", { count: extension })} />
          <KeyValueRow label={t("claim.effective_days")} value={t("days", { count: effective })} strong />
          <KeyValueRow label={t("claim.revision")} value={`R${programmeRevision(claims)}`} ltr />
          <KeyValueRow label={t("claim.planned_end")} value={startOn ? pmDate(plannedEnd(startOn.slice(0, 10), durationDays, extension), locale) : "—"} />
          <KeyValueRow label={t("claim.delay")} value={delay ? t("claim.delay_value", { days: delay.delayDays, planned: delay.planned }) : "—"} />
          {money && <KeyValueRow label={t("claim.damages")} value={delay && terms.damages.on ? pmMoney(delay.damages) : t("claim.damages_off")} ltr />}
        </div>
        {!delay && <p className="mt-2 text-xs text-muted-foreground">{t("claim.no_delay_yet")}</p>}
      </Panel>

      <Panel
        title={t("claim.title")}
        icon={Gavel}
        count={claims.filter((c) => c.status === "sub").length || undefined}
        actions={
          canDraft ? (
            <Button size="sm" onClick={() => setDrafting(true)}>
              <Plus size={15} className="me-1.5" aria-hidden="true" />
              {t("claim.new")}
            </Button>
          ) : null
        }
      >
        {claims.length === 0 ? (
          <EmptyState icon={Gavel} title={t("claim.empty")} description={t("claim.empty_desc")} />
        ) : (
          <ul className="space-y-2">
            {claims.map((c) => {
              const known = (CLAIM_STATUSES as readonly string[]).includes(c.status)
              const late = noticeLate(c, terms, today)
              return (
                <li key={c.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                        <span>{t("claim.no", { no: claimNo(c.seq) })}</span>
                        <StatusPill tone="mute">{t(`claim.kind.${c.kind}`)}</StatusPill>
                        <StatusPill tone={known ? TONE[c.status] : "bad"}>{known ? t(`claim.status.${c.status}`) : t("unknown_state")}</StatusPill>
                        {late && <StatusPill tone="bad">{t("claim.notice_late")}</StatusPill>}
                      </p>
                      <p className="mt-0.5 text-sm" dir="auto">
                        {c.cause}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("claim.line", { event: pmDate(c.eventOn, locale), deadline: pmDate(noticeDeadline(c.eventOn, terms), locale), days: c.daysAsked })}
                        {money && c.amountAsked > 0 ? ` · ${pmMoney(c.amountAsked)}` : ""}
                      </p>
                      {c.response && (c.status === "appr" || c.status === "part") && (
                        <p className="mt-0.5 text-xs text-success">
                          {t("claim.granted", { days: c.response.days, rev: c.revision ?? 0 })}
                          {money && c.response.amount > 0 ? ` · ${pmMoney(c.response.amount)}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canDraft && c.status === "draft" && (
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => firestore && void run(`n${c.seq}`, () => sendClaimNotice(firestore, access.ctx, projectId, c.seq), t("claim.noticed"))}>
                          {t("claim.send_notice")}
                        </Button>
                      )}
                      {canSubmit && c.status === "notice" && (
                        <Button size="sm" disabled={busy !== null} onClick={() => firestore && void run(`s${c.seq}`, () => submitClaim(firestore, access.ctx, projectId, c.seq), t("claim.submitted"))}>
                          {t("claim.submit")}
                        </Button>
                      )}
                      {canRespond && c.status === "sub" && (
                        <Button size="sm" onClick={() => setResponding({ c, response: "", days: "", amount: "" })}>
                          {t("claim.record_response")}
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

      <Dialog open={drafting} onOpenChange={setDrafting}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("claim.new")}</DialogTitle>
            <DialogDescription>{t("claim.new_desc", { days: terms.claimNoticeDays })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cl-kind">{t("claim.kind_label")}</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as ClaimKind)} disabled={busy !== null}>
                  <SelectTrigger id="cl-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAIM_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`claim.kind.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cl-event">{t("claim.event_on")}</Label>
                <Input id="cl-event" type="date" dir="ltr" max={today} value={eventOn} onChange={(e) => setEventOn(e.target.value)} disabled={busy !== null} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cl-cause">{t("claim.cause")}</Label>
              <Textarea id="cl-cause" value={cause} onChange={(e) => setCause(e.target.value)} disabled={busy !== null} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {kind !== "cost" && (
                <div className="space-y-1.5">
                  <Label htmlFor="cl-days">{t("claim.days_asked")}</Label>
                  <Input id="cl-days" dir="ltr" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} disabled={busy !== null} />
                </div>
              )}
              {kind !== "time" && (
                <div className="space-y-1.5">
                  <Label htmlFor="cl-amt">{t("claim.amount_asked")}</Label>
                  <Input id="cl-amt" dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy !== null} />
                </div>
              )}
            </div>
            <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`claim.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDrafting(false)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy !== null || blocks.length > 0}
              onClick={async () => {
                if (!firestore) return
                const ok = await run("draft", () => draftClaim(firestore, access.ctx, projectId, actor, { kind, cause, eventOn, daysAsked: num(days), amountAsked: num(amount) }), t("claim.drafted"))
                if (ok) {
                  setDrafting(false)
                  setCause("")
                  setDays("")
                  setAmount("")
                }
              }}
            >
              {busy === "draft" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("claim.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={responding !== null} onOpenChange={(o) => !o && setResponding(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("claim.record_response")}</DialogTitle>
            <DialogDescription>{t("claim.response_desc")}</DialogDescription>
          </DialogHeader>
          {responding && (
            <div className="space-y-4">
              <RadioGroup value={responding.response} onValueChange={(v) => setResponding({ ...responding, response: v })} className="gap-2">
                {CLAIM_RESPONSES.map((r) => (
                  <label key={r} className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm">
                    <RadioGroupItem value={r} />
                    {t(`claim.status.${r}`)}
                  </label>
                ))}
              </RadioGroup>
              {responding.response && responding.response !== "rej" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {responding.c.kind !== "cost" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="cl-got-days">{t("claim.days_granted")}</Label>
                      <Input id="cl-got-days" dir="ltr" inputMode="numeric" value={responding.days} onChange={(e) => setResponding({ ...responding, days: e.target.value })} />
                    </div>
                  )}
                  {responding.c.kind !== "time" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="cl-got-amt">{t("claim.amount_granted")}</Label>
                      <Input id="cl-got-amt" dir="ltr" inputMode="decimal" value={responding.amount} onChange={(e) => setResponding({ ...responding, amount: e.target.value })} />
                    </div>
                  )}
                </div>
              )}
              <BlockingReasons title={t("cannot_save")} reasons={rBlocks.map((b) => t(`claim.block.${b}`))} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResponding(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy !== null || rBlocks.length > 0}
              onClick={async () => {
                if (!firestore || !responding) return
                const ok = await run(
                  "resp",
                  () =>
                    respondToClaim(firestore, access.ctx, projectId, actor, responding.c.seq, {
                      response: responding.response || undefined,
                      days: responding.days === "" ? null : Number(responding.days),
                      amount: responding.amount === "" ? null : Number(responding.amount),
                    }),
                  t("claim.responded")
                )
                if (ok) setResponding(null)
              }}
            >
              {busy === "resp" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("claim.save_response")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
