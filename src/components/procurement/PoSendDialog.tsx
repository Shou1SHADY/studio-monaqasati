"use client"

// Send the approved order to the supplier (PRD §10.7): the system never
// messages on the buyer's behalf. A registered supplier gets it in his
// portal; otherwise WhatsApp or e-mail opens with a ready text — number,
// value when the sender may see it, the lines, and the one ask — and THEN
// the dispatch is recorded with the sender's name and the channel.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { doc, getDoc } from "firebase/firestore"
import { Copy, Loader2, Mail, MessageCircle, Send } from "lucide-react"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { lineOutstanding, PO_SEND_CHANNELS } from "@/lib/procurement/po"
import type { PoSendChannel, PurchaseOrder } from "@/lib/procurement/types"
import { buildSendMessage, isEmail, mailtoUrl, moneyTrail, whatsappUrl } from "./PoModel"
import type { Submit } from "./PoActionDialogs"

/** The site the buyer is using — UAT links stay on UAT. */
const portalOrigin = () => (typeof window !== "undefined" && window.location.origin) || "https://mdmaktech.sa"

export function PoSendDialog({
  open,
  onOpenChange,
  po,
  orgName,
  seesPrices,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  po: PurchaseOrder | null
  orgName: string
  seesPrices: boolean
  onSubmit: Submit<PoSendChannel>
}) {
  const t = useTranslations("Portal.ProcOrders")
  const tProc = useTranslations("Portal.Procurement")
  const locale = useLocale() as "ar" | "en"
  const firestore = useFirestore()
  const { toast } = useToast()
  const registered = Boolean(po && !po.isGuestSupplier && po.supplierUserId)

  const schema = z
    .object({
      channel: z.enum(PO_SEND_CHANNELS),
      phone: z.string().trim().optional(),
      email: z.string().trim().optional(),
      note: z.string().trim().optional(),
    })
    .superRefine((v, ctx) => {
      if (v.channel === "whatsapp" && !(v.phone || "").replace(/\D/g, "")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: t("send.phone_required") })
      if (v.channel === "email" && !isEmail(v.email || "")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: t("send.email_invalid") })
    })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { channel: registered ? "portal" : "whatsapp", phone: "", email: "", note: "" } })

  // The supplier's contact, when we know him: his platform profile, or the
  // guest contact he typed on his offer.
  useEffect(() => {
    if (!open || !po || !firestore) return
    form.reset({ channel: registered ? "portal" : "whatsapp", phone: "", email: "", note: "" })
    let cancelled = false
    ;(async () => {
      try {
        let phone = ""
        let email = ""
        if (po.supplierUserId) {
          const snap = await getDoc(doc(firestore, "users", po.supplierUserId))
          const d = (snap.exists() ? snap.data() : {}) as { phone?: string; phoneNumber?: string; email?: string }
          phone = d.phone || d.phoneNumber || ""
          email = d.email || ""
        } else if (po.offerId) {
          const snap = await getDoc(doc(firestore, "offers", po.offerId))
          const g = ((snap.exists() ? snap.data() : {}) as { guestContact?: { phone?: string; email?: string } }).guestContact
          phone = g?.phone || ""
          email = g?.email || ""
        }
        if (!cancelled) {
          if (phone) form.setValue("phone", phone)
          if (email) form.setValue("email", email)
        }
      } catch {
        /* the fields stay empty — the buyer types them */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, po, firestore, registered, form])

  const channel = form.watch("channel")
  const note = form.watch("note")
  const message = useMemo(() => {
    if (!po) return ""
    return buildSendMessage({
      locale,
      number: po.docNumber,
      orgName,
      commitment: seesPrices ? moneyTrail(po).commitment : null,
      lines: po.lines.filter((l) => lineOutstanding(l) > 0).map((l) => ({ name: l.name, quantity: lineOutstanding(l), unit: l.unit })),
      portalUrl: registered ? `${portalOrigin()}/supplier/orders?po=${po.id}` : null,
      note,
    })
  }, [po, locale, orgName, seesPrices, registered, note])

  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
    } catch {
      /* the toast still says so: the text is on screen to select */
    }
    setCopied(true)
    toast({ title: t("send.copied") })
    window.setTimeout(() => setCopied(false), 2000)
  }

  const channels = PO_SEND_CHANNELS.filter((c) => c !== "portal" || registered)

  if (!po) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>{t("send.title")}</DialogTitle>
          <DialogDescription>{t("send.desc", { supplier: po.supplierName })}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async (v) => {
              const subject = t("send.subject", { number: po.docNumber })
              if (v.channel === "whatsapp") window.open(whatsappUrl(v.phone || "", message), "_blank", "noopener,noreferrer")
              if (v.channel === "email") window.open(mailtoUrl(v.email || "", subject, message), "_blank")
              if (await onSubmit(v.channel)) onOpenChange(false)
            })}
          >
            <FormField
              control={form.control}
              name="channel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("send.channel")}</FormLabel>
                  <FormControl>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("send.channel")}>
                      {channels.map((c) => {
                        const Icon = c === "portal" ? Send : c === "whatsapp" ? MessageCircle : Mail
                        const active = field.value === c
                        return (
                          <button
                            key={c}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => field.onChange(c)}
                            className={cn(
                              "flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              active ? "border-module bg-module/10 text-module" : "text-muted-foreground hover:border-border hover:text-foreground"
                            )}
                          >
                            <Icon size={15} aria-hidden="true" />
                            {tProc(`channel.${c}`)}
                          </button>
                        )
                      })}
                    </div>
                  </FormControl>
                  <p className="text-xs text-muted-foreground">{registered ? t("send.hint_registered") : t("send.hint_guest")}</p>
                </FormItem>
              )}
            />
            {channel === "whatsapp" && (
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("send.phone")}</FormLabel>
                    <FormControl>
                      <Input type="tel" dir="ltr" placeholder="05xxxxxxxx" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {channel === "email" && (
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("send.email")}</FormLabel>
                    <FormControl>
                      <Input type="email" dir="ltr" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("send.note")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("send.note_ph")} dir="auto" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            {channel !== "portal" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">{t("send.message")}</span>
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={copy}>
                    <Copy size={14} aria-hidden="true" />
                    {copied ? t("send.copied_short") : t("send.copy")}
                  </Button>
                </div>
                <Textarea readOnly value={message} rows={7} dir="auto" className="text-xs" />
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("send.effect")}</p>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("form.cancel")}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting} className="gap-2">
                {form.formState.isSubmitting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {t(`send.submit_${channel}`)}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
