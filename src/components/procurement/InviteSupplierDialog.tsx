"use client"

// «ادعُ مورداً إلى المنصة» (Procurement 1.5, PUR-05): a supplier we deal with who is not
// on the platform gets a join link in our company's name — no RFQ, no price. Company ·
// contact (optional) · mobile or e-mail · his specialties from the material tree
// (optional) · the channel · a ready text he can edit. WhatsApp opens the sender's own
// chat; e-mail and a text message are sent by the platform in the company's name. A number
// invited before says so («دُعي في 12 أكتوبر — أعد الإرسال؟»), and one already on the
// platform is offered to «مورّدونا» instead. To send a given RFQ to a supplier outside
// the platform, that RFQ's guest link is the way — this is not it.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { ChevronDown, Loader2, Mail, MessageCircle, Smartphone } from "lucide-react"
import { useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Callout } from "@/components/module-ui/Callout"
import { MaterialSubsPicker } from "@/components/materials/MaterialSubsPicker"
import { cn } from "@/lib/utils"
import { waLink } from "@/lib/procurement/supplier-file"
import { LINK_TOKEN, PLATFORM_INVITE_CHANNELS, channelFits, contactOf, duplicateOf, finalInviteText, type InvitationFacts, type PlatformInviteChannel } from "@/lib/procurement/invitations"
import { fmtDayLong } from "@/lib/procurement/format"

export interface InvitePrefill {
  companyName?: string
  contactName?: string
  contact?: string
  specialtyIds?: string[]
}

const ICON: Record<PlatformInviteChannel, typeof MessageCircle> = { wa: MessageCircle, email: Mail, sms: Smartphone }

