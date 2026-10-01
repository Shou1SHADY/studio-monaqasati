"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useLocale, useTranslations } from "next-intl"
import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { leadCrmId, manualLeadSchema } from "@/lib/admin-crm"
import type { z } from "zod"

type Values = z.infer<typeof manualLeadSchema>

export function AddLeadDialog({ open, onOpenChange, ownerName }: { open: boolean; onOpenChange: (open: boolean) => void; ownerName: string }) {
  const t = useTranslations("Portal.Admin.Leads")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const form = useForm<Values>({ resolver: zodResolver(manualLeadSchema), defaultValues: { name: "", company: "", phone: "", email: "", note: "" } })
  const errors = form.formState.errors

  const submit = async (values: Values) => {
    if (!firestore || !user) return
    try {
      const ref = await addDoc(collection(firestore, "demoRequests"), {
        name: values.name,
        company: values.company,
        phone: values.phone,
        email: values.email,
        origin: "manual",
        note: values.note,
        locale,
        status: "new",
        createdByUid: user.uid,
        createdAt: serverTimestamp(),
      })
      const crmId = leadCrmId("manual", ref.id)
      await setDoc(
        doc(firestore, "adminCrmClients", crmId),
        { stage: "new", ownerUid: user.uid, ownerName, updatedAt: serverTimestamp() },
        { merge: true },
      )
      if (values.note) {
        await addDoc(collection(firestore, "adminCrmActivities"), {
          clientId: crmId,
          type: "note",
          note: values.note,
          authorUid: user.uid,
          authorName: ownerName,
          createdAt: serverTimestamp(),
        })
      }
      toast({ title: t("add_lead_saved") })
      form.reset()
      onOpenChange(false)
    } catch {
      toast({ variant: "destructive", title: t("add_lead_failed") })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !form.formState.isSubmitting && onOpenChange(o)}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{t("add_lead_title")}</DialogTitle>
          <DialogDescription>{t("add_lead_desc")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="al-name">{t("name")} <span className="text-warning">*</span></Label>
            <Input id="al-name" aria-invalid={!!errors.name} {...form.register("name")} />
            {errors.name && <p role="alert" className="text-xs text-destructive">{t("err_name")}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="al-company">{t("company")}</Label>
            <Input id="al-company" {...form.register("company")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="al-phone">{t("phone")}</Label>
              <Input id="al-phone" type="tel" dir="ltr" aria-invalid={!!errors.phone} {...form.register("phone")} />
              {errors.phone && <p role="alert" className="text-xs text-destructive">{t("err_contact")}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="al-email">{t("email")}</Label>
              <Input id="al-email" type="email" dir="ltr" aria-invalid={!!errors.email} {...form.register("email")} />
              {errors.email && <p role="alert" className="text-xs text-destructive">{t("err_email")}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="al-note">{t("add_lead_note")}</Label>
            <Textarea id="al-note" rows={3} placeholder={t("add_lead_note_ph")} {...form.register("note")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting} className="gap-2">
              {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t("add_lead_save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
