"use client"

// «بالأجل عبر مدماك — قريباً» (CMP-13, ED-07): the chip is switched off; pressing it only explains what is coming and where it will
// be chosen. «أبلغني حين يُطلق» (ED-20) records the member's interest through the server-only notify-me route — nothing else.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Bell, Clock, Loader2 } from "lucide-react"
import { useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { askToBeNotified } from "@/lib/procurement/soon-notify"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Callout } from "@/components/module-ui/Callout"

const STEPS = ["s1", "s2", "s3"] as const

export function BnplSoonDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("Portal.ProcEditor")
  const ts = useTranslations("Portal.ProcSoon")
  const locale = useLocale()
  const { user } = useUser()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const notify = async () => {
    if (!user) return
    setBusy(true)
    const saved = await askToBeNotified(await user.getIdToken(), "bnpl")
    setBusy(false)
    if (saved) {
      onOpenChange(false)
      toast({ title: ts("notified") })
    } else toast({ title: ts("notify_failed"), variant: "destructive" })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-md">
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle>{t("bnpl_title")}</DialogTitle>
          <DialogDescription>{t("bnpl_sub")}</DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-module/10 text-xs font-bold text-module">{i + 1}</span>
              <div>
                <b className="block text-sm">{t(`bnpl_${s}_t`)}</b>
                <span className="text-xs text-muted-foreground">{t(`bnpl_${s}_d`)}</span>
              </div>
            </li>
          ))}
        </ol>
        <Callout tone="info">
          <span className="inline-flex items-start gap-1.5">
            <Clock size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {t("bnpl_note")}
          </span>
        </Callout>
        <DialogFooter>
          <Button type="button" className="gap-1.5" disabled={busy || !user} onClick={() => void notify()}>
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Bell size={14} aria-hidden="true" />}
            {ts("notify")}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("bnpl_close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
