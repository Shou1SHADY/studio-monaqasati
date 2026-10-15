"use client"

// "What a subscription adds" (PRD SUB-02): the free account next to the subscribed one, and a way to talk to
// Mdmak. Nothing free is locked and the window never appears inside a workflow.

import { Check, Sparkles } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFree } from "./useFree"

const FREE = ["upgF1", "upgF2", "upgF3", "upgF4"] as const
const PAID = ["upgP0", "upgP1", "upgP2", "upgP3", "upgP4", "upgP5", "upgP6"] as const

export function SubscriptionDialog({ onClose }: { onClose: () => void }) {
  const { t } = useFree()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-cta" aria-hidden="true" />
            {t("upgModalT")}
          </DialogTitle>
          <DialogDescription>{t("upgModalSub")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-xl border bg-muted/30 p-4">
            <h3 className="mb-2 text-sm font-bold text-success">{t("upgFreeT")}</h3>
            <ul className="space-y-2 text-sm">
              {FREE.map((k) => (
                <li key={k} className="flex gap-2">
                  <Check size={15} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                  {t(k)}
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-cta/30 bg-cta/5 p-4">
            <h3 className="mb-2 text-sm font-bold text-cta">{t("upgPaidT")}</h3>
            <ul className="space-y-2 text-sm">
              {PAID.map((k) => (
                <li key={k} className="flex gap-2">
                  <Check size={15} className="mt-0.5 shrink-0 text-cta" aria-hidden="true" />
                  {t(k)}
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
          <Button asChild>
            <Link href="/contact" onClick={onClose}>
              {t("upgCta")}
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
