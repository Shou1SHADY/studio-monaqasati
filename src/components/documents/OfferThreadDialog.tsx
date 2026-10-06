"use client"

import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DocumentThread } from "@/components/documents/DocumentThread"
import { offerThread, type OfferLike } from "@/lib/document-thread"
import type { ActivityPortal } from "@/lib/activity-writes"

/** The discussion on one offer, in a window: the buyer opens it from the offer's card. */
export function OfferThreadDialog({ offer, portal, onClose }: { offer: OfferLike; portal: ActivityPortal; onClose: () => void }) {
  const t = useTranslations("Portal.Thread")
  const thread = offerThread(offer)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("offer_title")}</DialogTitle>
          <DialogDescription dir="auto">{thread?.target.label}</DialogDescription>
        </DialogHeader>
        {thread ? <DocumentThread portal={portal} {...thread} /> : <p className="text-sm text-muted-foreground">{t("offer_unavailable")}</p>}
      </DialogContent>
    </Dialog>
  )
}
