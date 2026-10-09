"use client"

import { useLocale, useTranslations } from "next-intl"
import { getDownloadURL, ref as storageRef } from "firebase/storage"
import { FileText, RefreshCcw } from "lucide-react"
import { useStorage } from "@/firebase"
import { formatCrmDate } from "@/lib/crm"
import { displayDocNumber } from "@/lib/sales-numbering"
import type { QuoteRequest } from "@/lib/sales-transfers"

/**
 * What a request from an opportunity carries (Opportunity journey v1.1, OPP-04): the deal's number and title, what we
 * deliver if we win, its details as written in CRM, the files picked to send, and the note to the pricer — or, for a
 * revision, which offer it revises and what the client asks. Shown in the requests inbox and above the composer, so the
 * pricer prices from the same facts CRM sent.
 */
export function QuoteRequestBrief({ request, compact = false }: { request: QuoteRequest; compact?: boolean }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const storage = useStorage()
  if (!request.opportunityId) return null

  const open = async (path: string) => {
    const url = await getDownloadURL(storageRef(storage, path))
    window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <div className="space-y-1.5 text-xs">
      <p className="flex flex-wrap items-center gap-1.5 font-semibold text-foreground">
        {request.opportunityNumber && (
          <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-black text-primary-foreground">
            <bdi dir="ltr">{displayDocNumber(request.opportunityNumber, locale)}</bdi>
          </span>
        )}
        <span dir="auto">{request.opportunityTitle}</span>
        {(request.deliverables || []).map((d) => (
          <span key={d} className="rounded-full border px-1.5 text-[10px] font-medium text-muted-foreground">
            {t(`crm_deliverable_${d}`)}
          </span>
        ))}
      </p>
      {request.kind === "revision" ? (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2 text-foreground" dir="auto">
          <RefreshCcw size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <span>
            <span className="font-bold">{t("sales_rq_revision_of", { number: displayDocNumber(request.revisionOfQuotationNumber, locale) })}</span>
            {request.note && <span className="block">«{request.note}»</span>}
          </span>
        </p>
      ) : (
        <>
          {request.details && (
            <p className={compact ? "line-clamp-2 text-muted-foreground" : "whitespace-pre-wrap text-muted-foreground"} dir="auto">
              {request.details}
            </p>
          )}
          {request.dueDate && <p className="text-muted-foreground">{t("sales_rq_offer_deadline", { date: formatCrmDate(request.dueDate, locale) })}</p>}
          {(request.files?.length ?? 0) > 0 && (
            <p className="flex flex-wrap gap-1.5">
              {request.files?.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => void open(f.path)}
                  className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <FileText size={11} aria-hidden="true" />
                  <bdi dir="auto">{f.name}</bdi>
                </button>
              ))}
            </p>
          )}
          {request.note && (
            <p className="text-muted-foreground" dir="auto">
              <span className="font-semibold">{t("crm_price_note")}:</span> {request.note}
            </p>
          )}
        </>
      )}
    </div>
  )
}
