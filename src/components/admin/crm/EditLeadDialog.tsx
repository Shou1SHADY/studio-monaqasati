"use client"

import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Chip } from "@/components/module-ui/Chip"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { leadDetailsSchema, type LeadDetails, type LeadRow } from "@/lib/admin-crm"
import { updateLeadDetails } from "@/lib/admin-crm-writes"

/** ADM-05 «تعديل» in the lead's header: the details it arrived with — the same fields and rules as adding one (ADM-04). */
export function EditLeadDialog({ row, open, onOpenChange }: { row: LeadRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const form = useForm<LeadDetails>({ resolver: zodResolver(leadDetailsSchema) })
  useEffect(() => {
    if (open) form.reset({ kind: row.kind, name: row.name, company: row.company, phone: row.phone, email: row.email, city: row.city })
  }, [open, row, form])
  const { errors, isSubmitting } = form.formState

  const submit = async (v: LeadDetails) => {
    if (!firestore) return
    try {
      await updateLeadDetails(firestore, row, v)
      toast({ title: t("saved") })
      onOpenChange(false)
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{t("edit_lead_title")}</DialogTitle>
          <DialogDescription>{t("contact_hint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label>{t("col_type")}</Label>
            <Controller
              control={form.control}
              name="kind"
              render={({ field }) => (
                <div className="flex flex-wrap gap-2" role="group" aria-label={t("col_type")}>
                  {(["contractor", "supplier", "unspecified"] as const).map((k) => (
                    <Chip key={k} selected={field.value === k} onClick={() => field.onChange(k)}>
                      {t(`kind_${k}`)}
                    </Chip>
                  ))}
                </div>
              )}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="el-name">
                {t("name")} <span className="text-warning">*</span>
              </Label>
              <Input id="el-name" aria-invalid={!!errors.name} {...form.register("name")} />
              {errors.name && <p role="alert" className="text-xs text-destructive">{t("err_name")}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="el-company">{t("company")}</Label>
              <Input id="el-company" {...form.register("company")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="el-phone">{t("phone")}</Label>
              <Input id="el-phone" type="tel" dir="ltr" aria-invalid={!!errors.phone} {...form.register("phone")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="el-email">{t("email")}</Label>
              <Input id="el-email" type="email" dir="ltr" aria-invalid={!!errors.email} {...form.register("email")} />
            </div>
          </div>
          <p className={errors.phone || errors.email ? "text-xs text-destructive" : "text-xs text-muted-foreground"} role={errors.phone || errors.email ? "alert" : undefined}>
            {errors.email ? t("err_email") : t("err_contact")}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="el-city">{t("city_label")}</Label>
            <Input id="el-city" {...form.register("city")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting} className="gap-2">
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
