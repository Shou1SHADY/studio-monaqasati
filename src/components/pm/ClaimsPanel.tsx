"use client"

// Contract › Claims on a PM 1.0 project (WF-07, CLM-01…03). A claim is won by
// timely notice and dated evidence — not by being right. The register counts
// the notice period from the event, links the obstacle that proves it, and
// prices an extension by the delay damages it would remove. Only what happened
// and when are required to log one: the days are estimated at submission,
// never invented. The client's response is mandatory; granted days issue the
// next programme revision.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { AlertTriangle, Clock, Coins, Gavel, Link2, Loader2, Plus, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { progressOf } from "@/lib/pm/acceptance"
import { inForce, PM_ADDENDA, type PmAddendum } from "@/lib/pm/addenda"
import {
  CLAIM_CAUSES,
  CLAIM_KINDS,
  CLAIM_RESPONSES,
  CLAIM_STATUSES,
  claimBlocks,
  claimNo,
  claimStepBlocks,
  delayAndDamages,
  grantedDays,
  noticeAfter,
  noticeDaysLeft,
  noticeLate,
  openClaims,
  penaltyAvoided,
  PM_CLAIMS,
  programmeRevision,
  respondBlocks,
  daysFrom,
  type ClaimCause,
  type ClaimKind,
  type ClaimStatus,
  type DelayInput,
  type PmClaim,
} from "@/lib/pm/claim"
import { draftClaim, PmClaimError, respondToClaim, sendClaimNotice, submitClaim, type ClaimActor } from "@/lib/pm/claim-writes"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { PM_ACTIVITIES, programmeK, type PmActivity } from "@/lib/pm/programme"
import { isOpenObstacle, obstacleDays, obstacleSeq, PM_OBSTACLES, type ClaimSeed, type PmObstacle } from "@/lib/pm/site"
import type { ContractTerms } from "@/lib/pm/terms"
import { approvedValue, PM_VARIATIONS, type PmVariation } from "@/lib/pm/variation"
import { cn } from "@/lib/utils"
import { ChoiceChips, FormHint } from "./ContractBits"

const TONE: Record<ClaimStatus, PillTone> = { draft: "mute", notice: "info", sub: "warn", appr: "ok", part: "ok", rej: "bad" }
const SEED_CAUSE: Record<ClaimSeed["causedBy"], ClaimCause> = { client: "emp", consultant: "cons", other: "oth" }

