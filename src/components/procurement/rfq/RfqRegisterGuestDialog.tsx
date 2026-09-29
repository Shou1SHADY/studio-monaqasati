"use client"

// «سجّله مورداً» (R-10, prototype FORMS.regSup): a guest who offered through
// the visitors' link has no supplier record, so no order can be issued to
// him. This sends him a join link in his company's name (the same
// supplier_invite the suppliers tab sends), prefilled from what he typed on
// the guest page; the offer and the RFQ's log remember it. Until he joins and
// his record is complete, the award still treats him as a guest.

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Check, Loader2, Mail, MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { INVITE_CHANNELS, inviteErrors, mailtoLink, waLink, type InviteChannel } from "@/lib/procurement/supplier-file"
import type { RfqWriteActor } from "@/lib/procurement/rfq-access"
import { recordGuestInvite } from "@/lib/procurement/rfq-writes"
import { isSaudiVat } from "@/lib/procurement/rfq-form"
import { cn } from "@/lib/utils"

export interface GuestToRegister {
  offerId: string
  name: string
  phone: string | null
  email: string | null
  vatNumber: string | null
}

const EFFECTS = ["joins", "awardable", "finance"] as const

export function RfqRegisterGuestDialog({
  guest,
  rfqId,
  rfqTitle,
  orgName,
  actor,
  onOpenChange,
}: {
  guest: GuestToRegister | null
  rfqId: string
  rfqTitle: string
  orgName: string
  actor: RfqWriteActor
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations("Portal.Procurement.rfqx.register")
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()

  const schema = z
    .object({
      companyName: z.string().trim().max(200),
      phone: z.string().trim().max(30),
      email: z.string().trim().max(200),
      vatNumber: z.string().trim().max(20),
      crExpiry: z.string().trim(),
      paymentTermsDays: z.string().trim().refine((v) => v === "" || (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 365)),
      channel: z.enum(INVITE_CHANNELS),
    })
    .superRefine((v, ctx) => {
      for (const code of inviteErrors(v)) {
        const path = code === "name_missing" ? "companyName" : code.startsWith("phone") ? "phone" : "email"
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: t(`err.${code}`) })
      }
      if (v.vatNumber && !isSaudiVat(v.vatNumber)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vatNumber"], message: t("err.vat_invalid") })
    })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { companyName: "", phone: "", email: "", vatNumber: "", crExpiry: "", paymentTermsDays: "", channel: "wa" } })
  const channel = useWatch({ control: form.control, name: "channel" })

  useEffect(() => {
    if (guest) form.reset({ companyName: guest.name, phone: guest.phone || "", email: guest.email || "", vatNumber: guest.vatNumber || "", crExpiry: "", paymentTermsDays: "", channel: guest.phone ? "wa" : "email" })
  }, [guest, form])

  const submit = form.handleSubmit(async (v) => {
    if (!user || !guest || !firestore) return
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
          message: t("message", { rfq: rfqTitle }),
          channel: v.channel,
          // Carried onto his supplier record when he joins, tagged «سُجّل من رابط زوار».
          guest: {
            ...(v.vatNumber ? { vatNumber: v.vatNumber } : {}),
            ...(v.crExpiry ? { crExpiry: v.crExpiry } : {}),
            ...(v.paymentTermsDays ? { paymentTermsDays: Number(v.paymentTermsDays) } : {}),
          },
        }),
      })
      const data = (await res.json().catch(() => null)) as { success?: boolean; data?: { joinUrl?: string; emailSent?: boolean; invitationId?: string } } | null
      if (!res.ok || !data?.success || !data.data?.joinUrl) throw new Error("invite_failed")
      const body = t("sentence", { company: orgName, rfq: rfqTitle, url: data.data.joinUrl })
      if (v.channel === "wa") {
        const link = waLink(v.phone, body)
        if (chat) {
          chat.opener = null
          chat.location.href = link
        } else window.open(link, "_blank", "noopener,noreferrer")
      } else if (!data.data.emailSent) {
        window.location.href = mailtoLink(v.email, t("subject"), body)
      }
      await recordGuestInvite(firestore, actor, { rfqId, offerId: guest.offerId, supplierName: v.companyName, channel: v.channel, invitationId: data.data.invitationId || null }).catch((err) =>
        console.warn("guest invite not logged:", (err as { code?: string })?.code || err)
      )
      toast({ title: t("done") })
      onOpenChange(false)
    } catch {
      chat?.close()
      toast({ title: t("err.failed"), variant: "destructive" })
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
        {t(`channel_${c}`)}
      </button>
    )
  }

  return (
    <Dialog open={Boolean(guest)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("sub")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="space-y-4">
            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("company")}</FormLabel>
                  <FormControl>
                    <Input dir="auto" {...field} />
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
                    <FormLabel>{t("phone")}</FormLabel>
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
                    <FormLabel>{t("email")}</FormLabel>
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
              name="vatNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("vat")}</FormLabel>
                  <FormControl>
                    <Input dir="ltr" inputMode="numeric" placeholder="3XXXXXXXXXXXXX3" {...field} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">{t("vat_hint")}</p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="crExpiry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("cr_expiry")}</FormLabel>
                    <FormControl>
                      <Input type="date" dir="ltr" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="paymentTermsDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("payment_terms")}</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" max="365" dir="ltr" inputMode="numeric" placeholder="30" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="channel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("how")}</FormLabel>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("how")}>
                    {INVITE_CHANNELS.map((c) => chip(c, field.value === c, () => field.onChange(c)))}
                  </div>
                </FormItem>
              )}
            />
            <ul className="space-y-1.5 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
              {EFFECTS.map((e) => (
                <li key={e} className="flex gap-2">
                  <Check size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                  <span>{t(`effect_${e}`)}</span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting} className="gap-1.5">
                {form.formState.isSubmitting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {channel === "wa" ? t("submit_wa") : t("submit_email")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
