"use client"

// Down payments a client order waits on — Finance's side of the deposit gate
// (finance.down_payment.confirmed). Confirming one opens delivery on the sales
// order and, through the same fact, the release of its work orders; the
// workshop is told.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Banknote, Loader2, Lock } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { formatSar } from "@/lib/crm"
import { SALES_ORDERS, depositTotal, type SalesOrder } from "@/lib/sales-orders"
import { markDepositPaid } from "@/lib/sales-order-writes"
import { emitDownPaymentConfirmed } from "@/lib/mfg-events"

export function SalesDepositsToConfirm({
  orgId,
  actor,
  canConfirm,
  ordersHref,
}: {
  orgId: string | null
  actor: { id: string; name: string }
  canConfirm: boolean
  ordersHref: string
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const ordersQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, SALES_ORDERS), where("organizationId", "==", orgId), where("status", "==", "awaiting_deposit"))
  }, [firestore, orgId])
  const { data } = useCollection(ordersQuery)
  const waiting = useMemo(
    () => ((data || []) as SalesOrder[]).filter((o) => o.payment?.kind === "deposit" && !o.payment.depositPaid).sort((a, b) => a.orderNumber - b.orderNumber),
    [data]
  )

  if (!waiting.length) return null

  const confirm = async (order: SalesOrder) => {
    if (!firestore || busyId) return
    setBusyId(order.id)
    try {
      await markDepositPaid(firestore, order)
      toast({ title: t("so_deposit_marked") })
      await emitDownPaymentConfirmed(firestore, { copy: t, organizationId: order.organizationId, salesOrderId: order.id, salesOrderNumber: order.orderNumber, actor })
    } catch (err) {
      console.error(err)
      toast({ title: t("so_save_error"), variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="rounded-2xl border border-warning/30 bg-warning/5 p-4 space-y-3" aria-labelledby="sales-deposits-title">
      <div className="flex items-start gap-2">
        <Lock size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id="sales-deposits-title" className="text-sm font-black text-foreground">
            {t("sales_deposits_title", { count: waiting.length })}
          </h2>
          <p className="text-xs text-muted-foreground">{t("sales_deposits_desc")}</p>
        </div>
      </div>
      <ul className="divide-y overflow-hidden rounded-xl border bg-white">
        {waiting.map((o) => (
          <li key={o.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${ordersHref}?open=${o.id}`}
                  className="rounded-sm text-xs font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("so_order_no", { number: o.orderNumber })}
                </Link>
                <span className="text-sm font-bold text-foreground" dir="auto">
                  {o.contactName || o.projectName || "—"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("sales_deposit_share", { percent: o.payment.depositPercent ?? 0 })}
                {o.payment.depositReportedAt && (
                  <span className="ms-1.5 font-semibold text-cta">· {t("so_deposit_reported", { name: o.payment.depositReportedBy || "" })}</span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-sm font-black tabular-nums text-warning" dir="ltr">
                {formatSar(depositTotal(o), locale)}
              </span>
              {canConfirm && (
                <Button size="sm" className="h-8 gap-1.5" disabled={!!busyId} onClick={() => confirm(o)}>
                  {busyId === o.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Banknote size={13} aria-hidden="true" />}
                  {t("so_deposit_confirm")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
