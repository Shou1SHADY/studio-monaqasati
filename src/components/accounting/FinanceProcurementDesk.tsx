"use client"

// Finance's desk for Procurement (22 Sep review). The agreed flow: Procurement
// awards an offer and prepares the purchase order; FINANCE approves it — there
// may be no money for it — and only then is it sent and the supplier told.
// Approval already existed, but only inside Procurement's order screen, where
// Finance does not work. This puts the queue in the Finance module, with the
// same drawer, so the decision is made where the person making it already is.
//
// Nothing here is a new rule: who may approve, the value limit above which
// only the owner may, and "nobody approves their own order" are the order's
// own (`approvalRefusal`), and the drawer enforces them exactly as before.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ClipboardCheck, Loader2, Lock, Send } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { PoDrawer } from "@/components/procurement/PoDrawer"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { approvalRefusal, poStatus, poValue } from "@/lib/procurement/po"
import { displayPoNumber } from "@/lib/procurement/format"
import { formatSar } from "@/lib/crm"
import type { PurchaseOrder } from "@/lib/procurement/types"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { AccountingShell } from "./AccountingShell"

export function FinanceProcurementDesk({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const world = useProcurementWorld()
  const { orders, actor, policies, loading } = world
  const [now] = useState(() => new Date())
  const [openId, setOpenId] = useState<string | null>(null)

  const byNewest = (a: PurchaseOrder, b: PurchaseOrder) => (b.createdAt || "").localeCompare(a.createdAt || "")
  const awaiting = useMemo(() => orders.filter((po) => poStatus(po) === "awaiting_approval").sort(byNewest), [orders])
  const toSend = useMemo(() => orders.filter((po) => poStatus(po) === "approved").sort(byNewest), [orders])
  const mine = awaiting.filter((po) => approvalRefusal(po, actor, policies) === null)
  const openOrder = orders.find((po) => po.id === openId) || null
  const mayApproveAny = actor.isOwner || actor.canApprove

  return (
    <AccountingShell portal={portal} title={t("fpd_title")} description={t("fpd_desc")} icon={ClipboardCheck}>
      {!loading && !mayApproveAny && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock size={12} aria-hidden="true" />
          {t("fpd_no_permission")}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
        </div>
      ) : (
        <>
          <Section icon={ClipboardCheck} title={t("fpd_awaiting_title")} sub={t("fpd_awaiting_sub")} count={mine.length}>
            {awaiting.length === 0 ? (
              <Empty>{t("fpd_awaiting_empty")}</Empty>
            ) : (
              <OrderRows
                orders={awaiting}
                locale={locale}
                onOpen={setOpenId}
                note={(po) => {
                  const refusal = approvalRefusal(po, actor, policies)
                  return refusal ? t(`fpd_refusal_${refusal.code}`) : null
                }}
                t={t}
              />
            )}
          </Section>

          <Section icon={Send} title={t("fpd_to_send_title")} sub={t("fpd_to_send_sub")} count={0}>
            {toSend.length === 0 ? (
              <Empty>{t("fpd_to_send_empty")}</Empty>
            ) : (
              <OrderRows orders={toSend} locale={locale} onOpen={setOpenId} note={() => null} t={t} />
            )}
          </Section>
        </>
      )}

      <PoDrawer po={openOrder} world={world} open={Boolean(openOrder)} onOpenChange={(o) => !o && setOpenId(null)} now={now} />
    </AccountingShell>
  )
}

function OrderRows({
  orders,
  locale,
  onOpen,
  note,
  t,
}: {
  orders: PurchaseOrder[]
  locale: string
  onOpen: (id: string) => void
  note: (po: PurchaseOrder) => string | null
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <ul className="divide-y">
      {orders.map((po) => {
        const why = note(po)
        return (
          <li key={po.id}>
            <button
              type="button"
              onClick={() => onOpen(po.id)}
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-start transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-foreground" dir="ltr">{displayPoNumber(po.docNumber, locale)}</span>
                  <span className="truncate text-sm text-muted-foreground">{po.supplierName}</span>
                  {po.approverKind === "owner" && (
                    <Badge variant="outline" className="text-[10px]">{t("fpd_owner_approves")}</Badge>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {po.rfqTitle}
                  {po.preparedByName ? ` · ${t("fpd_prepared_by", { name: po.preparedByName })}` : ""}
                </span>
                {why && <span className="mt-0.5 block text-[11px] text-muted-foreground">{why}</span>}
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-foreground" dir="ltr">
                {formatSar(poValue(po), locale)}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Section({ icon: Icon, title, sub, count, children }: { icon: typeof Send; title: string; sub: string; count: number; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-white">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b bg-muted/30 px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-black text-foreground">
            <Icon size={15} className="text-primary" aria-hidden="true" />
            {title}
            {count > 0 && <Badge className="border-none bg-warning/10 text-[10px] tabular-nums text-warning">{count}</Badge>}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="p-6 text-center text-sm text-muted-foreground">{children}</p>
