"use client"

import { useEffect, useMemo } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Chip } from "@/components/module-ui/Chip"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { Link } from "@/i18n/routing"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { staffName, useAdminCrm } from "@/hooks/useAdminCrm"
import { MANUAL_CHANNELS, findSimilarLead, formatCrmDate, manualLeadSchema } from "@/lib/admin-crm"
import { addManualLead } from "@/lib/admin-crm-writes"
import type { z } from "zod"

type Values = z.infer<typeof manualLeadSchema>

/** ADM-04: a person who reached us outside the landing page (an ad, a call we made, anything else). Source first; the name alone is enough to save. */
export function AddLeadDialog({ open, onOpenChange, ownerName }: { open: boolean; onOpenChange: (open: boolean) => void; ownerName: string }) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{t("add_lead_title")}</DialogTitle>
          <DialogDescription>{t("add_lead_desc")}</DialogDescription>
        </DialogHeader>
        {/* The listeners only run while the dialog is open. */}
        {open && <AddLeadForm onClose={() => onOpenChange(false)} ownerName={ownerName} />}
      </DialogContent>
    </Dialog>
  )
}

function AddLeadForm({ onClose, ownerName }: { onClose: () => void; ownerName: string }) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const crm = useAdminCrm()
  const me = user?.uid ?? ""
  const form = useForm<Values>({
    resolver: zodResolver(manualLeadSchema),
    defaultValues: { source: undefined as unknown as Values["source"], kind: "unspecified", name: "", company: "", phone: "", email: "", city: "", ownerUid: me, note: "" },
  })
  const { errors, isSubmitting } = form.formState
  const [name, phone, email] = form.watch(["name", "phone", "email"])
  useEffect(() => {
    if (me && !form.getValues("ownerUid")) form.setValue("ownerUid", me)
  }, [me, form])
  const similar = useMemo(() => findSimilarLead(crm.leadRows, { name, phone, email }), [crm.leadRows, name, phone, email])

  const submit = async (v: Values) => {
    if (!firestore || !user) return
    try {
      const owner = crm.staff.find((s) => s.id === v.ownerUid)
      await addManualLead(firestore, { uid: user.uid, name: ownerName || user.email || "" }, v, { uid: v.ownerUid, name: owner ? staffName(owner) : v.ownerUid === me ? ownerName : "" })
      toast({ title: t("add_lead_saved") })
      onClose()
    } catch {
      toast({ variant: "destructive", title: t("add_lead_failed") })
    }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label>
          {t("col_source")} <span className="text-warning">*</span>
        </Label>
        <Controller
          control={form.control}
          name="source"
          render={({ field }) => (
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("col_source")}>
              {MANUAL_CHANNELS.map((c) => (
                <Chip key={c} selected={field.value === c} onClick={() => field.onChange(c)}>
                  {t(`channel_${c}`)}
                </Chip>
              ))}
            </div>
          )}
        />
        {errors.source && <p role="alert" className="text-xs text-destructive">{t("err_source")}</p>}
      </div>
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
          <Label htmlFor="al-name">
            {t("name")} <span className="text-warning">*</span>
          </Label>
          <Input id="al-name" aria-invalid={!!errors.name} {...form.register("name")} />
          {errors.name && <p role="alert" className="text-xs text-destructive">{t("err_name")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="al-company">{t("company")}</Label>
          <Input id="al-company" {...form.register("company")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="al-phone">{t("phone")}</Label>
          <Input id="al-phone" type="tel" dir="ltr" aria-invalid={!!errors.phone} {...form.register("phone")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="al-email">{t("email")}</Label>
          <Input id="al-email" type="email" dir="ltr" aria-invalid={!!errors.email} {...form.register("email")} />
        </div>
      </div>
      <p className={errors.phone || errors.email ? "text-xs text-destructive" : "text-xs text-muted-foreground"} role={errors.phone || errors.email ? "alert" : undefined}>
        {errors.email ? t("err_email") : t("err_contact")}
      </p>
      {similar && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">{t(`dup_exists_${similar.reason}`)}</p>
            <p className="text-xs text-muted-foreground">
              {[similar.row.name, similar.row.company].filter(Boolean).join(" — ")} · {t(`channel_${similar.row.channel}`)} · {t("dup_arrived", { date: formatCrmDate(similar.row.createdMs, locale) })}
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`/admin/crm/leads/${similar.row.crmId}`} target="_blank">{t("dup_open")}</Link>
          </Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="al-city">{t("city_label")}</Label>
          <Input id="al-city" {...form.register("city")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="al-owner">{t("owner_label")}</Label>
          <NativeSelect id="al-owner" className="w-full" {...form.register("ownerUid")}>
            {/* You by default (ADM-04 #6); a manager may pick a colleague. */}
            <option value={me}>{t("you")}</option>
            {crm.staff
              .filter((s) => s.id !== me)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {staffName(s)}
                </option>
              ))}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="al-note">{t("note_label")}</Label>
        <Textarea id="al-note" rows={3} placeholder={t("add_lead_note_ph")} {...form.register("note")} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting} className="gap-2">
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {t("add_lead_save")}
        </Button>
      </DialogFooter>
    </form>
  )
}
