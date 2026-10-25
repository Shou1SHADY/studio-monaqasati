"use client"

// The RFQ page's «التفاصيل» tab, the prototype's two other panels (rdDet): «التسليم والشروط» — where it goes, when it is needed, how it
// is paid, the deadline (and the early close), the delivery options and the access note, the notes to suppliers — with «مدّد الموعد»
// while it is open; and «الطلبات الواردة فيه» — the incoming requests whose materials it holds, each opening that request.

import { useLocale, useTranslations } from "next-intl"
import { ChevronLeft, ClipboardList, Inbox, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useDateText } from "@/components/procurement/PoBits"
import { Link } from "@/i18n/routing"
import { displayCity } from "@/lib/constants"
import { deliveryLine, readDeliveryOptions } from "@/lib/procurement/delivery-options"
import { siteLine } from "@/lib/procurement/delivery-sites"
import { displayNeedRef } from "@/lib/procurement/format"
import type { IncomingDoc, RequestSt } from "@/lib/procurement/incoming-state"
import { needKeyOfMr } from "@/lib/procurement/incoming-need"
import type { RfqView } from "./rfqOfferView"

const STATE_KEY: Record<RequestSt, string> = { new: "new", prep: "prepared", part: "partial", rfq: "rfq", po: "order", done: "done", fail: "failed", wd: "withdrawn" }

type Group = { label?: string; city?: string; district?: string }

export function RfqTermsPanel({ rfq, onExtend }: { rfq: RfqView; onExtend?: (() => void) | null }) {
  const t = useTranslations("Portal.Procurement.rfqd")
  const te = useTranslations("Portal.ProcEditor")
  const tl = useTranslations("Portal.Procurement.rfqlife")
  const locale = useLocale()
  const date = useDateText()
  const extra = rfq as RfqView & { needBy?: string | null; editorGroups?: Group[] | null; deliveryOptions?: unknown }

  const places = Array.from(
    new Set(
      (extra.editorGroups?.length ? extra.editorGroups : [{ city: rfq.city || "", district: rfq.district || "" }])
        .map((g) => siteLine({ city: g.city || "", district: g.district || "" }, (c) => displayCity(c, locale)))
        .filter(Boolean),
    ),
  )
  const needs = [extra.needBy, ...(rfq.products || []).map((p) => p.needBy)].filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort()
  const terms = rfq.paymentTermsList?.length ? rfq.paymentTermsList.map((r) => te("terms_row", { pct: r.pct, days: r.days })).join(" + ") : te("terms_offer")
  const options = readDeliveryOptions(extra.deliveryOptions)
  const optionLines = Array.from(new Set(Object.values(options).map((d) => deliveryLine(d, te)).filter(Boolean)))
  const notes = Array.from(new Set(Object.values(options).map((d) => d.note).filter((n): n is string => !!n)))
  const early = rfq.closedEarly
  const open = rfq.status === "New"

  return (
    <Panel title={t("terms.title")} icon={Truck}>
      <div className="grid gap-x-6 sm:grid-cols-2">
        <KeyValueRow label={t("terms.delivery_in")} value={places.join(" · ") || "—"} />
        <KeyValueRow label={t("terms.needed_by")} value={needs[0] ? date(needs[0]) : "—"} />
        <KeyValueRow label={t("terms.payment")} value={terms} />
        <KeyValueRow label={t("terms.deadline")} value={rfq.deadline ? (early ? t("terms.deadline_early", { date: date(rfq.deadline), closed: date(early.at) }) : date(rfq.deadline)) : "—"} />
        {optionLines.length > 0 && <KeyValueRow label={t("terms.delivery_options")} value={optionLines.join(" · ")} />}
        {notes.length > 0 && <KeyValueRow label={t("terms.access_note")} value={notes.join(" · ")} />}
      </div>
      {rfq.notes && <KeyValueRow label={t("terms.notes")} value={<span dir="auto">{rfq.notes}</span>} />}
      {open && onExtend && (
        <div className="mt-3">
          <Button type="button" variant="outline" size="sm" onClick={onExtend}>
            {tl("extend_title")}
          </Button>
        </div>
      )}
    </Panel>
  )
}

export function RfqRequestsPanel({ requests }: { requests: ReadonlyArray<IncomingDoc> }) {
  const t = useTranslations("Portal.Procurement.rfqd")
  const ts = useTranslations("Portal.Shared")
  const locale = useLocale()
  if (!requests.length) return null
  return (
    <Panel title={t("requests.title")} icon={Inbox} count={requests.length} bodyClassName="p-0">
      <ul className="divide-y">
        {requests.map((r) => (
          <li key={r.mrKey}>
            <Link
              href={`/contractor/rfqs/requests?seg=all&publish=${encodeURIComponent(needKeyOfMr(r.mrKey))}&step=1`}
              className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex min-w-0 items-center gap-2">
                <ClipboardList size={14} className="shrink-0 text-module" aria-hidden="true" />
                <b dir="auto">{displayNeedRef(r.no, locale)}</b>
                <span className="truncate" dir="auto">
                  {r.projectName || r.place.label}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <StatusPill tone="mute">{ts(`rq_state_${STATE_KEY[r.st]}`)}</StatusPill>
                <ChevronLeft size={14} className="text-muted-foreground ltr:rotate-180" aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
