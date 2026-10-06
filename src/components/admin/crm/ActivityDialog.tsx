"use client"

import { useEffect, useMemo } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import type { z } from "zod"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Chip } from "@/components/module-ui/Chip"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { ACTIVITY_RESULTS, NEW_ACTIVITY_TYPES, activitySchema, toDateKey, type CrmActivity, type CrmContact } from "@/lib/admin-crm"
import { createActivity, updateActivity, type Actor } from "@/lib/admin-crm-writes"
import { staffName, type StaffUser } from "@/hooks/useAdminCrm"

export type Party = { id: string; label: string; contacts: CrmContact[] }
type Values = z.infer<typeof activitySchema>

const TYPE_FALLBACK = "call" as const

/** ADM-08 «سجّل نشاطاً»: what happened or will happen. Scheduling one IS the follow-up — there is no separate follow-up field. */
export function ActivityDialog({
  open,
  onOpenChange,
  parties,
  staff,
  actor,
  presetClientId,
  activity,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  parties: Party[]
  staff: StaffUser[]
  actor: Actor
  presetClientId?: string
  activity?: CrmActivity | null
}) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = toDateKey(new Date())

  const defaults = useMemo<Values>(
    () => ({
      clientId: activity?.clientId ?? presetClientId ?? "",
      type: NEW_ACTIVITY_TYPES.find((k) => k === activity?.type) ?? TYPE_FALLBACK,
      status: activity?.status === "done" ? "done" : "scheduled",
      dueDate: activity?.dueDate ?? today,
      dueTime: activity?.dueTime ?? "",
      withName: activity?.withName ?? "",
      ownerUid: activity?.ownerUid ?? actor.uid,
      title: activity?.title ?? "",
      note: activity?.note ?? "",
      result: activity?.result,
    }),
    [activity, presetClientId, actor.uid, today],
  )
  const form = useForm<Values>({ resolver: zodResolver(activitySchema), defaultValues: defaults })
  useEffect(() => {
    if (open) form.reset(defaults)
  }, [open, defaults, form])

  const { errors, isSubmitting } = form.formState
  const clientId = form.watch("clientId")
  const type = form.watch("type")
  const status = form.watch("status")
  const contacts = parties.find((p) => p.id === clientId)?.contacts ?? []
  const wantsResult = status === "done" && (type === "call" || type === "whatsapp")

  const submit = async (v: Values) => {
    if (!firestore) return
    const ownerName = staff.find((s) => s.id === v.ownerUid)
    try {
      const name = ownerName ? staffName(ownerName) : v.ownerUid === actor.uid ? actor.name : ""
      if (activity) await updateActivity(firestore, activity.id, v, name)
      else await createActivity(firestore, actor, v, name)
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
          <DialogTitle>{t(activity ? "activity_edit_title" : "activity_title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("activity_hint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="ac-client">{t("activity_client")}</Label>
            <NativeSelect id="ac-client" className="w-full" aria-invalid={!!errors.clientId} {...form.register("clientId", { onChange: () => form.setValue("withName", "") })}>
              <option value="">{t("activity_client_pick")}</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
            {errors.clientId && <p role="alert" className="text-xs text-destructive">{t("activity_err_client")}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>{t("type_label")}</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("type_label")}>
              {NEW_ACTIVITY_TYPES.map((k) => (
                <Chip key={k} selected={type === k} onClick={() => form.setValue("type", k)}>
                  {t(`type_${k}`)}
                </Chip>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("activity_status")}</Label>
            <div className="flex gap-4" role="radiogroup" aria-label={t("activity_status")}>
              {(["scheduled", "done"] as const).map((s) => (
                <label key={s} className="inline-flex items-center gap-2 text-sm">
                  <input type="radio" value={s} checked={status === s} onChange={() => form.setValue("status", s)} className="h-4 w-4 accent-primary" />
                  {t(`activity_status_${s}`)}
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ac-date">{t("activity_date")}</Label>
              <Input id="ac-date" type="date" dir="ltr" aria-invalid={!!errors.dueDate} {...form.register("dueDate")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-time">{t("activity_time")}</Label>
              <Input id="ac-time" type="time" dir="ltr" {...form.register("dueTime")} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ac-with">{t("activity_with")}</Label>
              <NativeSelect id="ac-with" className="w-full" disabled={contacts.length === 0} {...form.register("withName")}>
                <option value="">—</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.title ? `${c.name} — ${c.title}` : c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-owner">{t("owner_label")}</Label>
              <NativeSelect id="ac-owner" className="w-full" {...form.register("ownerUid")}>
                <option value={actor.uid}>{actor.name}</option>
                {staff
                  .filter((s) => s.id !== actor.uid)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {staffName(s)}
                    </option>
                  ))}
              </NativeSelect>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ac-title">{t("activity_title_label")}</Label>
            <Input id="ac-title" aria-invalid={!!errors.title} {...form.register("title")} />
            {errors.title && <p role="alert" className="text-xs text-destructive">{t("activity_err_title")}</p>}
          </div>

          {wantsResult && (
            <div className="space-y-1.5">
              <Label>{t("activity_result")}</Label>
              <Controller
                control={form.control}
                name="result"
                render={({ field }) => (
                  <div className="flex flex-wrap gap-2" role="group" aria-label={t("activity_result")}>
                    {ACTIVITY_RESULTS.map((r) => (
                      <Chip key={r} selected={field.value === r} onClick={() => field.onChange(field.value === r ? undefined : r)}>
                        {t(`result_${r}`)}
                      </Chip>
                    ))}
                  </div>
                )}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ac-note">{t("note_label")}</Label>
            <Textarea id="ac-note" rows={3} placeholder={t("activity_note_ph")} {...form.register("note")} />
          </div>
          <p className="text-xs text-muted-foreground">{t("activity_hint")}</p>

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
