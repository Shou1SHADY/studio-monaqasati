"use client"

// «الشراء بالأجل — قريباً»: what is coming, in three steps, opened from the sidebar's dimmed entry (and by the award review,
// the order drawer and the payment terms when they place their own «قريباً»). It only explains: nothing is stored or sent.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Bell, Info, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { askToBeNotified } from "@/lib/procurement/soon-notify"

const STEPS = ["choose", "paid", "instalments"] as const

export function BnplSoonDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("Portal.ProcSoon")
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
      toast({ title: t("notified") })
    } else toast({ title: t("notify_failed"), variant: "destructive" })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("sub")}</DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {STEPS.map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-module/10 text-sm font-black text-module">{i + 1}</span>
              <div className="min-w-0 text-sm">
                <b className="block">{t(`${step}_title`)}</b>
                <span className="text-muted-foreground">{t(`${step}_body`)}</span>
              </div>
            </li>
          ))}
        </ol>
        <p className="flex gap-2 rounded-xl bg-cta/5 p-3 text-xs leading-relaxed text-foreground">
          <Info size={15} className="mt-0.5 shrink-0 text-cta" aria-hidden="true" />
          {t("where")}
        </p>
        <DialogFooter>
          <Button className="gap-1.5" disabled={busy || !user} onClick={() => void notify()}>
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Bell size={14} aria-hidden="true" />}
            {t("notify")}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
