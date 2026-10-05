"use client"

// Performance's forms (PRD form 27; the prototype's X5F.cycle / rv / self / raiseplan). Open a cycle: two dates —
// the rest is computed (who is in it, who rates). A staff review: the record read, not rated; his self-assessment
// if he sent one; four 1–5 ratings, all required; a training need and a note to him, optional. A self-assessment:
// the same four, and highlights — his manager reads it; it is not part of the score. The raise proposal: per band
// the approved reviews, the percentage (company policy, 0–25) and what it costs a month; the company cost with
// GOSI and the end-of-service accrual; what the reviews still awaiting approval would add — one decision for
// management, and the HR manager never changes his own pay.

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useForm, useWatch, type Control } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { DataTable, Figure, type DataColumn } from "@/components/module-ui/DataTable"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useTableLabels } from "@/hooks/useTableLabels"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { BANDS, CRITERIA, cycleBlocks, firstOfNextMonth, raisePlan, recordScore, reviewEligible, type Band, type Criterion, type HrReview, type RecordFacts, type ReviewCycle, type SelfReview } from "@/lib/hr/performance"
import { addDays } from "@/lib/hr/statutory"
import { NEED_COURSES } from "@/lib/hr/training"
import { openCycle, proposeRaises, submitSelfReview, submitStaffReview } from "@/lib/hr/performance-writes"
import type { HrSite } from "@/lib/hr/sites"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"

