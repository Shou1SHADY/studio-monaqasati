"use client"

// «تفاصيل الطلب» (R-13) and «المدعوّون» (R-14): the orders this RFQ produced,
// its city, privacy, pricing mode, who created it and when, the internal
// budget (price viewers only), attachments, the products with their need date
// and source, warranty and note — then the RFQ's log, and the buyer's actions.
// The invited list marks each company «قدّم عرضاً» / «لم يقدّم بعد».

import { useLocale, useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { Ban, ClipboardList, File, History, Package, Plus, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { Money, PoStatusPill, useDateText } from "@/components/procurement/PoBits"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { Link } from "@/i18n/routing"
import { displayCity } from "@/lib/constants"
import { procLinks } from "@/lib/procurement/events"
import { displayPoNumber } from "@/lib/procurement/format"
import { pricedProducts, pricingModeOf } from "@/lib/procurement/offer-pricing"
import { poValue } from "@/lib/procurement/po"
import { invitedRows, rfqLog, type InviteOfferLike, type RfqLogEntry } from "@/lib/procurement/rfq-detail"
import type { PurchaseOrder } from "@/lib/procurement/types"
import type { RfqView } from "./rfqOfferView"

const SOURCE_KEY: Record<string, string> = { mfg_purchase: "source.mfg", project_request: "source.project", stock_gap: "source.stock" }

export function RfqDetailsPanel({
  rfq,
  orders,
  showPrices,
  canCancel,
  onCancel,
  onRecordOffer,
}: {
  rfq: RfqView
  orders: PurchaseOrder[]
  showPrices: boolean
  canCancel: boolean
  onCancel: () => void
  /** «سجّل عرضاً وصل خارج المنصة» — while the RFQ is open, for whoever runs it. */
  onRecordOffer?: (() => void) | null
}) {
  const t = useTranslations("Portal.Procurement.rfqd")
  const locale = useLocale()
  const date = useDateText()
  const now = new Date()
  const products = pricedProducts(rfq)
  const privacy = rfq.directAward ? "direct" : rfq.visibility === "private" ? "private" : "public"

  return (
    <div className="space-y-4">
      {rfq.cancellation && (
        <Callout tone="info" title={t("details.cancelled_title")}>
          {t("details.cancelled_by", { reason: t(`cancel.code.${rfq.cancellation.code}`), name: rfq.cancellation.byName, date: date(rfq.cancellation.at) })}
        </Callout>
      )}
      {rfq.closedEarly && (
        <Callout tone="warn" title={t("details.closed_early_title")}>
          {t("details.closed_early_by", { name: rfq.closedEarly.byName, date: date(rfq.closedEarly.at), reason: rfq.closedEarly.reason })}
        </Callout>
      )}

      {orders.length > 0 && (
        <Panel title={t("details.orders")} icon={ClipboardList} count={orders.length} bodyClassName="p-0">
          <ul className="divide-y">
            {orders.map((po) => (
              <li key={po.id}>
                <Link href={procLinks.order(po.id)} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="min-w-0">
                    <b className="block" dir="auto">
                      <bdi>{displayPoNumber(po.docNumber, locale)}</bdi> · {po.supplierName}
                    </b>
                    <span className="block truncate text-[11px] text-muted-foreground" dir="auto">
                      {po.lines.map((l) => l.name).join(locale === "ar" ? "، " : ", ")}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {showPrices && <Money value={poValue(po)} className="text-xs font-bold" />}
                    <PoStatusPill po={po} now={now} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="border-t px-4 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">{t("details.split_note")}</p>
        </Panel>
      )}

      {(rfq.unawardedLines || []).length > 0 && <Callout tone="info">{t("details.unawarded", { count: (rfq.unawardedLines || []).length })}</Callout>}

      <Panel title={t("details.title")} icon={ClipboardList}>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <KeyValueRow label={t("details.city")} value={`${displayCity(rfq.city || "", locale)}${rfq.district ? ` — ${displayCity(rfq.district, locale)}` : ""}`} />
          <KeyValueRow label={t("details.privacy")} value={t(`privacy.${privacy}`)} />
          <KeyValueRow label={t("details.pricing")} value={pricingModeOf(rfq) === "line" ? t("details.pricing_line") : t("details.pricing_total")} />
          <KeyValueRow label={t("details.created_by")} value={`${rfq.createdByUserName || "—"} · ${date(rfq.createdAt)}`} />
        </div>
        {showPrices && rfq.estimatedBudget != null && Number(rfq.estimatedBudget) > 0 && (
          <Callout tone="info" className="mt-3">
            {t.rich("details.budget", { amount: () => <Money value={Number(rfq.estimatedBudget)} className="font-bold" /> })}
          </Callout>
        )}
      </Panel>

      {rfq.pdfUrl && (
        <Panel title={t("details.attachments")} icon={File} bodyClassName="p-0">
          <a href={rfq.pdfUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex items-center gap-2">
              <File size={14} aria-hidden="true" />
              {t("details.rfq_file")}
            </span>
            <span className="text-[11px] text-muted-foreground">{t("details.visible_to_suppliers")}</span>
          </a>
        </Panel>
      )}

      <Panel title={t("details.products")} icon={Package} count={products.length} bodyClassName="p-0">
        <ul className="divide-y">
          {products.map((p) => {
            const need = rfq.products?.[p.rfqProductIndex]?.needBy || rfq.needBy
            const unawarded = (rfq.unawardedLines || []).includes(p.rfqProductIndex)
            return (
              <li key={p.rfqProductIndex} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <b className="block" dir="auto">
                    {p.name || "—"}
                  </b>
                  <span className="text-[11px] text-muted-foreground">
                    {rfq.purchaseSource?.kind ? t(SOURCE_KEY[rfq.purchaseSource.kind] || "source.direct") : t("source.direct")}
                    {need ? ` · ${t("details.need", { date: date(need) })}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {unawarded && <StatusPill tone="mute">{t("details.back_to_needs")}</StatusPill>}
                  <b className="tabular-nums" dir="ltr">
                    {p.quantity.toLocaleString("en-US")}
                  </b>
                  <span className="text-xs text-muted-foreground">{p.unit}</span>
                </span>
              </li>
            )
          })}
        </ul>
        {rfq.requiresWarranty && <p className="border-t px-4 py-2 text-[11.5px] text-muted-foreground">{t("details.warranty")}</p>}
        {rfq.notes && (
          <p className="border-t px-4 py-2 text-sm text-foreground/80" dir="auto">
            {rfq.notes}
          </p>
        )}
      </Panel>

      {(canCancel || onRecordOffer) && (
        <div className="flex flex-wrap gap-2">
          {onRecordOffer && (
            <Button variant="outline" size="sm" className="gap-2" onClick={onRecordOffer}>
              <Plus size={14} aria-hidden="true" />
              {t("manual.button")}
            </Button>
          )}
          {canCancel && (
          <Button variant="outline" size="sm" className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onCancel}>
            <Ban size={14} aria-hidden="true" />
            {t("cancel.button")}
          </Button>
          )}
        </div>
      )}

      <RfqLogPanel entries={rfq.log} />
    </div>
  )
}

function RfqLogPanel({ entries }: { entries: RfqLogEntry[] | null | undefined }) {
  const t = useTranslations("Portal.Procurement.rfqd")
  const tc = useTranslations("Portal.Contractor")
  const date = useDateText()
  const rows = rfqLog(entries)
  if (!rows.length) return null
  const param = (v: string | number) => {
    if (typeof v !== "string" || !v.startsWith("@")) return v
    const key = v.slice(1)
    if (key.startsWith("exclusion.")) return tc(`offers_exclusion_${key.slice("exclusion.".length)}`)
    if (key.startsWith("rfqCancel.")) return t(`cancel.code.${key.slice("rfqCancel.".length)}`)
    return v
  }
  return (
    <Panel title={t("log.title")} icon={History} bodyClassName="p-0">
      <ul className="divide-y">
        {rows.map((e, i) => (
          <li key={`${e.at}-${i}`} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-sm">
            <span className="min-w-0" dir="auto">
              {t(`log.${e.action}`, Object.fromEntries(Object.entries(e.params || {}).map(([k, v]) => [k, param(v)])))}
              {e.note && <span className="block text-xs text-muted-foreground">{e.note}</span>}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {e.byName} · {date(e.at)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function RfqInvitedList({ rfq, offers, guestOffers }: { rfq: RfqView; offers: InviteOfferLike[]; guestOffers: number }) {
  const t = useTranslations("Portal.Procurement.rfqd")
  const rows = invitedRows(rfq, offers)
  if (!rows.length && !guestOffers) return null
  return (
    <Panel title={t("invited.title")} icon={Users} count={rows.length || undefined} bodyClassName="p-0">
      {rows.length > 0 ? (
        <ul className="divide-y">
          {rows.map((r) => (
            <InvitedRow key={r.orgId} orgId={r.orgId} offered={r.offered} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-2.5 text-xs text-muted-foreground">{t("invited.public")}</p>
      )}
      {guestOffers > 0 && <p className="border-t px-4 py-2 text-[11.5px] text-muted-foreground">{t("invited.guests", { count: guestOffers })}</p>}
    </Panel>
  )
}

function InvitedRow({ orgId, offered }: { orgId: string; offered: boolean }) {
  const t = useTranslations("Portal.Procurement.rfqd")
  const firestore = useFirestore()
  const ref = useMemoFirebase(() => (firestore ? doc(firestore, "users", orgId) : null), [firestore, orgId])
  const { data } = useDoc(ref)
  const name = ((data as { companyName?: string; name?: string } | null)?.companyName || (data as { name?: string } | null)?.name || "").trim()
  return (
    <li>
      <Link href={`/contractor/supplier/profile/${orgId}`} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0 truncate font-semibold" dir="auto">
          {name || t("invited.unknown")}
        </span>
        <StatusPill tone={offered ? "ok" : "mute"}>{offered ? t("invited.offered") : t("invited.not_yet")}</StatusPill>
      </Link>
    </li>
  )
}
