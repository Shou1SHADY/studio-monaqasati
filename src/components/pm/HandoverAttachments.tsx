"use client"

import { useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { getDownloadURL, ref as storageRef } from "firebase/storage"
import { FileText } from "lucide-react"
import { OfferPdfButton } from "@/components/crm/OfferPdfButton"
import { useDoc, useFirestore, useMemoFirebase, useStorage } from "@/firebase"
import { CRM_QUOTATIONS, type CrmQuotation } from "@/lib/crm"
import type { HandoverExtras } from "@/lib/pm/handover-writes"

/**
 * The files a handover carries (Opportunity journey v1.1, OPP-07 #4): the accepted offer — Sales' own document for the
 * version the client accepted — and the signed contract, the priced BOQ and whatever else CRM picked. Each opens with a
 * fresh link; nothing is copied into Projects until the manager accepts the file.
 */
export function HandoverAttachments({ extras }: { extras: HandoverExtras }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const storage = useStorage()
  const offerRef = useMemoFirebase(() => (firestore && extras.acceptedOffer?.id ? doc(firestore, CRM_QUOTATIONS, extras.acceptedOffer.id) : null), [firestore, extras.acceptedOffer?.id])
  const { data: offer } = useDoc(offerRef)
  const files = extras.files ?? []
  if (!extras.acceptedOffer && files.length === 0) return <span className="font-normal text-muted-foreground">{t("crm_handover_no_attachments")}</span>

  const open = async (path: string) => {
    const url = await getDownloadURL(storageRef(storage, path))
    window.open(url, "_blank", "noopener,noreferrer")
  }
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {offer && <OfferPdfButton quote={{ ...(offer as Omit<CrmQuotation, "id">), id: extras.acceptedOffer?.id ?? "" } as CrmQuotation} />}
      {files.map((f) => (
        <button
          key={f.path}
          type="button"
          onClick={() => void open(f.path)}
          className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11px] font-normal hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileText size={11} aria-hidden="true" />
          <bdi dir="auto">{f.name}</bdi>
        </button>
      ))}
    </span>
  )
}
