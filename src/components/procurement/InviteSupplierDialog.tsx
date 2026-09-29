"use client"

// «ادعُ مورداً إلى منصة مدماك» (prototype FORMS.supInv). A supplier we deal
// with who is not on the platform gets a join link in his company's name. The
// channel decides which contact is required; either way the sender's own tool
// opens with the ready text — his WhatsApp chat or his mail — and he sends it.
// Until he joins, a guest RFQ link still reaches him — the invitation blocks no purchase.

import { useLocale, useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Check, Loader2, Mail, MessageCircle } from "lucide-react"
import { useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { CATEGORIES_DATA, displayCategory } from "@/lib/constants"
import { INVITE_CHANNELS, inviteErrors, inviteMessage, mailtoLink, waLink, type InviteChannel } from "@/lib/procurement/supplier-file"

const EFFECTS = ["opens", "joins", "guest", "profile"] as const

export function InviteSupplierDialog({ open, onOpenChange, orgName }: { open: boolean; onOpenChange: (open: boolean) => void; orgName: string }) {
  const t = useTranslations("Portal.ProcSuppliers")
  const locale = useLocale()
  const { user } = useUser()
  const { toast } = useToast()

  const schema = z
    .object({
      companyName: z.string().trim().max(200),
      phone: z.string().trim().max(30),
      email: z.string().trim().max(200),
      category: z.string(),
      channel: z.enum(INVITE_CHANNELS),
      message: z.string().trim().max(1000),
    })
    .superRefine((v, ctx) => {
      for (const code of inviteErrors(v)) {
        const path = code === "name_missing" ? "companyName" : code.startsWith("phone") ? "phone" : "email"
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: t(`inv.err.${code}`) })
      }
    })
  type Values = z.infer<typeof schema>
  const blank: Values = { companyName: "", phone: "", email: "", category: "", channel: "wa", message: "" }
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: blank })
  const channel = form.watch("channel")

  const submit = form.handleSubmit(async (v) => {
    if (!user) return
    // Opened now, inside the click: a window opened after the request returns
    // is a popup the browser blocks.
    const chat = v.channel === "wa" ? window.open("", "_blank") : null
    try {
      const idToken = await user.getIdToken()
      const res = await fetch("/api/invitations/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          type: "supplier_invite",
          companyName: v.companyName,
          email: v.email || undefined,
          phone: v.phone || undefined,
          category: v.category || undefined,
          message: v.message || undefined,
          channel: v.channel,
        }),
      })
      const data = (await res.json().catch(() => null)) as { success?: boolean; message?: string; data?: { joinUrl?: string; emailSent?: boolean } } | null
      if (!res.ok || !data?.success || !data.data?.joinUrl) throw new Error(data?.message || "invite_failed")
      const body = inviteMessage(v.message, t("inv.sentence", { company: orgName, url: data.data.joinUrl }))
      if (v.channel === "wa") {
        const link = waLink(v.phone, body)
        if (chat) {
          chat.opener = null
          chat.location.href = link
        } else window.open(link, "_blank", "noopener,noreferrer")
        toast({ title: t("inv.toast_wa") })
      } else {
        // The sender's own mail, like WhatsApp: the platform never sends in his name (supplier-file.ts).
        window.location.href = mailtoLink(v.email, t("inv.subject"), body)
        toast({ title: t("inv.toast_email") })
      }
      form.reset(blank)
      onOpenChange(false)
    } catch {
      chat?.close()
      toast({ title: t("inv.err.failed"), variant: "destructive" })
    }
  })

  const chip = (c: InviteChannel, active: boolean, onPick: () => void) => {
    const Icon = c === "wa" ? MessageCircle : Mail
    return (
      <button
        key={c}
        type="button"
        role="radio"
        aria-checked={active}
        onClick={onPick}
        className={cn(
          "flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active ? "border-module bg-module/10 text-module" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Icon size={15} aria-hidden="true" />
        {t(`inv.channel_${c}`)}
      </button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>{t("inv.form_title")}</DialogTitle>
          <DialogDescription>{t("inv.form_sub")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="space-y-4">
            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("inv.company")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("inv.company_ph")} dir="auto" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("inv.phone")}</FormLabel>
                    <FormControl>
                      <Input type="tel" dir="ltr" placeholder="05xxxxxxxx" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("inv.email")}</FormLabel>
                    <FormControl>
                      <Input type="email" dir="ltr" placeholder="name@company.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("inv.supplies")}</FormLabel>
                  <FormControl>
                    <select {...field} className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <option value="">{t("inv.not_specified")}</option>
                      {Object.keys(CATEGORIES_DATA).map((c) => (
                        <option key={c} value={c}>
                          {displayCategory(c, locale)}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="channel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("inv.how")}</FormLabel>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("inv.how")}>
                    {INVITE_CHANNELS.map((c) => chip(c, field.value === c, () => field.onChange(c)))}
                  </div>
                  <p className="text-xs text-muted-foreground">{t("inv.how_hint")}</p>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("inv.message")}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder={t("inv.message_ph")} dir="auto" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <ul className="space-y-1.5 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
              {EFFECTS.map((e) => (
                <li key={e} className="flex gap-2">
                  <Check size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                  <span>{t(`inv.effect_${e}`)}</span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting} className="gap-1.5">
                {form.formState.isSubmitting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {channel === "wa" ? t("inv.submit_wa") : t("inv.submit_email")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
