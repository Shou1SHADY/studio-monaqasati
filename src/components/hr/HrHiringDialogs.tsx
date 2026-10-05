"use client"

// The hiring forms (PRD form 26; the prototype's X5F.job / cand / score /
// offer / offerl / bstage): open an opening (with the honest-date warning,
// the band and the cost for pay roles, the approval it needs), add a
// candidate (Saudi-only trades take no non-Saudi; the Saudization effect
// before, not after), the interview scorecard, the offer (band, loaded cost,
// Saudization, above the band → management), the offer letter, and a
// recruitment batch's next step (agency → visas issued → arrivals by name).
// Each form shows what blocks it; the write checks it again.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import type { HrEmployee } from "@/lib/hr/employee"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import {
  arrivalNames,
  bandOf,
  batchBlocks,
  BATCH_STAGES,
  candidateBlocks,
  CONTRACT_TERMS,
  defaultTrack,
  leadShortfall,
  offerCheck,
  offerFigures,
  openingBlocks,
  openingLeft,
  openingNo,
  positionCost,
  replacementNeed,
  saudiPct,
  saudiPctAfter,
  scoreBlocks,
  type Candidate,
  type HireTrack,
  type Opening,
} from "@/lib/hr/hiring"
import { addCandidate, batchStep, makeOffer, openOpening, recordScorecard, registerArrivals } from "@/lib/hr/hiring-writes"
import { freeVisas } from "@/lib/hr/manpower"
import { payFromBasic } from "@/lib/hr/pay"
import type { HrSite } from "@/lib/hr/sites"
import { addDays } from "@/lib/hr/statutory"
import { NATIONALITIES, TRADES, tradeOf } from "@/lib/hr/trades"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"

/** The toast for a refused write: a block in the hiring words, else the module's refusal. */
export const hireErrKey = (err: unknown) =>
  err instanceof HrWriteError ? (err.blocks[0] ? `hire.block.${err.blocks[0]}` : err.code === "missing" ? "hire.err_missing" : `err.${err.code}`) : "err.save"

const num = (v: string) => (v.trim() === "" ? null : Number(v))