type Submit = { c: PmClaim; days: string; amount: string }
type Respond = { c: PmClaim; response: string; days: string; amount: string; ref: string }

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
  seed,
  onSeedUsed,
}: {
  projectId: string
  lifecycle: string
  original: ContractTerms
  startOn: string | null
  durationDays: number
  baseValue: number
  items: Array<{ id?: string; quantity: number; rate: number; executed: number }>
  access: PmAccess
  actor: ClaimActor
  /** A claim drafted from an obstacle on Execution › Site: the composer opens on it. */
  seed?: ClaimSeed | null
  onSeedUsed?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [drafting, setDrafting] = useState(false)
  const [kind, setKind] = useState<ClaimKind>("time")
  const [cause, setCause] = useState("")
  const [causedBy, setCausedBy] = useState<ClaimCause>("emp")
  const [causedByText, setCausedByText] = useState("")
  const [eventOn, setEventOn] = useState("")
  const [days, setDays] = useState("")
  const [amount, setAmount] = useState("")
  const [noticeToday, setNoticeToday] = useState(false)
  const [obstacleId, setObstacleId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<Submit | null>(null)
  const [responding, setResponding] = useState<Respond | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const money = access.has("money")
  const seesTerms = money || access.has("approve")
  const claimQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_CLAIMS) : null), [firestore, projectId])
  const { data: claimData } = useCollection(claimQ)
  const addQ = useMemoFirebase(() => (firestore && seesTerms ? collection(firestore, "projects", projectId, PM_ADDENDA) : null), [firestore, projectId, seesTerms])
  const { data: addenda } = useCollection(addQ)
  const voQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_VARIATIONS) : null), [firestore, projectId])
  const { data: vos } = useCollection(voQ)
  const obsQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_OBSTACLES) : null), [firestore, projectId])
  const { data: obsData } = useCollection(obsQ)
  const actQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_ACTIVITIES) : null), [firestore, projectId])
  const { data: actData } = useCollection(actQ)
  const obstacles = useMemo(() => (obsData ?? []) as unknown as PmObstacle[], [obsData])
  const openObstacles = obstacles.filter(isOpenObstacle)
  const obsNo = (o: Pick<PmObstacle, "type" | "seq">) => t(`site.obs.no.${o.type}`, { no: obstacleSeq(o.seq) })

  const claims = useMemo(() => ((claimData ?? []) as unknown as PmClaim[]).slice().sort((a, b) => b.eventOn.localeCompare(a.eventOn) || b.seq - a.seq), [claimData])
  const terms = useMemo(() => inForce(original, (addenda ?? []) as unknown as PmAddendum[]), [original, addenda])
  const effective = durationDays + grantedDays(claims)
  const contractValue = baseValue + approvedValue((vos ?? []) as unknown as PmVariation[])
  const start = startOn ? startOn.slice(0, 10) : null
  const k = useMemo(
    () => programmeK({ acts: (actData ?? []) as unknown as PmActivity[], items: items.map((i, n) => ({ id: i.id ?? String(n), quantity: i.quantity, rate: i.rate })), startOn: start, durationDays, today }),
    [actData, items, start, durationDays, today]
  )
  const delayInput: DelayInput = { lifecycle, startOn: start, effectiveDays: effective, progress: progressOf(items), contractValue, damages: terms.damages, today, curveK: k }
  const open = openClaims(claims)
  const pendingDays = open.filter((c) => c.kind !== "cost").reduce((a, c) => a + (c.daysAsked || 0), 0)
  const worth = open.reduce((a, c) => a + penaltyAvoided(c, delayInput), 0)
  const late = claims.filter((c) => noticeLate(c, terms, today))

  const canDraft = !access.ctx.archived && access.allowed("claim.draft")
  const canApprove = !access.ctx.archived && access.allowed("claim.submit")
  const canRespond = !access.ctx.archived && access.allowed("claim.respond")

  useEffect(() => {
    if (!seed) return
    if (canDraft) {
      setKind("time")
      setCause(seed.cause)
      setEventOn(seed.eventOn)
      setCausedBy(SEED_CAUSE[seed.causedBy])
      setObstacleId(seed.obstacleId)
      setDrafting(true)
    }
    onSeedUsed?.()
  }, [seed, canDraft, onSeedUsed])

  const num = (s: string) => (s.trim() === "" ? 0 : Number(s))
  const blocks = claimBlocks({ archived: access.ctx.archived, lifecycle, kind, cause, eventOn, daysAsked: num(days), amountAsked: money ? num(amount) : 0, today, causedBy, causedByText })
  const sBlocks = submitting
    ? claimStepBlocks({ archived: access.ctx.archived, status: submitting.c.status, step: "submit", kind: submitting.c.kind, daysAsked: num(submitting.days), amountAsked: num(submitting.amount) })
    : []
  const rBlocks = responding
    ? respondBlocks({ archived: access.ctx.archived, status: responding.c.status, kind: responding.c.kind, response: responding.response || undefined, days: responding.days === "" ? null : Number(responding.days), amount: responding.amount === "" ? null : Number(responding.amount) })
    : []
  const preview = (() => {
    if (!responding || responding.c.kind === "cost" || !money || !terms.damages.on) return null
    const g = num(responding.days)
    if (!(g > 0) || responding.response === "rej" || !responding.response) return null
    const now = delayAndDamages(delayInput)
    const after = delayAndDamages({ ...delayInput, effectiveDays: effective + g })
    return { rev: programmeRevision(claims) + 1, days: effective + g, from: now?.damages ?? 0, to: after?.damages ?? 0 }
  })()

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

  const causeName = (c: PmClaim) => (c.causedBy ? (c.causedBy === "oth" && c.causedByText ? t("amend.other_stated", { text: c.causedByText }) : t(`claim.caused.${c.causedBy}`)) : null)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile icon={Gavel} label={t("claim.tile.open")} value={String(open.length)} note={pendingDays ? t("claim.tile.pending", { days: t("days", { count: pendingDays }) }) : t("claim.tile.no_pending")} />
        <Tile
          icon={Coins}
          label={t("claim.tile.worth")}
          value={terms.damages.on && money ? pmMoney(worth) : "—"}
          note={terms.damages.on ? t("claim.tile.worth_note") : t("claim.tile.no_penalty")}
          tone={worth > 0 ? "good" : undefined}
        />
        <Tile
          icon={Clock}
          label={t("claim.tile.notice")}
          value={t("days", { count: terms.claimNoticeDays })}
          note={late.length ? t("claim.tile.missed", { count: late.length }) : t("claim.tile.none_missed")}
          tone={late.length ? "bad" : undefined}
        />
      </div>

      <Callout tone="info">{t("claim.won_by")}</Callout>

      <Panel
        title={t("claim.register")}
        icon={Gavel}
        count={open.length || undefined}
        actions={
          canDraft ? (
            <Button size="sm" onClick={() => setDrafting(true)}>
              <Plus size={15} className="me-1.5" aria-hidden="true" />
              {t("claim.new")}
            </Button>
          ) : null
        }
        bodyClassName="p-0"
      >
        {claims.length === 0 ? (
          <EmptyState icon={Gavel} title={t("claim.empty")} description={t("claim.empty_desc")} className="p-6" />
        ) : (
          <ul className="divide-y">
            {claims.map((c) => {
              const known = (CLAIM_STATUSES as readonly string[]).includes(c.status)
              const isLate = noticeLate(c, terms, today)
              const left = noticeDaysLeft(c, terms, today)
              const after = noticeAfter(c)
              const v = penaltyAvoided(c, delayInput)
              const o = c.obstacleId ? obstacles.find((x) => x.id === c.obstacleId) : null
              const who = causeName(c)
              return (
                <li key={c.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      <span dir="auto">
                        {t("claim.no", { no: claimNo(c.seq) })} — {c.cause}
                      </span>
                      <StatusPill tone={known ? TONE[c.status] : "bad"}>{known ? t(`claim.status.${c.status}`) : t("unknown_state")}</StatusPill>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t(`claim.kind.${c.kind}`)}
                      {who && ` · ${t("claim.caused_by_line", { who })}`}
                      {` · ${t("claim.event_line", { date: pmDate(c.eventOn, locale) })} · `}
                      {after !== null && c.noticeOn ? t("claim.noticed_after", { date: pmDate(c.noticeOn, locale), days: t("days", { count: after }) }) : t("claim.no_notice")}
                    </p>
                    {o && (
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <Link2 size={12} className="text-module" aria-hidden="true" />
                        {t("claim.evidence", {
                          no: obsNo(o),
                          state: o.closeOn ? t("site.obs.closed_after", { count: obstacleDays(o, today) }) : t("site.obs.open_for", { count: obstacleDays(o, today) }),
                          chases: o.chases?.length ?? 0,
                        })}
                      </p>
                    )}
                    {isLate && (
                      <Callout tone="block" className="mt-2 py-2 text-xs">
                        {t("claim.late_block", { since: t("days", { count: Math.max(0, daysFrom(c.eventOn, today)) }), period: t("days", { count: terms.claimNoticeDays }) })}
                      </Callout>
                    )}
                    {left !== null && (
                      <Callout tone="warn" className="mt-2 py-2 text-xs">
                        {t("claim.left_block", { days: t("days", { count: left }) })}
                      </Callout>
                    )}
                    {c.response && (c.status === "appr" || c.status === "part") && c.response.days > 0 && (
                      <p className="mt-1 text-xs font-bold text-success">{t("claim.granted_line", { days: t("days", { count: c.response.days }), date: pmDate(c.response.on, locale), rev: c.revision ?? 0 })}</p>
                    )}
                    {c.response?.ref && <p className="mt-0.5 text-xs text-muted-foreground">{t("claim.response_ref_line", { ref: c.response.ref })}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {c.kind !== "cost" && (
                      <b className="text-sm tabular-nums">
                        {(c.status === "appr" || c.status === "part") && c.response
                          ? t("claim.days_of", { got: t("days", { count: c.response.days }), asked: t("days", { count: c.daysAsked }) })
                          : c.daysAsked
                            ? t("days", { count: c.daysAsked })
                            : t("claim.days_at_submission")}
                      </b>
                    )}
                    {money && c.amountAsked > 0 && <span className="text-xs text-muted-foreground">{t("claim.cost_line", { amount: pmMoney(c.amountAsked) })}</span>}
                    {money && v > 0 && ["draft", "notice", "sub"].includes(c.status) && <StatusPill tone="ok">{t("claim.avoids", { amount: pmMoney(v) })}</StatusPill>}
                    {canApprove && c.status === "draft" && (
                      <Button
                        size="sm"
                        variant={isLate ? "destructive" : "default"}
                        disabled={busy !== null}
                        onClick={() => firestore && void run(`n${c.seq}`, () => sendClaimNotice(firestore, access.ctx, projectId, c.seq), t("claim.noticed"))}
                      >
                        {t("claim.send_notice")}
                      </Button>
                    )}
                    {canApprove && c.status === "notice" && (
                      <Button size="sm" onClick={() => setSubmitting({ c, days: c.daysAsked ? String(c.daysAsked) : "", amount: c.amountAsked ? String(c.amountAsked) : "" })}>
                        {t("claim.submit")}
                      </Button>
                    )}
                    {canRespond && c.status === "sub" && (
                      <Button size="sm" variant="outline" onClick={() => setResponding({ c, response: "", days: "", amount: "", ref: "" })}>
                        {t("claim.record_response")}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <Dialog open={drafting} onOpenChange={(o) => !busy && setDrafting(o)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("claim.new")}</DialogTitle>
            <DialogDescription>{t("claim.new_desc", { days: terms.claimNoticeDays })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cl-cause">
                {t("claim.cause")} <span className="text-warning">*</span>
              </Label>
              <Input id="cl-cause" value={cause} onChange={(e) => setCause(e.target.value)} placeholder={t("claim.cause_ph")} disabled={busy !== null} dir="auto" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("claim.kind_label")}</Label>
                <ChoiceChips label={t("claim.kind_label")} options={CLAIM_KINDS.map((k2) => ({ id: k2, label: t(`claim.kind.${k2}`) }))} value={kind} onChange={setKind} disabled={busy !== null} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cl-event">
                  {t("claim.event_on")} <span className="text-warning">*</span>
                </Label>
                <Input id="cl-event" type="date" dir="ltr" max={today} value={eventOn} onChange={(e) => setEventOn(e.target.value)} disabled={busy !== null} />
                <FormHint>{t("claim.event_hint")}</FormHint>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("claim.caused_by")}</Label>
              <ChoiceChips label={t("claim.caused_by")} options={CLAIM_CAUSES.map((c) => ({ id: c, label: t(`claim.caused.${c}`) }))} value={causedBy} onChange={setCausedBy} disabled={busy !== null} />
              {causedBy === "oth" && (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="cl-cause-text">
                    {t("claim.cause_text")} <span className="text-warning">*</span>
                  </Label>
                  <Input id="cl-cause-text" value={causedByText} onChange={(e) => setCausedByText(e.target.value)} disabled={busy !== null} dir="auto" />
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {kind !== "cost" && (
                <div className="space-y-1.5">
                  <Label htmlFor="cl-days">{t("claim.days_optional")}</Label>
                  <Input id="cl-days" dir="ltr" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="—" disabled={busy !== null} />
                  <FormHint>{t("claim.days_hint")}</FormHint>
                </div>
              )}
              {kind !== "time" && money && (
                <div className="space-y-1.5">
                  <Label htmlFor="cl-amt">{t("claim.amount_optional")}</Label>
                  <Input id="cl-amt" dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="—" disabled={busy !== null} />
                </div>
              )}
            </div>
            {(openObstacles.length > 0 || obstacleId) && (
              <div className="space-y-1.5">
                <Label>{t("claim.evidence_label")}</Label>
                <div className="flex flex-wrap gap-2">
                  {obstacles
                    .filter((o) => isOpenObstacle(o) || o.id === obstacleId)
                    .map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        aria-pressed={obstacleId === o.id}
                        disabled={busy !== null}
                        onClick={() => setObstacleId(obstacleId === o.id ? null : o.id)}
                        className={cn(
                          "min-h-9 rounded-full border px-3 text-xs font-semibold hover:border-module/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          obstacleId === o.id ? "border-module bg-module/10 text-module" : "bg-background text-muted-foreground"
                        )}
                      >
                        {obsNo(o)}
                      </button>
                    ))}
                </div>
              </div>
            )}
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={noticeToday} onCheckedChange={(v) => setNoticeToday(v === true)} disabled={busy !== null} />
              {t("claim.notice_today")}
            </label>
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
                const ok = await run(
                  "draft",
                  () =>
                    draftClaim(firestore, access.ctx, projectId, actor, {
                      kind,
                      cause,
                      eventOn,
                      daysAsked: num(days),
                      amountAsked: money ? num(amount) : 0,
                      obstacleId,
                      causedBy,
                      causedByText,
                      noticeToday,
                    }),
                  t("claim.drafted")
                )
                if (ok) {
                  setDrafting(false)
                  setObstacleId(null)
                  setCause("")
                  setCausedBy("emp")
                  setCausedByText("")
                  setEventOn("")
                  setDays("")
                  setAmount("")
                  setNoticeToday(false)
                }
              }}
            >
              {busy === "draft" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("claim.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={submitting !== null} onOpenChange={(o) => !o && !busy && setSubmitting(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("claim.submit")}</DialogTitle>
            <DialogDescription dir="auto">{submitting ? `${t("claim.no", { no: claimNo(submitting.c.seq) })} — ${submitting.c.cause}` : ""}</DialogDescription>
          </DialogHeader>
          {submitting && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {submitting.c.kind !== "cost" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="cs-days">
                      {t("claim.days_asked")} <span className="text-warning">*</span>
                    </Label>
                    <Input id="cs-days" dir="ltr" inputMode="numeric" value={submitting.days} onChange={(e) => setSubmitting({ ...submitting, days: e.target.value })} disabled={busy !== null} />
                  </div>
                )}
                {submitting.c.kind !== "time" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="cs-amt">
                      {t("claim.amount_asked")} <span className="text-warning">*</span>
                    </Label>
                    <Input id="cs-amt" dir="ltr" inputMode="decimal" value={submitting.amount} onChange={(e) => setSubmitting({ ...submitting, amount: e.target.value })} disabled={busy !== null} />
                  </div>
                )}
              </div>
              <FormHint>{t("claim.submit_hint")}</FormHint>
              <BlockingReasons title={t("cannot_save")} reasons={sBlocks.map((b) => t(`claim.block.${b}`))} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitting(null)} disabled={busy !== null}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy !== null || sBlocks.length > 0}
              onClick={async () => {
                if (!firestore || !submitting) return
                const ok = await run("sub", () => submitClaim(firestore, access.ctx, projectId, submitting.c.seq, { daysAsked: num(submitting.days), amountAsked: num(submitting.amount) }), t("claim.submitted"))
                if (ok) setSubmitting(null)
              }}
            >
              {busy === "sub" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("claim.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={responding !== null} onOpenChange={(o) => !o && !busy && setResponding(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("claim.response_title")}</DialogTitle>
            <DialogDescription dir="auto">{responding ? `${t("claim.no", { no: claimNo(responding.c.seq) })} — ${responding.c.cause}` : ""}</DialogDescription>
          </DialogHeader>
          {responding && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t("claim.decision")}</Label>
                <ChoiceChips label={t("claim.decision")} options={CLAIM_RESPONSES.map((r) => ({ id: r, label: t(`claim.status.${r}`) }))} value={responding.response || null} onChange={(r) => setResponding({ ...responding, response: r })} />
              </div>
              {responding.response && responding.response !== "rej" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {responding.c.kind !== "cost" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="cl-got-days">{t("claim.days_granted")}</Label>
                      <Input id="cl-got-days" dir="ltr" inputMode="numeric" value={responding.days} onChange={(e) => setResponding({ ...responding, days: e.target.value })} />
                      <FormHint>{t("claim.requested_hint", { days: responding.c.daysAsked ? t("days", { count: responding.c.daysAsked }) : "—" })}</FormHint>
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
              {preview && (
                <Callout tone="info">
                  {t("claim.preview", { rev: preview.rev, days: t("days", { count: preview.days }), from: pmMoney(preview.from), to: pmMoney(preview.to) })}
                </Callout>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="cl-ref">{t("claim.letter_ref")}</Label>
                <Input id="cl-ref" value={responding.ref} onChange={(e) => setResponding({ ...responding, ref: e.target.value })} dir="auto" />
              </div>
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
                      ref: responding.ref,
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

function Tile({ icon: Icon, label, value, note, tone }: { icon: typeof Clock; label: string; value: string; note: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Icon size={13} aria-hidden="true" /> {label}
      </p>
      <p className={cn("mt-1 text-xl font-black tabular-nums", tone === "bad" ? "text-destructive" : tone === "good" ? "text-success" : "text-foreground")} dir="auto">
        {value}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
        {tone === "bad" && <AlertTriangle size={11} aria-hidden="true" />}
        {tone === "good" && <ShieldCheck size={11} aria-hidden="true" />}
        {note}
      </p>
    </div>
  )
}
