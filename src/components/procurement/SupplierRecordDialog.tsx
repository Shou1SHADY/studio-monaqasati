"use client"

// «عدّل سجل المورد» — the facts WE vouch for: his VAT number, when his CR ends,
// the payment terms Finance reads for due dates, the lead time we see, and what
// kind of supplier he is (a subcontractor's contract lives in Projects).

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2 } from "lucide-react"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PAYMENT_TERM_DAYS, SUPPLIER_KINDS, SUPPLIER_ORIGINS, VAT_PATTERN, effectiveCrExpiry, effectiveVat, phoneIsInternational } from "@/lib/procurement/supplier-file"
import { SupplierWriteError, saveSupplierRecord } from "@/lib/procurement/supplier-writes"
import type { ProcActor } from "@/lib/procurement/types"
import type { PlatformSupplier } from "@/hooks/useSupplierDirectory"

export function SupplierRecordDialog({
  open,
  onOpenChange,
  supplier,
  actor,
  orgId,
  ownerHasTeam = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  supplier: PlatformSupplier
  actor: ProcActor
  orgId: string
  ownerHasTeam?: boolean
}) {
  const t = useTranslations("Portal.ProcSuppliers")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  const schema = z.object({
    vatNumber: z
      .string()
      .trim()
      .transform((v) => v.replace(/\s/g, ""))
      .refine((v) => !v || VAT_PATTERN.test(v), { message: t("err.vat_format") }),
    crExpiry: z.string().trim(),
    paymentTermsDays: z.string(),
    leadTimeDays: z
      .string()
      .trim()
      .refine((v) => !v || (/^\d+$/.test(v) && Number(v) <= 365), { message: t("err.lead_invalid") }),
    kind: z.enum(SUPPLIER_KINDS),
    origin: z.enum(["auto", ...SUPPLIER_ORIGINS]),
  })
  type Values = z.infer<typeof schema>

  const initial = (): Values => ({
    vatNumber: effectiveVat(supplier.record, supplier.profileVat),
    crExpiry: effectiveCrExpiry(supplier.record, supplier.profileCrExpiry) || "",
    paymentTermsDays: String(supplier.record?.paymentTermsDays ?? 30),
    leadTimeDays: supplier.record?.leadTimeDays ? String(supplier.record.leadTimeDays) : "",
    kind: supplier.record?.kind || "mat",
    origin: supplier.record?.origin || "auto",
  })
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial() })

  useEffect(() => {
    if (open) form.reset(initial())
    // Only when the dialog opens on a supplier: a live update to his record must
    // not wipe what the manager is typing.
  }, [open, supplier.orgId])

  const submit = form.handleSubmit(async (v) => {
    if (!firestore) return
    setSaving(true)
    try {
      await saveSupplierRecord(firestore, actor, orgId, { orgId: supplier.orgId, name: supplier.name }, v, new Date(), ownerHasTeam)
      toast({ title: t("toast.saved") })
      onOpenChange(false)
    } catch (err) {
      const code = err instanceof SupplierWriteError ? err.code : "generic"
      toast({ title: t.has(`err.${code}`) ? t(`err.${code}`) : t("err.generic"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>{t("record.title")}</DialogTitle>
          <DialogDescription dir="auto">{supplier.name}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="vatNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("record.vat")}</FormLabel>
                    <FormControl>
                      <Input dir="ltr" inputMode="numeric" placeholder="3xxxxxxxxxxxxx3" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="crExpiry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("record.cr")}</FormLabel>
                    <FormControl>
                      <Input type="date" dir="ltr" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="paymentTermsDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("record.terms")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PAYMENT_TERM_DAYS.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {d ? t("file.terms_days", { days: d }) : t("file.cash")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("record.terms_hint")}</p>
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="leadTimeDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("record.lead")}</FormLabel>
                    <FormControl>
                      <Input dir="ltr" inputMode="numeric" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("record.kind")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SUPPLIER_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {t(`kind.${k}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="origin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("record.origin")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="auto">{t("record.origin_auto")}</SelectItem>
                      {SUPPLIER_ORIGINS.map((o) => (
                        <SelectItem key={o} value={o}>
                          {t(`origin.${o}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {field.value === "auto"
                      ? t("record.origin_detected", { origin: t(`origin.${phoneIsInternational(supplier.phone) ? "international" : "local"}`) })
                      : t("record.origin_hint")}
                  </p>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
                {t("record.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
