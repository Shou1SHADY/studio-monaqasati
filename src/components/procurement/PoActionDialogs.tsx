"use client"

// The small forms an order's next step opens: a reason (return, cancel the
// remainder, close short, cancel the order), a date (record the supplier's
// acceptance, update his date), and the decision on a rejected quantity.
// Each one validates with zod, shows what will happen, and hands the value
// to the drawer — which runs the domain write and translates its refusal.

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
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

export function RejectDecisionDialog({
  open,
  onOpenChange,
  line,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  line: PoLine | null
  onSubmit: Submit<{ decision: RejectDecision; note: string | null }>
}) {
  const t = useTranslations("Portal.ProcOrders")
  const tProc = useTranslations("Portal.Procurement")
  const schema = z.object({ decision: z.enum(REJECT_DECISIONS), note: z.string().trim().optional() })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { decision: "replace", note: "" } })
  useEffect(() => {
    if (open) form.reset({ decision: "replace", note: "" })
  }, [open, form])
  const decision = form.watch("decision")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("reject.title")}</DialogTitle>
          <DialogDescription>{t("reject.desc")}</DialogDescription>
        </DialogHeader>
        {line && (
          <Form {...form}>
            <form
              className="space-y-4"
              onSubmit={form.handleSubmit(async (v) => {
                if (await onSubmit({ decision: v.decision, note: v.note?.trim() || null })) onOpenChange(false)
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
                              <span className="block text-xs text-muted-foreground">{t(`reject.effect_${d}`)}</span>
                            </span>
                          </label>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{decision === "discount" ? t("reject.note_discount") : t("reject.note")}</FormLabel>
                    <FormControl>
                      <Input placeholder={decision === "discount" ? t("reject.note_discount_ph") : t("reject.note_ph")} dir="auto" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Effects items={[t("reject.effect_always")]} />
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