function useActor(access: HrAccess, actorName: string) {
  return { uid: access.ctx.uid, name: actorName || null }
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Footer({ busy, label, disabled, onCancel }: { busy: boolean; label: string; disabled: boolean; onCancel: () => void }) {
  const t = useTranslations("Portal.HR")
  return (
    <DialogFooter className="gap-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
        {t("cancel")}
      </Button>
      <Button type="submit" disabled={busy || disabled} className="gap-1.5">
        {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
        {label}
      </Button>
    </DialogFooter>
  )
}

// ---------------------------------------------------------------------------
// New opening (X5F.job)
// ---------------------------------------------------------------------------

const openingSchema = z.object({ trade: z.string(), q: z.string(), siteId: z.string(), need: z.string(), track: z.enum(["ind", "batch"]).or(z.literal("")), why: z.string() })

export function OpeningDialog({
  open,
  onOpenChange,
  access,
  actorName,
  sites,
  replaces,
  onOpened,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  access: HrAccess
  actorName: string
  sites: HrSite[]
  replaces?: HrEmployee | null
  onOpened?: (id: string) => void
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const actor = useActor(access, actorName)
  const today = todayDay()
  const policies = access.settings.policies
  const money = access.allowed("pay.view")
  const live = sites.filter((s) => s.active !== false)
  const defaults = () => ({
    trade: replaces?.trade ?? "",
    q: "1",
    siteId: replaces?.siteId ?? live[0]?.id ?? "",
    need: replaces ? replacementNeed(replaces, today) : addDays(today, 30),
    track: (replaces ? defaultTrack(replaces.trade) : "") as HireTrack | "",
    why: "",
  })
  const form = useForm<z.infer<typeof openingSchema>>({ resolver: zodResolver(openingSchema), defaultValues: defaults() })
  useEffect(() => {
    if (open) form.reset(defaults())
    // Reset on opening only.
  }, [open])
  const v = useWatch({ control: form.control })
  const trade = v.trade ?? ""
  const track: HireTrack = (v.track || (trade ? defaultTrack(trade) : "ind")) as HireTrack
  const q = Number(v.q)
  const blocks = openingBlocks({ trade, q, siteId: v.siteId || null, need: v.need ?? "" })
  const late = trade && v.need ? leadShortfall(v.need, track, today) : 0
  const band = trade ? bandOf(trade, policies) : null
  const approval = !replaces && policies.jobApprove === "block"

  const save = form.handleSubmit(async (x) => {
    if (!firestore || !access.orgId) return
    try {
      const r = await openOpening(
        firestore,
        access.ctx,
        access.orgId,
        actor,
        { trade: x.trade, q: Number(x.q), siteId: x.siteId || null, need: x.need, track, why: x.why, replaces: replaces ? { employeeId: replaces.id, name: replaces.names?.ar ?? "" } : null },
        { policies }
      )
      toast({ title: t(r.state === "wait" ? "hire.opened_wait" : "hire.opened", { no: openingNo(r.no, locale) }) })
      onOpenChange(false)
      onOpened?.(r.id)
    } catch (err) {
      console.error(err)
      toast({ title: t(hireErrKey(err)), variant: "destructive" })
    }
  })
  const busy = form.formState.isSubmitting

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{replaces ? t("hire.job.title_rep", { name: replaces.names?.ar ?? "" }) : t("hire.job.title")}</DialogTitle>
          <DialogDescription>{t(replaces ? "hire.job.sub_rep" : approval ? "hire.job.sub_new" : "hire.job.sub_new_warn")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="job-trade" label={t("hire.job.trade")}>
              <NativeSelect id="job-trade" className="w-full" {...form.register("trade")} disabled={busy}>
                <option value="">{t("hire.job.pick")}</option>
                {TRADES.map((x) => (
                  <option key={x.key} value={x.key}>
                    {t(`trade.${x.key}` as "trade.mason")}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="job-q" label={t("hire.job.count")}>
              <Input id="job-q" type="number" min="1" step="1" dir="ltr" inputMode="numeric" {...form.register("q")} disabled={busy} />
            </Field>
            <Field id="job-site" label={t("hire.job.site")}>
              <NativeSelect id="job-site" className="w-full" {...form.register("siteId")} disabled={busy}>
                <option value="">{t("hire.job.pick")}</option>
                {live.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="job-need" label={t("hire.job.need")}>
              <Input id="job-need" type="date" dir="ltr" {...form.register("need")} disabled={busy} />
            </Field>
          </div>
          {trade && (
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="mb-1.5 text-sm font-medium">{t("hire.job.track")}</legend>
              {(["ind", "batch"] as const).map((k) => (
                <label key={k} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm", track === k && "border-module bg-module/10")}>
                  <input type="radio" value={k} checked={track === k} onChange={() => form.setValue("track", k)} disabled={busy} className="mt-1 accent-current focus-visible:ring-2 focus-visible:ring-ring" />
                  <span>
                    <span className="block font-bold">{t(`hire.track.${k}`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`hire.track_sub.${k}`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {late > 0 && (
            <Callout tone="warn" title={t("hire.job.late_title", { n: late })}>
              {t(track === "batch" ? "hire.job.late_batch" : "hire.job.late_ind")}
            </Callout>
          )}
          {tradeOf(trade)?.saudiOnly && <Callout tone="info">{t("hire.job.saudi_only")}</Callout>}
          {money && band && (
            <div className="rounded-xl border px-3">
              <KeyValueRow label={t("hire.band")} value={`${hrMoney(band[0])} – ${hrMoney(band[1])}`} />
              <KeyValueRow label={t("hire.job.cost")} value={hrMoney(positionCost(trade, q || 1, policies))} />
            </div>
          )}
          {!replaces && (
            <Field id="job-why" label={t("hire.job.why")} hint={t("hire.job.why_hint")}>
              <Textarea id="job-why" rows={2} {...form.register("why")} disabled={busy} />
            </Field>
          )}
          <p className="text-xs text-muted-foreground">{t("att.fill_by", { name: actorName || "—" })}</p>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`hire.block.${b}`))} />
          <Footer busy={busy} label={t(replaces || !approval ? "hire.job.open_it" : "hire.job.send_mgmt")} disabled={blocks.length > 0} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// New candidate (X5F.cand)
// ---------------------------------------------------------------------------

const candSchema = z.object({ nameAr: z.string(), nameEn: z.string(), nat: z.string(), gender: z.enum(["m", "f"]), src: z.enum(["ref", "agency", "walk", "file"]), phone: z.string(), ask: z.string() })

export function CandidateDialog({ open, onOpenChange, access, actorName, opening, employees }: { open: boolean; onOpenChange: (o: boolean) => void; access: HrAccess; actorName: string; opening: Opening; employees: HrEmployee[] }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const actor = useActor(access, actorName)
  const money = access.allowed("pay.view")
  const defaults = { nameAr: "", nameEn: "", nat: "sa", gender: "m" as const, src: "ref" as const, phone: "", ask: "" }
  const form = useForm<z.infer<typeof candSchema>>({ resolver: zodResolver(candSchema), defaultValues: defaults })
  useEffect(() => {
    if (open) form.reset(defaults)
  }, [open])
  const v = useWatch({ control: form.control })
  const blocks = candidateBlocks({ nameAr: v.nameAr ?? "", nameEn: v.nameEn ?? "", nat: v.nat ?? "sa", trade: opening.trade, ask: money ? num(v.ask ?? "") : null })
  const save = form.handleSubmit(async (x) => {
    if (!firestore) return
    try {
      await addCandidate(firestore, access.ctx, actor, opening.id, { nameAr: x.nameAr, nameEn: x.nameEn || null, nat: x.nat, gender: x.gender, src: x.src, phone: x.phone || null, ask: money ? num(x.ask) : null })
      toast({ title: t("hire.cand.added") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t(hireErrKey(err)), variant: "destructive" })
    }
  })
  const busy = form.formState.isSubmitting
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("hire.cand.title")}</DialogTitle>
          <DialogDescription>
            {t(`trade.${opening.trade}` as "trade.mason")} · <bdi dir="ltr">{openingNo(opening.no, locale)}</bdi>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="cd-ar" label={t("hire.cand.name_ar")}>
              <Input id="cd-ar" dir="rtl" {...form.register("nameAr")} disabled={busy} />
            </Field>
            <Field id="cd-en" label={t("hire.cand.name_en")} hint={t("hire.cand.either")}>
              <Input id="cd-en" dir="ltr" {...form.register("nameEn")} disabled={busy} />
            </Field>
            <Field id="cd-nat" label={t("new.nationality")}>
              <NativeSelect id="cd-nat" className="w-full" {...form.register("nat")} disabled={busy}>
                {NATIONALITIES.map((n) => (
                  <option key={n} value={n}>
                    {t(`nat.${n}` as "nat.sa")}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="cd-g" label={t("new.gender")}>
              <NativeSelect id="cd-g" className="w-full" {...form.register("gender")} disabled={busy}>
                <option value="m">{t("gender.m")}</option>
                <option value="f">{t("gender.f")}</option>
              </NativeSelect>
            </Field>
            <Field id="cd-src" label={t("hire.cand.src")}>
              <NativeSelect id="cd-src" className="w-full" {...form.register("src")} disabled={busy}>
                {(["ref", "agency", "walk", "file"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`hire.csrc.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="cd-ph" label={t("hire.cand.phone")} hint={t("hire.optional")}>
              <Input id="cd-ph" type="tel" dir="ltr" {...form.register("phone")} disabled={busy} />
            </Field>
            {money && (
              <Field id="cd-ask" label={t("hire.cand.ask")} hint={t("hire.cand.ask_hint")}>
                <Input id="cd-ask" type="number" min="0" step="100" dir="ltr" inputMode="numeric" {...form.register("ask")} disabled={busy} />
              </Field>
            )}
          </div>
          <div className="rounded-xl border px-3">
            <KeyValueRow label={t("hire.saudi_if")} value={t("hire.saudi_change", { now: saudiPct(employees), after: saudiPctAfter(employees, v.nat ?? "sa") })} />
          </div>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`hire.block.${b}`))} />
          <Footer busy={busy} label={t("hire.cand.add")} disabled={blocks.length > 0} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Interview scorecard (X5F.score)
// ---------------------------------------------------------------------------

const scoreSchema = z.object({ t: z.string(), x: z.string(), b: z.string(), rec: z.enum(["yes", "no"]).or(z.literal("")), note: z.string() })

export function ScoreDialog({ open, onOpenChange, access, actorName, candidate }: { open: boolean; onOpenChange: (o: boolean) => void; access: HrAccess; actorName: string; candidate: Candidate }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { toast } = useToast()
  const actor = useActor(access, actorName)
  const form = useForm<z.infer<typeof scoreSchema>>({ resolver: zodResolver(scoreSchema), defaultValues: { t: "", x: "", b: "", rec: "", note: "" } })
  useEffect(() => {
    if (open) form.reset({ t: "", x: "", b: "", rec: "", note: "" })
  }, [open])
  const v = useWatch({ control: form.control })
  const input = { t: num(v.t ?? ""), x: num(v.x ?? ""), b: num(v.b ?? ""), rec: v.rec === "yes" ? true : v.rec === "no" ? false : null }
  const blocks = scoreBlocks(input)
  const save = form.handleSubmit(async () => {
    if (!firestore || blocks.length) return
    try {
      await recordScorecard(firestore, access.ctx, candidate.id, actor, { t: input.t!, x: input.x!, b: input.b!, rec: input.rec!, note: v.note })
      toast({ title: t(input.rec ? "hire.score.saved" : "hire.score.saved_rej") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t(hireErrKey(err)), variant: "destructive" })
    }
  })
  const busy = form.formState.isSubmitting
  const rate = (k: "t" | "x" | "b", label: string) => (
    <fieldset className="flex flex-wrap items-center justify-between gap-2 border-b py-2.5 last:border-b-0">
      <legend className="sr-only">{label}</legend>
      <span className="text-sm font-semibold">{label}</span>
      <span className="flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Button key={n} type="button" size="sm" variant={v[k] === String(n) ? "default" : "outline"} aria-pressed={v[k] === String(n)} className="h-11 w-11 tabular-nums sm:h-9 sm:w-9" onClick={() => form.setValue(k, String(n))} disabled={busy}>
            {n}
          </Button>
        ))}
      </span>
    </fieldset>
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("hire.score.title", { name: candidate.names.ar })}</DialogTitle>
          <DialogDescription>{t(`trade.${candidate.trade}` as "trade.mason")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div>
            {rate("t", t(tradeOf(candidate.trade)?.category === "labour" ? "hire.score.t_lab" : "hire.score.t"))}
            {rate("x", t("hire.score.x"))}
            {rate("b", t("hire.score.b"))}
          </div>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("hire.score.rec")}>
            {(["yes", "no"] as const).map((k) => (
              <Button key={k} type="button" variant={v.rec === k ? "default" : "outline"} aria-pressed={v.rec === k} className="min-h-11" onClick={() => form.setValue("rec", k)} disabled={busy}>
                {t(`hire.score.rec_${k}`)}
              </Button>
            ))}
          </div>
          <Field id="sc-note" label={t("hire.score.note")} hint={t("hire.optional")}>
            <Textarea id="sc-note" rows={2} {...form.register("note")} disabled={busy} />
          </Field>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`hire.block.${b}`))} />
          <Footer busy={busy} label={t("hire.score.save")} disabled={blocks.length > 0} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// The offer (X5F.offer) — pay roles only (the HR manager makes it)
// ---------------------------------------------------------------------------

const offerSchema = z.object({ basic: z.string(), start: z.string(), until: z.string(), ct: z.enum(CONTRACT_TERMS) })

export function OfferDialog({ open, onOpenChange, access, actorName, candidate, opening, ask, employees }: { open: boolean; onOpenChange: (o: boolean) => void; access: HrAccess; actorName: string; candidate: Candidate; opening: Opening; ask: number | null; employees: HrEmployee[] }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { toast } = useToast()
  const actor = useActor(access, actorName)
  const today = todayDay()
  const policies = access.settings.policies
  const band = bandOf(candidate.trade, policies)
  const defaults = () => ({ basic: String(ask && band ? Math.min(ask, band[1]) : (tradeOf(candidate.trade)?.ref ?? "")), start: addDays(today, 14), until: addDays(today, 7), ct: "open" as const })
  const form = useForm<z.infer<typeof offerSchema>>({ resolver: zodResolver(offerSchema), defaultValues: defaults() })
  useEffect(() => {
    if (open) form.reset(defaults())
  }, [open])
  const v = useWatch({ control: form.control })
  const basic = num(v.basic ?? "")
  const check = offerCheck({ basic, start: v.start ?? "", until: v.until ?? "", nat: candidate.nat, trade: candidate.trade, need: opening.need }, policies, today)
  const fig = basic && basic > 0 ? offerFigures(basic, candidate.nat, policies, v.start || today) : null
  const save = form.handleSubmit(async (x) => {
    if (!firestore) return
    try {
      const r = await makeOffer(firestore, access.ctx, candidate.id, actor, { basic: Number(x.basic), start: x.start, until: x.until, ct: x.ct }, { policies })
      toast({ title: t(r.held ? "hire.offer.held" : "hire.offer.issued") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t(hireErrKey(err)), variant: "destructive" })
    }
  })
  const busy = form.formState.isSubmitting
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("hire.offer.title", { name: candidate.names.ar })}</DialogTitle>
          <DialogDescription>
            {t(`trade.${candidate.trade}` as "trade.mason")} · {t(`nat.${candidate.nat}` as "nat.sa")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="of-basic" label={t("hire.offer.basic")} hint={t("hire.offer.basic_hint", { h: Math.round(policies.housingShare * 100), tr: Math.round(policies.transportShare * 100) })}>
              <Input id="of-basic" type="number" min="0" step="50" dir="ltr" inputMode="numeric" {...form.register("basic")} disabled={busy} />
            </Field>
            <Field id="of-start" label={t("hire.offer.start")}>
              <Input id="of-start" type="date" dir="ltr" {...form.register("start")} disabled={busy} />
            </Field>
            <Field id="of-until" label={t("hire.offer.until")}>
              <Input id="of-until" type="date" dir="ltr" {...form.register("until")} disabled={busy} />
            </Field>
            <Field id="of-ct" label={t("hire.offer.ct")}>
              <NativeSelect id="of-ct" className="w-full" {...form.register("ct")} disabled={busy}>
                {CONTRACT_TERMS.map((k) => (
                  <option key={k} value={k}>
                    {t(`hire.ct.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="rounded-xl border px-3">
            <KeyValueRow label={t("hire.offer.wage")} value={fig ? hrMoney(fig.wage) : "—"} />
            <KeyValueRow label={t("hire.offer.cost")} value={fig ? hrMoney(fig.cost) : "—"} />
            {band && <KeyValueRow label={t("hire.band")} value={`${hrMoney(band[0])} – ${hrMoney(band[1])}`} />}
            <KeyValueRow label={t("hire.saudi_if")} value={t("hire.saudi_change", { now: saudiPct(employees), after: saudiPctAfter(employees, candidate.nat) })} />
          </div>
          {check.over && band && basic != null && (
            <Callout tone="warn" title={t("hire.offer.over_title", { amount: hrMoney(basic - band[1]) })}>
              {t(check.held ? "hire.offer.over_held" : "hire.offer.over_warn")}
            </Callout>
          )}
          {check.warnings.includes("saudi_below_nitaqat") && <Callout tone="warn">{t("hire.offer.saudi_low")}</Callout>}
          {check.warnings.includes("start_after_need") && <Callout tone="info">{t("hire.offer.after_need", { n: Math.max(0, Math.round((Date.parse(v.start ?? "") - Date.parse(opening.need)) / 86_400_000)) })}</Callout>}
          <BlockingReasons title={t("cannot_save")} reasons={check.blocks.map((b) => t(`hire.block.${b}`))} />
          <Footer busy={busy} label={t(check.held ? "hire.offer.save_mgmt" : "hire.offer.issue")} disabled={check.blocks.length > 0} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// The offer letter (X5F.offerl, HI-09) — in the reader's language or the other
// ---------------------------------------------------------------------------

export function OfferLetterDialog({
  open,
  onOpenChange,
  access,
  candidate,
  opening,
  siteName,
  basic,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  access: HrAccess
  candidate: Candidate
  opening: Opening
  siteName: string
  basic: number | null
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const [lang, setLang] = useState<"ar" | "en">(locale === "ar" ? "ar" : "en")
  const o = candidate.offer
  const parts = basic != null ? payFromBasic(basic, access.settings.policies) : null
  const est = access.settings.establishment
  const company = (lang === "en" ? est.nameEn : est.name) || est.name || ""
  const lt = (k: string, p: Record<string, string | number> = {}) => t(`hire.letter.${lang}.${k}` as "hire.letter.ar.dear", p)
  if (!o) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("hire.letter.title")}</DialogTitle>
          <DialogDescription>
            {candidate.names.ar} · <bdi dir="ltr">{openingNo(opening.no, locale)}</bdi>
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2" role="group" aria-label={t("hire.letter.lang")}>
          {(["ar", "en"] as const).map((l) => (
            <Button key={l} type="button" size="sm" variant={lang === l ? "default" : "outline"} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {t(`hire.letter.lang_${l}`)}
            </Button>
          ))}
        </div>
        <article dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="space-y-3 rounded-xl border bg-background p-5 text-sm leading-loose">
          <header className="flex items-baseline justify-between gap-3 border-b-2 border-module pb-2">
            <b>{company}</b>
            <span className="text-xs text-muted-foreground">{hrDate(o.at.slice(0, 10), lang)}</span>
          </header>
          <p>{lt("dear", { name: (lang === "en" ? candidate.names.en : candidate.names.ar) || candidate.names.ar })}</p>
          <p>
            {lt("body", {
              trade: t(`trade.${opening.trade}` as "trade.mason"),
              site: siteName,
              basic: parts ? hrMoney(parts.basic) : "•••",
              housing: parts ? hrMoney(parts.housing) : "•••",
              transport: parts ? hrMoney(parts.transport) : "•••",
              total: parts ? hrMoney(parts.basic + parts.housing + parts.transport) : "•••",
              start: hrDate(o.start, lang),
              contract: lt(`ct_${o.ct}`),
              leave: 21,
            })}
          </p>
          <p>{lt("valid", { until: hrDate(o.until, lang) })}</p>
          <p className="pt-2 text-xs text-muted-foreground">
            {o.byName ?? ""} — {lt("hr")}
          </p>
        </article>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => window.print()} className="gap-1.5">
            <Printer size={15} aria-hidden="true" />
            {t("hire.letter.print")}
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {t("hire.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// A recruitment batch's next step (X5F.bstage)
// ---------------------------------------------------------------------------

const batchSchema = z.object({ agency: z.string(), nat: z.string(), sel: z.string(), eta: z.string(), names: z.string() })

export function BatchDialog({ open, onOpenChange, access, actorName, opening, siteName }: { open: boolean; onOpenChange: (o: boolean) => void; access: HrAccess; actorName: string; opening: Opening; siteName: string }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const actor = useActor(access, actorName)
  const today = todayDay()
  const b = opening.batch!
  const stage = b.stage
  const left = openingLeft(opening)
  const free = freeVisas(access.settings.establishment)
  const defaults = () => ({ agency: b.agency ?? "", nat: b.nat ?? "bd", sel: String(opening.q), eta: addDays(today, 45), names: "" })
  const form = useForm<z.infer<typeof batchSchema>>({ resolver: zodResolver(batchSchema), defaultValues: defaults() })
  useEffect(() => {
    if (open) form.reset(defaults())
  }, [open])
  const v = useWatch({ control: form.control })
  const names = useMemo(() => arrivalNames(v.names ?? ""), [v.names])
  const blocks = batchBlocks(opening, { agency: v.agency, sel: num(v.sel ?? ""), eta: v.eta || null, names }, free)
  const next = BATCH_STAGES[Math.min(3, BATCH_STAGES.indexOf(stage) + 1)]
  const arrivals = stage === "visa" || stage === "arr"
  const save = form.handleSubmit(async (x) => {
    if (!firestore || !access.orgId) return
    try {
      if (arrivals) {
        const r = await registerArrivals(firestore, access.ctx, access.orgId, actor, opening, x.names, { policies: access.settings.policies, seesPay: access.allowed("pay.view") })
        toast({ title: t("hire.batch.arrived", { n: r.created }), ...(r.failed.length ? { description: t("hire.batch.failed", { names: r.failed.join("، ") }), variant: "destructive" as const } : {}) })
      } else {
        const r = await batchStep(firestore, access.ctx, opening.id, actor, { agency: x.agency, nat: x.nat, sel: num(x.sel), eta: x.eta })
        toast({ title: r.stage === "visa" ? t("hire.batch.issued", { n: r.issued ?? 0, date: hrDate(x.eta, locale) }) : t("hire.batch.recorded") })
      }
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t(hireErrKey(err)), variant: "destructive" })
    }
  })
  const busy = form.formState.isSubmitting
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("hire.batch.title", { trade: t(`trade.${opening.trade}` as "trade.mason"), site: siteName })}</DialogTitle>
          <DialogDescription>{arrivals ? t("hire.batch.sub_arr") : t("hire.batch.sub", { stage: t(`hire.bst.${next}`) })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          {stage === "auth" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="bt-ag" label={t("hire.batch.agency")}>
                <Input id="bt-ag" dir="auto" {...form.register("agency")} disabled={busy} />
              </Field>
              <Field id="bt-nat" label={t("new.nationality")}>
                <NativeSelect id="bt-nat" className="w-full" {...form.register("nat")} disabled={busy}>
                  {NATIONALITIES.filter((n) => n !== "sa").map((n) => (
                    <option key={n} value={n}>
                      {t(`nat.${n}` as "nat.sa")}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="bt-sel" label={t("hire.batch.sel")} hint={t("hire.batch.sel_hint", { n: opening.q })}>
                <Input id="bt-sel" type="number" min="0" step="1" dir="ltr" inputMode="numeric" {...form.register("sel")} disabled={busy} />
              </Field>
            </div>
          )}
          {stage === "test" && (
            <>
              <div className="rounded-xl border px-3">
                <KeyValueRow label={t("hire.batch.needed")} value={left} />
                <KeyValueRow label={t("hire.batch.free_visas")} value={<span className={cn(free < left && "text-destructive")}>{free}</span>} />
              </div>
              {free < left && (
                <Callout tone="block" title={t("hire.block.not_enough_visas")}>
                  {t("hire.batch.visas_short")}
                </Callout>
              )}
              <Field id="bt-eta" label={t("hire.batch.eta")} hint={t("hire.batch.eta_hint")}>
                <Input id="bt-eta" type="date" dir="ltr" {...form.register("eta")} disabled={busy} />
              </Field>
            </>
          )}
          {arrivals && (
            <>
              <Field id="bt-names" label={t("hire.batch.names")} hint={t("hire.batch.names_left", { n: Math.min(left, b.visas) })}>
                <Textarea id="bt-names" rows={6} dir="ltr" placeholder="MOHAMMAD RAHIM UDDIN" {...form.register("names")} disabled={busy} />
              </Field>
              <Callout tone="info">{t("hire.batch.names_note", { site: siteName })}</Callout>
            </>
          )}
          <p className="text-xs text-muted-foreground">{t("att.fill_by", { name: actorName || "—" })}</p>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((x) => t(`hire.block.${x}`))} />
          <Footer busy={busy} label={t("hire.batch.save")} disabled={blocks.length > 0} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}