type T = ReturnType<typeof useTranslations>
const errTitle = (t: T, err: unknown) => t(err instanceof HrWriteError ? (err.blocks[0] ? `perf.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save")

/** «من السجل — لا يُقيَّم بل يُقرأ (20%)»: absences, applied penalties, overtime, an injury → the record's score. */
export function FactsBox({ rec, weight }: { rec: RecordFacts | null | undefined; weight: number }) {
  const t = useTranslations("Portal.HR")
  const f = rec ?? { abs: 0, pen: 0, ot: 0, injury: false }
  return (
    <Callout tone="info" title={t("perf.facts_title", { w: Math.round(weight * 100) })}>
      {t("perf.facts", { abs: f.abs, pen: f.pen, ot: f.ot })}
      {f.injury ? ` · ${t("perf.facts_injury")}` : ""} → <b className="tabular-nums">{recordScore(f)}/5</b>
    </Callout>
  )
}

/** One criterion's 1–5 rating as five buttons (one pressed). */
function RatingRow({ name, label, control }: { name: Criterion; label: string; control: Control<Record<Criterion, number> & { note: string; need?: string }> }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
          <span id={`rate-${name}`} className="text-sm font-semibold">
            {label}
          </span>
          <span role="radiogroup" aria-labelledby={`rate-${name}`} className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={field.value === n}
                onClick={() => field.onChange(n)}
                className={cn(
                  "h-9 w-9 rounded-lg border text-sm font-bold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  field.value === n ? "border-module bg-module text-module-foreground" : "bg-background hover:border-module/40"
                )}
              >
                {n}
              </button>
            ))}
          </span>
        </div>
      )}
    />
  )
}

const ratingsSchema = z.object({
  g: z.number().int().min(1).max(5),
  q: z.number().int().min(1).max(5),
  i: z.number().int().min(1).max(5),
  t: z.number().int().min(1).max(5),
  note: z.string().max(1000),
  need: z.string().optional(),
})
type RatingsForm = z.infer<typeof ratingsSchema>
const EMPTY_RATINGS = { g: 0, q: 0, i: 0, t: 0, note: "", need: "" } as unknown as RatingsForm

// ---------------------------------------------------------------------------
// Open a cycle
// ---------------------------------------------------------------------------

const cycleSchema = z.object({ open: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), close: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

export function CycleDialog({
  access,
  actor,
  employees,
  sites,
  current,
  recOf,
  hrManagerEmployeeIds,
  onClose,
}: {
  access: HrAccess
  actor: HrActor
  employees: HrEmployee[]
  sites: HrSite[]
  current: ReviewCycle | null
  recOf: (e: HrEmployee) => RecordFacts
  hrManagerEmployeeIds: string[]
  onClose: () => void
}) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const form = useForm<z.infer<typeof cycleSchema>>({ resolver: zodResolver(cycleSchema), defaultValues: { open: today, close: addDays(today, 30) } })
  const [open, close] = useWatch({ control: form.control, name: ["open", "close"] })
  const blocks = cycleBlocks({ open: open || null, close: close || null }, current)
  const live = employees.filter((e) => e.status === "active" || e.status === "leave")
  const inScope = live.filter((e) => reviewEligible(e, open || today)).length
  const submit = form.handleSubmit(async (v) => {
    if (!firestore || !access.orgId || blocks.length) return
    try {
      const r = await openCycle(firestore, access.ctx, access.orgId, actor, v, { employees, sites, current, recOf, hrManagerEmployeeIds })
      toast({ title: t("perf.cycle_opened", { n: r.count }) })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: errTitle(t, err), variant: "destructive" })
    }
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("perf.cycle_title")}</DialogTitle>
          <DialogDescription>{t("perf.cycle_sub")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cy-open">{t("perf.cycle_open")}</Label>
              <Input id="cy-open" type="date" dir="ltr" {...form.register("open")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cy-close">{t("perf.cycle_close")}</Label>
              <Input id="cy-close" type="date" dir="ltr" {...form.register("close")} />
            </div>
          </div>
          <Callout tone="info">{t("perf.cycle_scope", { n: inScope, of: live.length })}</Callout>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`perf.block.${b}`))} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting || blocks.length > 0}>
              {form.formState.isSubmitting && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("perf.cycle_submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// A staff review, and the self-assessment
// ---------------------------------------------------------------------------

export function StaffReviewDialog({ access, actor, review, cycle, self, siteName, weight, onClose }: { access: HrAccess; actor: HrActor; review: HrReview; cycle: ReviewCycle; self: SelfReview | null; siteName: string; weight: number; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { toast } = useToast()
  const form = useForm<RatingsForm>({ resolver: zodResolver(ratingsSchema), defaultValues: { ...EMPTY_RATINGS, ...(review.sc ?? {}), need: review.need ?? "", note: review.note ?? "" } })
  const values = useWatch({ control: form.control })
  const incomplete = CRITERIA.some((k) => !(Number(values[k]) >= 1))
  const submit = form.handleSubmit(async (v) => {
    if (!firestore) return
    try {
      await submitStaffReview(firestore, access.ctx, actor, review, { g: v.g, q: v.q, i: v.i, t: v.t, need: v.need || null, note: v.note }, { cycle })
      toast({ title: t("perf.review_sent") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: errTitle(t, err), variant: "destructive" })
    }
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("perf.review_title", { name: review.employeeName })}</DialogTitle>
          <DialogDescription>
            {t(`trade.${review.trade}` as "trade.mason")} · {siteName} · {t("perf.cycle_name", { year: cycle.year })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <FactsBox rec={review.rec} weight={weight} />
          {self && (
            <Callout tone="info" title={t("perf.self_seen")}>
              {CRITERIA.map((k) => `${t(`perf.crit.${k}`)} ${self.sc[k]}`).join(" · ")}
              {self.note ? ` — ${self.note}` : ""}
            </Callout>
          )}
          <div className="divide-y rounded-xl border px-3">
            {CRITERIA.map((k) => (
              <RatingRow key={k} name={k} label={t(`perf.crit.${k}`)} control={form.control as unknown as Control<Record<Criterion, number> & { note: string; need?: string }>} />
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rv-need">{t("perf.need")}</Label>
            <NativeSelect id="rv-need" className="w-full" {...form.register("need")}>
              <option value="">{t("perf.need_none")}</option>
              {NEED_COURSES.map((c) => (
                <option key={c.id} value={c.id}>
                  {t(`train.course.${c.id}` as "train.course.ind")}
                </option>
              ))}
            </NativeSelect>
            <p className="text-[11px] text-muted-foreground">{t("perf.need_note")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rv-note">{t("perf.note")}</Label>
            <Textarea id="rv-note" rows={2} {...form.register("note")} />
          </div>
          <p className="text-xs text-muted-foreground">{t("perf.by", { name: actor.name || "—" })}</p>
          {incomplete && <BlockingReasons title={t("cannot_save")} reasons={[t("perf.block.incomplete")]} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting || incomplete}>
              {form.formState.isSubmitting && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("perf.review_submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SelfReviewDialog({ access, actor, emp, cycle, onClose }: { access: HrAccess; actor: HrActor; emp: HrEmployee; cycle: ReviewCycle; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { toast } = useToast()
  const form = useForm<RatingsForm>({ resolver: zodResolver(ratingsSchema), defaultValues: EMPTY_RATINGS })
  const values = useWatch({ control: form.control })
  const incomplete = CRITERIA.some((k) => !(Number(values[k]) >= 1))
  const submit = form.handleSubmit(async (v) => {
    if (!firestore) return
    try {
      await submitSelfReview(firestore, access.ctx, actor, emp, cycle, { g: v.g, q: v.q, i: v.i, t: v.t, note: v.note })
      toast({ title: t("perf.self_sent") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: errTitle(t, err), variant: "destructive" })
    }
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("perf.self_title")}</DialogTitle>
          <DialogDescription>{t("perf.cycle_name", { year: cycle.year })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <Callout tone="info">{t("perf.self_info")}</Callout>
          <div className="divide-y rounded-xl border px-3">
            {CRITERIA.map((k) => (
              <RatingRow key={k} name={k} label={t(`perf.crit.${k}`)} control={form.control as unknown as Control<Record<Criterion, number> & { note: string; need?: string }>} />
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="self-note">{t("perf.self_note")}</Label>
            <Textarea id="self-note" rows={3} {...form.register("note")} />
          </div>
          {incomplete && <BlockingReasons title={t("cannot_save")} reasons={[t("perf.block.incomplete")]} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting || incomplete}>
              {form.formState.isSubmitting && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("perf.self_submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// The raise proposal (PF-06)
// ---------------------------------------------------------------------------

const pctField = z.coerce.number().min(0).max(25)
const raiseSchema = z.object({ A: pctField, B: pctField, C: pctField, D: pctField })

export function RaisePlanDialog({
  access,
  actor,
  cycle,
  reviews,
  employees,
  pays,
  pct,
  weight,
  onClose,
}: {
  access: HrAccess
  actor: HrActor
  cycle: ReviewCycle
  reviews: HrReview[]
  employees: HrEmployee[]
  pays: ReadonlyMap<string, EmployeePay>
  pct: Record<Band, number>
  weight: number
  onClose: () => void
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const labels = useTableLabels()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const form = useForm<z.infer<typeof raiseSchema>>({ resolver: zodResolver(raiseSchema), defaultValues: pct })
  const watched = useWatch({ control: form.control })
  const live: Record<Band, number> = { A: Number(watched.A) || 0, B: Number(watched.B) || 0, C: Number(watched.C) || 0, D: Number(watched.D) || 0 }
  const people = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const plan = raisePlan(reviews, { pct: live, weight, pays, people, today })
  const eff = firstOfNextMonth(today)
  const cols: DataColumn<Band>[] = [
    { key: "band", header: t("perf.col.band"), cell: (b) => t(`perf.band.${b}`) },
    { key: "n", header: t("perf.col.count"), numeric: true, cell: (b) => <Figure>{plan.byBand[b].length}</Figure> },
    {
      key: "pct",
      header: "%",
      numeric: true,
      cell: (b) => <Input aria-label={t("perf.pct_of", { band: t(`perf.band.${b}`) })} type="number" min={0} max={25} step={0.5} dir="ltr" className="ms-auto h-8 w-20" {...form.register(b)} />,
    },
    { key: "cost", header: t("perf.col.month"), numeric: true, cell: (b) => hrMoney(plan.cost[b]), footer: hrMoney(plan.total) },
  ]
  const submit = form.handleSubmit(async (v) => {
    if (!firestore) return
    try {
      await proposeRaises(firestore, access.ctx, actor, cycle, plan, { A: v.A, B: v.B, C: v.C, D: v.D })
      toast({ title: t("perf.raise_sent") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: errTitle(t, err), variant: "destructive" })
    }
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("perf.raise_title")}</DialogTitle>
          <DialogDescription>{t("perf.raise_sub", { date: hrDate(eff, locale) })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <DataTable columns={cols} rows={BANDS} rowKey={(b) => b} caption={t("perf.raise_title")} labels={labels} empty={null} dense />
          <div className="rounded-xl border px-3 text-sm">
            <div className="flex justify-between gap-2 py-2">
              <span>{t("perf.raise_loaded")}</span>
              <bdi dir="ltr" className="font-bold tabular-nums">
                {hrMoney(plan.loaded)}
              </bdi>
            </div>
            {plan.rest > 0 && (
              <div className="flex justify-between gap-2 border-t py-2 text-muted-foreground">
                <span>{t("perf.raise_rest", { n: plan.rest })}</span>
                <bdi dir="ltr" className="tabular-nums">
                  +{hrMoney(plan.restCost)}
                </bdi>
              </div>
            )}
          </div>
          <Callout tone="info">{t("perf.raise_note")}</Callout>
          <p className="text-xs text-muted-foreground">{t("perf.by", { name: actor.name || "—" })}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting || !(plan.total > 0)}>
              {form.formState.isSubmitting && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("perf.raise_submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
