"use client"

// The small forms an order's next step opens: a reason (return, cancel the
// remainder, close short, cancel the order), a date (record the supplier's
// acceptance, update his date), and the decision on a rejected quantity.
// The reject decision carries its terms: the replacement's date as the
// supplier committed to it, or the discounted unit price (required).
// Each one validates with zod, shows what will happen, and hands the value
// to the drawer — which runs the domain write and translates its refusal.

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useModules } from "@/hooks/useCompanyModules"
import { REJECT_DECISIONS, todayOf } from "@/lib/procurement/po"
import type { PoLine, RejectDecision } from "@/lib/procurement/types"
import { figure } from "./PoModel"

/** Resolves true when the write succeeded (the dialog closes), false when it was refused (it stays open). */
export type Submit<T> = (value: T) => Promise<boolean>

function Effects({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <ul className="space-y-1 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
      {items.map((s) => (
        <li key={s} className="flex gap-2">
          <span aria-hidden="true">•</span>
          <span>{s}</span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// A reason
// ---------------------------------------------------------------------------

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  submitLabel,
  effects = [],
  destructive,
  context,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  label: string
  placeholder?: string
  submitLabel: string
  effects?: string[]
  destructive?: boolean
  /** A line the reason is about, shown above the field. */
  context?: string | null
  onSubmit: Submit<string>
}) {
  const t = useTranslations("Portal.ProcOrders")
  const schema = z.object({ reason: z.string().trim().min(1, t("form.reason_required")) })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { reason: "" } })
  useEffect(() => {
    if (open) form.reset({ reason: "" })
  }, [open, form])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async (v) => {
              if (await onSubmit(v.reason)) onOpenChange(false)
            })}
          >
            {context && <p className="rounded-lg border px-3 py-2 text-sm font-bold">{context}</p>}
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{label}</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder={placeholder} dir="auto" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Effects items={effects} />
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("form.cancel")}
              </Button>
              <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={form.formState.isSubmitting} className="gap-2">
                {form.formState.isSubmitting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// A date — the supplier's, as he committed to it
// ---------------------------------------------------------------------------

export function DateDialog({
  open,
  onOpenChange,
  title,
  description,
  dateLabel,
  noteLabel,
  notePlaceholder,
  submitLabel,
  defaultDate,
  effects = [],
  now,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  dateLabel: string
  /** When given, an optional note field is shown (the reason the supplier gave). */
  noteLabel?: string
  notePlaceholder?: string
  submitLabel: string
  defaultDate?: string | null
  effects?: string[]
  now: Date
  onSubmit: Submit<{ date: string; note: string | null }>
}) {
  const t = useTranslations("Portal.ProcOrders")
  const today = todayOf(now)
  const schema = z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, t("form.date_required"))
      .refine((d) => d >= today, t("form.date_past")),
    note: z.string().trim().optional(),
  })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { date: defaultDate || "", note: "" } })
  useEffect(() => {
    if (open) form.reset({ date: defaultDate && defaultDate >= today ? defaultDate : "", note: "" })
  }, [open, defaultDate, today, form])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async (v) => {
              if (await onSubmit({ date: v.date, note: v.note?.trim() || null })) onOpenChange(false)
            })}
          >
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{dateLabel}</FormLabel>
                  <FormControl>
                    <Input type="date" min={today} dir="ltr" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {noteLabel && (
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{noteLabel}</FormLabel>
                    <FormControl>
                      <Input placeholder={notePlaceholder} dir="auto" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <Effects items={effects} />
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("form.cancel")}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting} className="gap-2">
                {form.formState.isSubmitting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// The decision on a rejected quantity (§5.2-8)
// ---------------------------------------------------------------------------

export interface RejectDecisionValue {
  decision: RejectDecision
  note: string | null
  /** `YYYY-MM-DD` on `replace` — optional. */
  replaceBy: string | null
  /** Unit price excl. VAT on `discount` — required. */
  discountPrice: number | null
}

export function RejectDecisionDialog({
  open,
  onOpenChange,
  line,
  now,
  initialDecision = "replace",
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  line: PoLine | null
  now?: Date
  /** The next step's three buttons open the form on the answer they name. */
  initialDecision?: RejectDecision
  onSubmit: Submit<RejectDecisionValue>
}) {
  const t = useTranslations("Portal.ProcOrders")
  const tProc = useTranslations("Portal.Procurement")
  const financeOn = useModules().on("payments")
  const today = todayOf(now ?? new Date())
  const schema = z
    .object({
      decision: z.enum(REJECT_DECISIONS),
      note: z.string().trim().optional(),
      replaceBy: z.string().optional(),
      discountPrice: z.string().optional(),
    })
    .superRefine((v, ctx) => {
      if (v.decision === "replace" && v.replaceBy && v.replaceBy < today) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["replaceBy"], message: t("form.date_past") })
      if (v.decision === "discount" && !(Number(v.discountPrice) > 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discountPrice"], message: t("reject.discount_required") })
    })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { decision: initialDecision, note: "", replaceBy: "", discountPrice: "" } })
  useEffect(() => {
    if (open) form.reset({ decision: initialDecision, note: "", replaceBy: "", discountPrice: "" })
  }, [open, form, initialDecision])
  const decision = useWatch({ control: form.control, name: "decision" })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("reject.title")}</DialogTitle>
          <DialogDescription>{t("reject.desc")}</DialogDescription>
        </DialogHeader>
        {line && (
          <Form {...form}>
            <form
              className="space-y-4"
              onSubmit={form.handleSubmit(async (v) => {
                const value: RejectDecisionValue = {
                  decision: v.decision,
                  note: v.note?.trim() || null,
                  replaceBy: v.decision === "replace" && v.replaceBy ? v.replaceBy : null,
                  discountPrice: v.decision === "discount" ? Number(v.discountPrice) : null,
                }
                if (await onSubmit(value)) onOpenChange(false)
              })}
            >
              <p className="rounded-lg border px-3 py-2 text-sm">
                <span className="font-bold">{line.name}</span>
                <span className="ms-2 text-destructive">{t("reject.rejected_qty", { qty: figure(line.rejected), unit: line.unit })}</span>
              </p>
              <FormField
                control={form.control}
                name="decision"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("reject.question")}</FormLabel>
                    <FormControl>
                      <RadioGroup value={field.value} onValueChange={field.onChange} className="gap-2">
                        {REJECT_DECISIONS.map((d) => (
                          <label key={d} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm", field.value === d && "border-module bg-module/5")}>
                            <RadioGroupItem value={d} className="mt-0.5" />
                            <span>
                              <span className="block font-bold">{tProc(`rejectDecision.${d}`)}</span>
                              <span className="block text-xs text-muted-foreground">{t(!financeOn && d === "discount" ? "reject.effect_discount_nofin" : `reject.effect_${d}`)}</span>
                            </span>
                          </label>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {decision === "replace" && (
                <FormField
                  control={form.control}
                  name="replaceBy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("reject.replace_by")}</FormLabel>
                      <FormControl>
                        <Input type="date" min={today} dir="ltr" {...field} />
                      </FormControl>
                      <p className="text-[11px] text-muted-foreground">{t("reject.replace_by_hint")}</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {decision === "discount" && (
                <FormField
                  control={form.control}
                  name="discountPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("reject.discount_price")}</FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="decimal" min={0} step="any" dir="ltr" className="tabular-nums" {...field} />
                      </FormControl>
                      <p className="text-[11px] text-muted-foreground">{t("reject.discount_price_hint")}</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t(financeOn ? "reject.note" : "reject.note_nofin")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("reject.note_ph")} dir="auto" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Effects items={[t(!financeOn && decision === "discount" ? "reject.effect_discount_nofin" : `reject.effect_${decision}`), t(financeOn ? "reject.effect_always" : "reject.effect_always_nofin")]} />
              <DialogFooter className="gap-2 sm:gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {t("form.cancel")}
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting} className="gap-2">
                  {form.formState.isSubmitting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                  {t("reject.submit")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// «ألغِ {no}» — a reason from the list, and what happens to its materials (WF-25)
// ---------------------------------------------------------------------------

const CANCEL_WHY_IDS = ["nacc", "dec", "chg", "need", "other"] as const
const CANCEL_THEN_IDS = ["reaward", "back", "none"] as const
export type CancelWhyId = (typeof CANCEL_WHY_IDS)[number]
export type CancelThenId = (typeof CANCEL_THEN_IDS)[number]
export interface CancelOrderValue {
  why: CancelWhyId
  note: string
  then: CancelThenId
}

export function CancelOrderDialog({
  open,
  onOpenChange,
  number,
  rfqNumber,
  canReaward,
  canBack,
  canNone,
  defaultWhy,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  number: string
  rfqNumber: string
  /** The RFQ is still there to go back to «يُقارن» without his offer. */
  canReaward: boolean
  /** The order's items came from requests: they return to «الواردة» for a new RFQ. */
  canBack: boolean
  /** An order that serves no request: it is cancelled alone. */
  canNone: boolean
  defaultWhy: CancelWhyId | null
  onSubmit: Submit<CancelOrderValue>
}) {
  const t = useTranslations("Portal.ProcOrders")
  const options = CANCEL_THEN_IDS.filter((c) => (c === "reaward" ? canReaward : c === "back" ? canBack : canNone))
  const schema = z
    .object({ why: z.enum(CANCEL_WHY_IDS), note: z.string().trim().optional(), then: z.enum(CANCEL_THEN_IDS) })
    .superRefine((v, ctx) => {
      if (v.why === "other" && (v.note || "").trim().length < 4) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["note"], message: t("cancel_order.other_required") })
    })
  type Values = z.infer<typeof schema>
  const initial = (): Partial<Values> => ({ why: defaultWhy ?? undefined, note: "", then: options.length === 1 ? options[0] : undefined })
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial() })
  useEffect(() => {
    if (open) form.reset(initial())
  }, [open])
  const why = form.watch("why")
  const then = form.watch("then")
  const card = (id: CancelThenId) => (
    <button
      key={id}
      type="button"
      role="radio"
      aria-checked={then === id}
      onClick={() => form.setValue("then", id, { shouldValidate: true })}
      className={cn(
        "flex w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        then === id ? "border-module bg-module/10" : "hover:border-border"
      )}
    >
      <span className="text-sm font-bold">{t(`cancel_order.then.${id}`, { rfq: rfqNumber })}</span>
      <span className="text-xs text-muted-foreground">{t(`cancel_order.then_hint.${id}`)}</span>
    </button>
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("cancel_order.title_no", { no: number })}</DialogTitle>
          <DialogDescription>{t("cancel_order.sub")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async (v) => {
              if (await onSubmit({ why: v.why, note: (v.note || "").trim(), then: v.then })) onOpenChange(false)
            })}
          >
            <div className="space-y-2">
              <p className="text-sm font-bold">{t("cancel_order.why_label")}</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("cancel_order.why_label")}>
                {CANCEL_WHY_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={why === id}
                    onClick={() => form.setValue("why", id, { shouldValidate: true })}
                    className={cn(
                      "min-h-9 rounded-full border px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      why === id ? "border-module bg-module/10 text-module" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t(`cancel_order.why.${id}`)}
                  </button>
                ))}
              </div>
              {why === "other" && (
                <FormField
                  control={form.control}
                  name="note"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input placeholder={t("cancel_order.other_ph")} dir="auto" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-bold">{t("cancel_order.then_label")}</p>
              <div className="space-y-2" role="radiogroup" aria-label={t("cancel_order.then_label")}>
                {options.map(card)}
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("cancel_order.back")}
              </Button>
              <Button type="submit" variant="destructive" disabled={!why || !then || form.formState.isSubmitting} className="gap-2">
                {form.formState.isSubmitting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {t("cancel_order.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
