"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarClock, Inbox, Loader2, Tag, XCircle, PencilLine } from "lucide-react"
import { collection, query, where } from "firebase/firestore"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { cn } from "@/lib/utils"
import { formatCrmDate } from "@/lib/crm"
import {
  QUOTE_DECLINE_REASONS,
  SALES_QUOTE_REQUESTS,
  declineQuoteRequest,
  type QuoteDeclineReason,
  type QuoteRequest,
} from "@/lib/sales-transfers"
import { displayDocNumber } from "@/lib/sales-numbering"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { salesBasePath } from "./SalesShell"

/**
 * The one door quote work arrives through: CRM's requests, priced or returned
 * with a factual reason. "Price it" opens the composer pre-filled. A request
 * with a draft stays here as "Finish the draft" — continued, never priced
 * twice — and leaves the inbox when that draft is ISSUED (RQ-04). A rep sees
 * only his own clients' requests (RQ-05).
 */
export function QuoteRequestsInbox({
  portal,
  orgId,
  actorName,
  mine,
}: {
  portal: CrmPortal
  orgId: string
  actorName: string
  /** The viewer's scope; omit to show every request. */
  mine?: (record: { contactId?: string | null }) => boolean
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canQuote = can("sales.manage")
  const base = salesBasePath(portal)

  const requestsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, SALES_QUOTE_REQUESTS), where("organizationId", "==", orgId), where("status", "==", "new"))
  }, [firestore, orgId])
  const { data } = useCollection(requestsQuery)
  const today = new Date().toISOString().slice(0, 10)
  const requests = useMemo(
    () =>
      ((data || []) as QuoteRequest[]).filter((r) => (mine ? mine(r) : true)).sort((a, b) => {
        const aLate = a.dueDate && a.dueDate < today ? 0 : 1
        const bLate = b.dueDate && b.dueDate < today ? 0 : 1
        return aLate - bLate || (a.dueDate || "9999").localeCompare(b.dueDate || "9999")
      }),
    [data, today, mine]
  )

  const [declining, setDeclining] = useState<QuoteRequest | null>(null)
  const [reason, setReason] = useState<QuoteDeclineReason | "">("")
  const [note, setNote] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  if (requests.length === 0) return null

  const decline = async () => {
    if (!firestore || !user || !declining || !reason || isSaving) return
    setIsSaving(true)
    try {
      await declineQuoteRequest(firestore, {
        request: declining,
        reason,
        note,
        actor: { id: user.uid, name: actorName },
        notification: {
          title: t("sales_rq_notif_declined_title"),
          message: t("sales_rq_notif_declined_msg", {
            number: declining.requestNumber,
            reason: t(`sales_rq_reason_${reason}`),
          }),
        },
      })
      toast({ title: t("sales_rq_declined_toast") })
      setDeclining(null)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-cta/30 bg-cta/[0.03] overflow-hidden">
      <header className="px-4 py-3 border-b border-cta/20 flex items-center gap-2">
        <Inbox size={16} className="text-cta" aria-hidden="true" />
        <h2 className="text-sm font-bold text-foreground">{t("sales_rq_inbox_title")}</h2>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cta/10 text-cta tabular-nums">{requests.length}</span>
      </header>
      <ul className="divide-y">
        {requests.map((r) => {
          const late = !!r.dueDate && r.dueDate < today
          return (
            <li key={r.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">{displayDocNumber(r.requestNumber, locale)}</span>
                  <span className="text-sm font-bold" dir="auto">{r.contactName || "—"}</span>
                  {r.dueDate && (
                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1", late ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-muted text-muted-foreground border-border")}>
                      <CalendarClock size={10} aria-hidden="true" />
                      {late ? t("sales_rq_overdue", { date: formatCrmDate(r.dueDate, locale) }) : t("sales_rq_due", { date: formatCrmDate(r.dueDate, locale) })}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5" dir="auto">
                  {r.lines.map((l) => `${l.quantity} ${l.unit} ${l.name}`).join(" · ")}
                  {" · "}
                  {t("sales_rq_requested_by", { name: r.requestedByUserName })}
                </p>
                {r.note && <p className="text-xs text-muted-foreground mt-0.5" dir="auto">{r.note}</p>}
              </div>
              {canQuote && (
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/5" onClick={() => { setDeclining(r); setReason(""); setNote("") }}>
                    <XCircle size={13} />
                    {t("sales_rq_decline_btn")}
                  </Button>
                  <Button size="sm" className="h-8 gap-1.5" asChild>
                    {r.draftQuotationId ? (
                      <Link href={`${base}/quotations/new?draft=${r.draftQuotationId}`}>
                        <PencilLine size={13} />
                        {t("sales_rq_finish_draft_btn")}
                      </Link>
                    ) : (
                      <Link href={`${base}/quotations/new?request=${r.id}`}>
                        <Tag size={13} />
                        {t("sales_rq_price_btn")}
                      </Link>
                    )}
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <Dialog open={!!declining} onOpenChange={(open) => { if (!isSaving && !open) setDeclining(null) }}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-md w-[calc(100vw-2rem)] overflow-x-hidden max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pe-8">{declining && t("sales_rq_decline_title", { number: declining.requestNumber })}</DialogTitle>
            <DialogDescription>{t("sales_rq_decline_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 min-w-0">
            <div role="radiogroup" aria-label={t("sales_rq_decline_desc")} className="space-y-1">
              {QUOTE_DECLINE_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={reason === r}
                  disabled={isSaving}
                  onClick={() => setReason(r)}
                  className={cn(
                    "w-full text-start rounded-lg border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    reason === r ? "border-primary bg-primary/5" : "border-slate-200 hover:border-slate-300"
                  )}
                >
                  {t(`sales_rq_reason_${r}`)}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rq-decline-note">{t("sales_rq_decline_note")}</Label>
              <Textarea id="rq-decline-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={isSaving} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclining(null)} disabled={isSaving}>{t("crm_cancel")}</Button>
            <Button variant="destructive" onClick={decline} disabled={isSaving || !reason} className="gap-2">
              {isSaving ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />}
              {t("sales_rq_decline_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
