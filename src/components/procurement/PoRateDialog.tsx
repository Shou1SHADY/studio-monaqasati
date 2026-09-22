"use client"

// Rate the supplier (PRD §6.2): three aspects come from the receipts and are
// shown read-only — on time, in full, rejected at the gate, documents — and
// two stars come from the buyer. Published anonymously by default: other
// contractors see stars and a note, never our name.

import { useEffect, useMemo } from "react"
import { useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { poFacts } from "@/lib/procurement/po"
import type { PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"
import type { RatingInput } from "@/lib/procurement/writes"
import { useDateText } from "./PoBits"
import { figure } from "./PoModel"
import type { Submit } from "./PoActionDialogs"

function Stars({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n}/5`}
          onClick={() => onChange(n)}
          className="grid h-11 w-11 place-items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Star size={22} className={cn("transition-colors", n <= value ? "fill-warning text-warning" : "text-muted-foreground/40")} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

export function PoRateDialog({
  open,
  onOpenChange,
  po,
  receipts,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  po: PurchaseOrder | null
  receipts: ReceiptFact[]
  onSubmit: Submit<RatingInput>
}) {
  const t = useTranslations("Portal.ProcOrders")
  const fmt = useDateText()
  const facts = useMemo(() => (po ? poFacts(po, receipts) : null), [po, receipts])
  const schema = z.object({
    conformity: z.number().int().min(1, t("rate.pick_stars")).max(5),
    cooperation: z.number().int().min(1, t("rate.pick_stars")).max(5),
    note: z.string().trim().optional(),
    publishAnonymously: z.boolean(),
  })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { conformity: 0, cooperation: 0, note: "", publishAnonymously: true } })
  useEffect(() => {
    if (open) form.reset({ conformity: 0, cooperation: 0, note: "", publishAnonymously: true })
  }, [open, form])

  if (!po || !facts) return null
  const rows: Array<[string, string, "good" | "bad" | "plain"]> = [
    [
      t("rate.on_time"),
      facts.onTime == null ? "—" : facts.onTime ? t("rate.on_time_yes") : t("rate.on_time_no", { days: facts.lateByDays }),
      facts.onTime == null ? "plain" : facts.onTime ? "good" : "bad",
    ],
    [t("rate.in_full"), facts.inFull ? t("rate.in_full_yes") : t("rate.in_full_no", { accepted: figure(facts.accepted), ordered: figure(facts.ordered) }), facts.inFull ? "good" : "bad"],
    [t("rate.rejected"), `${figure(facts.rejectPercent)}%`, facts.rejectPercent > 0 ? "bad" : "good"],
    [t("rate.documents"), t("rate.documents_value", { docs: facts.docs, n: facts.receipts, certs: facts.certs }), "plain"],
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>{t("rate.title")}</DialogTitle>
          <DialogDescription>{t("rate.desc")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async (v) => {
              if (await onSubmit({ conformity: v.conformity, cooperation: v.cooperation, note: v.note?.trim() || null, publishAnonymously: v.publishAnonymously })) onOpenChange(false)
            })}
          >
            <dl className="divide-y rounded-lg border text-sm">
              {rows.map(([label, value, tone]) => (
                <div key={label} className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className={cn("font-bold", tone === "good" && "text-success", tone === "bad" && "text-destructive")}>{value}</dd>
                </div>
              ))}
              {facts.lastReceiptDay && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {t("rate.last_arrival", { date: fmt(facts.lastReceiptDay) })} · {t("rate.its_date", { date: fmt(po.promisedDate) })}
                </div>
              )}
            </dl>
            <FormField
              control={form.control}
              name="conformity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("rate.conformity")}</FormLabel>
                  <FormControl>
                    <Stars value={field.value} onChange={field.onChange} label={t("rate.conformity")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="cooperation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("rate.cooperation")}</FormLabel>
                  <FormControl>
                    <Stars value={field.value} onChange={field.onChange} label={t("rate.cooperation")} />
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
                  <FormLabel>{t("rate.note")}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder={t("rate.note_ph")} dir="auto" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="publishAnonymously"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <div>
                    <FormLabel className="text-sm">{t("rate.publish")}</FormLabel>
                    <p className="text-xs text-muted-foreground">{field.value ? t("rate.publish_on") : t("rate.publish_off")}</p>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!po.supplierUserId} />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("form.cancel")}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting} className="gap-2">
                {form.formState.isSubmitting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {t("rate.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