export function InviteSupplierDialog({
  open,
  onOpenChange,
  orgName,
  prefill,
  invitations = [],
  platform = [],
  onAddExisting,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgName: string
  prefill?: InvitePrefill | null
  invitations?: Array<InvitationFacts & { id: string; phone?: string | null; email?: string | null }>
  platform?: Array<{ orgId: string; name: string; phone?: string | null; email?: string | null }>
  /** «موجود في المنصة — أضِفه إلى مورّدينا». */
  onAddExisting?: (orgId: string) => void
}) {
  const t = useTranslations("Portal.ProcSuppliers")
  const locale = useLocale()
  const { user } = useUser()
  const { toast } = useToast()
  const { index } = useMaterialTree()
  const [showSubs, setShowSubs] = useState(false)
  // The link's place in the text, as the sender reads it; the server puts the link there.
  const linkWord = t("inv2.link_word")
  const ready = (name: string) => t("inv2.ready", { name: name.trim() ? ` ${name.trim()}` : "", company: orgName || "—", link: linkWord })

  const schema = z
    .object({
      companyName: z.string().trim().min(1, t("inv.err.name_missing")).max(200),
      contactName: z.string().trim().max(120),
      contact: z.string().trim().max(200),
      specialtyIds: z.array(z.string()),
      channel: z.enum(PLATFORM_INVITE_CHANNELS),
      message: z.string().trim().min(1).max(1000),
    })
    .superRefine((v, ctx) => {
      const c = contactOf(v.contact)
      if (!c.phone && !c.email) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contact"], message: t("inv2.err_contact") })
      else if (!channelFits(v.channel, c)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["channel"], message: t(v.channel === "email" ? "inv2.err_needs_email" : "inv2.err_needs_phone") })
    })
  type Values = z.infer<typeof schema>
  const blank = (p?: InvitePrefill | null): Values => ({
    companyName: p?.companyName || "",
    contactName: p?.contactName || "",
    contact: p?.contact || "",
    specialtyIds: p?.specialtyIds || [],
    channel: p?.contact && contactOf(p.contact).email ? "email" : "wa",
    message: ready(p?.contactName || ""),
  })
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: blank(prefill) })
  useEffect(() => {
    if (open) form.reset(blank(prefill))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill])
  const [channel, contact, contactName, message] = useWatch({ control: form.control, name: ["channel", "contact", "contactName", "message"] })
  const parsed = useMemo(() => contactOf(contact || ""), [contact])
  const dup = useMemo(() => duplicateOf(parsed, invitations, platform), [parsed, invitations, platform])
  // The greeting follows the contact's name until the sender edits the text himself.
  useEffect(() => {
    if (!form.formState.dirtyFields.message) form.setValue("message", ready(contactName || ""))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactName, orgName])

  const submit = form.handleSubmit(async (v) => {
    if (!user) return
    const c = contactOf(v.contact)
    // Opened now, inside the click: a window opened after the request returns is a popup the browser blocks.
    const chat = v.channel === "wa" ? window.open("", "_blank") : null
    try {
      const text = v.message.split(linkWord).join(LINK_TOKEN)
      const res = await fetch("/api/invitations/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({
          type: "supplier_invite",
          companyName: v.companyName,
          contactName: v.contactName || undefined,
          email: c.email || undefined,
          phone: c.phone || undefined,
          specialtyIds: v.specialtyIds,
          message: text,
          fullText: true,
          channel: v.channel,
        }),
      })
      const data = (await res.json().catch(() => null)) as { success?: boolean; data?: { joinUrl?: string; delivered?: boolean } } | null
      if (!res.ok || !data?.success || !data.data?.joinUrl) throw new Error("invite_failed")
      if (v.channel === "wa") {
        const link = waLink(c.phone || "", finalInviteText(text, data.data.joinUrl))
        if (chat) {
          chat.opener = null
          chat.location.href = link
        } else window.open(link, "_blank", "noopener,noreferrer")
        toast({ title: t("inv.toast_wa") })
      } else {
        toast({ title: data.data.delivered ? t(v.channel === "email" ? "inv2.sent_email" : "inv2.sent_sms") : t("inv2.not_delivered"), variant: data.data.delivered ? "default" : "destructive" })
      }
      onOpenChange(false)
    } catch {
      chat?.close()
      toast({ title: t("inv.err.failed"), variant: "destructive" })
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>{t("inv2.title")}</DialogTitle>
          <DialogDescription>{t("inv2.sub")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="space-y-4">
            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("inv2.company")} *</FormLabel>
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
                name="contactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("inv2.contact_name")} <span className="font-normal text-muted-foreground">({t("inv2.optional")})</span>
                    </FormLabel>
                    <FormControl>
                      <Input dir="auto" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contact"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("inv2.contact")} *</FormLabel>
                    <FormControl>
                      <Input dir="ltr" placeholder="05xxxxxxxx" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {dup?.kind === "invited" && <Callout tone="info">{t("inv2.dup_invited", { date: dup.day ? fmtDayLong(dup.day, locale, false) : "—" })}</Callout>}
            {dup?.kind === "registered" && (
              <Callout tone="warn">
                <span className="flex flex-wrap items-center gap-2">
                  {t("inv2.dup_registered", { name: dup.name || "" })}
                  {onAddExisting && dup.orgId && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onAddExisting(dup.orgId as string)
                        onOpenChange(false)
                      }}
                    >
                      {t("inv2.add_existing")}
                    </Button>
                  )}
                </span>
              </Callout>
            )}
            <FormField
              control={form.control}
              name="specialtyIds"
              render={({ field }) => (
                <FormItem>
                  <button type="button" onClick={() => setShowSubs(!showSubs)} aria-expanded={showSubs} className="flex w-full items-center justify-between text-sm font-medium">
                    <span>
                      {t("inv2.specialties")} <span className="font-normal text-muted-foreground">({t("inv2.optional")})</span>
                      {field.value.length > 0 && <span className="ms-2 rounded-full bg-module/10 px-2 text-xs text-module">{field.value.length}</span>}
                    </span>
                    <ChevronDown size={15} className={cn("transition-transform", showSubs && "rotate-180")} aria-hidden="true" />
                  </button>
                  {showSubs && <MaterialSubsPicker index={index} value={field.value} onChange={field.onChange} />}
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="channel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("inv2.channel")}</FormLabel>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("inv2.channel")}>
                    {PLATFORM_INVITE_CHANNELS.map((c) => {
                      const Icon = ICON[c]
                      const fits = !contact || channelFits(c, parsed)
                      return (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={field.value === c}
                          disabled={!fits}
                          onClick={() => field.onChange(c)}
                          className={cn(
                            "flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                            field.value === c ? "border-module bg-module/10 text-module" : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <Icon size={15} aria-hidden="true" />
                          {t(`inv2.ch_${c}`)}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">{t(`inv2.ch_${field.value}_hint`)}</p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("inv2.message")}</FormLabel>
                  <FormControl>
                    <Textarea rows={4} dir="auto" {...field} />
                  </FormControl>
                  {!(message || "").includes(linkWord) && <p className="text-xs text-muted-foreground">{t("inv2.link_added")}</p>}
                </FormItem>
              )}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">{t("inv2.not_rfq")}</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting} className="gap-1.5">
                {form.formState.isSubmitting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {dup?.kind === "invited" ? t("inv2.resend") : t(`inv2.send_${channel}`)}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
