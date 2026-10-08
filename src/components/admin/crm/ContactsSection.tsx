"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useLocale, useTranslations } from "next-intl"
import { Mail, Pencil, Phone, Plus, Star, Trash2, UsersRound } from "lucide-react"
import type { z } from "zod"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { IconButton } from "@/components/module-ui/IconButton"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { contactSchema, withPrimary, type CrmContact } from "@/lib/admin-crm"
import { saveRecord } from "@/lib/admin-crm-writes"
import { LtrValue, Section } from "./parts"

type Values = z.infer<typeof contactSchema>

const newId = () => `c_${Math.random().toString(36).slice(2, 10)}`

/** ADM-06: everyone we talk to at the company — name, job title, phone, e-mail; one is the main contact. */
export function ContactsSection({ recordId, contacts, originNote }: { recordId: string; contacts: CrmContact[]; originNote?: string }) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  // null = closed; "new" = adding; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<CrmContact | null>(null)
  const current = contacts.find((c) => c.id === editing)
  const form = useForm<Values>({ resolver: zodResolver(contactSchema), defaultValues: { name: "", title: "", phone: "", email: "", primary: false } })
  useEffect(() => {
    if (editing !== null) form.reset({ name: current?.name ?? "", title: current?.title ?? "", phone: current?.phone ?? "", email: current?.email ?? "", primary: current?.primary ?? contacts.length === 0 })
  }, [editing])
  const { errors, isSubmitting } = form.formState

  const persist = async (next: CrmContact[]) => {
    if (!firestore) return
    try {
      await saveRecord(firestore, recordId, { contacts: next })
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }

  const submit = async (v: Values) => {
    const isNew = editing === "new" || !current
    const id = isNew ? newId() : current.id
    const entry: CrmContact = { id, name: v.name, title: v.title, phone: v.phone, email: v.email, primary: v.primary }
    const list = isNew ? [...contacts, entry] : contacts.map((c) => (c.id === id ? entry : c))
    // Whoever is entered first becomes the main contact; ticking the box moves it.
    await persist(withPrimary(list, v.primary || list.length === 1 ? id : undefined))
    setEditing(null)
  }

  const remove = (c: CrmContact) => {
    const rest = contacts.filter((x) => x.id !== c.id)
    void persist(withPrimary(rest, c.primary ? undefined : rest.find((x) => x.primary)?.id))
  }

  // The form opens inside the section (ADM-06), above the list for a new person and in place of the row being edited.
  const formBox = (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-4 border-b bg-muted/20 p-4" noValidate aria-label={t(editing === "new" ? "contact_add" : "contact_edit")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`ct-name-${editing}`}>{t("name")} <span className="text-warning">*</span></Label>
          <Input id={`ct-name-${editing}`} autoFocus aria-invalid={!!errors.name} {...form.register("name")} />
          {errors.name && <p role="alert" className="text-xs text-destructive">{t("err_name")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ct-title-${editing}`}>{t("contact_job")}</Label>
          <Input id={`ct-title-${editing}`} {...form.register("title")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ct-phone-${editing}`}>{t("phone")}</Label>
          <Input id={`ct-phone-${editing}`} type="tel" dir="ltr" aria-invalid={!!errors.phone} {...form.register("phone")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ct-email-${editing}`}>{t("email")}</Label>
          <Input id={`ct-email-${editing}`} type="email" dir="ltr" aria-invalid={!!errors.email} {...form.register("email")} />
        </div>
      </div>
      <p className={errors.phone || errors.email ? "text-xs text-destructive" : "text-xs text-muted-foreground"} role={errors.phone || errors.email ? "alert" : undefined}>
        {t(errors.email ? "err_email" : "err_contact")}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" {...form.register("primary")} />
          {t("contact_primary_label")}
        </label>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)} disabled={isSubmitting}>
            {t("cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting}>{t("save")}</Button>
        </div>
      </div>
    </form>
  )

  return (
    <Section
      icon={UsersRound}
      title={t("contacts_title")}
      count={contacts.length}
      action={
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing("new")}>
          <Plus size={14} aria-hidden="true" />
          {t("contact_add")}
        </Button>
      }
    >
      {editing === "new" && formBox}
      {contacts.length === 0 && editing !== "new" ? (
        <p className="p-6 text-center text-sm text-muted-foreground">{t("contacts_empty")}</p>
      ) : (
        <ul className="divide-y">
          {contacts.map((c) =>
            editing === c.id ? (
              <li key={c.id}>{formBox}</li>
            ) : (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary" aria-hidden="true">
                {c.name.trim().slice(0, 2)}
              </span>
              {/* Never narrower than a name: on a phone the phone/e-mail line wraps under it instead. */}
              <div className="min-w-[12rem] flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                  {c.name}
                  {c.primary && (
                    <span className="inline-flex items-center gap-1 rounded-full border bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                      <Star size={11} aria-hidden="true" />
                      {t("contact_primary")}
                    </span>
                  )}
                </p>
                {(c.title || (c.id === "origin" && originNote)) && (
                  <p className="text-xs text-muted-foreground">{[c.title, c.id === "origin" ? originNote : ""].filter(Boolean).join(" · ")}</p>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {c.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone size={12} aria-hidden="true" />
                    <LtrValue value={c.phone} />
                  </span>
                )}
                {c.email && (
                  <span className="inline-flex min-w-0 max-w-56 items-center gap-1">
                    <Mail size={12} className="shrink-0" aria-hidden="true" />
                    <LtrValue value={c.email} />
                  </span>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <IconButton icon={Pencil} iconSize={14} label={t("edit")} onClick={() => setEditing(c.id)} />
                <IconButton icon={Trash2} iconSize={14} label={t("delete")} onClick={() => setRemoving(c)} className="hover:text-destructive" />
              </div>
            </li>
            ),
          )}
        </ul>
      )}

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("contact_delete_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("contact_delete_desc", { name: removing?.name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction className={buttonVariants({ variant: "destructive" })} onClick={() => removing && remove(removing)}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  )
}
